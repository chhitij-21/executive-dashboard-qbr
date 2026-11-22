# Implementation Plan — Item #16: Test Isolation, CI Pipeline & Modular Refactor

**Status**: Waiting for user **APPROVED** before writing code.  
**Roadmap Item**: **#16 Testing, Quality, Isolation & CI Pipeline** (Wave 2 — Correctness & Final Foundation)  
**Sequence Context**: Follows **#4 (Real Auth)**, **#3 (Database Layer)**, **#14 (API-First v1 Versioning)**, and **#15 (Observability - Pino & Sentry)**. Eliminates serial test execution bottlenecks, enforces complete per-worker test isolation, establishes automated GitHub Actions CI with hermetic tree verification, decomposes the monolithic `v1Router.js` (2,218 lines) into domain sub-routers, incorporates Sentry single-capture deduplication, and adds a dual-runner parity check for Turso.

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
Currently, running `npm test` requires serial execution (`--test-concurrency=1`), taking ~38-40 seconds across 411 tests. This is caused by shared disk and in-memory resources: all test suites contend for a single SQLite file (`data/test.db`), tenant directories (`data/tenants/`), and in-memory caches (`jobCache`, `_authRateMap`), leading to `SQLITE_BUSY` database lock contention and cross-suite state leakage under default parallel execution. Furthermore, running tests mutates tracked git files (`data/tenants/client-jfl/schedules/runs.json`, `schedules.json`), violating the hermetic testing contract. There is no automated CI pipeline to gate pull requests across backend tests, frontend unit tests, and production builds. Finally, `backend/routes/v1Router.js` has grown into a 2,218-line monolith that violates single-responsibility principles and hampers long-term maintainability.

### 1.2 Core Deliverables
1. **P0-1: Full Test Isolation (Parallel `npm test` in <10s)**:
   - Worker-scoped test database: `data/test-${process.pid}.db`, automatically created, migrated, and cleaned up on worker teardown.
   - Isolated tenant directories: dynamic `os.tmpdir()/test-tenants-${process.pid}`, ensuring zero file contention across suites.
   - Dynamic vulnerability path: `os.tmpdir()/vuln-${process.pid}.json` via `VULN_DATA_PATH`.
   - Clean in-memory resets: `resetJobCache()`, `resetRateLimits()`, `resetSchedulerState()`.
   - Formal test setup/teardown harness in `backend/tests/_setup.js`.
   - Pre-test cleanup script `scripts/cleanup-test-artifacts.js` triggered via `npm run pretest` to purge orphaned test databases after SIGKILL/OOM.
   - `.gitignore` update ignoring all worker databases (`data/test-*.db*`) and temporary tenant directories.
   - Remove `--test-concurrency=1` from `package.json` test script; tests execute concurrently across all available CPU cores with **zero** `SQLITE_BUSY` errors.
2. **P0-2: Production CI Pipeline (`.github/workflows/ci.yml`)**:
   - Automated GitHub Actions workflow triggered on `push` and `pull_request` against `main`.
   - Matrix testing across **Node 18 LTS** and **Node 20 LTS** (`strategy: matrix: { node-version: [18, 20] }`).
   - Automated validation steps:
     - OpenAPI 3.0 contract lint/validation (`docs/openapi-v1.yaml`).
     - Backend parallel test execution (`npm test`).
     - Hermetic clean-tree check (`scripts/verify-hermetic.js`: fails if tree was dirty before tests or dirty after tests).
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
   - Sub-routers do **NOT** define catch-all 404 handlers. A single catch-all 404 is placed at the bottom of `v1Router.js`.
   - Duplicate route detection test ensures no duplicate `(method, path)` endpoints across any sub-routers.
   - Zero regression: All 16 contract tests in `backend/tests/apiV1Contract.test.js` and all existing 411 tests pass.
4. **P1-2: Dual-Runner Parity CI Job (Turso vs SQLite)**:
   - CI job running tests with `TEST_USE_TURSO=true` against an ephemeral/remote Turso database.
   - Condition: Skipped on fork PRs or when `secrets.TURSO_DATABASE_URL` is empty. Failure mode is SKIPPED, not failed.
   - Data cleanup: PR/run-scoped tables (`ci_${{ github.run_id }}_`) and cleanup script `scripts/cleanup-turso-ci.js` run on completion (`if: always()`) to protect 1GB Turso storage limits.
