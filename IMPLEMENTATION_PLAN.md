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
The **Scheduled QBR** engine automates recurring report generation for enterprise tenants on standard business cadences (weekly, monthly, quarterly, or custom cron). It eliminates manual report execution at period close by:
1. **Automated Period Resolution**: Automatically resolving previous month or quarter boundaries (e.g., automatically generating `1 May 2026 – 31 May 2026` on June 1st).
2. **Dual-Driver Integration with Queue & Tenant Locking**: Submitting scheduled jobs directly into `queueService` and acquiring `TenantLockManager` locks to guarantee zero overlap with live manual uploads.
3. **Execution History & Audit Log**: Retaining a persistent run log (`runs.json`) recording execution timestamps, durations, generated `jobId`s, and error telemetry.
4. **Ad-Hoc Manual Trigger ("⚡ Run Now")**: Permitting immediate on-demand test runs without waiting for wall-clock cron triggers.
5. **Strict RBAC & Physical Tenant Isolation**: Config stored within tenant namespace (`data/tenants/:id/schedules/`); client users have read-only visibility, while creation, updating, and execution are restricted to Administrators.

---

### 2. Architecture & Data Flow

```
   ┌─────────────────────────────────────────────────────────────┐
   │                     node-cron Scheduler                     │
   │  - Weekly: '0 6 * * 1'      - Monthly: '0 6 1 * *'          │
   │  - Quarterly: '0 6 1 1,4,7,10 *'                            │
   │  - Custom 5-field cron validated with cron.validate()       │
   └──────────────────────────────┬──────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────┐
   │         backend/services/schedulerService.js                │
   │  1. Resolves dynamic period dates (Previous Month/Quarter)  │
   │  2. Resolves staged/incoming tenant workbooks               │
   │  3. Acquires TenantLock via queueService                    │
   │  4. Queues background job in BullMQ / In-Memory Queue       │
   │  5. Appends run record to runs.json                         │
   └──────────────────────────────┬──────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────┐
   │         backend/routes/scheduleRoutes.js                    │
   │  - GET /api/tenants/:id/schedules (Read-only for Clients)   │
   │  - POST /api/tenants/:id/schedules (Admin Only)             │
   │  - POST /api/tenants/:id/schedules/trigger (Run Now, Admin) │
   │  - DELETE /api/tenants/:id/schedules (Admin Only)           │
   └──────────────────────────────┬──────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────┐
   │     frontend/src/components/ScheduleManagerModal.jsx        │
   │  - Next Run Countdown & Status Toggle (Enabled/Disabled)    │
   │  - Cadence: Monthly | Quarterly | Weekly | Custom Cron      │
   │  - Recipients Email Tags & Notification Settings            │
   │  - Execution History Table (Status, Duration, Download Link)│
   │  - ⚡ Run Now Trigger Button (Admin Only)                   │
   └─────────────────────────────────────────────────────────────┘
```

---

### 3. Dynamic Period Resolution Rules (Zero Hardcoded Dates)

When a scheduled job fires automatically, it dynamically derives calendar dates according to the configured cadence:

| Cadence | Execution Timing | Derived Date Period Formulation |
|---|---|---|
| **Monthly** | 1st day of month at 06:00 | Previous full calendar month (e.g. if run on June 1, `2026-05-01` to `2026-05-31`). Formatted as `1 May 2026 – 31 May 2026`. |
| **Quarterly** | 1st day of quarter at 06:00 (Jan 1, Apr 1, Jul 1, Oct 1) | Previous full calendar quarter (e.g. if run on July 1, Q1: `2026-04-01` to `2026-06-30`). Formatted as `1 Apr 2026 – 30 Jun 2026`. |
| **Weekly** | Every Monday at 06:00 | Preceding 7 full calendar days (Monday to Sunday). |
| **Custom Cron** | User-defined cron expression | Defaults to previous calendar month unless custom period parameters are supplied. |

---

### 4. Backend Implementation Plan

#### 4.1. `backend/services/schedulerService.js`
- **Schedule Configuration Storage**:
  - Persisted at `data/tenants/{tenantId}/schedules/schedule_config.json`.
  - Schema:
    ```javascript
    {
      tenantId: "client-jfl",
      enabled: true,
      cadence: "monthly", // "weekly" | "monthly" | "quarterly" | "custom"
      cronExpression: "0 6 1 * *",
      recipients: ["cio@dominos.in", "noc-ops@dominos.in"],
      lastRunAt: "2026-05-01T06:00:00.000Z",
      nextRunAt: "2026-06-01T06:00:00.000Z",
      lastStatus: "SUCCESS", // "SUCCESS" | "FAILED" | "PENDING"
      updatedAt: "2026-05-22T02:00:00.000Z",
      updatedBy: "admin@portal.com"
    }
    ```
- **Lifecycle Methods**:
  - `initSchedulers()`: Scans all tenant directories on server boot and mounts active `node-cron` standing tasks.
  - `saveSchedule(tenantId, config, user)`: Validates cron syntax using `cron.validate(cronExpression)`, writes atomically via `.tmp` and rename, and restarts the tenant's cron task.
  - `getSchedule(tenantId)`: Returns current config and last 10 execution run records.
  - `executeScheduledQbr(tenantId, triggerType = 'CRON')`:
    - Checks tenant directory for incoming or cached source workbooks (`inventory.xlsx`, `incidents.xlsx`). If missing, records a descriptive error in `runs.json` without throwing.
    - Resolves dynamic period start and end dates.
    - Acquires tenant lock via `queueService.acquireTenantLock`.
    - Queues or executes QBR processing.
    - On completion, writes run record to `data/tenants/{tenantId}/schedules/runs.json`.
  - `deleteSchedule(tenantId)`: Cancels active node-cron task and marks config as disabled.

