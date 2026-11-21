# Implementation Plan: Item #10 Async Queue (BullMQ + Redis with In-Memory Fallback)

## 1. Problem Statement & Architecture
Currently, when a user uploads Excel files to `/api/process-data` or `/api/upload`, data ingestion, Excel parsing, mathematical aggregation, QoQ diffing, and PowerPoint deck generation all execute synchronously within the Express request cycle. 
- For multi-site workbooks with large incident sheets, this takes several seconds, blocking Node's event loop, risking HTTP timeout errors (especially behind reverse proxies, Cloudflare, or Render cold starts), and providing zero real-time progress feedback to the user.
- Item #10 decouples file ingestion from computational processing by introducing an **Asynchronous Job Queue**:
  - **Option A Selected**: **BullMQ** with Redis connection (`REDIS_URL`), paired with a robust **In-Memory Worker Fallback** when Redis is absent or offline.
  - **HTTP 202 Accepted Pattern**: Uploads return a `jobId` immediately (< 200ms).
  - **Real-Time Progress Polling**: The frontend displays an active progress bar and dynamic stage messages by polling `GET /api/jobs/:jobId`.
  - **Zero Regressions**: Direct synchronous calls to `processData` remain supported for offline scripts and existing unit tests via `?sync=true` query parameter.

---

## 2. Job State Schema & Query Location

### A. Exact Job State Schema (Multi-File Capable)
The job state object is standardized across both BullMQ and In-Memory queue implementations, supporting multi-file uploads (e.g., separate Inventory and Incident workbooks):

```typescript
interface JobState {
  jobId: string;                     // Unique UUID v4 identifying the job
  clientId: string;                  // Tenant identifier (e.g. 'client-jfl', 'client-mmtcpamp')
  status: 'queued' | 'processing' | 'completed' | 'failed'; // High-level lifecycle status
  progress: number;                  // Integer percentage (0 to 100)
  stage: 'queued' | 'upload_validation' | 'excel_parsing' | 'data_processing' | 'ppt_generation' | 'finished';
  message: string;                   // User-facing progress message (e.g. 'Parsing Excel workbook...')
  resultUrl: string | null;          // Dashboard data endpoint: '/api/dashboard?jobId={jobId}'
  downloadUrl: string | null;        // PowerPoint download endpoint: '/api/ppt/download/{jobId}'
  error: string | null;              // Sanitized customer-ready error message if status === 'failed'
  fileNames: string[] | null;        // Array of uploaded file names (e.g. ['Inventory_Master.xlsx', 'Incidents_Q2.xlsx'])
  reportPeriod: {                    // Reporting period metadata
    startDate: string;
    endDate: string;
    quarter?: string;
    fiscalYear?: string;
  } | null;
  createdAt: string;                 // ISO 8601 creation timestamp
  startedAt: string | null;          // ISO 8601 start timestamp
  completedAt: string | null;        // ISO 8601 completion timestamp
  durationMs: number | null;         // Execution duration in milliseconds
}
```

### B. Where Job State is Queried From
- **Queue Service Unified Registry (`backend/services/queueService.js`)**:
  - **Redis Mode (Production)**: BullMQ persists job status, progress, and return values in Redis hash keys (`bull:qbr-processing:{jobId}`). State queries fetch directly from BullMQ's `Job.fromId(queue, jobId)`.
  - **In-Memory Fallback Mode (Local Dev / CI / Fallback)**: Maintains an internal `Map<string, JobState>` for active and recent jobs.
  - **Memory Eviction Policy**: Completed or failed jobs are automatically pruned from the in-memory Map after 1 hour, with a max capacity limit of 500 records.
  - **Persistent History Sync**: Upon job completion, `queueService` commits the job metadata and summary into `data/reports_metadata.json` via `historyService`, guaranteeing that completed jobs remain retrievable across server restarts even in in-memory mode.
- **Query Endpoint**: `GET /api/jobs/:jobId` (enforcing strict tenant isolation via `resolveTenantContext`).

---

## 3. Progress Reporting Mechanism & API Endpoint Contract

### A. Reporting Mechanism (Polling vs SSE)
- **Selected Mechanism: REST Polling via `GET /api/jobs/:jobId`**:
  - **Interval**: 1.5 – 2 seconds using recursive `setTimeout` in the frontend.
  - **Hard Timeout**: 5 minutes (`300,000ms`). If processing exceeds 5 minutes, polling halts, local state is purged, and a diagnostic timeout state is shown.
  - **Resilience**: 100% resilient across HTTP/2 proxies, firewalls, and serverless/Render environments where Server-Sent Events (SSE) connections frequently drop or buffer headers.
  - **Backoff & Error Tolerance**: Resilient up to 5 consecutive network blips before flagging network disconnection.

