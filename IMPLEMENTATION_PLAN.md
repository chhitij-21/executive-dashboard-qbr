# Implementation Plan — Item #16: Test Isolation, CI Pipeline & Modular Refactor

**Status**: Waiting for user **APPROVED** before writing code.  
**Roadmap Item**: **#16 Testing, Quality, Isolation & CI Pipeline** (Wave 2 — Correctness & Final Foundation)  
**Sequence Context**: Follows **#4 (Real Auth)**, **#3 (Database Layer)**, **#14 (API-First v1 Versioning)**, and **#15 (Observability - Pino & Sentry)**. Eliminates serial test execution bottlenecks, enforces complete per-worker test isolation, establishes automated GitHub Actions CI with hermetic tree verification, decomposes the monolithic `v1Router.js` (2,218 lines) into domain sub-routers, and adds a dual-runner parity check for Turso.

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
Currently, running `npm test` requires serial execution (`--test-concurrency=1`), taking ~38-40 seconds across 411 tests. This is caused by shared disk and in-memory resources: all test suites contend for a single SQLite file (`data/test.db`), tenant directories (`data/tenants/`), and in-memory caches (`jobCache`, `_authRateMap`), leading to `SQLITE_BUSY` database lock contention and cross-suite state leakage under default parallel execution. Furthermore, running tests mutates tracked git files (`data/tenants/client-jfl/schedules/runs.json`, `schedules.json`), violating the hermetic testing contract. There is no automated CI pipeline to gate pull requests across backend tests, frontend unit tests, and production builds. Finally, `backend/routes/v1Router.js` has grown into a 2,218-line monolith that violates single-responsibility principles and hampers long-term maintainability.

### 1.2 Core Deliverables
1. **P0-1: Full Test Isolation (Parallel `npm test` in <10s)**:
   - Worker-scoped test database: `data/test-${process.pid}.db` (or `test-${workerId}.db`), automatically created, migrated, and cleaned up on worker teardown.
   - Isolated tenant directories: dynamic `os.tmpdir()/test-tenants-${pid}` or worker-scoped directory, ensuring zero contention across suites.
   - Clean in-memory resets: `resetJobCache()`, `resetRateLimits()`, `resetSchedulerState()`.
   - Remove `--test-concurrency=1` from `package.json` test script; tests execute concurrently across all available CPU cores with **zero** `SQLITE_BUSY` errors.
2. **P0-2: Production CI Pipeline (`.github/workflows/ci.yml`)**:
   - Automated GitHub Actions workflow triggered on `push` and `pull_request` against `main`.
   - Node 18 LTS runner with `npm ci` caching.
   - Automated validation steps:
     - OpenAPI 3.0 contract lint/validation (`docs/openapi-v1.yaml`).
     - Backend parallel test execution (`npm test`).
     - Hermetic clean-tree check (`git status --porcelain` must be 100% clean post-test).
     - Frontend Vitest suite (`npm --prefix frontend test -- --run`).
     - Frontend production Vite build (`npm --prefix frontend run build`).
     - Hard PR failure on any red step.
3. **P1-1: `v1Router.js` Decomposition into Domain Sub-Routers**:
   - Modular sub-routers authored under `backend/routes/v1/`:
     - `authRoutes.js` (Login, Logout, Revoke, Me, Auto, MFA, Tickets)
     - `dashboardRoutes.js` (Dashboard summary, site inspections, rack health, lineage, QoQ, AI chat/insights)
     - `reportRoutes.js` (Uploads, Excel analysis, history, report status, downloads, PPT generation)
     - `tenantRoutes.js` (Tenant/Client CRUD, locations, settings, rules)
     - `scheduleRoutes.js` (Scheduled QBR management, manual trigger, run inspection)
     - `dataHealthRoutes.js` (Data health anomaly inspection, CSV/JSON export)
     - `healthRoutes.js` (System health, scheduler status, observability telemetry)
   - `backend/routes/v1Router.js` becomes a high-level router aggregator (~80 lines).
   - Zero regression: All 16 contract tests in `backend/tests/apiV1Contract.test.js` and all existing 411 tests pass.
4. **P1-2: Dual-Runner Parity CI Job (Turso vs SQLite)**:
   - Nightly and pre-merge CI job running tests with `TEST_USE_TURSO=true` against an ephemeral/remote Turso database.
   - Catches dialect discrepancies (foreign key cascades, JSON1 handling, timestamps, lock semantics) before deployment.
