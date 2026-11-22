# Implementation Plan — Item #3: Database Layer (Turso/LibSQL Unified Persistence & Encrypted Recipients)

**Status**: Waiting for user **APPROVED** before writing code.  
**Roadmap Item**: **#3 Database Layer (Multi-Tenant Relational Storage & Data Encryption)**  
**Sequence Context**: Implemented following **#4 (Real Auth)** and prior to **#14 (API-First v1 Versioning)** to ensure all core database models and encryption-at-rest policies are established before freezing the API contract.

---

## 1. Executive Summary & Goals

Item #3 consolidates the application's fragmented persistence model (legacy JSON files on local disk: `users.json`, `schedules.json`, `runs.json`, `templates_manifest.json`, and `schedule_config.json`) into a single, ACID-compliant, multi-tenant relational database powered by **`@libsql/client` (Turso / LibSQL)**.

Key deliverables:
1. **Unified Relational Schema**: Centralize dynamic data (`users`, `schedules`, `schedule_runs`, `templates`) into relational tables alongside existing inventory tables (`inventory_devices`, `reports_tickets`).
2. **AES-256-GCM Encryption at Rest with Loud Failure**: Encrypt sensitive recipient emails (`recipients_encrypted`) in the `schedules` table using per-tenant derived keys. If decryption fails, it returns `null` and fails loudly (`RECIPIENTS_UNAVAILABLE`), preventing silent drop of executive alert emails.
3. **FK-Safe Idempotent Migration**: Standalone script (`migrate-legacy-files.js`) strictly uses `INSERT INTO ... ON CONFLICT(id) DO UPDATE ... WHERE updated_at < excluded.updated_at` (or `INSERT OR IGNORE`). `INSERT OR REPLACE` is strictly prohibited to prevent SQLite `DELETE + INSERT` cascade deletion of foreign key child rows.
4. **One-Way Migration with Pre-Migration Snapshot**: Full pre-migration backup saved to `data/backup_pre_item3_<timestamp>/`. In-flight failures abort safely before renaming files; once complete and verified, migration is strictly one-way (forward-fix only; no post-migration rollback).
5. **Clean Service Cutover (No Dual-Write, No Fallback)**:
   > **After migration: `authService` reads ONLY `userRepo`, `schedulerService` reads ONLY `scheduleRepo`, `templateService` reads ONLY `templateRepo`. Files are `.migrated` and never read again. No dual-write, no fallback.**
6. **Explicit File Dispositions**:
   - `schedule_config.json`: Orphaned legacy single-schedule config file is merged into `schedules` table if missing, then renamed to `.migrated`.
   - `data/vulnerabilities.json`: Stays on filesystem as an ephemeral third-party advisory cache (TTL/refresh).
   - `data/audit/*.log` (`schedules.log`): Stays on filesystem as streaming append-only compliance logs to avoid high write lock contention on transactional DB.
7. **Offline & CI Test Parity**: Dual-mode engine supporting remote Turso in production (`TURSO_DATABASE_URL=libsql://...`) and zero-dependency embedded SQLite (`file:./data/test.db`) in local/test environments with enforced `PRAGMA foreign_keys = ON;`.
8. **Engine Prerequisite**: Requires Node 18+ for `crypto.hkdfSync` (enforced via `"engines": { "node": ">=18.0.0" }` in root and backend `package.json`).

---

## 2. Architecture & Data Flow