### B. Real Progress Reporting Wiring (`onProgress` Callbacks)
To prevent the progress bar from jumping abruptly from 0% to 100%, real computation loops in `processData.js` and `pptGenerator.js` accept an `onProgress(percent, message, stage)` callback:
1. **`processData.js` Progress Points**:
   - **`15%`**: `upload_validation` – File signatures verified, date bounds validated.
   - **`35%`**: `excel_parsing` – Inventory sheets and raw incident rows extracted.
   - **`50%`**: `data_processing` – Device uptime, site SLA aggregation, and health scores computed.
   - **`65%`**: `data_processing` – QoQ comparative analytics and RCA category shifts resolved.
2. **`pptGenerator.js` Progress Points**:
   - **`75%`**: `ppt_generation` – Title, executive summary, and QoQ comparative slides built.
   - **`88%`**: `ppt_generation` – Site-by-site breakdowns and incident tables rendered.
   - **`95%`**: `ppt_generation` – Presentation compiled and written to disk.
   - **`100%`**: `finished` – Finalized and registered in history service.

### C. API Endpoint Contract

#### 1. `GET /api/jobs/:jobId` (Status & Progress)
- **Method & Route**: `GET /api/jobs/:jobId`
- **Headers**:
  - `x-client-id: <clientId>` (or authenticated session JWT)
- **Response `200 OK` (Processing)**:
  ```json
  {
    "success": true,
    "job": {
      "jobId": "7a9b1c2d-3e4f-5a6b-7c8d-9e0f1a2b3c4d",
      "clientId": "client-jfl",
      "status": "processing",
      "progress": 65,
      "stage": "data_processing",
      "message": "Analyzing Quarter-over-Quarter movements and RCA shifts...",
      "resultUrl": null,
      "downloadUrl": null,
      "error": null,
      "fileNames": ["Inventory_Master.xlsx", "Incidents_Q2.xlsx"],
      "createdAt": "2026-11-21T16:50:00.000Z",
      "startedAt": "2026-11-21T16:50:00.500Z",
      "completedAt": null,
      "durationMs": null
    }
  }
  ```
- **Response `200 OK` (Completed)**:
  ```json
  {
    "success": true,
    "job": {
      "jobId": "7a9b1c2d-3e4f-5a6b-7c8d-9e0f1a2b3c4d",
      "clientId": "client-jfl",
      "status": "completed",
      "progress": 100,
      "stage": "finished",
      "message": "Report processing and PowerPoint generation completed successfully.",
      "resultUrl": "/api/dashboard?jobId=7a9b1c2d-3e4f-5a6b-7c8d-9e0f1a2b3c4d",
      "downloadUrl": "/api/ppt/download/7a9b1c2d-3e4f-5a6b-7c8d-9e0f1a2b3c4d",
      "error": null,
      "fileNames": ["Inventory_Master.xlsx", "Incidents_Q2.xlsx"],
      "createdAt": "2026-11-21T16:50:00.000Z",
      "startedAt": "2026-11-21T16:50:00.500Z",
      "completedAt": "2026-11-21T16:50:05.200Z",
      "durationMs": 4700
    }
  }
  ```
- **Response `200 OK` (Failed - Sanitized Error)**:
  ```json
  {
    "success": false,
    "job": {
      "jobId": "7a9b1c2d-3e4f-5a6b-7c8d-9e0f1a2b3c4d",
      "clientId": "client-jfl",
      "status": "failed",
      "progress": 35,
      "stage": "excel_parsing",
      "message": "Workbook validation failed: Missing required sheet 'Master'",
      "resultUrl": null,
      "downloadUrl": null,
      "error": "Workbook validation failed: Missing required sheet 'Master'",
      "fileNames": ["Inventory_Master.xlsx"],
      "createdAt": "2026-11-21T16:50:00.000Z",
      "startedAt": "2026-11-21T16:50:00.500Z",
      "completedAt": "2026-11-21T16:50:02.100Z",
      "durationMs": 1600
    }
  }
  ```
- **Response `404 Not Found`**: Returned if the `jobId` does not exist or belongs to another tenant (enforcing strict tenant isolation).