5. **P2-1: Environment-Overridable Runtime Paths**:
   - `TENANT_DATA_ROOT`: defaults to `data/tenants`, overridable to `os.tmpdir()` in tests.
   - `VULN_DATA_PATH`: defaults to `data/vulnerabilities.json`, overridable in tests.
   - `DATA_DIR`: defaults to `data/`, overridable in tests.
   - Guarantees zero tracked git files are created or modified during `npm test`.
6. **P2-2: Hermetic Test Contract & Verification**:
   - Strict contract: *"npm test requires no network, mutates zero tracked files."*
   - Automated check: `npm run check:hermetic` (and in CI) verifies `git status --porcelain` is empty after test runs.

---

## 2. Architecture & Data Flow Changes

### 2.1 Worker-Scoped Test Database & Storage Architecture

```
                  Parallel Test Runner (node --test)
                                   │
         ┌─────────────────────────┼─────────────────────────┐
         ▼                         ▼                         ▼
   Worker Process 1          Worker Process 2          Worker Process N
   (PID: 10421)              (PID: 10422)              (PID: 10423)
         │                         │                         │
         ▼                         ▼                         ▼
  getDatabaseUrl()          getDatabaseUrl()          getDatabaseUrl()
  data/test-10421.db        data/test-10422.db        data/test-10423.db
  (Auto-migrated)           (Auto-migrated)           (Auto-migrated)
         │                         │                         │
         ▼                         ▼                         ▼
  getTenantsDir()           getTenantsDir()           getTenantsDir()
  tmp/tenants-10421/        tmp/tenants-10422/        tmp/tenants-10423/
         │                         │                         │
         └─────────────────────────┼─────────────────────────┘
                                   │
                                   ▼
                           Process Teardown
                (Cleans up test-*.db and tmp dirs)
                                   │
                                   ▼
                      Git Tree Remains 100% Clean
```

### 2.2 Modular `v1Router.js` Sub-Router Architecture

```
                             backend/routes/v1Router.js
                           (Clean High-Level Aggregator)
                                       │
        ┌──────────────┬───────────────┼───────────────┬──────────────┬──────────────┐
        ▼              ▼               ▼               ▼              ▼              ▼
   v1/authRoutes  v1/dashboard    v1/reportRoutes  v1/tenantRoutes v1/schedule   v1/healthRoutes
   - /auth/login  - /dashboard    - /upload        - /clients      - /schedules  - /health
   - /auth/logout - /lineage      - /upload-json   - /tenants      - /history    - /health/scheduler
   - /auth/me     - /qoq/compare  - /analyze-excel - /rules        - /run
   - /auth/auto   - /chat         - /ppt/download
   - /auth/ticket - /ai/insights  - /history
```

---

## 3. Files to Touch & Scope Breakdown

### 3.1 Files to Create:
1. `.github/workflows/ci.yml`: Production GitHub Actions workflow (Node 18 matrix, `npm ci`, parallel test, clean git check, frontend test, Vite build, Turso parity job).
2. `backend/routes/v1/authRoutes.js`: Auth endpoints extracted from `v1Router.js` (lines 125-330).
3. `backend/routes/v1/dashboardRoutes.js`: Executive dashboard, site inspection, rack health, lineage, QoQ, AI chat/insights routes extracted from `v1Router.js` (lines 530-1120).
4. `backend/routes/v1/reportRoutes.js`: Ingestion (`upload`, `upload-json`, `analyze-excel`), history CRUD, status, and download/PPT endpoints extracted from `v1Router.js` (lines 1125-1850).
5. `backend/routes/v1/tenantRoutes.js`: Client CRUD, tenant locations, settings, and dynamic rules routes extracted from `v1Router.js` (lines 335-520).
6. `backend/routes/v1/scheduleRoutes.js`: Schedule CRUD, execution triggering, and runs history extracted from `scheduleRoutes.js` and consolidated into `v1`.
7. `backend/routes/v1/healthRoutes.js`: System health, scheduler health, and observability telemetry endpoints.
8. `backend/tests/testIsolation.test.js`: Comprehensive TDD suite verifying per-worker database isolation, concurrent execution without locks, rate-limit resets, and hermetic cleanup.
9. `scripts/verify-hermetic.js`: Automated script that executes tests and asserts `git status --porcelain` is strictly empty.