```
                                  ┌──────────────────────────────┐
                                  │      Incoming Request        │
                                  │  (Auth, Schedule, Template)  │
                                  └──────────────┬───────────────┘
                                                 │
                                                 ▼
                                  ┌──────────────────────────────┐
                                  │       Service Layer          │
                                  │ (authService, schedulerSvc)  │
                                  │  *No filesystem reads/writes*│
                                  └──────────────┬───────────────┘
                                                 │
                                                 ▼
                                  ┌──────────────────────────────┐
                                  │       Repository Layer       │
                                  │ (userRepo, scheduleRepo, ...)│
                                  │  - AES-256-GCM HKDF Dec/Enc  │
                                  │  - Loud failure on bad key   │
                                  │  - Strict ON CONFLICT DO UPD │
                                  └──────────────┬───────────────┘
                                                 │
                                                 ▼
                                  ┌──────────────────────────────┐
                                  │  backend/config/database.js  │
                                  │      (@libsql/client)        │
                                  └──────┬────────────────┬──────┘
                                         │                │
            ┌────────────────────────────┴──┐          ┌──┴──────────────────────────┐
            ▼                               │          │                             ▼
  Production / Cloud                        │          │                 Local Dev / Sandbox / CI
  Turso Distributed LibSQL                  │          │                 Embedded SQLite
  (TURSO_DATABASE_URL=libsql://...)         │          │                 (url="file:./data/app.db")
  PRAGMA foreign_keys = ON;                 │          │                 PRAGMA foreign_keys = ON;
```

---

## 3. Detailed Specifications

### 3.1 Encryption Key Management & Loud Failure Policy
- **Algorithm**: `AES-256-GCM` authenticated symmetric encryption with 128-bit authentication tags and unique 96-bit random initialization vectors (IVs) per row.
- **Master Key Configuration**:
  - Environment variable: `RECIPIENTS_ENCRYPTION_KEY` (must be a 64-character hex string representing 32 bytes).
  - Production Guard: If `RECIPIENTS_ENCRYPTION_KEY` is missing or $<64$ hex characters in production (`NODE_ENV === 'production'`), startup halts immediately.
  - In local development or test mode (`NODE_ENV !== 'production'`), falls back to a deterministic development key with an explicit console warning.
- **Mandatory Backup Warning**:
  > **[IMPORTANT]**: The `RECIPIENTS_ENCRYPTION_KEY` MUST be backed up to a secure secret store (e.g. AWS Secrets Manager, HashiCorp Vault) before the first production deployment. **Loss of this key results in permanent, unrecoverable loss of all recipient email lists.**
- **Key Derivation (Tenant Subkeys)**:
  - Encryption uses RFC 5869 `HKDF` with SHA-256 (supported in Node 18+) to derive a deterministic, isolated 32-byte key per tenant:
    ```javascript
    function getTenantKey(tenantId) {
      return crypto.hkdfSync('sha256', Buffer.from(process.env.RECIPIENTS_ENCRYPTION_KEY, 'hex'), tenantId, 'executive-dashboard-recipients-v1', 32);
    }
    ```
- **Ciphertext Storage Format**:
  - Stored as a serialized JSON envelope in the `recipients_encrypted` column:
    ```json
    {
      "v": 1,
      "iv": "a1b2c3d4e5f6789012345678",
      "tag": "fedcba9876543210fedcba9876543210",
      "data": "1234abcd5678ef..."
    }
    ```
- **Loud Decryption Failure Policy (BLOCKER 2 Resolved)**:
  - Returning `[]` on decryption failure causes silent executive alert loss (schedules appear to succeed while sending to nobody).
  - **Resolution**:
    1. Repository returns `null` (never `[]`) when decryption fails (bad key, corrupted tag, tampered ciphertext).
    2. Scheduler execution detects `null` and **immediately aborts execution** with status `FAILED` and error code `RECIPIENTS_UNAVAILABLE`.
    3. Fires `schedulerService.notifyFailure(tenantId, 'RECIPIENTS_DECRYPTION_FAILED', { scheduleId, scheduleName })`.
    4. Health checks (`/api/data-health` and `/api/health`) mark the scheduler subsystem as degraded (`ready: false`, `reason: 'RECIPIENTS_DECRYPTION_FAILED'`).
    5. The failure is loud, recorded in `schedule_runs` and audit logs.
- **Key Rotation Strategy**:
  - The envelope includes a version field (`v: 1`).
  - To rotate keys:
    1. Set `RECIPIENTS_ENCRYPTION_KEY_NEW` alongside `RECIPIENTS_ENCRYPTION_KEY`.
    2. Writes encrypt with the new key (`v: 2`).
    3. Reads inspect `v`: decrypt with legacy key if `v: 1`, new key if `v: 2`.
    4. Run offline script `node backend/db/reencrypt-recipients.js` to batch re-encrypt existing records to `v: 2`.

---