#### 4.2. `backend/routes/scheduleRoutes.js`
- Endpoints:
  - `GET /api/tenants/:id/schedules`: Returns tenant schedule configuration and run history. Client users restricted to their assigned tenant.
  - `POST /api/tenants/:id/schedules`: Updates schedule configuration (Admin only).
  - `POST /api/tenants/:id/schedules/trigger`: Triggers immediate "Run Now" execution (Admin only).
  - `DELETE /api/tenants/:id/schedules`: Disables/deletes schedule (Admin only).
- Enforces strict role checks: Non-admin users receive HTTP 403 Forbidden on `POST` and `DELETE`.

#### 4.3. `backend/index.js`
- Mount `app.use(['/api/tenants', '/api/clients'], scheduleRoutes)`.
- On startup, invoke `schedulerService.initSchedulers()` to restore active cron jobs across all tenants.

---

### 5. Frontend UI/UX Plan

#### 5.1. `frontend/src/components/ScheduleManagerModal.jsx`
- Clean modal dialog:
  - **Header**: `📅 Automated QBR Scheduling & Cadence Manager`
  - **Tenant Banner**: Current customer name, Active template badge, and status pill (`🟢 Active Schedule` / `⚪ Inactive`).
  - **Configuration Section (Admin Editable, Client View-Only)**:
    - **Active Switch**: Toggle automated scheduling on/off.
    - **Cadence Selector**: Radio cards for `Monthly (1st of Month)`, `Quarterly (Period Close)`, `Weekly (Mondays)`, and `Custom Cron Expression`.
    - **Cron Expression Input**: Validated live with human-readable explanation (e.g. `Runs at 06:00 on day 1 of the month`).
    - **Recipients Input**: Multi-email chip input for notifications.
  - **Run History Table**:
    - Columns: Execution Date, Cadence, Period Generated, Duration, Status (`SUCCESS` in green, `FAILED` in red), Action (Download PPTX / View Dashboard).
  - **Action Footer**:
    - `⚡ Run Now` button: Triggers immediate ad-hoc report generation (Admin only).
    - `💾 Save Schedule` button (Admin only).
    - `Close` button.

#### 5.2. `frontend/src/components/ClientManager.jsx`
- On each client card in `ClientManager.jsx`, add a **📅 Schedule** button next to Branding and Rules.
- Clicking opens `ScheduleManagerModal`.

---

### 6. Risks, Edge Cases & Safeguards

| Risk / Edge Case | Safeguard |
|---|---|
| **Invalid Cron String** | Validate with `cron.validate(expr)` before saving. If invalid, reject with HTTP 400 Bad Request (`INVALID_CRON_SYNTAX`). |
| **Race Condition with Manual Upload** | Scheduled jobs acquire `queueService.acquireTenantLock`. If tenant is currently processing an upload, scheduled job retries or logs `TENANT_LOCKED`. |
| **Missing Incoming Workbooks** | If tenant has no cached or incoming files in `data/tenants/:id/`, logs `SOURCE_FILES_MISSING` in `runs.json`. Server process continues running safely. |
| **Server Restart / Crash** | On server boot, `schedulerService.initSchedulers()` re-reads all tenant `schedule_config.json` files and re-registers standing cron tasks. |
| **Client User RBAC Bypass** | Route enforces `requireAuth` + `requireAdmin` on all mutation endpoints (`POST /schedules`, `POST /trigger`, `DELETE /schedules`). |

---

### 7. Test Plan & Invariants

#### A. Backend Test Suite (`backend/tests/scheduledQbr.test.js`)
1. **Cron Validation**: Rejects invalid cron strings (`* * * * * * *`, `invalid`) with 400 Bad Request.
2. **Dynamic Period Calculation**: Verifies `monthly` derives previous calendar month dates, and `quarterly` derives previous calendar quarter.
3. **Save & Persist Schedule**: Saves config to tenant namespace and verifies file structure.
4. **Immediate Trigger ("Run Now")**: Calls `POST /api/tenants/:id/schedules/trigger` and verifies job execution and run record generation in `runs.json`.
5. **Admin-Only RBAC**: Verifies client user receives HTTP 403 Forbidden on `POST /schedules` and `POST /trigger`.
6. **Cross-Tenant Isolation**: Verifies client user cannot view another tenant's schedule config or history.
7. **Boot Recovery**: Verifies `initSchedulers()` initializes standing cron tasks from disk manifests.

#### B. Frontend Verification
- Verify `ScheduleManagerModal.jsx` renders cadence options, recipient list, and history.
- Verify client users see view-only controls (Run Now and Save disabled/hidden).
- `npm --prefix frontend test` passes 100%.
- `npm --prefix frontend run build` completes with 0 errors.

---

### 8. Rollback Plan
If any issue occurs, `schedulerService` can be disabled with a feature flag `ENABLE_SCHEDULED_QBR=false` without affecting manual uploads or dashboard features.

---

**Status**: Waiting for user **APPROVED** before proceeding to implementation.