### 3.2 Files to Modify:
1. `backend/config/database.js`:
   - Lines 21-32: Update `getDatabaseUrl()` to inspect `process.env.TEST_DB_PATH` or derive a worker-scoped database `data/test-${process.pid}.db` when `NODE_ENV === 'test'` and not using remote Turso.
   - Lines 52-68: Ensure auto-migration on fresh worker SQLite database initialization.
   - Add `closeClient()` helper to safely disconnect and release file locks on process exit.
2. `backend/services/clientService.js`:
   - Lines 10-14: Update `TENANTS_DIR` to inspect `process.env.TENANT_DATA_ROOT || path.join(DATA_DIR, 'tenants')`.
   - Update `DATA_DIR` to inspect `process.env.DATA_DIR`.
3. `backend/services/schedulerService.js`:
   - Lines 232-237: Update `getTenantSchedulesDir` to derive base directory from `clientService.getTenantDir(canonicalId)` instead of hardcoding `data/tenants/`.
   - Export `resetSchedulerState()` to reset `_scheduledTasks`, `_scheduleLocks`, and `_failureAlertsThrottle` for test isolation.
4. `backend/services/templateService.js`:
   - Lines 25 & 156: Update `tenantDir` resolution to respect `clientService.getTenantDir(canonicalId)`.
5. `backend/services/vulnerabilityFetcher.js`:
   - Lines 10-12: Update `VULN_FILE` to inspect `process.env.VULN_DATA_PATH || path.join(DATA_DIR, 'vulnerabilities.json')`.
6. `backend/services/jobCache.js`:
   - Export `resetJobCache()` to wipe cached jobs between tests.
7. `backend/routes/v1Router.js`:
   - Replace 2,218 lines of inline handler spaghetti with clean domain sub-router composition (`router.use('/auth', authRoutes)`, etc.).
8. `backend/index.js`:
   - Export `resetRateLimits()` for IP rate-limiting map isolation during testing.
   - Wire Sentry `captureException` deduplication guard (`err.__sentry_captured__ = true`) to prevent double-capture between Sentry Express error handler and centralized error middleware.
9. `package.json`:
   - Line 15: Update test script from:
     `"test": "node --test --test-concurrency=1 backend/tests/*.test.js backend/tests/ai/*.test.js frontend/src/__tests__/validators/*.test.js"`
     to:
     `"test": "node --test backend/tests/*.test.js backend/tests/ai/*.test.js frontend/src/__tests__/validators/*.test.js"`
   - Add `"test:turso": "cross-env TEST_USE_TURSO=true npm test"`.
   - Add `"check:hermetic": "node scripts/verify-hermetic.js"`.

---

## 4. Detailed Technical Specifications

### 4.1 P0-1: Worker-Scoped Test Database (`backend/config/database.js`)
```javascript
function getDatabaseUrl() {
  if (process.env.TURSO_DATABASE_URL && process.env.TURSO_DATABASE_URL.trim()) {
    const url = process.env.TURSO_DATABASE_URL.trim();
    if (process.env.NODE_ENV !== 'test' || url.startsWith('file:') || process.env.TEST_USE_TURSO) {
      return url;
    }
  }

  if (process.env.NODE_ENV === 'test') {
    if (process.env.TEST_DB_PATH) {
      return `file:${path.resolve(process.env.TEST_DB_PATH).replace(/\\/g, '/')}`;
    }
    // Per-worker isolated SQLite DB (PID-scoped)
    const workerDbFile = path.resolve(__dirname, `../../data/test-${process.pid}.db`);
    return `file:${workerDbFile.replace(/\\/g, '/')}`;
  }

  const defaultDbFile = path.resolve(__dirname, '../../data/app.db');
  return `file:${defaultDbFile.replace(/\\/g, '/')}`;
}
```
- **Auto-Migration Hook**: In test mode, if `test-${process.pid}.db` does not exist or has 0 tables, `getClient()` automatically invokes `migrate()` synchronously or via lazy promise so tests never encounter missing schema tables.
- **Teardown Hook**: Register `process.on('exit')` / `process.on('SIGINT')` to unlink `data/test-${process.pid}.db` and `data/test-${process.pid}.db-wal`/`-shm` if they exist.

### 4.2 P0-1: Path Isolation & State Resets (`clientService.js`, `schedulerService.js`)
- `clientService.js`:
  ```javascript
  const TENANTS_DIR = process.env.TENANT_DATA_ROOT || path.join(DATA_DIR, 'tenants');
  ```
