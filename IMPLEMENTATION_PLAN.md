# Implementation Plan — Item #12 Refinements & Item #13: Scheduled QBR

**Status**: Waiting for user **APPROVED** before writing code.  
**Roadmap Items**:
- **Item #12 Refinements**: Data Health Panel (6 Critical Production Safeguards)
- **Item #13**: Scheduled QBR Engine (Batch 3 Final Item)

---

## Part 1: Item #12 Data Health Panel — 6 Production Safeguards

### 1. Standardized Content-Disposition Header & JobId Sanitization
On both `/export?format=xlsx` and `/export?format=pdf` endpoints, the filename dynamically interpolates a strictly sanitized `jobId`:
```javascript
const safeJobId = String(jobId || 'latest').replace(/[^a-zA-Z0-9_-]/g, '_');
const filename = `Data_Health_Report_${safeJobId}.${format}`;
```
- **Sanitization Guard**: Strips CRLF (`\r`, `\n`), quotation marks (`"`), slashes, and spaces to eliminate HTTP header injection and filename tampering vulnerabilities.
- For Excel: `Content-Disposition: attachment; filename="Data_Health_Report_job_123.xlsx"`
- For PDF: `Content-Disposition: attachment; filename="Data_Health_Report_job_123.pdf"`

### 2. Invariant Reconciliation: R1 vs R5 (Excluding Stock from Sites)
- **R1 (Physical Inventory Conservation)**:
  $$\text{Active Switches} + \text{Active APs} + \text{Stock Devices} = \text{Total Devices}$$
- **R5 (Site Device Allocation Consistency)**:
  Site summary tables explicitly represent operational devices installed at client store/branch sites. Unassigned spare/shelf hardware in warehouse storage (`stockDevices`) is NOT part of site device allocations.
  $$\sum_{s \in \text{sites}} s.\text{deviceCount} = \text{Total Active Devices} = \text{Total Devices} - \text{Stock Devices}$$
  - **Formula**: `Sum of Site Device Counts = Total Active Devices (Total Devices - Stock Devices)`
  - **Expected Value**: `totalDevices - stockDevices`
  - Eliminates false positive invariant violations on datasets with stock inventory.

### 3. Removal of Shared `qbrData` Deep-Freeze
- Remove `Object.freeze` / `deepFreeze` on the shared in-memory `qbrData` object. Freezing shared references introduces runtime `TypeError` risks in downstream middleware or routes that annotate transient properties.
- Immutability is enforced contractually by ensuring `dataHealthService.js` operates purely as a read-only scanner without mutating any inputs.

### 4. Empty / Minimal Dataset: `INSUFFICIENT_DATA` Status
When a dataset contains 0 devices and 0 incidents:
- **Status**: `"INSUFFICIENT_DATA"` (never `"HEALTHY"`).
- **Health Score**: `null` (displayed in the UI as `"N/A"`).
- **Audit Detail**: `"Insufficient data to evaluate health metrics (0 devices and 0 incidents found)."`
- All invariant checks marked as not applicable with clear explanatory text.
- Includes automated test assertion verifying `status === 'INSUFFICIENT_DATA'` and `score === null`.

### 5. PDF & Excel Export DoS Protection: Rate Limiting, Headers & Scopes
- **Per-Tenant Rate Limiting**: Added `checkExportRateLimit(tenantId)` allowing a maximum of 5 export requests per 60 seconds per tenant. If exceeded, returns HTTP 429 Too Many Requests (`RATE_LIMIT_EXCEEDED`) with header `Retry-After: 60` and JSON `{ code: 'RATE_LIMIT_EXCEEDED', retryAfter: 60 }`.
  - *Architecture Note & Known Limitation*: Implemented as an in-memory sliding window map (`_exportRateMap`), suitable for single-instance / development setups. In horizontally autoscaled multi-pod environments, this should be backed by Redis `INCR` + `EXPIRE` leveraging the Redis client from `queueService`.
