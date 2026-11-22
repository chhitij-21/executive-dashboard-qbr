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
   - Formal test setup/teardown harness in `backend/tests/_setup.js` with **strictly synchronous** exit cleanup (`fs.unlinkSync`, `fs.rmSync`).
   - Automated import enforcement script `scripts/check-test-setup-imports.js` ensuring 100% of test files import `_setup.js`.
   - Pre-test cleanup scripts `pretest` and `pretest:serial` via `scripts/cleanup-test-artifacts.js` to purge orphaned test databases after SIGKILL/OOM.
   - `.gitignore` update ignoring all worker databases (`data/test-*.db*`) and temporary tenant directories.
   - Remove `--test-concurrency=1` from `package.json` test script; tests execute concurrently across all available CPU cores with **zero** `SQLITE_BUSY` errors.
2. **P0-2: Production CI Pipeline (`.github/workflows/ci.yml`)**:
   - Automated GitHub Actions workflow triggered on `push` and `pull_request` against `main`.
   - Matrix testing across **Node 18 LTS** and **Node 20 LTS** (`strategy: matrix: { node-version: [18, 20] }`), naturally testing 2 complete test runs per PR.
   - Automated validation steps:
     - Check `_setup.js` import compliance across all test files (`npm run check:test-setup`).
     - OpenAPI 3.0 contract lint/validation (`docs/openapi-v1.yaml`).
     - Backend parallel test execution (`npm test`).
     - Hermetic clean-tree check (`scripts/verify-hermetic.js`: runs AFTER tests finish; fails if tree was dirty before tests or dirty after tests).
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
   - Cross-platform runner script `scripts/run-turso-test.js` providing zero-dependency Node-native environment switching for `npm run test:turso` on Windows, macOS, and Linux.
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
   - 5x consecutive test validation protocol on local release branch (`1..5 | % { npm test }`) to prove zero flakiness under parallel execution.
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
              Synchronous Process Teardown (_setup.js)
        (fs.unlinkSync test-*.db* & fs.rmSync tmp dirs)
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

## 3. Detailed Resolution of User Blockers, Gaps & Concerns

### 3.1 GAP 1: Cross-Platform `test:turso` Execution (Node-Native)
- **Problem**: `cross-env` is not installed; `cross-env TEST_USE_TURSO=true npm test` fails immediately on Windows.
- **Resolution**:
  - Implement zero-dependency Node-native runner script: `scripts/run-turso-test.js`:
    ```javascript
    const { spawnSync } = require('child_process');
    const env = { ...process.env, TEST_USE_TURSO: 'true' };
    const result = spawnSync('npm', ['test'], { stdio: 'inherit', env, shell: true });
    process.exit(result.status || 0);
    ```
  - In `package.json`, define: `"test:turso": "node scripts/run-turso-test.js"`.
  - Also add `cross-env` to `devDependencies` for projects/developers preferring CLI variable assignment.

### 3.2 GAP 2: Enforce `_setup.js` Import Across 100% of Test Files
- **Problem**: If even 1 test file omits `require('./_setup')`, that file falls back to shared `data/test.db` without PID scoping, causing intermittent `SQLITE_BUSY` locks under parallel execution.
- **Resolution**:
  - Implement enforcement script `scripts/check-test-setup-imports.js`:
    - Reads all test files matching `backend/tests/*.test.js` and `backend/tests/ai/*.test.js` (excluding `_setup.js`).
    - Uses regex `/require\(['"].*\/_setup(\.js)?['"]\)/` to confirm the test imports `_setup.js`.
    - If any file is missing the import, it logs `MISSING _setup.js import: <filePath>` and terminates with exit code 1.
  - Wired into `package.json`: `"check:test-setup": "node scripts/check-test-setup-imports.js"`.
  - Executed as a gating step in CI and inside `scripts/verify-hermetic.js`.

### 3.3 GAP 3: Decouple Hermetic Verification from Parallel Test Runner
- **Problem**: Running a test asserting `git status --porcelain` *inside* `backend/tests/testIsolation.test.js` races against parallel worker processes creating temporary test artifacts, falsely failing.
- **Resolution**:
  - Remove `hermetic_contract_git_status_clean` from `backend/tests/testIsolation.test.js`.
  - Hermetic verification runs exclusively in `scripts/verify-hermetic.js` (and in CI step) **AFTER** `npm test` has completely finished and all child worker processes have exited.
  - Replaced test in `testIsolation.test.js` with `exit_handler_cleanup_synchronous` (spawns child process requiring `_setup.js`, exits, and verifies artifacts were deleted).