### 3.2 Foreign-Key-Safe Migration Script Specification (`backend/db/migrate-legacy-files.js`)
- **Foreign-Key Data-Loss Hazard (`INSERT OR REPLACE` Ban - BLOCKER 1 Resolved)**:
  - In SQLite / LibSQL, `INSERT OR REPLACE` is implemented as an explicit `DELETE` followed by `INSERT`.
  - Under active foreign key constraints (`PRAGMA foreign_keys = ON;`), a `DELETE` cascades into child tables (`schedule_runs` deleted when `schedules` is touched).
  - **STRICT INVARIANT**: `INSERT OR REPLACE` is strictly prohibited across all tables.
  - For parent tables (`schedules`, `users`, `templates`), the migration and repositories strictly use:
    ```sql
    INSERT INTO schedules (id, tenant_id, name, cadence, cron_expression, day_of_month, day_of_week, hour_utc, recipients_encrypted, active, last_run_at, last_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      tenant_id = excluded.tenant_id,
      name = excluded.name,
      cadence = excluded.cadence,
      cron_expression = excluded.cron_expression,
      day_of_month = excluded.day_of_month,
      day_of_week = excluded.day_of_week,
      hour_utc = excluded.hour_utc,
      recipients_encrypted = excluded.recipients_encrypted,
      active = excluded.active,
      last_run_at = excluded.last_run_at,
      last_status = excluded.last_status,
      updated_at = excluded.updated_at
    WHERE schedules.updated_at < excluded.updated_at;
    ```
  - For immutable history records (`schedule_runs`), use `INSERT OR IGNORE`.
- **Concurrency Guard**:
  - Migration script halts if `ENABLE_SCHEDULED_QBR === 'true'`. Operators must run migrations with `ENABLE_SCHEDULED_QBR=false` to prevent background scheduler cron triggers from racing against schema migrations.
- **Pre-Migration Snapshot & One-Way Policy (BLOCKER 3 Resolved)**:
  - Selected strategy: **Option (B) — Rollback NOT supported post-migration; forward-fix only. Backup taken before migration. Migration is one-way.**
  - Rationale: Once post-migration writes occur in the relational database, rolling back to pre-migration flat files would silently destroy all newly created schedules, executions, and user state.
  - Step 0 of migration automatically creates a timestamped physical snapshot:
    `data/backup_pre_item3_<timestamp>/` containing exact copies of all JSON files.
  - In-flight error handling: If an error occurs during migration execution before completion, the transaction rolls back, no files are renamed to `.migrated`, and the script exits with non-zero status.
  - Post-migration policy: Once the script outputs `[MIGRATION SUCCESS]` and renames files to `.migrated`, the database is the authoritative SSOT. Any subsequent fixes must be forward-fix migrations.
- **Complete File Migration & Disposition List (CLARIFICATION 1 Resolved)**:
  1. `data/users.json` $\longrightarrow$ Migrated to `users` table; source renamed to `data/users.json.migrated`.
  2. `data/tenants/<id>/schedules/schedules.json` $\longrightarrow$ Migrated to `schedules` table with AES-256 encrypted recipients; source renamed to `schedules.json.migrated`.
  3. `data/tenants/<id>/schedules/schedule_config.json` $\longrightarrow$ Legacy single-schedule artifact. Merged: if not already present in `schedules`, ingested as an initial schedule record (`cadence: quarterly`), then renamed to `schedule_config.json.migrated`.
  4. `data/tenants/<id>/schedules/runs.json` $\longrightarrow$ Migrated to `schedule_runs` table; source renamed to `runs.json.migrated`.
  5. `data/templates_manifest.json` $\longrightarrow$ Migrated to `templates` table (global manifest); source renamed to `templates_manifest.json.migrated`.
  6. `data/tenants/<id>/templates/templates_manifest.json` $\longrightarrow$ Migrated to `templates` table (tenant-specific manifests); source renamed to `templates_manifest.json.migrated`.
  7. `data/vulnerabilities.json` $\longrightarrow$ **Stays on filesystem** as an ephemeral read-through cache for Cisco PSIRT CVEs with TTL refresh. Not migrated to relational database.
  8. `data/audit/*.log` (`schedules.log`) $\longrightarrow$ **Stays on filesystem** as streaming append-only compliance logs to avoid high write lock contention on transactional DB.