#### 2. `DELETE /api/jobs/:jobId` (Job Cancellation Endpoint)
- **Method & Route**: `DELETE /api/jobs/:jobId`
- **Headers**:
  - `x-client-id: <clientId>` (or authenticated session JWT)
- **Behavior**:
  - Verifies tenant isolation (`req.tenantId === job.clientId`).
  - If job is in status `'queued'` or `'processing'`:
    - Triggers `abortController.abort()` to interrupt active CPU processing loops.
    - Cancels BullMQ job via `job.discard()` / `job.remove()`.
    - Transitions job status to `'failed'` with error message: `'Job cancelled by user.'`.
    - Unconditionally releases the tenant lock.
    - Purges temporary staging directory and partial `.tmp` outputs.
    - Returns **`200 OK`**:
      ```json
      {
        "success": true,
        "jobId": "7a9b1c2d-3e4f-5a6b-7c8d-9e0f1a2b3c4d",
        "message": "Job cancelled successfully."
      }
      ```
  - If job is already in terminal state (`'completed'` or `'failed'`):
    - Returns **`400 Bad Request`**: `{ "error": "Cannot cancel job in terminal state." }`.

---

## 4. Production Safeguards & Edge-Case Architecture

### 1. Worker Hard Timeout (`MAX_JOB_EXECUTION_MS = 4 Minutes`)
- **Problem**: If an Excel workbook causes an infinite loop, memory swapping, or unhandled promise deadlock, the worker could run indefinitely, keeping the tenant lock permanently held and starving the server.
- **Solution**: Strict 4-Minute Execution Guard:
  - In `queueService.js`, define:
    ```javascript
    const MAX_JOB_EXECUTION_MS = 4 * 60 * 1000; // 4 minutes
    ```
  - When worker starts processing, schedule a hard watchdog timer tied to the job's `AbortController`:
    ```javascript
    const timeoutHandle = setTimeout(() => {
      abortController.abort();
      failJob(job.jobId, 'Job timed out');
      releaseTenantLock(job.clientId, job.jobId);
      cleanupStagedFiles(job.jobId);
      console.warn(`[queueService] Job ${job.jobId} exceeded 4m execution timeout. Forcefully killed.`);
    }, MAX_JOB_EXECUTION_MS);
    ```
  - On normal completion or error, `clearTimeout(timeoutHandle)` is invoked in `finally`.
  - Guarantees that hanging jobs are killed, tenant locks are freed, and resources are recovered.

### 2. Dashboard, History & Download Strict Tenant Isolation Verification
- **Problem**: Querying endpoints with an explicit `jobId` parameter could leak another tenant's metrics or files if cross-tenant ownership is not verified.
- **Solution**: Multi-Endpoint Tenant Isolation Guard in `backend/index.js`:
  - **`GET /api/dashboard?jobId=:jobId`**:
    - Queries `historyService.getReportByJobId(jobId)` or `queueService.getJob(jobId)`.
    - Strictly checks `report.clientId === req.tenantId`.
    - If mismatch: responds with **`403 Forbidden`** `{ "error": "Access denied: Report belongs to another tenant." }`.
  - **`GET /api/reports/history`**:
    - Filters loaded reports strictly by `record.clientId === req.tenantId`.
    - Cross-tenant historical summaries are NEVER returned.
  - **`GET /api/ppt/download/:jobId`**:
    - Verifies `job.clientId === req.tenantId` before serving files. Mismatches return `403 Forbidden`.
  - **`GET /api/ppt/latest`**:
    - Filters latest completed report strictly matching `req.tenantId`.

### 3. Customer-Safe Error Sanitization (Zero Stack Trace Leakage)
- **Problem**: Exposing raw error strings (`ENOENT: no such file ... C:\Users\Chhitij\...`, internal driver exceptions, or stack traces) leaks internal server architecture and creates security vulnerabilities.
- **Solution**: Strict Error Sanitization Guard:
  - Inside `queueService.js`:
    ```javascript
    function sanitizeErrorMessage(err) {
      if (!err) return 'Report generation failed. Please try again.';
      const msg = typeof err === 'string' ? err : err.message || '';
      
      // Allow friendly domain validation messages
      if (err.isUnrecoverable || err.name === 'UnrecoverableError' || msg.includes('Workbook validation') || msg.includes('Missing required sheet')) {
        return msg;
      }
      if (msg === 'Job timed out' || msg === 'Job cancelled by user.') {
        return msg;
      }
      
      // Default sanitized fallback for unexpected runtime exceptions
      return 'Report generation failed. Please try again.';
    }
    ```
  - `job.error` strictly contains the sanitized string.
  - Full diagnostic details (`err.stack`, memory usage) are logged strictly to server console/logs via `console.error('[queueService] Internal job error:', err)`.