5. **P2-1: Environment-Overridable Runtime Paths & Hermetic Contract**:
   - `TENANT_DATA_ROOT`: defaults to `data/tenants`, overridable to `os.tmpdir()` in tests.
   - `VULN_DATA_PATH`: defaults to `data/vulnerabilities.json`, overridable in tests.
   - `DATA_DIR`: defaults to `data/`, overridable in tests.
   - Guarantees zero tracked git files are created or modified during `npm test`.
6. **P2-2: Hermetic Test Contract & Verification Protocol**:
   - Strict contract: *"npm test requires no network, mutates zero tracked files."*
   - Script `scripts/verify-hermetic.js` enforces clean tree before tests, runs tests, and asserts clean tree after tests.
   - 5x consecutive test validation protocol (`1..5 | % { npm test }`) to prove zero flakiness under parallel execution.
7. **P2-3: Sentry Deduplication Resolution**:
   - Adopt Option (A): Remove `sentry.setupExpressErrorHandler(app)` from `backend/index.js`. Only the centralized Express error middleware captures unhandled exceptions via `sentry.captureException(err, { reqId, module: 'express', status })`.

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
  tmp/test-tenants-10421/   tmp/test-tenants-10422/   tmp/test-tenants-10423/
         │                         │                         │
         └─────────────────────────┼─────────────────────────┘
                                   │
                                   ▼
                   Process Teardown (_setup.js)
              (Unlinks test-*.db and cleans tmp dirs)
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
                                       │
                                       ▼
                       Single Catch-All 404 Handler
                    (Returns 404 JSON for unmatched v1)