---

### 3.3 Service Layer Refactoring Specification (CLARIFICATION 2 Resolved)

> **"After migration: authService reads ONLY userRepo, schedulerService reads ONLY scheduleRepo, templateService reads ONLY templateRepo. Files are .migrated and never read again. No dual-write, no fallback."**

- **`authService.js` Refactor**:
  - Decommission all calls to `fs.readFileSync(USERS_FILE)` and `safeWriteJsonSync(USERS_FILE)`.
  - Replaces internal `USERS` array mutation with calls to `userRepo.getUserById(id)`, `userRepo.getUserByEmail(email)`, `userRepo.createUser(user)`, and `userRepo.updatePassword(id, hash)`.
  - Maintains in-memory cache for ultra-fast sync lookups where required by synchronous middleware, populated at startup from `userRepo.getAllUsers()`.
- **`schedulerService.js` Refactor**:
  - Decommission all calls to `readSchedulesFile`, `saveSchedulesFile`, `readRunsFile`, `saveRunsFile`.
  - Replaces file operations with `scheduleRepo.getSchedules(tenantId)`, `scheduleRepo.saveSchedule(schedule)`, `scheduleRepo.recordRun(run)`.
  - Concurrency locks (optimistic lock via `updatedAt` / DB transaction) ensure safe concurrent writes without file-level mutexes.
- **`templateService.js` Refactor**:
  - Decommission all reads/writes to `templates_manifest.json`.
  - Replaces manifest operations with `templateRepo.getManifest(tenantId)`, `templateRepo.addVersion(...)`, `templateRepo.setActiveVersion(...)`.
  - Physical template `.pptx` files remain stored on disk in `data/tenants/<tenantId>/templates/`, with path references tracked in `templates` table.

---

### 3.4 `data/tenants/` Directory Disposition & Git Tracking
- **Static Assets Retained on Disk (Git-Tracked)**:
  - Tenant branding files (`data/tenants/<tenantId>/branding/logo.png`, `logo.svg`).
  - Tenant static baseline definitions (`data/tenants/<tenantId>/tenant_config.json`).
- **Dynamic Files Decommissioned from Git**:
  - Update `.gitignore` to add:
    ```gitignore
    # Dynamic operational tenant state (managed in DB via Item #3)
    data/tenants/**/schedules/
    data/tenants/**/templates/*_manifest.json
    data/templates_manifest.json
    data/*.db
    data/*.db-journal
    data/*.db-wal
    data/*.migrated
    data/backup_pre_item3_*/
    ```
- **Seed Data**: Baseline seed accounts and tenants are provisioned via automated seed routines (`backend/db/seed.js`), ensuring zero dependency on committed runtime JSON state.

---

### 3.5 Test vs Production Parity & CI Dual-Runner Specification
- **Engine Parity Safeguards**:
  - **Foreign Key Enforcement**: `backend/config/database.js` executes `PRAGMA foreign_keys = ON;` upon connection initialization.
  - **JSON1 Functions**: Both LibSQL / Turso and SQLite 3.38+ natively provide `json_extract()`, `json_array()`, and `json_valid()`.
  - **UTC Timestamps**: All table datetime columns use standard ISO 8601 UTC strings (`YYYY-MM-DDTHH:MM:SS.SSSZ`).
- **CI Test Strategy**:
  1. **Fast Local / PR Unit Test Suite**: Executes against an embedded SQLite file database (`file:./data/test.db`), ensuring 100% offline functionality, fast execution ($< 2$ seconds), and zero external network dependencies.
  2. **Nightly / Pre-Merge Ephemeral Smoke Suite**: Runs automated regression tests against Turso cloud/ephemeral database by passing `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`.
  3. **Auto-Detection Switch**: In `backend/config/database.js`:
     ```javascript
     const dbUrl = process.env.TURSO_DATABASE_URL || (process.env.NODE_ENV === 'test' ? 'file:./data/test.db' : 'file:./data/app.db');
     ```

---