### 3.4 GAP 4: Synchronous Exit Cleanup in `_setup.js`
- **Problem**: Node ignores asynchronous callbacks and promises inside `process.on('exit')`. If cleanup uses `fs.unlink` or async/await, files are dropped and persist on disk.
- **Resolution**:
  - `backend/tests/_setup.js` exclusively uses synchronous Node filesystem APIs in its exit handler:
    ```javascript
    process.on('exit', () => {
      try {
        const dbPath = process.env.TEST_DB_PATH;
        if (dbPath) {
          if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
          if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`);
          if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`);
        }
        const tenantDir = process.env.TENANT_DATA_ROOT;
        if (tenantDir && fs.existsSync(tenantDir)) {
          fs.rmSync(tenantDir, { recursive: true, force: true });
        }
        const vulnPath = process.env.VULN_DATA_PATH;
        if (vulnPath && fs.existsSync(vulnPath)) {
          fs.unlinkSync(vulnPath);
        }
      } catch (e) {
        // Suppress teardown errors during process termination
      }
    });
    ```
  - Added test: `exit_handler_cleanup_synchronous` spawns a child worker, lets it exit, and verifies `fs.existsSync` returns false for all worker artifacts.

### 3.5 CONCERN 1: Validation Execution Scope (5x vs 2x)
- **Local Pre-Merge / Release Gate**: Run `npm test` 5 consecutive times (`1..5 | % { npm test }` or `for i in {1..5}; do npm test || exit 1; done`). 5/5 passes required before marking Item #16 complete.
- **Pull Request CI (`.github/workflows/ci.yml`)**: Uses GitHub Actions matrix for Node 18 and Node 20. Running 1x per matrix leg naturally tests 2 full runs on distinct Node engines without adding +3 minutes to every developer PR.

### 3.6 CONCERN 2: `pretest:serial` Lifecycle Hook
- **Problem**: `npm run test:serial` does not trigger `pretest` (npm lifecycle only binds `pretest` to `npm test`).
- **Resolution**:
  - Add explicit `"pretest:serial": "node scripts/cleanup-test-artifacts.js"` in `package.json`.
  - Guarantees `npm run test:serial` also cleans orphaned test files prior to execution.

### 3.7 Auto-Migration Parallel Safety Note
- `backend/db/schema.sql` uses `CREATE TABLE IF NOT EXISTS` for all tables.
- In addition, because each worker process connects to its own dedicated SQLite database file (`data/test-${process.pid}.db`), migrations run in strict isolation without lock contention.

---

## 4. `package.json` Scripts Specification

### 4.1 Before & After

```diff
  "scripts": {
    "dev": "node --env-file-if-exists=.env --watch --watch-path=backend backend/index.js",
    "dev:backend": "node --watch --watch-path=backend backend/index.js",
    "dev:frontend": "npx vite --config frontend/vite.config.js",
    "build": "npm install --prefer-offline && cd backend && npm install --prefer-offline && cd .. && cd frontend && npm install --include=dev --prefer-offline && npm run build",
    "start": "node --env-file-if-exists=.env backend/index.js",
-   "test": "node --test --test-concurrency=1 backend/tests/*.test.js backend/tests/ai/*.test.js frontend/src/__tests__/validators/*.test.js",
+   "pretest": "node scripts/cleanup-test-artifacts.js",
+   "pretest:serial": "node scripts/cleanup-test-artifacts.js",
+   "test": "node --test backend/tests/*.test.js backend/tests/ai/*.test.js frontend/src/__tests__/validators/*.test.js",
+   "test:serial": "node --test --test-concurrency=1 backend/tests/*.test.js backend/tests/ai/*.test.js frontend/src/__tests__/validators/*.test.js",
+   "test:turso": "node scripts/run-turso-test.js",
+   "check:test-setup": "node scripts/check-test-setup-imports.js",
+   "check:hermetic": "node scripts/verify-hermetic.js",
    "parity": "node scripts/deployment-parity.js",
    "reconcile": "node scripts/ssot-reconciler.js"
  }
```

