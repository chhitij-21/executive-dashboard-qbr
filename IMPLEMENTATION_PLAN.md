# Implementation Plan — Item #3: Database Layer (Turso/LibSQL Unified Persistence & Encrypted Recipients)

**Status**: Waiting for user **APPROVED** before writing code.  
**Roadmap Item**: **#3 Database Layer (Multi-Tenant Relational Storage & Data Encryption)**  
**Sequence Context**: Implemented following **#4 (Real Auth)** and prior to **#14 (API-First v1 Versioning)** to ensure all core database models and encryption-at-rest policies are established before freezing the API contract.

---

## 1. Executive Summary & Goals

Item #3 consolidates the application's fragmented persistence model (legacy JSON files on local disk: `users.json`, `schedules.json`, `runs.json`, and `templates_manifest.json`) into a single, ACID-compliant, multi-tenant relational database powered by **`@libsql/client` (Turso / LibSQL)**.

Key deliverables:
1. **Unified Relational Schema**: Centralize dynamic data (`users`, `schedules`, `schedule_runs`, `templates`) into relational tables alongside existing inventory tables (`inventory_devices`, `reports_tickets`).
2. **AES-256-GCM Encryption at Rest**: Encrypt sensitive recipient emails (`recipients_encrypted`) in the `schedules` table, resolving the compliance gap identified in Item #13.
3. **Idempotent, Atomic, and Reversible Migration**: Standalone script (`migrate-legacy-files.js`) that imports existing JSON files, validates records, commits DB transactions, and renames source files to `.migrated`.
4. **Offline & CI Test Parity**: Dual-mode engine supporting remote Turso in production (`TURSO_DATABASE_URL=libsql://...`) and zero-dependency embedded SQLite (`file:./data/test.db`) in local/test environments.
5. **Clean Repository Abstractions**: Introduce `backend/repositories/` (`userRepo.js`, `scheduleRepo.js`, `templateRepo.js`), keeping caller service interfaces (`authService`, `schedulerService`, `templateService`) 100% backward compatible.
6. **Filesystem vs Database Boundary**: Report PPTX/PDF artifacts remain strictly filesystem-backed in `reports/job_<jobId>/` (object storage S3 is designated as backlog).

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
                                  └──────────────┬───────────────┘
                                                 │
                                                 ▼
                                  ┌──────────────────────────────┐
                                  │       Repository Layer       │
                                  │ (userRepo, scheduleRepo, ...)│
                                  │  - AES-256-GCM Decrypt/Enc   │
                                  │  - Tenant Isolation Guarantees│
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

### 3.1 Encryption Key Management & PII Protection Specification
- **Algorithm**: `AES-256-GCM` authenticated symmetric encryption with 128-bit authentication tags and unique 96-bit random initialization vectors (IVs) per row.
- **Master Key Configuration**:
  - Environment variable: `RECIPIENTS_ENCRYPTION_KEY` (must be a 64-character hex string representing 32 bytes).
  - Production Guard: If `RECIPIENTS_ENCRYPTION_KEY` is missing or $<64$ hex characters in production (`NODE_ENV === 'production'`), startup halts immediately.
  - In local development or test mode (`NODE_ENV !== 'production'`), falls back to a deterministic development key with an explicit console warning.
- **Mandatory Backup Warning**:
  > **[IMPORTANT]**: The `RECIPIENTS_ENCRYPTION_KEY` MUST be backed up to a secure secret store (e.g. AWS Secrets Manager, HashiCorp Vault) before the first production deployment. **Loss of this key results in permanent, unrecoverable loss of all recipient email lists.**
- **Key Derivation (Tenant Subkeys)**:
  - While the master key is global, encryption uses RFC 5869 `HKDF` with SHA-256 to derive a deterministic, isolated 32-byte key per tenant:
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
- **Key Rotation Strategy**:
  - The envelope includes a version field (`v: 1`).
  - To rotate keys:
    1. Deploy `RECIPIENTS_ENCRYPTION_KEY_NEW` alongside existing `RECIPIENTS_ENCRYPTION_KEY`.
    2. Writes use the new key (`v: 2`).
    3. Reads check `v`: if `v: 1`, decrypts using the legacy key; if `v: 2`, decrypts using the new key.
    4. An offline CLI script (`node backend/db/reencrypt-recipients.js`) iterates and upgrades all rows to `v: 2`.