### 4. Deep Cancellation Checks in CPU-Bound Loops
- **Problem**: Node.js is single-threaded. An `AbortController` will NOT magically interrupt heavy synchronous `for` loops in `processData.js` or `pptGenerator.js`. Without explicit checks, an aborted job will keep spinning CPU cycles to completion.
- **Solution**: Pass `signal` (`AbortSignal`) down into core computational loops and evaluate cancellation checkpoints:
  - Inside `processData.js`:
    ```javascript
    // Checkpoint 1: In workbook sheet extraction loop
    for (const sheetName of workbook.SheetNames) {
      if (options.signal?.aborted) throw new Error('Job cancelled');
      // ... parse sheet
    }
    // Checkpoint 2: In device iteration & inventory mapping loop
    for (const dev of devices) {
      if (options.signal?.aborted) throw new Error('Job cancelled');
      // ... process device
    }
    // Checkpoint 3: In site SLA calculation loop
    for (const site of sites) {
      if (options.signal?.aborted) throw new Error('Job cancelled');
      // ... aggregate SLA
    }
    ```
  - Inside `pptGenerator.js`:
    ```javascript
    // Checkpoint 4: In slide generation loop
    for (const site of data.siteSummary) {
      if (options.signal?.aborted) throw new Error('Job cancelled');
      buildSiteOverviewSlide(pres, site, options);
    }
    ```
  - Upon cancellation, the loop aborts instantly (< 1ms), throws `'Job cancelled'`, unwinds the execution stack, releases tenant locks, deletes staging and `.tmp` files, and halts compute.

### 5. Zombie .tmp File Sweeper on Server Startup
- **Problem**: If the server crashes or restarts midway through writing a `.tmp` file, orphaned files like `report.pptx.tmp.*` or `dashboard_data.json.tmp.*` linger on disk indefinitely, consuming disk space.
- **Solution**: Multi-Directory Zombie .tmp Cleanup in `queueService.initialize()`:
  - On server boot, recursively scan:
    1. `data/tenants/*/reports/`
    2. `data/tenants/*/`
    3. `uploads/staged/`
  - Match and delete any files matching `*.tmp.*` or ending in `.tmp`:
    ```javascript
    async function purgeOrphanedTmpFiles(dir) {
      if (!fs.existsSync(dir)) return;
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await purgeOrphanedTmpFiles(fullPath);
        } else if (entry.name.includes('.tmp')) {
          await fs.promises.unlink(fullPath).catch(() => {});
          console.log(`[queueService] Purged orphaned temp file: ${entry.name}`);
        }
      }
    }
    ```
  - Reclaims disk space and guarantees zero corrupted temporary artifacts survive reboots.

### 6. In-Memory Queue Eviction Policy (Memory Leak Prevention)
- **Problem**: In long-running processes, the `InMemoryJobQueue` internal `Map<string, JobState>` will grow indefinitely as users upload files, eventually causing an Out-Of-Memory (OOM) crash.
- **Solution**: Multi-Tiered Eviction Strategy:
  - **1-Hour TTL on Completed/Failed Jobs**:
    Upon reaching a terminal state (`completed` or `failed`), schedule automated eviction after 1 hour (`JOB_TTL_MS = 60 * 60 * 1000`):
    ```javascript
    setTimeout(() => {
      this.jobs.delete(jobId);
    }, JOB_TTL_MS).unref();
    ```
  - **Periodic Cleanup Sweeper**: A periodic timer running every 15 minutes sweeps `this.jobs` and purges any terminal jobs older than 1 hour.
  - **Capacity Cap (Max 500 Jobs)**: If `this.jobs.size` exceeds 500, immediately evict the oldest completed or failed jobs (FIFO) to enforce a hard upper bound on memory consumption. Active/processing jobs are never evicted.
  - Historical retrieval remains 100% intact through `data/reports_metadata.json`.