- `schedulerService.js`:
  ```javascript
  function getTenantSchedulesDir(tenantId) {
    const canonicalId = clientService.resolveCanonicalClientId(tenantId) || tenantId || 'client-default';
    const baseDir = clientService.getTenantDir(canonicalId);
    const schedDir = path.join(baseDir, 'schedules');
    ...
  }

  function resetSchedulerState() {
    stopAll();
    _scheduledTasks.clear();
    _scheduleLocks.clear();
    _failureAlertsThrottle.clear();
  }
  ```
- `jobCache.js`:
  ```javascript
  function resetJobCache() {
    for (const k of Object.keys(jobs)) {
      delete jobs[k];
    }
  }
  ```

### 4.3 P0-2: Production CI Pipeline (`.github/workflows/ci.yml`)
```yaml
name: Production CI Pipeline

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test-and-build:
    name: Backend Tests, Frontend Tests & Build
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Setup Node.js 18 LTS
        uses: actions/setup-node@v4
        with:
          node-version: 18
          cache: 'npm'

      - name: Install Root Dependencies
        run: npm ci

      - name: Install Backend Dependencies
        run: cd backend && npm ci

      - name: Install Frontend Dependencies
        run: cd frontend && npm ci

      - name: Validate OpenAPI 3.0 Contract Specification
        run: npx @redocly/cli lint docs/openapi-v1.yaml

      - name: Run Backend Test Suite (Parallel & Isolated)
        run: npm test

      - name: Enforce Hermetic Contract (No Tracked File Drift)
        run: |
          git status --porcelain
          test -z "$(git status --porcelain)"

      - name: Run Frontend Unit Tests
        run: npm --prefix frontend test -- --run

      - name: Build Frontend for Production
        run: npm --prefix frontend run build

  turso-parity-smoke:
    name: Turso LibSQL Dialect Parity Smoke Test
    runs-on: ubuntu-latest
    timeout-minutes: 5
    if: github.event_name == 'push' || contains(github.event.pull_request.labels.*.name, 'run-turso-parity')
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Setup Node.js 18 LTS
        uses: actions/setup-node@v4
        with:
          node-version: 18

      - name: Install Dependencies
        run: npm ci && cd backend && npm ci

      - name: Run Ephemeral Turso Parity Suite
        env:
          TEST_USE_TURSO: 'true'
          TURSO_DATABASE_URL: 'file:/tmp/turso_ephemeral.db'
        run: npm test
```

### 4.4 P1-1: Modular Sub-Router Architecture (`backend/routes/v1/`)
Each domain sub-router encapsulates its specific business logic and middleware:
1. `backend/routes/v1/authRoutes.js`:
   - Routes: `POST /login`, `POST /logout`, `POST /revoke`, `GET /me`, `POST /auto`, `GET /demo-accounts`, `POST /download-ticket`, `POST /sse-ticket`.
   - Middleware: `authRateLimit`, `requireAuth`.
2. `backend/routes/v1/dashboardRoutes.js`:
   - Routes: `GET /dashboard`, `GET /dashboard/:jobId`, `POST /switch-mode`, `GET /lineage`, `GET /lineage/trace`, `GET /qoq/compare`, `POST /chat`, `GET /chat/loop`, `POST /ai/section-summary`, `POST /ai/insights`.
   - Middleware: `requireAuth`, `requireClientAccess`.
3. `backend/routes/v1/reportRoutes.js`:
   - Routes: `POST /upload`, `POST /upload-json`, `POST /analyze-excel`, `GET /history`, `GET /history/:jobId`, `DELETE /history`, `DELETE /history/:jobId`, `GET /status/:jobId`, `GET /report/:jobId`, `GET /error-report/:jobId`, `GET /data-quality/:jobId`, `GET /processing-log/:jobId`, `GET /ppt/:jobId`, `GET /ppt/download/:jobId`.
   - Middleware: `createHardenedUploadMiddleware`, `heavyRateLimit`, `requireAuth`.
4. `backend/routes/v1/tenantRoutes.js`:
   - Routes: `GET /clients`, `POST /clients`, `GET /clients/:id`, `PUT /clients/:id`, `GET /clients/:id/locations`, `GET /tenants`, `GET /tenants/:id/settings`, `PUT /tenants/:id/settings`, `GET /rules`, `PUT /rules`.
   - Middleware: `requireAdmin`, `requireAuth`.