- **Decryption Failure Handling**:
  - If decryption fails (corrupted tag or missing key), the repository catches the error, logs `[CRITICAL] RECIPIENTS_DECRYPTION_FAILED for schedule <id>`, and returns an empty array `[]` so the application does not crash or expose ciphertext.

---

### 3.2 Legacy Files Migration Specification (`backend/db/migrate-legacy-files.js`)
- **Execution Guard**:
  - Migration runs with `ENABLE_SCHEDULED_QBR=false` to prevent a race condition with background scheduled jobs executing while tables are populated.
- **Idempotency**:
  - Uses `INSERT OR REPLACE` (or `INSERT INTO ... ON CONFLICT (id) DO UPDATE ...`) based on unique primary keys (`id`). Running the script multiple times produces identical, deterministic database state.
- **Atomic-ish File Lifecycle**:
  1. Script reads each legacy JSON file.
  2. Parses and validates record structures.
  3. Executes database batch insert in a single transaction.
  4. Only **AFTER** the database transaction successfully resolves and verifies row counts, the script renames the source file to `<filename>.migrated` (e.g. `schedules.json` $\to$ `schedules.json.migrated`).
- **Reversibility & Rollback (`backend/db/rollback-legacy-files.js`)**:
  - If a migration failure or operational rollback is requested, running `node backend/db/rollback-legacy-files.js` renames all `<filename>.migrated` files back to their original `<filename>.json` paths.
- **Full Migration File List (Exact Paths)**:
  1. `data/users.json` $\longrightarrow$ `users` table
  2. `data/tenants/client-jfl/schedules/schedules.json` $\longrightarrow$ `schedules` table (and any additional tenant directories under `data/tenants/`)
  3. `data/tenants/client-jfl/schedules/runs.json` $\longrightarrow$ `schedule_runs` table (and any additional tenant directories under `data/tenants/`)
  4. `data/templates_manifest.json` $\longrightarrow$ `templates` table (global manifest)
  5. `data/tenants/client-jfl/templates/templates_manifest.json` $\longrightarrow$ `templates` table (tenant-specific manifests)

---

### 3.3 `data/tenants/` Directory Disposition & Git Tracking
- **Static Assets Retained on Disk**:
  - Tenant branding files (`data/tenants/<tenantId>/branding/logo.png`, `logo.svg`) remain on the filesystem.
  - Tenant static baseline definitions (`data/tenants/<tenantId>/tenant_config.json`) remain on disk.
  - These files are committed and tracked in Git.
- **Dynamic Operational Files Moved to DB**:
  - `schedules.json` and `runs.json` are decommissioned from filesystem writes.
  - `templates_manifest.json` is decommissioned from filesystem writes (the actual `.pptx` template files remain stored in `data/tenants/<tenantId>/templates/` on disk, but their metadata and active version pointers live in the `templates` database table).
- **Git Tracking Rules**:
  - Update `.gitignore` to add:
    ```gitignore
    # Dynamic operational tenant state (managed in DB via Item #3)
    data/tenants/**/schedules/
    data/tenants/**/templates/*_manifest.json
    data/templates_manifest.json
    data/*.db
    data/*.db-journal
    data/*.db-wal
    ```
  - Pre-existing seed tenants (`client-jfl`, `client-mmtcpamp`) have their baseline profiles provisioned via automated seed routines (`backend/db/seed.js`), ensuring zero dependency on committed runtime JSON state.

---

### 3.4 Test vs Production Parity & CI Dual-Runner Specification
- **Engine Parity Safeguards**:
  - **Foreign Key Enforcement**: SQLite requires explicit PRAGMA activation on every connection. `backend/config/database.js` automatically executes `PRAGMA foreign_keys = ON;` upon connection initialization.
  - **JSON1 Functions**: Both modern LibSQL / Turso and SQLite 3.38+ natively provide `json_extract()`, `json_array()`, and `json_valid()`.
  - **UTC Timestamps**: All table datetime columns use standard ISO 8601 UTC strings formatted as `YYYY-MM-DDTHH:MM:SS.SSSZ` (avoiding local timezone divergence between Turso and SQLite).
- **CI Test Strategy**:
  1. **Fast Local / PR Unit Test Suite**: Executes against an embedded SQLite file database (`file:./data/test.db`), ensuring 100% offline functionality, fast execution ($< 2$ seconds), and zero external network dependencies.
  2. **Nightly / Pre-Merge Ephemeral Smoke Suite**: Runs automated regression tests against Turso cloud/ephemeral database by passing `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`.
  3. **Auto-Detection Switch**: In `backend/config/database.js`:
     ```javascript
     const dbUrl = process.env.TURSO_DATABASE_URL || (process.env.NODE_ENV === 'test' ? 'file:./data/test.db' : 'file:./data/app.db');
     ```

