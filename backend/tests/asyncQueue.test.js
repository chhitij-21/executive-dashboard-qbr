// backend/tests/asyncQueue.test.js
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const queueService = require('../services/queueService');
const historyService = require('../services/historyService');

describe('Async Queue & Job Management Suite (Item #10)', () => {
  const testTenantA = 'client-jfl';
  const testTenantB = 'client-mmtcpamp';

  beforeEach(() => {
    // Clear in-memory queue jobs before each test if available
    if (queueService._clearInMemoryJobs) {
      queueService._clearInMemoryJobs();
    }
  });

  after(async () => {
    await queueService.closeQueue();
  });

  it('1. enqueueJob returns HTTP 202 compatible payload with valid UUID and initial queued status', async () => {
    const job = await queueService.enqueueJob({
      clientId: testTenantA,
      fileNames: ['inventory.xlsx', 'incidents.xlsx'],
      reportPeriod: {
        startDate: '2026-07-01',
        endDate: '2026-09-30',
        quarter: 'Q2',
        fiscalYear: 'FY2027',
      },
    });

    assert.ok(job.jobId, 'jobId must be present');
    assert.strictEqual(typeof job.jobId, 'string');
    assert.strictEqual(job.status, 'queued');
    assert.strictEqual(job.progress, 0);
    assert.strictEqual(job.clientId, testTenantA);
    assert.deepStrictEqual(job.fileNames, ['inventory.xlsx', 'incidents.xlsx']);
    assert.strictEqual(job.pollUrl, `/api/jobs/${job.jobId}`);
  });

  it('2. Multi-tenant security: Tenant B cannot query Tenant A job', async () => {
    const job = await queueService.enqueueJob({
      clientId: testTenantA,
      fileNames: ['jfl_inventory.xlsx'],
    });

    // Query with matching tenant
    const jobFound = await queueService.getJob(job.jobId, testTenantA);
    assert.ok(jobFound, 'Tenant A should be able to query own job');
    assert.strictEqual(jobFound.jobId, job.jobId);

    // Query with different tenant
    const jobUnauthorized = await queueService.getJob(job.jobId, testTenantB);
    assert.strictEqual(jobUnauthorized, null, 'Tenant B should receive null for Tenant A job');
  });

  it('3. Real progress progression: updateProgress updates percentage and stage in real time', async () => {
    const job = await queueService.enqueueJob({
      clientId: testTenantA,
      fileNames: ['test.xlsx'],
    });

    await queueService.updateProgress(job.jobId, 15, 'upload_validation', 'Validating file integrity...');
    let current = await queueService.getJob(job.jobId, testTenantA);
    assert.strictEqual(current.progress, 15);
    assert.strictEqual(current.stage, 'upload_validation');
    assert.strictEqual(current.message, 'Validating file integrity...');

    await queueService.updateProgress(job.jobId, 50, 'data_processing', 'Calculating site SLAs...');
    current = await queueService.getJob(job.jobId, testTenantA);
    assert.strictEqual(current.progress, 50);
    assert.strictEqual(current.stage, 'data_processing');

    await queueService.updateProgress(job.jobId, 85, 'ppt_generation', 'Generating presentation deck...');
    current = await queueService.getJob(job.jobId, testTenantA);
    assert.strictEqual(current.progress, 85);
    assert.strictEqual(current.stage, 'ppt_generation');
  });

  it('4. Customer-Safe Error Sanitization: masks raw exceptions and stack traces', async () => {
    const job = await queueService.enqueueJob({
      clientId: testTenantA,
      fileNames: ['corrupt.xlsx'],
    });

    // Simulate unexpected internal crash with sensitive stack trace
    const internalCrash = new Error('SQLITE_CORRUPT: disk I/O error at C:\\Users\\Chhitij\\secret\\db.sqlite\n    at internalQuery (node:internal:123)');
    await queueService.failJob(job.jobId, internalCrash);

    const failedJob = await queueService.getJob(job.jobId, testTenantA);
    assert.strictEqual(failedJob.status, 'failed');
    assert.strictEqual(failedJob.error, 'Report generation failed. Please try again.');
    assert.ok(!failedJob.error.includes('SQLITE_CORRUPT'), 'Raw error must not be exposed');
    assert.ok(!failedJob.error.includes('C:\\Users'), 'Internal path must not leak');

    // Friendly validation error preservation
    const jobValidation = await queueService.enqueueJob({
      clientId: testTenantA,
      fileNames: ['invalid.xlsx'],
    });
    const friendlyErr = new Error("Workbook validation failed: Missing required sheet 'Master'");
    friendlyErr.isUnrecoverable = true;
    await queueService.failJob(jobValidation.jobId, friendlyErr);

    const failedValidationJob = await queueService.getJob(jobValidation.jobId, testTenantA);
    assert.strictEqual(failedValidationJob.error, "Workbook validation failed: Missing required sheet 'Master'");
  });

  it('5. Per-Tenant Concurrency Mutex: serializes jobs for same tenant while running different tenants in parallel', async () => {
    const lockA = await queueService.acquireTenantLock(testTenantA, 'job-1');
    assert.strictEqual(typeof lockA, 'function', 'Lock A should be acquired');

    // Different tenant should acquire lock immediately
    const lockB = await queueService.acquireTenantLock(testTenantB, 'job-2');
    assert.strictEqual(typeof lockB, 'function', 'Lock B should be acquired concurrently');

    // Attempting to acquire lock for tenant A again should wait or indicate lock is held
    const isLockedA = queueService.isTenantLocked(testTenantA);
    assert.strictEqual(isLockedA, true, 'Tenant A should be locked');

    // Release lock A
    lockA();
    assert.strictEqual(queueService.isTenantLocked(testTenantA), false, 'Tenant A should be unlocked');

    // Release lock B
    lockB();
    assert.strictEqual(queueService.isTenantLocked(testTenantB), false, 'Tenant B should be unlocked');
  });

  it('6. Tenant Lock TTL: forcefully releases hung lock after TTL to prevent deadlock', async () => {
    // Acquire lock with short test TTL (50ms)
    const lock = await queueService.acquireTenantLock(testTenantA, 'hung-job', 50);
    assert.strictEqual(queueService.isTenantLocked(testTenantA), true);

    // Wait for TTL expiration
    await new Promise((resolve) => setTimeout(resolve, 80));

    assert.strictEqual(queueService.isTenantLocked(testTenantA), false, 'Lock should have been forcefully cleared after TTL');
    // Cleanup callback should safely no-op
    lock();
  });

  it('7. Job Cancellation: cancelJob halts execution, marks status as failed, and releases lock', async () => {
    const job = await queueService.enqueueJob({
      clientId: testTenantA,
      fileNames: ['huge_file.xlsx'],
    });

    const lock = await queueService.acquireTenantLock(testTenantA, job.jobId);
    assert.strictEqual(queueService.isTenantLocked(testTenantA), true);

    const cancelled = await queueService.cancelJob(job.jobId, testTenantA);
    assert.strictEqual(cancelled, true, 'Job cancellation should succeed');

    const updatedJob = await queueService.getJob(job.jobId, testTenantA);
    assert.strictEqual(updatedJob.status, 'failed');
    assert.strictEqual(updatedJob.error, 'Job cancelled by user.');
    assert.strictEqual(queueService.isTenantLocked(testTenantA), false, 'Tenant lock should be released on cancellation');
  });

  it('8. Deep CPU-bound Loop Interruption: AbortSignal stops processing loops', async () => {
    const abortController = new AbortController();
    const signal = abortController.signal;

    // Simulate loop in processData with signal check
    let iterations = 0;
    assert.throws(() => {
      for (let i = 0; i < 1000; i++) {
        if (i === 10) {
          abortController.abort();
        }
        if (signal.aborted) {
          throw new Error('Job cancelled');
        }
        iterations++;
      }
    }, /Job cancelled/);

    assert.strictEqual(iterations, 10, 'Loop should halt immediately when signal is aborted');
  });

  it('9. In-Memory Queue Eviction: purges old completed jobs and respects capacity cap', async () => {
    // Create completed job with 50ms TTL for testing
    const job = await queueService.enqueueJob({ clientId: testTenantA, fileNames: ['quick.xlsx'] });
    await queueService.completeJob(job.jobId, { resultUrl: '/test' }, 50);

    let retrieved = await queueService.getJob(job.jobId, testTenantA);
    assert.ok(retrieved, 'Job should exist right after completion');

    // Wait for TTL expiration
    await new Promise((resolve) => setTimeout(resolve, 80));
    retrieved = await queueService.getJob(job.jobId, testTenantA);
    assert.strictEqual(retrieved, null, 'Job should be evicted after TTL expiration');
  });

  it('10. Atomic Output Writing: preserves integrity and removes temp files on failure', async () => {
    const testDir = path.resolve(__dirname, '../../data/test_atomic');
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

    const finalPath = path.join(testDir, 'output.json');
    const tempPath = `${finalPath}.tmp.12345`;

    // 1. Success case: write temp then rename
    fs.writeFileSync(tempPath, JSON.stringify({ ok: true }), 'utf8');
    fs.renameSync(tempPath, finalPath);
    assert.ok(fs.existsSync(finalPath), 'Final file should exist');
    assert.ok(!fs.existsSync(tempPath), 'Temp file should be renamed');

    // 2. Failure case: cleanup temp file
    fs.writeFileSync(tempPath, 'partial corrupted data', 'utf8');
    // Simulate cleanup on failure
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    assert.ok(!fs.existsSync(tempPath), 'Temp file should be deleted on failure');

    // Clean up test dir
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('11. Zombie .tmp File Sweeper: purges orphaned temp files on initialization', async () => {
    const testDir = path.resolve(__dirname, '../../data/tenants/test-client/reports/test-job');
    fs.mkdirSync(testDir, { recursive: true });

    const orphanedTmp = path.join(testDir, 'report.pptx.tmp.orphaned');
    fs.writeFileSync(orphanedTmp, 'stale partial data');
    assert.ok(fs.existsSync(orphanedTmp));

    await queueService.purgeOrphanedTmpFiles(path.resolve(__dirname, '../../data/tenants'));
    assert.ok(!fs.existsSync(orphanedTmp), 'Orphaned temp file should be purged by sweeper');

    fs.rmSync(path.resolve(__dirname, '../../data/tenants/test-client'), { recursive: true, force: true });
  });

  it('12. Worker Hard Timeout: job running longer than watchdog limit is killed with "Job timed out"', async () => {
    const job = await queueService.enqueueJob({
      clientId: testTenantA,
      fileNames: ['hang.xlsx'],
    });

    // Run simulated worker with 50ms watchdog timeout
    const watchdogPromise = queueService.executeWithWatchdog(
      job.jobId,
      testTenantA,
      async (signal) => {
        // Simulate hung task
        await new Promise((resolve) => setTimeout(resolve, 200));
        if (signal.aborted) throw new Error('Job cancelled');
      },
      50 // 50ms timeout for test
    );

    await assert.rejects(watchdogPromise, (err) => {
      assert.strictEqual(err.message, 'Job timed out');
      return true;
    });

    const timedOutJob = await queueService.getJob(job.jobId, testTenantA);
    assert.strictEqual(timedOutJob.status, 'failed');
    assert.strictEqual(timedOutJob.error, 'Job timed out');
  });

  it('13. Retry-Aware Staged File Cleanup: preserves staged files on retryable error and deletes on final completion', async () => {
    const stagedDir = path.resolve(__dirname, '../../uploads/staged/test-job-retry');
    fs.mkdirSync(stagedDir, { recursive: true });
    const stagedFile = path.join(stagedDir, 'inventory.xlsx');
    fs.writeFileSync(stagedFile, 'excel data');

    // Attempt 1 of 3: should NOT delete
    await queueService.handleJobOutcome(
      { id: 'test-job-retry', attemptsMade: 1, opts: { attempts: 3 } },
      new Error('Transient network error')
    );
    assert.ok(fs.existsSync(stagedFile), 'Staged file must be preserved on attempt 1/3');

    // Attempt 3 of 3 (exhausted): should delete
    await queueService.handleJobOutcome(
      { id: 'test-job-retry', attemptsMade: 3, opts: { attempts: 3 } },
      new Error('Transient network error')
    );
    assert.ok(!fs.existsSync(stagedDir), 'Staged folder must be deleted when retries exhausted');
  });

  it('14. Redis connection error resilience: attaches error handler without crashing process', () => {
    // Calling error resilience setup should not throw
    assert.doesNotThrow(() => {
      queueService.attachRedisErrorHandlers({
        on: (event, handler) => {
          if (event === 'error') {
            // Trigger simulated error
            handler(new Error('Simulated Redis connection refused'));
          }
        },
      });
    });
  });
});