- **Hard Limit**: Maximum 2,000 issues exported. If `?strict=true` and count > 2,000, returns HTTP 413 Payload Too Large (`PAYLOAD_TOO_LARGE`). Otherwise automatically caps to top 2,000 issues with a visible notice banner.
- **Unicode Glyph Transliteration**: Pure Node.js PDF 1.4 generator translates Unicode symbols (`⚠️` $\to$ `[!]`, `₹` $\to$ `INR `, `🟢` $\to$ `[PASS]`, etc.) to guarantee 100% crash-free Type 1 Helvetica font streams.
- **Export Scope Separation (1-Page Executive PDF vs Full Excel)**:
  - **PDF Export**: Strictly a 1-page **Executive Summary** by design (top 10 prioritized issues, all 5 mathematical invariant conservation audits, health metrics, and operational recommendations).
  - **Excel (.xlsx) Export**: Dedicated to full-catalog data audits, exporting complete data up to the 2,000-issue cap across multi-tab structured worksheets (`Executive Summary`, `Invariant Rules`, `Data Hygiene Issues`, `Operational Recommendations`). Full 2,000-issue data is in XLSX.

### 6. Lazy-Load Job Pinning & Stale Cache Invalidation
- **Job-Pinned Fetch**: `DataHealthModal.jsx` must pass `?jobId=${activeJobId || 'latest'}` on every `/api/data-health/issue/:issueId` call.
- **Scoped Cache Key**: Snapshot cache key is scoped by job: `${activeJobId || 'default'}_${issue.id}`.
- **Cache Invalidation on Refresh**: Whenever `activeJobId` changes or the dataset refreshes, `snapshotCache` is wiped clean (`setSnapshotCache({})`), preventing stale row snapshots from bleeding across jobs.
- Added test in `DataHealthModal.test.jsx` verifying that changing `activeJobId` clears cached row previews.

---

## Part 2: Item #13 Scheduled QBR Engine Plan