---

## 5. Files to Touch & Scope Breakdown

### 5.1 Files to Create:
1. `.github/workflows/ci.yml`: Production GitHub Actions workflow (Node 18/20 matrix, `npm ci`, setup check, parallel test, clean git check, frontend test, Vite build, Turso parity job).
2. `scripts/cleanup-test-artifacts.js`: Cross-platform pre-test artifact cleaner (`test-*.db*`, `test-tenants-*`).
3. `scripts/check-test-setup-imports.js`: Enforcement check ensuring 100% of test files import `_setup.js`.
4. `scripts/run-turso-test.js`: Cross-platform Node-native runner for Turso test mode.
5. `scripts/verify-hermetic.js`: Strict clean-tree verifier (pre-check clean -> test -> post-check clean).
6. `scripts/cleanup-turso-ci.js`: Turso cloud table dropper for CI runs.
7. `backend/tests/_setup.js`: Isolated worker test setup, PID path binding, and **synchronous** exit cleanup.
8. `backend/routes/v1/authRoutes.js`: Auth endpoints extracted from `v1Router.js`.
9. `backend/routes/v1/dashboardRoutes.js`: Dashboard, site, lineage, QoQ, and AI routes extracted from `v1Router.js`.
10. `backend/routes/v1/reportRoutes.js`: Uploads, analysis, history, and PPT routes extracted from `v1Router.js`.
11. `backend/routes/v1/tenantRoutes.js`: Client CRUD, locations, settings, and rules routes extracted from `v1Router.js`.
12. `backend/routes/v1/scheduleRoutes.js`: Schedule CRUD, execution triggering, and runs history extracted from `scheduleRoutes.js`.
13. `backend/routes/v1/dataHealthRoutes.js`: Data health inspection and export routes extracted from `v1Router.js`.
14. `backend/routes/v1/healthRoutes.js`: Health check routes extracted from `v1Router.js`.
15. `backend/tests/testIsolation.test.js`: Comprehensive TDD suite for worker isolation, duplicate routes, rate-limit resets, synchronous exit cleanup, and Sentry single-capture.

### 5.2 Files to Modify:
1. `.gitignore`: Add test isolation patterns (`data/test-*.db*`, `data/test-tenants-*/`).
2. `package.json`: Add `pretest`, `pretest:serial`, remove `--test-concurrency=1` from `test`, add `test:serial`, `test:turso`, `check:test-setup`, `check:hermetic`, add `devDependencies: { "cross-env": "^7.0.3" }`.
3. `backend/config/database.js`: Worker-scoped database URL (`test-${process.pid}.db`) and auto-migration on worker launch.
4. `backend/services/clientService.js`: Respect `process.env.TENANT_DATA_ROOT`.
5. `backend/services/schedulerService.js`: Respect `clientService.getTenantDir()` and export `resetSchedulerState()`.
6. `backend/services/templateService.js`: Respect `clientService.getTenantDir()`.
7. `backend/services/vulnerabilityFetcher.js`: Respect `process.env.VULN_DATA_PATH`.
8. `backend/services/jobCache.js`: Export `resetJobCache()`.
9. `backend/routes/v1Router.js`: Decompose into modular router aggregator with single 404 catch-all.
10. `backend/index.js`: Remove `sentry.setupExpressErrorHandler(app)` (Option A Sentry deduplication) and export `resetRateLimits()`.
11. Existing test files (`backend/tests/*.test.js`, `backend/tests/ai/*.test.js`): Ensure `require('./_setup')` or `require('../_setup')` is present at the top.

---

## 6. Test Strategy (TDD)

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
12. **`exit_handler_cleanup_synchronous`**: Spawns a child process that requires `_setup.js`, exits, and asserts PID-scoped files are synchronously unlinked.

---

## 7. Risk Assessment & Rollback

- **Risk Level**: **LOW**.
  - Worker isolation strictly improves stability and test speed without altering production business logic or math formulas.
  - Sub-router decomposition preserves all existing route paths, HTTP methods, headers, and status codes.
- **Rollback Path**:
  - Revert commit: `git revert HEAD`. The server resumes reading `v1Router.js` as a single file and running `npm test` serially.