5. `backend/routes/v1/scheduleRoutes.js`:
   - Consolidated canonical scheduler endpoints with tenant isolation.
6. `backend/routes/v1/dataHealthRoutes.js`:
   - Data health anomaly inspection and export.
7. `backend/routes/v1/healthRoutes.js`:
   - `GET /health` and `GET /health/scheduler` with observability telemetry.

Master `backend/routes/v1Router.js` mounts them:
```javascript
const express = require('express');
const router = express.Router();

router.use(express.json({ limit: '2mb' }));
router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

// Domain Sub-Routers
router.use('/auth', require('./v1/authRoutes'));
router.use('/health', require('./v1/healthRoutes'));
router.use('/', require('./v1/tenantRoutes'));
router.use('/', require('./v1/dashboardRoutes'));
router.use('/', require('./v1/reportRoutes'));
router.use('/', require('./v1/scheduleRoutes'));
router.use('/data-health', require('./v1/dataHealthRoutes'));

// Existing specialist sub-routers
router.use('/vulnerabilities', require('./vulnerabilities'));
router.use('/mfa', require('./mfa'));
router.use('/inventory', require('./inventorySync'));
router.use('/reports', require('./reports'));
router.use('/jobs', require('./jobRoutes'));
router.use('/validate', require('./validationRoutes').router);

module.exports = v1Router;
```

### 4.5 Minor Verify Resolution (Item #15 Sentry Deduplication)
In `backend/index.js`, we prevent double-capture between `Sentry.setupExpressErrorHandler` and our centralized 500 error middleware:
```javascript
app.use((err, req, res, next) => {
  const reqId = req.id || req.headers['x-request-id'] || 'unknown';
  const status = err.status || err.statusCode || 500;

  // Deduplication guard: if Sentry SDK already captured this error in setupExpressErrorHandler, do not re-send
  if (!err.__sentry_captured__) {
    err.__sentry_captured__ = true;
    sentry.captureException(err, { reqId, module: 'express', status });
  }

  if (req.log?.error) {
    req.log.error({ err, status, reqId }, err.message);
  } else {
    logger.error({ err, status, reqId }, err.message);
  }

  res.status(status).json({
    error: status >= 500 ? 'Internal Server Error' : err.message,
    status,
    reqId,
  });
});
```

---

## 5. Test Strategy (TDD)

New test suite `backend/tests/testIsolation.test.js` covering:

1. **`worker_db_path_isolated_by_pid`**: Asserts `getDatabaseUrl()` returns a distinct URL containing `process.pid` during tests when `TEST_DB_PATH` is not explicitly set.
2. **`worker_db_auto_migrates_schema`**: Asserts a newly spawned worker SQLite DB automatically creates all tables (`reports_tickets`, `schedules`, `templates`, `users`, etc.) without manual setup.
3. **`parallel_database_writes_zero_sqlite_busy`**: Spawns concurrent asynchronous database transactions across multiple simulated connections and asserts 0 lock failures.
4. **`tenant_dir_override_respected`**: Asserts setting `TENANT_DATA_ROOT` to a temporary directory routes all reads and writes to that directory, never touching `data/tenants/`.
5. **`vulnerability_path_override_respected`**: Asserts setting `VULN_DATA_PATH` routes vulnerability cache writes to a temporary file, never dirtying `data/vulnerabilities.json`.
6. **`resetJobCache_clears_memory`**: Asserts `resetJobCache()` empties all in-memory jobs.
7. **`resetRateLimits_clears_memory`**: Asserts `resetRateLimits()` empties IP rate maps.
8. **`resetSchedulerState_clears_tasks_and_locks`**: Asserts `resetSchedulerState()` clears all active cron tasks and locks.
9. **`v1Router_subrouter_parity_check`**: Asserts all domain sub-routers mount cleanly and route handlers match original paths.
10. **`hermetic_contract_git_status_clean`**: Runs the entire test suite and asserts `git status --porcelain` contains zero modified or untracked files.

---

## 6. Risk Assessment & Rollback

- **Risk Level**: **LOW**.
  - Worker isolation strictly improves stability and test speed without altering production business logic or math formulas.
  - Sub-router decomposition preserves all existing route paths, HTTP methods, headers, and status codes.
- **Rollback Path**:
  - Revert commit: `git revert HEAD`. The server resumes reading `v1Router.js` as a single file and running `npm test` serially.