### 3.6 Operational Boundary & Backlog
- **Report Artifact Storage**:
  - Generated executive presentation files (`reports/job_<jobId>/presentation.pptx` and `summary.pdf`) remain filesystem-backed.
  - Migration to cloud object storage (AWS S3 or Cloudflare R2) is logged as a backlog item (Item #2 Storage).

---

## 4. Relational Database Schema (`backend/db/schema.sql`)

```sql
-- ── Existing Inventory & Ticket Tables (Preserved) ──────────────────────────
CREATE TABLE IF NOT EXISTS inventory_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  serial_no TEXT NOT NULL,
  mac_address TEXT,
  cloud_id TEXT,
  hostname TEXT,
  device_type TEXT,
  model TEXT,
  site_id TEXT,
  rack_location TEXT,
  status TEXT DEFAULT 'active',
  first_seen_at TEXT DEFAULT (datetime('now')),
  last_seen_at TEXT DEFAULT (datetime('now')),
  last_sync_id INTEGER,
  UNIQUE (client_id, serial_no)
);

CREATE TABLE IF NOT EXISTS inventory_syncs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  triggered_by TEXT,
  uploaded_file_name TEXT,
  diff_summary TEXT, 
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now')),
  approved_at TEXT
);

CREATE TABLE IF NOT EXISTS inventory_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_id INTEGER REFERENCES inventory_syncs(id),
  client_id TEXT NOT NULL,
  serial_no TEXT,
  change_type TEXT, 
  before_state TEXT, 
  after_state TEXT, 
  changed_fields TEXT, 
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inventory_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_id INTEGER,
  client_id TEXT NOT NULL,
  snapshot_data TEXT, 
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reports_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  ticket_number TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  payload_json TEXT NOT NULL,
  bucket TEXT,
  ticket_type TEXT,
  uploaded_at TEXT NOT NULL,
  UNIQUE(client_id, ticket_number)
);

-- ── Item #3 Unified Tables ──────────────────────────────────────────────────

-- 1. User Profiles & Credentials
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'client_user')),
  assigned_client TEXT NOT NULL,
  avatar TEXT,
  mfa_secret TEXT,
  mfa_enabled INTEGER DEFAULT 0,
  pending_mfa_secret TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 2. Scheduled QBRs (with AES-256-GCM Encrypted Recipients)
CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  cadence TEXT NOT NULL CHECK(cadence IN ('weekly', 'monthly', 'quarterly')),
  cron_expression TEXT NOT NULL,
  day_of_month INTEGER,
  day_of_week INTEGER,
  hour_utc INTEGER NOT NULL,
  recipients_encrypted TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  last_run_at TEXT,
  last_status TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tenant_id, name)
);

-- 3. Schedule Run History
CREATE TABLE IF NOT EXISTS schedule_runs (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  schedule_name TEXT NOT NULL,
  run_at TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK(trigger_type IN ('SCHEDULED', 'MANUAL')),
  cadence TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  period_label TEXT NOT NULL,
  days INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('SUCCESS', 'FAILED')),
  job_id TEXT,
  dedup_key TEXT UNIQUE NOT NULL,
  duration_ms INTEGER,
  error_message TEXT,
  download_url TEXT,
  dashboard_url TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 4. Template Metadata & Manifests
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  uploaded_by TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  is_active INTEGER DEFAULT 0,
  UNIQUE(tenant_id, version)
);

-- Index optimization
CREATE INDEX IF NOT EXISTS idx_schedules_tenant ON schedules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_runs_tenant_schedule ON schedule_runs(tenant_id, schedule_id);
CREATE INDEX IF NOT EXISTS idx_templates_tenant_active ON templates(tenant_id, is_active);
```

---

## 5. TDD Test Plan (`backend/tests/databaseV2.test.js`)

We will author an automated test suite containing 13 targeted tests:

1. `db_connection_dualMode`: Connects to embedded SQLite (`file:./data/test.db`) when `TURSO_DATABASE_URL` is omitted and Turso when configured.
2. `db_foreignKeys_enforced`: Proves foreign key constraints fail on invalid `schedule_id` insertion.
3. `userRepo_crud_roundtrip`: Inserts, retrieves by ID, retrieves by email, updates password, and lists users.
4. `recipients_encrypt_decrypt_aes256`: Encrypts recipient email list with AES-256-GCM; ciphertext envelope contains valid IV, tag, and version; decrypts to original array.
5. `recipients_tenantKey_isolation`: Ciphertext encrypted for `client-jfl` cannot be decrypted using `client-mmtc`'s derived key.
6. `recipients_lossRecovery_loudFailure`: Corrupted tag or mismatched key returns `null` (not `[]`), triggers `RECIPIENTS_UNAVAILABLE` error, fires failure notification, and degrades health endpoint.
7. `scheduleRepo_crud_roundtrip`: Creates schedule with encrypted recipients, updates schedule metadata using `ON CONFLICT DO UPDATE`, and queries active schedules.
8. `scheduleRepo_reinsert_doesNotDeleteRuns`: Proves re-inserting or updating an existing schedule row does NOT delete child `schedule_runs` (verifying prohibition of `INSERT OR REPLACE`).
9. `scheduleRuns_dedupKey_uniqueConstraint`: Prevents duplicate runs for identical tenant, schedule, and period.
10. `templateRepo_versioning_and_activeToggle`: Inserts versions 1 and 2; activates version 2; confirms only one active version per tenant.
11. `migrationScript_idempotent_reRunSafe`: Running `migrate-legacy-files.js` twice produces identical database state without duplicate rows or foreign key violations.
12. `migrationScript_atomicLifecycle_renamesSource`: Verifies source files are renamed to `.migrated` only after successful database commit.
13. `serviceCutover_readsOnlyFromRepos`: Proves `authService`, `schedulerService`, and `templateService` operate exclusively against DB repositories and do not touch `.migrated` or legacy JSON files.

---

## 6. Implementation Steps

1. **Verify Engine Requirement (`package.json`, `backend/package.json`)**:
   - Verify `"engines": { "node": ">=18.0.0" }` is pinned.
2. **Update Database Client (`backend/config/database.js`)**:
   - Implement automatic fallback to embedded SQLite (`file:./data/app.db` or `file:./data/test.db` in tests).
   - Execute `PRAGMA foreign_keys = ON;` upon connection initialization.
3. **Expand DDL & Migration Runner (`backend/db/schema.sql`, `backend/db/migrate.js`)**:
   - Append tables: `users`, `schedules`, `schedule_runs`, `templates`.
   - Update `migrate.js` to execute DDL statements idempotently.
4. **Build Crypto Utility (`backend/utils/cryptoUtil.js`)**:
   - Implement `encryptRecipients(recipientsArray, tenantId)` and `decryptRecipients(envelope, tenantId)` using AES-256-GCM + HKDF.
   - Return `null` on decryption failure and log critical diagnostic.
5. **Build Repositories (`backend/repositories/`)**:
   - `userRepo.js`: DB operations for users.
   - `scheduleRepo.js`: DB operations for schedules & runs with `ON CONFLICT DO UPDATE` and loud decryption failure handling.
   - `templateRepo.js`: DB operations for template versions and active manifest pointers.
6. **Author Migration Script (`backend/db/migrate-legacy-files.js`)**:
   - Step 0: Takes pre-migration snapshot to `data/backup_pre_item3_<timestamp>/`.
   - Step 1: Idempotently migrates `users.json`, `schedules.json`, `schedule_config.json`, `runs.json`, and `templates_manifest.json` using `ON CONFLICT DO UPDATE`.
   - Step 2: Verifies row counts in database.
   - Step 3: Renames files to `.migrated`.
7. **Wire Repositories into Services (`authService.js`, `schedulerService.js`, `templateService.js`)**:
   - Direct cutover: services interact solely with repositories. No filesystem reads/writes of dynamic operational files.
8. **Run Full Verification**:
   - Execute `node --test backend/tests/databaseV2.test.js`.
   - Execute `npm test` across all 363+ tests.
   - Execute frontend tests and build.
9. **Local Commit**:
   - Stage and commit locally on `main` without pushing: `feat(db): unified LibSQL/Turso database layer with AES-256 encrypted recipients`.