### 7. Redis Connection Error Handling & Graceful Fallback
- **Problem**: `ioredis` and BullMQ emit EventEmitter `'error'` events when Redis is unreachable, misconfigured, or disconnects mid-flight. In Node.js, unhandled `'error'` events throw an uncaught exception, crashing the entire web server.
- **Solution**: Explicit Error Listeners & Safe Degradation:
  - Attach mandatory `'error'` handlers to the Redis client and BullMQ instances immediately upon instantiation:
    ```javascript
    redisClient.on('error', (err) => {
      console.warn('[queueService] Redis connection warning (falling back to in-memory queue):', err.message);
    });
    bullQueue.on('error', (err) => {
      console.warn('[queueService] BullMQ Queue warning:', err.message);
    });
    bullWorker.on('error', (err) => {
      console.warn('[queueService] BullMQ Worker warning:', err.message);
    });
    ```
  - If Redis fails or disconnects during `enqueueJob`, the service catches the error, marks Redis as unhealthy, logs a non-fatal warning, and routes the job to `InMemoryJobQueue` seamlessly. The Node server never crashes.

### 8. LocalStorage Client Switch Reset Guard
- **Problem**: In `FileUploader.jsx`, if the user switches active client while an active `jobId` is stored in `localStorage`, resuming polling would fetch and display the wrong tenant's progress.
- **Solution**: Strict Client Match Verification:
  - On mount and in a `useEffect` watching `activeClientId`:
    ```javascript
    useEffect(() => {
      const storedClient = localStorage.getItem('active_qbr_job_client');
      if (storedClient && storedClient !== activeClientId) {
        localStorage.removeItem('active_qbr_job_id');
        localStorage.removeItem('active_qbr_job_client');
        localStorage.removeItem('active_qbr_job_start');
        setJobState(null);
        setIsProcessing(false);
        setPolling(false);
      }
    }, [activeClientId]);
    ```

### 9. Atomic Output Generation (`dashboard_data.json` & `.pptx`)
- **Problem**: If the server crashes or an error occurs midway through generation, partially written corrupt files remain on disk.
- **Solution**: Atomic Output Replacement with `.tmp` Cleanup:
  - In `processData.js` and `pptGenerator.js`:
    ```javascript
    const tempPath = `${finalPath}.tmp.${jobId}`;
    await writeOutput(tempPath, data);
    fs.renameSync(tempPath, finalPath);
    ```
  - Leftover `.tmp` files are deleted on error or cancellation.

### 10. Tenant-Partitioned Output Paths
- **Directory Structure**:
  - `data/tenants/{clientId}/reports/{jobId}/dashboard_data.json`
  - `data/tenants/{clientId}/reports/{jobId}/report.pptx`
  - Canonical copy: `data/tenants/{clientId}/dashboard_data.json`

### 11. Retry-Aware Staged File Cleanup Policy
- Staged files in `uploads/staged/{jobId}/` are preserved between transient retry attempts and deleted only when a job reaches `'completed'`, unrecoverable failure, exhausted retries, or cancellation.

### 12. BullMQ `UnrecoverableError` for Fatal Client/Data Errors
- Missing required sheets or corrupt file signatures immediately throw `UnrecoverableError`, skipping useless retries and cleaning up files immediately.

### 13. Graceful Process Shutdown (`SIGTERM` / `SIGINT`)
- Closes BullMQ worker and queue gracefully on `SIGTERM`/`SIGINT`, preventing orphaned Redis lock keys.

### 14. Per-Tenant Concurrency & Race Condition Mutex Guard with TTL Deadlock Prevention
- Enforces single-job concurrency per `clientId` with automatic 10-minute TTL release.

### 15. Zombie Job Recovery on Server Startup
- Boot sweeper marks abandoned `'processing'`/`'queued'` jobs as `'failed'` with `"Server restarted before job completed"`.

### 16. Atomic History Writes (`reports_metadata.json`)
- Writes metadata to `.tmp` file and atomically renames via `fs.renameSync` with in-memory mutex serialization.

---

## 5. Upload/Poll Flow Update (`/api/upload` & `/api/process-data`)