### 1. Overview & Objectives
The **Scheduled QBR** engine automates recurring report generation for enterprise tenants across multiple independent schedules (e.g. Weekly Ops report for NOC + Monthly Executive QBR for Leadership). It eliminates manual report execution at period close by:
1. **Automated Dynamic Period Resolution**: Automatically resolving previous month, quarter, or weekly boundaries (e.g., dynamically generating `1 May 2026 – 31 May 2026` on June 1st) with zero static hardcoded date strings.
2. **Template Version Pinning (Item #11 Integration)**: Schedules pin a specific template version (`v1`, `v2`) or track `"latest"`. If a pinned template is pruned/deprecated, generation halts safely and alerts the NOC.
3. **Multi-Schedule Architecture per Tenant**: Supports an array of multiple distinct schedules per tenant (`data/tenants/{tenantId}/schedules/schedules.json`), each with its own cadence, timezone, pinned template, and recipients.
4. **Crash Mid-Run Recovery**: Writes a `PENDING` run record at execution start; reconciles unfinalized runs on boot, marking dead/crashed jobs as `FAILED` and notifying administrators.
5. **Strict Lock Ordering & Backoff**: Acquires `tenantLock` FIRST (guaranteeing pipeline exclusivity with 3x backoff) and distributed `schedule_lock` SECOND (preventing multi-pod double-fire), releasing in reverse order.
6. **Idempotency Key & Job Deduplication**: Period-bound dedup key `{tenantId}:{scheduleId}:{cadence}:{periodStart}:{periodEnd}` (TTL 24h) preventing duplicate report generations and returning HTTP 409 `DUPLICATE_JOB` on redundant ad-hoc triggers.
7. **Missed-Run Boot Recovery**: On startup, `initSchedulers()` compares `lastRunAt` against `now` to detect missed calendar slots from server downtime, triggering an immediate catch-up run logged as `MISSED_RUN_RECOVERED`.
8. **Failure Alerting Dispatcher**: Active `notifyFailure(tenantId, error)` hook delivering notifications to `config.recipients` (throttled to 1/hr per error code) and surfacing 🔴 status alerts on tenant dashboard cards.
9. **Clean Teardown & Isolated Test Timers**: Exporting `stopAll()` to stop every registered standing cron task, guaranteeing 0 hanging timers and crash-free test exits.

---

### 2. Architecture & Data Flow

```
   ┌─────────────────────────────────────────────────────────────┐
   │             node-cron Standing Tasks (v4.6.0)               │
   │  - Configured with tenant IANA timezone (e.g. Asia/Kolkata) │
   │  - Distinct task per scheduleId: 'sched_monthly', etc.      │
   └──────────────────────────────┬──────────────────────────────┘
                                  │ (Slot fires at wall-clock hour)
                                  ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  LOCK ORDERING:                                             │
   │  1. queueService.acquireTenantLock(tenantId) [3x backoff]   │
   │  2. Redis SETNX schedule_lock:{tenant}:{schedId}:{slot} (5m)│
   └──────────────────────────────┬──────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────┐
   │         backend/services/schedulerService.js                │
   │  1. Write PENDING run record to runs.json (at start)        │
   │  2. Idempotency Check: dedup_qbr:{tenant}:{sched}:{period}  │
   │  3. Template Pinning: Resolve pinnedVersion from manifest   │
   │  4. Run QBR processing; on fail -> notifyFailure(1/hr cap)  │
   │  5. Finalize run record to SUCCESS/FAILED (capped 100 runs) │
   │  6. Release locks in REVERSE order (schedule_lock, tenant)  │
   └──────────────────────────────┬──────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────┐
   │         backend/routes/scheduleRoutes.js                    │
   │  - Boot Readiness Gate: rejects with 503 until init done    │
   │  - GET /api/tenants/:id/schedules (Read-only for Clients)   │
   │  - POST /api/tenants/:id/schedules (Admin; optimistic lock) │
   │  - POST /api/tenants/:id/schedules/:schedId/trigger (Run)   │
   │  - DELETE /api/tenants/:id/schedules/:schedId (Admin)       │
   └──────────────────────────────┬──────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────┐
   │     frontend/src/components/ScheduleManagerModal.jsx        │
   │  - Schedule List with "+ Add Schedule" and Edit Drawer      │
   │  - Cadence: Monthly | Quarterly | Weekly | Custom Cron      │
   │  - Template Version Dropdown: 'Latest Active' vs Pinned 'v2'│
   │  - Timezone Dropdown from Intl.supportedValuesOf('timeZone')│
   │  - Execution History Table with evicted 404 artifact guard  │
   │  - ⚡ Run Now Trigger Button (Admin Only; HTTP 409 handled) │
   └─────────────────────────────────────────────────────────────┘
```

---

### 3. Dynamic Period Resolution & Timezone Rules (Zero Hardcoded Dates)

When a scheduled job fires, it derives calendar dates according to the configured cadence:

| Cadence | Execution Timing | Derived Date Period Formulation |
|---|---|---|
| **Monthly** | 1st day of month at 06:00 (local timezone) | Previous full calendar month (e.g. if run on June 1, `2026-05-01` to `2026-05-31`). Formatted as `1 May 2026 – 31 May 2026`. Respects 28/29/30/31 calendar days. |
| **Quarterly** | 1st day of quarter at 06:00 (Jan 1, Apr 1, Jul 1, Oct 1) | Previous full calendar quarter (e.g. if run on July 1, Q2: `2026-04-01` to `2026-06-30`). Formatted as `1 Apr 2026 – 30 Jun 2026`. |
| **Weekly** | Every Monday at 06:00 (local timezone) | Preceding 7 full calendar days (Monday to Sunday). |
| **Custom Cron** | User-defined 5-field cron expression | Restricted to $\ge 24\text{h}$ frequency. Defaults to previous calendar month. Custom date ranges are strictly capped at 1 year and future dates are rejected with HTTP 400 (`FUTURE_DATE_REJECTED`). Sub-daily schedules rejected with HTTP 400 (`SUB_DAILY_CRON_NOT_SUPPORTED`). |

#### Timezone Conversion & DST Policy:
- **Tenant Timezone Pre-Conversion**: `derivePeriodForCadence(cadence, refDate, timezone)` converts `refDate` to the tenant's IANA timezone (via `Intl.DateTimeFormat`) **before** extracting year/month/day. On UTC servers, a trigger at June 1 06:00 IST (`2026-05-31T00:30:00Z` UTC) converts to June 1 in IST and correctly derives May (`2026-05-01` to `2026-05-31`), preventing wrong-month skew.
- **Tenant Timezone Binding**: `timezone` stored per schedule (defaults to tenant settings from `clientService`, e.g. `'Asia/Kolkata'`, never server OS timezone).
- **node-cron Timezone Execution**: Instantiated with `{ timezone: schedule.timezone }`.
- **Daylight Saving Time (DST) Handling**: `node-cron` evaluates standard IANA timezones against local wall-clock time:
  - Spring-Forward (skipped hour): When 02:00 springs to 03:00, schedules falling in the skipped hour execute immediately at the transition boundary.
  - Fall-Back (repeated hour): When 02:00 repeats, schedules execute once on the first occurrence.

---

### 4. Six Core System Blockers Resolved

#### 1. Custom Cron Frequency Restriction & Semantic Validation
- **Problem**: Sub-daily custom cron (e.g. `"0 */6 * * *"` or `"*/15 * * * *"`) fires multiple times per day/month, but since the derived period defaults to the previous calendar month, every run after the first shares the exact same dedup key and is silently dropped, executing only once per month. Furthermore, typos like `"* * * * *"` would trigger 1,440 runs/day and OOM the server.
- **Solution**: Restrict custom cron to $\ge 24\text{ hours}$ frequency.
  - `cron.validate(expr)` checks 5-field syntax.
  - Semantic validation checks interval between consecutive executions: if interval $< 24\text{ hours}$, reject with **HTTP 400 `SUB_DAILY_CRON_NOT_SUPPORTED`** or **`CRON_FREQUENCY_TOO_HIGH`**.
  - QBR cadences are strictly daily or slower by definition.

#### 2. Period Derivation Timezone Conversion
- `derivePeriodForCadence(cadence, refDate, timezone = 'UTC')`:
  - Uses `new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', hourCycle: 'h23' })` to project `refDate` into the tenant's local calendar day before deriving period boundaries.
  - Guarantees that UTC cloud servers running jobs for IST/JST/PST tenants always resolve the correct calendar month.
  - Test: System timezone UTC, tenant timezone `Asia/Kolkata`, trigger at June 1 06:00 IST $\to$ derived period is May 1 – May 31.

#### 3. Template Version Pinning (Item #11 Integration)
- **Schedule Schema**: Includes `templateVersion: "latest" | "v1" | "v2" | ...` (defaults to `"latest"`).
- **Resolution Logic**:
  - Reads tenant manifest from `templateService.getManifest(tenantId)`.
  - If `"latest"`, uses `manifest.activeVersionId` (or master template fallback if tenant has no custom versions).
  - If pinned to a specific version (e.g. `"v2"`), loads `templates/versions/{versionId}.pptx`.
  - **Pruned / Deprecated Guard**: If the pinned version has been pruned by the 5-version retention policy or deleted, generation halts safely, does NOT fall back silently, triggers `notifyFailure(tenantId, 'PINNED_TEMPLATE_DEPRECATED')`, and logs `status: 'FAILED'`.
- **Admin UI**: Dropdown offering `"Latest Active Template (Auto-Update)"` alongside all uploaded versions (`v1 — 1 May 2026`, `v2 — 15 May 2026`).
- **Test Assertion**: Pinned `v2` + new active version uploaded as `v3` $\to$ report generation strictly uses `v2`.

#### 4. Crash Mid-Run Recovery
- **Execution State Journaling**:
  - At the exact start of execution, write a `PENDING` run record to `runs.json`:
    `{ id, scheduleId, runAt, status: 'PENDING', jobId, dedupKey, cadence, period }`.
  - On successful completion, update the record to `status: 'SUCCESS'`. On catch error, update to `status: 'FAILED'`.
- **Boot Reconciliation**:
  - During `initSchedulers()`, scan all tenant `runs.json` files for lingering `PENDING` records.
  - For each `PENDING` run, query `queueService.getJob(jobId)`.
  - If the job is missing, aborted, or dead due to a server crash, transition the run record to `status: 'FAILED'`, `error: 'Server crashed mid-execution. Job terminated.'`, and trigger `notifyFailure(tenantId, 'SERVER_CRASH_MID_RUN', run)`.
  - Eliminates silent job loss and prevents zombie duplicate executions when dedup keys expire.

#### 5. Multiple Schedules Per Tenant Architecture
- **Schema & Persistence**: Tenants can configure multiple distinct schedules stored in `data/tenants/{tenantId}/schedules/schedules.json` (array of schedule objects):
  ```javascript
  [
    {
      id: "sched_monthly_exec",
      name: "Monthly Executive QBR",
      enabled: true,
      cadence: "monthly",
      cronExpression: "0 6 1 * *",
      timezone: "Asia/Kolkata",
      templateVersion: "latest",
      recipients: ["cio@dominos.in"],
      lastRunAt: "2026-05-01T06:00:00.000Z",
      nextRunAt: "2026-06-01T06:00:00.000Z",
      lastStatus: "SUCCESS",
      lastError: null,
      updatedAt: "2026-05-22T02:00:00.000Z",
      updatedBy: "admin@portal.com"
    },
    {
      id: "sched_weekly_ops",
      name: "Weekly NOC Operations Report",
      enabled: true,
      cadence: "weekly",
      cronExpression: "0 6 * * 1",
      timezone: "Asia/Kolkata",
      templateVersion: "v2",
      recipients: ["noc-leads@dominos.in"],
      lastRunAt: "2026-05-18T06:00:00.000Z",
      nextRunAt: "2026-05-25T06:00:00.000Z",
      lastStatus: "SUCCESS",
      lastError: null,
      updatedAt: "2026-05-22T02:00:00.000Z",
      updatedBy: "admin@portal.com"
    }
  ]
  ```
- **Endpoints**:
  - `GET /api/tenants/:id/schedules` $\to$ returns `{ success: true, schedules: [...], runs: [...] }`.
  - `POST /api/tenants/:id/schedules` $\to$ creates or updates a schedule by `schedule.id`.
  - `POST /api/tenants/:id/schedules/:scheduleId/trigger` $\to$ triggers Run Now for a specific schedule.
  - `DELETE /api/tenants/:id/schedules/:scheduleId` $\to$ deletes a specific schedule.
- **Frontend**: `ScheduleManagerModal` presents a schedule management list, "+ Add Schedule" button, and per-schedule controls.

#### 6. Strict Lock Ordering (Deadlock & Slot Waste Prevention)
- **Acquisition Order**:
  1. `queueService.acquireTenantLock(tenantId)` **FIRST** (ensures exclusive pipeline access; retries up to 3x with backoff).
  2. Distributed `schedule_lock:{tenantId}:{scheduleId}:{timeSlot}` via Redis `SETNX` (TTL 5m) **SECOND** (deduplicates multi-pod triggers).
- **Release Order in Reverse**:
  1. Release `schedule_lock` **FIRST**.
  2. Release `tenantLock` **SECOND**.
- **Rationale**: If `schedule_lock` were acquired before `tenantLock`, waiting for a long manual upload would waste the cron slot lock and block recovery.

---

### 5. Production Specifications & Operational Guarantees

#### A. Health Monitoring Endpoint
- `GET /api/health/scheduler` returns `{ ready: _schedulersReady, activeTasks: count, lastHeartbeat: ISOString }` for container orchestrator readiness/liveness probes.

#### B. Compliance Admin Audit Logging
- All administrative schedule mutations (create, update, delete, trigger) append structured audit records to `data/audit/schedules.log`:
  `{ action: "CREATE"|"UPDATE"|"DELETE"|"TRIGGER", scheduleId, tenantId, timestamp: ISOString, ip: req.ip, user: req.user.email }`.

#### C. Role-Based Error Masking
- Non-admin client users inspecting schedule status see a sanitized customer-ready message (`"Report generation encountered an issue. Please contact administrator."`), while Super Admins see full technical error messages and stack traces.

#### D. Empty Derived Period Guard
- If source workbooks contain 0 devices and 0 incidents for the derived period, report generation is skipped with `status: 'NO_DATA_FOR_PERIOD'` logged in `runs.json`, and an alert is dispatched to the NOC instead of generating and delivering empty reports to executives.

#### E. Graceful Shutdown Signal Trapping (SIGTERM / SIGINT)
- Server process registers `SIGTERM` and `SIGINT` handlers:
  1. Immediately invokes `schedulerService.stopAll()` to prevent new cron triggers.
  2. Awaits completion of in-flight queue jobs up to graceful timeout before exiting cleanly, preventing corrupted or severed PPTX generation during deployments.

#### Additional One-Line Invariants:
1. **Tenant Deletion Cleanup**: When a tenant is deleted or deactivated, invoke `stopAllForTenant(tenantId)` and archive `runs.json` to `archived_runs.json`.
2. **Custom Cron Period Limits**: Custom start/end date overrides are capped at a maximum of 1 calendar year (366 days), and future end dates are rejected with HTTP 400 (`FUTURE_DATE_REJECTED`).
3. **Frontend Timezone Selector**: Dropdown populated dynamically via `Intl.supportedValuesOf('timeZone')` with search filtering, defaulting to the client's configured timezone.
4. **Optimistic Concurrency Control**: `POST /api/tenants/:id/schedules` compares incoming `updatedAt` against on-disk `updatedAt`; if mismatched, rejects with HTTP 409 Conflict (`SCHEDULE_VERSION_CONFLICT`).
5. **Failure Alert Throttling**: `notifyFailure()` throttles outbound email dispatches for the same `(tenantId, errorCode)` tuple to at most 1 email per hour.
6. **Evicted Job Artifact Download Handling**: When downloading artifacts from `runs.json`, if the underlying `jobId` report directory has been pruned/evicted, the route returns HTTP 404 with `{ code: 'JOB_ARTIFACT_EVICTED', error: 'Report artifacts for this run have expired or been pruned.' }`.
7. **Boot Readiness Gate**: An internal flag `_schedulersReady` ensures `initSchedulers()` completes all boot scans and reconciliations before `POST /schedules*` mutations are accepted (rejecting with HTTP 503 `SCHEDULER_INITIALIZING` during boot). `GET` endpoints read safely from disk even during boot.
8. **Timezone Mutation Hot-Swap**: When `saveSchedule` updates `timezone` or `cronExpression`, it explicitly stops the previous `node-cron` instance and mounts a fresh task under the new timezone; verified by an automated unit test.
9. **Run History Retention**: `runs.json` strictly retains the last **100** execution entries (pruned on each append).
10. **Tenant Lock Backoff**: If `acquireTenantLock` fails due to an ongoing upload, it retries **3 times** with exponential backoff (500ms, 1000ms, 2000ms); if still locked, records `TENANT_LOCKED` and invokes `notifyFailure()`.
11. **node-cron Version Pin**: Explicitly pinned to `^4.6.0` in `package.json` (modern v4 API: `cron.validate(expr)` boolean check; `cron.schedule(expr, fn, { timezone })`).
12. **Email Delivery Mechanism**: Noted as an **out-of-scope stub** for this batch (mocked via structured notification dispatcher with pluggable SMTP/SES transport interface).

---

### 6. Backend Implementation Plan

#### 6.1. `backend/services/schedulerService.js`
- **Methods**:
  - `validateCron(expr)`: Validates 5-field syntax and verifies frequency $\ge 24\text{ hours}$. Rejects sub-daily expressions.
  - `derivePeriodForCadence(cadence, refDate, timezone)`: Converts `refDate` to tenant timezone using `Intl.DateTimeFormat`, then derives exact calendar boundaries.
  - `initSchedulers()`: Scans tenant directories, reconciles `PENDING` runs, checks missed-run recovery slots, mounts standing tasks with `{ timezone }`, sets `_schedulersReady = true`.
  - `saveSchedule(tenantId, scheduleData, user)`: Validates cron/timezone, optimistic concurrency check, atomic disk write, hot-swaps cron task, logs admin audit record.
  - `getSchedules(tenantId, userRole)`: Returns schedules (with role-based error masking for non-admins) and last 100 runs.
  - `executeScheduledQbr(tenantId, scheduleId, triggerType = 'CRON', options = {})`:
    - Checks empty dataset guard: skips if 0 devices and 0 incidents.
    - Strict lock ordering: `acquireTenantLock` (3x backoff) then `schedule_lock`.
    - Idempotency key evaluation (`dedup_qbr:...`). Returns HTTP 409 if duplicate ad-hoc run.
    - Appends `PENDING` record to `runs.json` at start.
    - Pinned template resolution from manifest.
    - Runs generation; on error, calls `notifyFailure()` (1/hr throttle).
    - Updates run record to `SUCCESS` or `FAILED` and releases locks in reverse order.
  - `stopAll()` / `stopAllForTenant(tenantId)`: Stops active `node-cron` tasks and clears timer maps.
  - `getActiveTaskCount()`: Returns active cron task count for test assertions.
  - `notifyFailure(tenantId, errorCode, details)`: Throttled alert dispatcher (1/hr per errorCode).

#### 6.2. `backend/routes/scheduleRoutes.js`
- `GET /api/health/scheduler`: Returns `{ ready, activeTasks, lastHeartbeat }`.
- `GET /api/tenants/:id/schedules`: Returns schedules array and run history. Client users restricted to assigned tenant; client users receive masked errors.
- `POST /api/tenants/:id/schedules`: Creates/updates schedule (Admin only; enforces `_schedulersReady` gate, optimistic lock, audit log).
- `POST /api/tenants/:id/schedules/:scheduleId/trigger`: Triggers immediate Run Now (Admin only; returns HTTP 409 `DUPLICATE_JOB` on duplicates).
- `DELETE /api/tenants/:id/schedules/:scheduleId`: Deletes schedule (Admin only).

#### 6.3. `backend/index.js`
- Mount `scheduleRoutes` at `/api/tenants`, `/api/clients`, and `/api/health`.
- Register `SIGTERM` / `SIGINT` handlers for graceful shutdown calling `schedulerService.stopAll()`.
- Invoke `schedulerService.initSchedulers()` on server startup.

---

### 7. Frontend UI/UX Plan

#### 7.1. `frontend/src/components/ScheduleManagerModal.jsx`
- Clean modal dialog:
  - **Header**: `📅 Automated QBR Scheduling & Cadence Manager`
  - **Schedule Selector & Add Button**:
    - List of configured schedules for this tenant.
    - `+ Add Schedule` button (Admin only).
  - **Configuration Section (Admin Editable, Client View-Only)**:
    - **Active Switch**: Toggle specific schedule on/off.
    - **Schedule Name**: E.g. `"Monthly Executive QBR"`.
    - **Cadence Selector**: Radio cards for Monthly, Quarterly, Weekly, and Custom Cron ($\ge 24$h validation feedback).
    - **Template Version Dropdown**: Select `"Latest Active Template (Auto-Update)"` or specific pinned version (`v1`, `v2`).
    - **Timezone Selector**: Dropdown populated from `Intl.supportedValuesOf('timeZone')` with search filter.
    - **Recipients Input**: Multi-email chip input for alerts.
  - **Run History Table**:
    - Columns: Execution Date, Schedule Name, Trigger (`⏰ Cron`, `⚡ Ad-Hoc`, `🔄 Missed Recovery`), Derived Period, Duration, Status, Artifacts.
    - Evicted 404 handler for purged artifacts.
  - **Action Footer**:
    - `⚡ Run Now` button (Admin only; handles HTTP 409 duplicate alert).
    - `💾 Save Schedule` button (Admin only; handles HTTP 409 optimistic conflict).
    - `Close` button.

#### 7.2. `frontend/src/components/ClientManager.jsx`
- `📅 Schedules` button on every client card.
- Client card displays 🔴 failure badge if any schedule has `lastStatus === 'FAILED'`.

---

### 8. Comprehensive Test Plan & Invariants

#### A. Backend Test Suite (`backend/tests/scheduledQbr.test.js`)
1. **Dynamic Period Calculation with Timezone Conversion**: System timezone UTC, tenant timezone `Asia/Kolkata`, trigger at June 1 06:00 IST $\to$ derived period is May 1 – May 31.
2. **Cron Semantic Frequency Check**: Rejects `* * * * *` and sub-daily cron with HTTP 400 `SUB_DAILY_CRON_NOT_SUPPORTED` / `CRON_FREQUENCY_TOO_HIGH`.
3. **Template Version Pinning**: Pinned `v2` + active updated to `v3` $\to$ generator strictly uses `v2`. Deprecated version triggers `notifyFailure`.
4. **Crash Mid-Run Recovery**: Simulates `PENDING` run with dead job on boot $\to$ reconciles to `status: 'FAILED'` and triggers `notifyFailure()`.
5. **Lock Ordering & Reverse Release**: Asserts `tenantLock` acquired 1st (with 3x backoff), `schedule_lock` 2nd, released in reverse.
6. **Idempotency Key & HTTP 409**: Triggers same period twice; first succeeds, second returns HTTP 409 `DUPLICATE_JOB`, and only 1 run record exists.
7. **Timezone Mutation Hot-Swap**: Updating timezone stops old cron and mounts new task with updated timezone.
8. **Optimistic Concurrency**: Mismatched `updatedAt` returns HTTP 409 `SCHEDULE_VERSION_CONFLICT`.
9. **Failure Alert Throttling**: 5 rapid failure triggers dispatch exactly 1 alert email within 1 hour.
10. **Role-Based Error Masking**: Client user receives masked error; admin receives raw error.
11. **Empty Period Guard**: 0 devices and 0 incidents logs `NO_DATA_FOR_PERIOD` and skips generation.
12. **Scheduler Health Endpoint**: `GET /api/health/scheduler` returns `{ ready: true, activeTasks, lastHeartbeat }`.
13. **Clean Teardown**: Calls `schedulerService.stopAll()`; asserts `getActiveTaskCount() === 0` and process exits without hang.

#### B. Frontend Verification
- `ScheduleManagerModal.jsx` renders schedule list, template dropdown, timezone selector, recipient list, and history table.
- Verifies non-admin client users see view-only controls (Run Now and Save disabled/hidden, errors masked).
- `npm --prefix frontend test` passes 100%.
- `npm --prefix frontend run build` completes with 0 errors.

---

### 9. Rollback Plan
If any issue occurs, `schedulerService` can be disabled with feature flag `ENABLE_SCHEDULED_QBR=false` without affecting manual uploads or dashboard features.

---

**Status**: Waiting for user **APPROVED** before proceeding to implementation.
