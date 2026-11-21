# Code Review: Item #10 — Async Queue & Background Job Processing

## 1. Summary of Changes
- **Architecture**: Implemented dual-driver background queue system (`BullMQ` + `ioredis` with an automatic, zero-dependency `InMemoryJobQueue` fallback).
- **Staging & Retry Policies**:
  - File staging under `uploads/staged/{jobId}/`.
  - Retry-aware cleanup: staged files are retained during transient retries and purged only on complete success, unrecoverable errors, or when retries are exhausted.
- **Concurrency & Deadlock Prevention**:
  - `TenantLockManager` enforces per-tenant mutual exclusion so concurrent jobs for the same tenant are serialized without corrupting datasets.
  - 10-minute TTL deadlock breaker forcefully releases orphaned locks.
- **Boot Recovery & Zombie Sweepers**:
  - On application startup, `queueService.initialize()` purges orphaned staged upload directories and recursively scrubs lingering `.tmp` files.
- **Deep Cancellation & Watchdog**:
  - 4-minute watchdog timeout kills hung tasks.
  - User cancellation endpoint `DELETE /api/jobs/:jobId` triggers `AbortController.abort()`.
  - Processing loops in `processData.js` and `pptGenerator.js` check `options.signal?.aborted` to immediately release CPU-bound execution.
- **Atomic File Operations**:
  - `historyService.js`, `processData.js` (dashboard JSON), and `pptGenerator.js` (PowerPoint presentation) write to unique `.tmp` files first, followed by atomic renames.
- **Tenant Isolation**:
  - `GET /api/jobs/:jobId`, `DELETE /api/jobs/:jobId`, and `/api/ppt/download/:jobId` verify `req.tenantId === job.clientId`.
- **Frontend Live Polling & State Recovery**:
  - `FileUploader.jsx` polls `/api/jobs/:jobId` with animated progress (0–100%), stage indicators, and cancel control.
  - Stores active job in `localStorage` and automatically resumes on refresh; purges job state when switching tenants.
  - Hard 5-minute timeout prevents indefinite spinning.

## 2. Invariant & Test Verification
- Backend unit tests (`backend/tests/asyncQueue.test.js`): 14/14 passed.
- Backend integration tests (`backend/tests/jobRoutes.test.js`): 6/6 passed.
- All repo backend & validator tests (`npm test`): 296/296 passed.
- Frontend component tests (`npm --prefix frontend test`): 8/8 passed.
- Frontend production bundle (`npm --prefix frontend run build`): Succeeded with 0 errors.