### A. Backend Ingestion Flow (`POST /api/upload`)
1. **File Ingestion & Signature Hardening**:
   - Multer receives uploaded workbook(s).
   - Hardened magic-byte validation (Item #5) inspects all file buffers.
2. **Immediate Enqueue & 202 Accepted Response**:
   - Controller allocates `jobId = uuidv4()`.
   - Files stored in staging directory (`uploads/staged/{jobId}/`).
   - Job enqueued via `queueService.enqueueJob({ jobId, clientId, fileNames, stagedFiles, options })`.
   - Controller returns **HTTP `202 Accepted`** (< 200ms) with `{ jobId, pollUrl }`.
3. **Background Worker Execution Pipeline**:
   - Worker picks up job, starts 4-minute watchdog timer, acquires tenant lock:
     1. **Stage 1 (15%)**: `upload_validation` – Checks signatures, date bounds, sheet presence. Checks `signal.aborted`.
     2. **Stage 2 (35%)**: `excel_parsing` – Extracts inventory & incident rows via `processData.js` calling `onProgress(35, ...)`. Checks `signal.aborted`.
     3. **Stage 3 (65%)**: `data_processing` – Computes SLAs, uptime formulas, QoQ deltas via `onProgress(65, ...)`. Writes output atomically to `data/tenants/{clientId}/reports/{jobId}/dashboard_data.json.tmp`. Checks `signal.aborted`.
     4. **Stage 4 (85%)**: `ppt_generation` – Executes `pptGenerator.js` via `onProgress(85, ...)` writing atomically to `report.pptx.tmp`. Checks `signal.aborted`.
     5. **Stage 5 (100%)**: `finished` – Renames `.tmp` files to final paths, registers report in `historyService`, clears watchdog timer, and marks job `'completed'`.
4. **Cleanup & Lock Release**:
   - Tenant lock released unconditionally in `finally`. Staged files cleaned up on completion or terminal error.

### B. Frontend Upload & Polling Flow (`FileUploader.jsx` & `App.jsx`)
1. **Submit**: User selects files, dates, and clicks "Process Report".
2. **202 Response**: Receives `202 Accepted` with `{ jobId, pollUrl }`.
3. **Active Processing State**:
   - Saves `jobId`, client, & start time to `localStorage` and shows progress card.
   - User can click "Cancel Upload" calling `DELETE /api/jobs/:jobId`.
4. **Polling Loop**:
   - Polls `GET /api/jobs/:jobId` every 1.5s with 5-minute timeout guard.
5. **Completion Transition**:
   - When completed, clears `localStorage`, shows 100%, updates `App.jsx` `jobId`, and navigates to `overview`.
6. **Error Handling**:
   - When failed or timed out, clears `localStorage` and shows sanitized error message with "Try Again" button.

---

## 6. Detailed Files to Touch (Exact Paths & Scope)

### 1. `backend/services/queueService.js` (NEW FILE)
- Dual-mode BullMQ + InMemory queue with 4-minute `MAX_JOB_EXECUTION_MS` hard timeout.
- In-memory 1-hour TTL eviction & 500-job capacity cap.
- Multi-file `fileNames: string[]` support.
- Customer-safe `sanitizeErrorMessage(err)`.
- Exports:
  - `initialize()`: boots queue, runs `recoverZombieJobs()` and `purgeOrphanedTmpFiles()`.
  - `enqueueJob(payload): Promise<JobState>`
  - `getJob(jobId, clientId): Promise<JobState | null>`
  - `cancelJob(jobId, clientId): Promise<boolean>`
  - `updateProgress(jobId, progress, stage, message): Promise<void>`
  - `completeJob(jobId, result): Promise<void>`
  - `failJob(jobId, error): Promise<void>`
  - `acquireTenantLock(clientId, jobId): Promise<() => void>`
  - `cleanupStagedFiles(jobId): Promise<void>`
  - `closeQueue(): Promise<void>`

### 2. `backend/services/processData.js` & `backend/services/pptGenerator.js`
- Accept `options.onProgress(percent, message, stage)` and `options.signal`.
- Add cancellation checks `if (options.signal?.aborted) throw new Error('Job cancelled');` in CPU-bound loops.
- Write output to `.tmp` files and atomically rename to final paths in `data/tenants/{clientId}/reports/{jobId}/`.

### 3. `backend/services/historyService.js`
- Atomic metadata writes via `saveHistoryAtomic` using `.tmp` file and `fs.renameSync` with in-memory mutex.
- Strict tenant filtering in `getHistory(clientId)`.

### 4. `backend/routes/jobRoutes.js` (NEW FILE)
- `GET /api/jobs/:jobId`: Returns job status enforcing tenant isolation (`req.tenantId === job.clientId`).
- `DELETE /api/jobs/:jobId`: Cancels active/queued job with tenant verification.
- `GET /api/jobs`: Returns recent jobs for current tenant.

### 5. `backend/index.js`
- Mount `/api/jobs` routes.
- Update `/api/upload` to return `202 Accepted` with `{ jobId, pollUrl }`.
- Enforce `req.tenantId === job.clientId` on `/api/dashboard?jobId=:jobId`, returning 403 on mismatch.
- Enforce `req.tenantId === job.clientId` on `/api/ppt/download/:jobId`, returning 403 on mismatch.
- Scope `/api/reports/history` strictly to `req.tenantId`.
- Retain synchronous fallback mode via `?sync=true`.

### 6. `frontend/src/components/FileUploader.jsx`
- 202 handling and active progress polling.
- Store/restore active `jobId`, client, and start timestamp in `localStorage`.
- Reset localStorage and cancel polling if `activeClientId` changes.
- Add "Cancel" button to call `DELETE /api/jobs/:jobId`.
- Enforce 5-minute hard polling timeout.

### 7. `frontend/src/App.jsx`
- Handle job completion from `FileUploader`: updates `jobId`, refreshes data, transitions tab.

### 8. `backend/tests/asyncQueue.test.js` (NEW FILE)
- TDD test suite covering all 18 unit & integration requirements.

---

## 7. Verification Plan
1. **Unit & Integration Tests (`backend/tests/asyncQueue.test.js`)**:
   - Test 1: Immediate `202 Accepted` return on upload with `fileNames` array.
   - Test 2: Progress progression across stages (15% $\rightarrow$ 35% $\rightarrow$ 50% $\rightarrow$ 65% $\rightarrow$ 75% $\rightarrow$ 88% $\rightarrow$ 95% $\rightarrow$ 100%).
   - Test 3: Multi-tenant job isolation (cross-tenant access to `/api/jobs/:jobId` returns 404).
   - Test 4: Cross-tenant access to `/api/dashboard?jobId=:id` returns 403 Forbidden.
   - Test 5: `/api/reports/history` returns only records matching authenticated `req.tenantId`.
   - Test 6: Secure download endpoint `/api/ppt/download/:jobId` blocks cross-tenant access with 403 Forbidden.
   - Test 7: Error sanitization: raw internal exceptions and stack traces are suppressed; user receives sanitized message.
   - Test 8: Worker hard timeout: job running > 4 minutes is killed, marked as `"Job timed out"`, and tenant lock released.
   - Test 9: Atomic output generation: `.tmp` files are renamed on success; deleted on failure.
   - Test 10: Tenant partitioning: artifacts reside strictly inside `data/tenants/{clientId}/reports/{jobId}/`.
   - Test 11: Job cancellation: `DELETE /api/jobs/:jobId` aborts execution, frees lock, and purges `.tmp` files.
   - Test 12: Deep loop cancellation: abort signal halts execution during CPU loops in `processData` and `generatePPT`.
   - Test 13: Zombie .tmp sweeper deletes orphaned `.tmp` files across tenant directories on startup.
   - Test 14: In-memory queue eviction purges jobs older than 1 hour and respects 500-item capacity cap.
   - Test 15: Per-tenant mutex serializes concurrent uploads for the same client.
   - Test 16: Tenant lock TTL forcefully releases hung lock after 10-minute timeout.
   - Test 17: Retry-aware staged file preservation across attempts.
   - Test 18: `UnrecoverableError` fails immediately without retrying and cleans up staged files.
   - Test 19: Atomic metadata write handles simultaneous concurrent saves safely.
   - Test 20: Zombie job recovery scans and marks orphaned jobs as failed on startup.
   - Test 21: Graceful shutdown hook terminates worker and queue connections cleanly.
   - Test 22: Redis error listener intercepts connection drop and switches to in-memory fallback.
2. **Frontend Component Tests (`frontend/src/__tests__/FileUploader.test.jsx`)**:
   - Test 23: Switching client clears `localStorage` job keys and resets upload progress view.
   - Test 24: Polling resumes automatically on mount if valid `localStorage` key exists.
   - Test 25: 5-minute timeout terminates polling and renders diagnostic timeout UI.
   - Test 26: Clicking "Cancel Upload" calls `DELETE /api/jobs/:jobId` and resets view.
3. **Full Regression**:
   - Run root `npm test` (all 276 existing backend/validator tests must pass).
   - Run frontend `vitest` tests (all component tests must pass).
   - Run frontend production build (`npm --prefix frontend run build`).