```

---

## 3. Detailed Resolution of User Blockers & Concerns

### 3.1 BLOCKER 1: Sentry Deduplication in Express (Option A)
- **Problem**: `err.__sentry_captured__` is a custom flag not set by Sentry's `setupExpressErrorHandler`. Calling both `setupExpressErrorHandler` and manual `sentry.captureException` in custom error middleware causes duplicate error reports.
- **Resolution**:
  - Completely **remove** `sentry.setupExpressErrorHandler(app)` from `backend/index.js`.
  - The centralized custom Express error middleware handles all unhandled error logging and Sentry reporting:
    ```javascript
    app.use((err, req, res, next) => {
      const reqId = req.id || req.headers['x-request-id'] || 'unknown';
      const status = err.status || err.statusCode || 500;

      // Single, authoritative Sentry capture on unhandled/500 errors
      if (status >= 500) {
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
  - Test: `sentry_express_singleCapture_on500` asserts `captureException` is invoked exactly once during a 500 error.

### 3.2 BLOCKER 2: `.gitignore` and `pretest` Cleanup
- **Updates to `.gitignore`**:
  ```gitignore
  # Test Isolation Artifacts
  data/test-*.db
  data/test-*.db-wal
  data/test-*.db-shm
  data/test-tenants-*/
  ```
- **New Script `scripts/cleanup-test-artifacts.js`**:
  - Scans `data/` for orphaned `test-*.db`, `test-*.db-wal`, `test-*.db-shm`, and `test-tenants-*`.
  - Removes them using Node `fs.rmSync` / `fs.unlinkSync` with `force: true`.
  - Wired into `package.json`: `"pretest": "node scripts/cleanup-test-artifacts.js"`.

### 3.3 BLOCKER 3: Test Setup/Teardown Mechanism (`backend/tests/_setup.js`)
- **Mechanism**:
  - File: `backend/tests/_setup.js`.
  - Automatically executed on worker startup:
    1. Sets PID-scoped environment variables:
       - `process.env.NODE_ENV = 'test'`
       - `process.env.TEST_DB_PATH = path.resolve(__dirname, '../../data/test-' + process.pid + '.db')`
       - `process.env.TENANT_DATA_ROOT = path.join(os.tmpdir(), 'test-tenants-' + process.pid)`
       - `process.env.VULN_DATA_PATH = path.join(os.tmpdir(), 'vuln-' + process.pid + '.json')`
    2. Hooks `process.on('exit')` and `process.on('SIGINT')` to unlink the database and remove the temp tenant directory.
    3. Exports:
       - `setupTestEnvironment()`: Initializes paths and seeds minimal test DB tables if needed.
       - `cleanupTestEnvironment()` / `resetAllState()`: Resets `jobCache.resetJobCache()`, `schedulerService.resetSchedulerState()`, and `index.resetRateLimits()`.
  - In each test suite: Imported at top (`const { resetAllState } = require('./_setup');`) and called in `test.afterEach(resetAllState)` or `test.after(...)`.

### 3.4 BLOCKER 4: Turso Parity CI Job Credentials & Cleanup
- **In `.github/workflows/ci.yml`**:
  - Secret access: `secrets.TURSO_DATABASE_URL` and `secrets.TURSO_AUTH_TOKEN`.
  - Skip condition: `if: ${{ secrets.TURSO_DATABASE_URL != '' && secrets.TURSO_AUTH_TOKEN != '' }}`.
  - Failure behavior: When secrets are absent (fork PRs or missing config), the job is cleanly **SKIPPED** (not failed).
  - Storage defense: Script `scripts/cleanup-turso-ci.js` executes in `if: always()` step to drop tables created during test execution, preventing exhaustion of Turso's 1GB limit.

### 3.5 CONCERN 1: Node Version Matrix in CI
- Matrix configured in `.github/workflows/ci.yml`:
  ```yaml
  strategy:
    matrix:
      node-version: [18, 20]
  ```
- `package.json` specifies minimum supported engine: `"engines": { "node": ">=18.0.0 <23.0.0" }`.

### 3.6 CONCERN 2: 5x Consecutive Test Validation Protocol
- Once parallelization is active (without `--test-concurrency=1`), run 5 consecutive test passes locally and document the output:
  - PowerShell: `1..5 | ForEach-Object { Write-Host "Test Run $_"; npm test }`
  - All 5/5 runs must pass with 100% green tests and zero `SQLITE_BUSY` errors before marking Item #16 complete.

### 3.7 CONCERN 3: `v1Router.js` Catch-All 404 & Duplicate Route Detection
- Sub-routers (`v1/authRoutes.js`, etc.) contain **no** 404 handlers.
- Exactly one catch-all 404 handler is placed at the end of `v1Router.js`:
  ```javascript
  router.use('*', (req, res) => {
    res.status(404).json({
      error: 'API route not found',
      status: 404,
      path: req.originalUrl,
    });
  });
  ```
- New test `v1Router_noDuplicateRoutes`: Traverses `v1Router.stack` recursively, gathers all `(method, path)` pairs, and asserts `duplicateRoutes.length === 0`.

### 3.8 CONCERN 4: `verify-hermetic.js` Clean-Tree Protocol
- Step 1: Pre-test check: `git status --porcelain`. If dirty, abort immediately with:
  `"ERROR: Working tree is dirty before tests ran. Commit or stash existing changes before running hermetic verification."` (exit code 1).
- Step 2: Execute `npm test` synchronously via child process.
- Step 3: Post-test check: `git status --porcelain`. If dirty, output diff and exit code 1.
- Step 4: Exit 0 if clean.

### 3.9 CONCERN 5: `package.json` Scripts Before/After
- **Before**:
  ```json
  "scripts": {
    "dev": "node --env-file-if-exists=.env --watch --watch-path=backend backend/index.js",
    "dev:backend": "node --watch --watch-path=backend backend/index.js",
    "dev:frontend": "npx vite --config frontend/vite.config.js",
    "build": "npm install --prefer-offline && cd backend && npm install --prefer-offline && cd .. && cd frontend && npm install --include=dev --prefer-offline && npm run build",
    "start": "node --env-file-if-exists=.env backend/index.js",
    "test": "node --test --test-concurrency=1 backend/tests/*.test.js backend/tests/ai/*.test.js frontend/src/__tests__/validators/*.test.js",
    "parity": "node scripts/deployment-parity.js",
    "reconcile": "node scripts/ssot-reconciler.js"
  }
  ```
- **After**:
  ```json
  "scripts": {
    "dev": "node --env-file-if-exists=.env --watch --watch-path=backend backend/index.js",
    "dev:backend": "node --watch --watch-path=backend backend/index.js",
    "dev:frontend": "npx vite --config frontend/vite.config.js",
    "build": "npm install --prefer-offline && cd backend && npm install --prefer-offline && cd .. && cd frontend && npm install --include=dev --prefer-offline && npm run build",
    "start": "node --env-file-if-exists=.env backend/index.js",
    "pretest": "node scripts/cleanup-test-artifacts.js",
    "test": "node --test backend/tests/*.test.js backend/tests/ai/*.test.js frontend/src/__tests__/validators/*.test.js",
    "test:serial": "node --test --test-concurrency=1 backend/tests/*.test.js backend/tests/ai/*.test.js frontend/src/__tests__/validators/*.test.js",
    "test:turso": "cross-env TEST_USE_TURSO=true npm test",
    "check:hermetic": "node scripts/verify-hermetic.js",
    "parity": "node scripts/deployment-parity.js",
    "reconcile": "node scripts/ssot-reconciler.js"
  }
  ```

---

## 4. Files to Touch & Scope Breakdown

### 4.1 Files to Create:
1. `.github/workflows/ci.yml`: Production GitHub Actions workflow (Node 18/20 matrix, `npm ci`, parallel test, clean git check, frontend test, Vite build, Turso parity job).
2. `scripts/cleanup-test-artifacts.js`: Cross-platform pre-test artifact cleaner (`test-*.db*`, `test-tenants-*`).
3. `scripts/verify-hermetic.js`: Strict clean-tree verifier (pre-check clean -> test -> post-check clean).
4. `scripts/cleanup-turso-ci.js`: Turso cloud table dropper for CI runs.
5. `backend/tests/_setup.js`: Isolated worker test setup, PID path binding, and state resets.
6. `backend/routes/v1/authRoutes.js`: Auth endpoints extracted from `v1Router.js`.
7. `backend/routes/v1/dashboardRoutes.js`: Dashboard, site, lineage, QoQ, and AI routes extracted from `v1Router.js`.
8. `backend/routes/v1/reportRoutes.js`: Uploads, analysis, history, and PPT routes extracted from `v1Router.js`.
9. `backend/routes/v1/tenantRoutes.js`: Client CRUD, locations, settings, and rules routes extracted from `v1Router.js`.
10. `backend/routes/v1/scheduleRoutes.js`: Schedule CRUD, execution triggering, and runs history extracted from `scheduleRoutes.js`.
11. `backend/routes/v1/dataHealthRoutes.js`: Data health inspection and export routes extracted from `v1Router.js`.
12. `backend/routes/v1/healthRoutes.js`: Health check routes extracted from `v1Router.js`.
13. `backend/tests/testIsolation.test.js`: Comprehensive TDD suite for worker isolation, duplicate routes, rate-limit resets, and Sentry single-capture.

### 4.2 Files to Modify:
1. `.gitignore`: Add test isolation patterns (`data/test-*.db*`, `data/test-tenants-*/`).
2. `package.json`: Add `pretest`, remove `--test-concurrency=1` from `test`, add `test:serial`, `test:turso`, `check:hermetic`.
3. `backend/config/database.js`: Worker-scoped database URL (`test-${process.pid}.db`) and auto-migration on worker launch.
4. `backend/services/clientService.js`: Respect `process.env.TENANT_DATA_ROOT`.
5. `backend/services/schedulerService.js`: Respect `clientService.getTenantDir()` and export `resetSchedulerState()`.
6. `backend/services/templateService.js`: Respect `clientService.getTenantDir()`.
7. `backend/services/vulnerabilityFetcher.js`: Respect `process.env.VULN_DATA_PATH`.
8. `backend/services/jobCache.js`: Export `resetJobCache()`.
9. `backend/routes/v1Router.js`: Decompose into modular router aggregator with single 404 catch-all.
10. `backend/index.js`: Remove `sentry.setupExpressErrorHandler(app)` (Option A Sentry deduplication) and export `resetRateLimits()`.

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
9. **`v1Router_noDuplicateRoutes`**: Asserts no duplicate `(method, path)` endpoints exist across all domain sub-routers.
10. **`v1Router_unmatched_returns_json_404`**: Asserts unmatched `/api/v1/nonexistent` returns 404 JSON with `{ error: 'API route not found', status: 404 }`.
11. **`sentry_express_singleCapture_on500`**: Asserts unhandled 500 triggers `sentry.captureException` exactly once (no double-capture).
12. **`hermetic_contract_git_status_clean`**: Runs the entire test suite and asserts `git status --porcelain` contains zero modified or untracked files.

---

## 6. Risk Assessment & Rollback

- **Risk Level**: **LOW**.
  - Worker isolation strictly improves stability and test speed without altering production business logic or math formulas.
  - Sub-router decomposition preserves all existing route paths, HTTP methods, headers, and status codes.
- **Rollback Path**:
  - Revert commit: `git revert HEAD`. The server resumes reading `v1Router.js` as a single file and running `npm test` serially.