---

### 3.5 Operational Boundary & One-Liners
- **Report Artifact Storage**:
  - Generated executive presentation files (`reports/job_<jobId>/presentation.pptx` and `summary.pdf`) remain filesystem-backed.
  - Migration to cloud object storage (AWS S3 or Cloudflare R2) is logged as a backlog item (Item #2 Storage).
- **Scheduled QBR Concurrency Lock**:
  - Running database migrations requires setting `ENABLE_SCHEDULED_QBR=false` or acquiring the global scheduler lock to prevent active cron triggers from racing against schema updates.

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

We will author an automated test suite containing 12 targeted tests:

1. `db_connection_dualMode`: Connects to embedded SQLite (`file:./data/test.db`) when `TURSO_DATABASE_URL` is omitted and Turso when configured.
2. `db_foreignKeys_enforced`: Proves foreign key constraints fail on invalid `schedule_id` insertion.
3. `userRepo_crud_roundtrip`: Inserts, retrieves by ID, retrieves by email, updates password, and lists users.
4. `recipients_encrypt_decrypt_aes256`: Encrypts recipient email list with AES-256-GCM; ciphertext envelope contains valid IV, tag, and version; decrypts to original array.
5. `recipients_tenantKey_isolation`: Ciphertext encrypted for `client-jfl` cannot be decrypted using `client-mmtc`'s derived key.
6. `recipients_lossRecovery_gracefulFallback`: Corrupted tag or mismatched key returns `[]` without throwing or crashing the process.
7. `scheduleRepo_crud_roundtrip`: Creates schedule with encrypted recipients, updates schedule metadata, and queries active schedules.
8. `scheduleRuns_dedupKey_uniqueConstraint`: Prevents duplicate runs for identical tenant, schedule, and period.
9. `templateRepo_versioning_and_activeToggle`: Inserts versions 1 and 2; activates version 2; confirms only one active version per tenant.
10. `migrationScript_idempotent_reRunSafe`: Running `migrate-legacy-files.js` twice produces identical database state without duplicate rows.
11. `migrationScript_atomicLifecycle_renamesSource`: Verifies source files are renamed to `.migrated` only after successful database commit.
12. `rollbackScript_restoresOriginalJson`: Verifies `rollback-legacy-files.js` successfully restores `.migrated` files back to `.json`.

---

## 6. Implementation Steps

1. **Update Database Client (`backend/config/database.js`)**:
   - Implement automatic fallback to embedded SQLite (`file:./data/app.db` or `file:./data/test.db` in tests).
   - Execute `PRAGMA foreign_keys = ON;` upon connection initialization.
2. **Expand DDL & Migration Runner (`backend/db/schema.sql`, `backend/db/migrate.js`)**:
   - Append tables: `users`, `schedules`, `schedule_runs`, `templates`.
   - Update `migrate.js` to execute DDL statements idempotently.
3. **Build Crypto Utility (`backend/utils/cryptoUtil.js`)**:
   - Implement `encryptRecipients(recipientsArray, tenantId)` and `decryptRecipients(envelope, tenantId)` using AES-256-GCM + HKDF.
4. **Build Repositories (`backend/repositories/`)**:
   - `userRepo.js`: DB operations for users.
   - `scheduleRepo.js`: DB operations for schedules & runs with automatic recipient encryption/decryption.
   - `templateRepo.js`: DB operations for template versions and active manifest pointers.
5. **Author Migration & Rollback Scripts**:
   - `backend/db/migrate-legacy-files.js`: Idempotent JSON-to-DB migration with `.migrated` file renaming.
   - `backend/db/rollback-legacy-files.js`: Rollback restoration script.
6. **Wire Repositories into Services**:
   - Adapt `authService.js`, `schedulerService.js`, and `templateService.js` to consume repositories while maintaining legacy memory caches where needed for high performance.
7. **Run Full Verification**:
   - Execute `node --test backend/tests/databaseV2.test.js`.
   - Execute `npm test` across all 363+ tests.
   - Execute frontend tests and build.
8. **Local Commit**:
   - Stage and commit locally on `main` without pushing: `feat(db): unified LibSQL/Turso database layer with AES-256 encrypted recipients`.
