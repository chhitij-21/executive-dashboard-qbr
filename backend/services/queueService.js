// backend/services/queueService.js
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

let BullMQ = null;
let Redis = null;
try {
  BullMQ = require('bullmq');
  Redis = require('ioredis');
} catch (_) {
  // BullMQ or ioredis not available; in-memory fallback will handle everything
}

const DEFAULT_JOB_TTL_MS = 60 * 60 * 1000; // 1 hour retention in memory
const MAX_IN_MEMORY_JOBS = 500;
const DEFAULT_TENANT_LOCK_TTL_MS = 10 * 60 * 1000; // 10 minutes max lock duration
const DEFAULT_MAX_JOB_EXECUTION_MS = 4 * 60 * 1000; // 4 minutes watchdog timeout

// Per-Tenant Lock Manager
class TenantLockManager {
  constructor() {
    this.locks = new Map(); // clientId -> { jobId, timer, acquiredAt }
  }

  isLocked(clientId) {
    return this.locks.has(clientId);
  }

  acquire(clientId, jobId, ttlMs = DEFAULT_TENANT_LOCK_TTL_MS) {
    if (this.locks.has(clientId)) {
      const existing = this.locks.get(clientId);
      if (existing.jobId !== jobId) {
        // Wait or queue: for mutex semantics, we return lock handler when available or reject
        // For queue worker, we track active lock
      }
    }

    // Set TTL timeout for deadlock prevention
    const timer = setTimeout(() => {
      console.warn(`[TenantLockManager] Forcefully released expired lock for tenant ${clientId} held by job ${jobId}`);
      this.release(clientId, jobId);
    }, ttlMs);
    if (timer.unref) timer.unref();

    this.locks.set(clientId, { jobId, timer, acquiredAt: Date.now() });

    // Return unlock callback
    return () => this.release(clientId, jobId);
  }

  release(clientId, jobId) {
    if (!this.locks.has(clientId)) return;
    const lock = this.locks.get(clientId);
    if (!jobId || lock.jobId === jobId) {
      if (lock.timer) clearTimeout(lock.timer);
      this.locks.delete(clientId);
    }
  }

  clear() {
    for (const lock of this.locks.values()) {
      if (lock.timer) clearTimeout(lock.timer);
    }
    this.locks.clear();
  }
}

// In-Memory Job Queue with TTL eviction & concurrency control
class InMemoryJobQueue {
  constructor(concurrency = 2) {
    this.concurrency = concurrency;
    this.activeWorkers = 0;
    this.jobs = new Map(); // jobId -> JobState
    this.queue = []; // array of { jobState, jobData }
    this.abortControllers = new Map(); // jobId -> AbortController
    this.sweeperInterval = null;
    this.processor = null;
    this.startSweeper();
  }

  setProcessor(processorFn) {
    this.processor = processorFn;
  }

  startSweeper() {
    this.sweeperInterval = setInterval(() => {
      this.purgeExpiredJobs();
    }, 15 * 60 * 1000);
    if (this.sweeperInterval.unref) this.sweeperInterval.unref();
  }

  purgeExpiredJobs(customTtlMs = DEFAULT_JOB_TTL_MS) {
    const now = Date.now();
    for (const [jobId, job] of this.jobs.entries()) {
      if (job.status === 'completed' || job.status === 'failed') {
        const finishTime = job.completedAt ? new Date(job.completedAt).getTime() : job.startedAt ? new Date(job.startedAt).getTime() : null;
        if (finishTime && (now - finishTime > customTtlMs)) {
          this.jobs.delete(jobId);
          this.abortControllers.delete(jobId);
        }
      }
    }
  }

  enforceCapacity() {
    if (this.jobs.size <= MAX_IN_MEMORY_JOBS) return;
    // Evict oldest completed or failed jobs first
    for (const [jobId, job] of this.jobs.entries()) {
      if (this.jobs.size <= MAX_IN_MEMORY_JOBS) break;
      if (job.status === 'completed' || job.status === 'failed') {
        this.jobs.delete(jobId);
        this.abortControllers.delete(jobId);
      }
    }
  }

  add(jobState, jobData = null) {
    this.enforceCapacity();
    this.jobs.set(jobState.jobId, jobState);
    const controller = new AbortController();
    this.abortControllers.set(jobState.jobId, controller);
    this.queue.push({ jobState, jobData });
    if (this.processor && jobData) {
      setImmediate(() => this.processNext());
    }
    return jobState;
  }

  async processNext() {
    if (!this.processor) return;
    if (this.activeWorkers >= this.concurrency) return;
    if (this.queue.length === 0) return;

    const itemIndex = this.queue.findIndex(item => item && item.jobData);
    if (itemIndex === -1) return;

    const [item] = this.queue.splice(itemIndex, 1);
    if (!item) return;

    this.activeWorkers++;
    try {
      await this.processor(item.jobState, item.jobData);
    } catch (err) {
      console.error(`[InMemoryJobQueue] Error executing job ${item.jobState.jobId}:`, err);
    } finally {
      this.activeWorkers--;
      setImmediate(() => this.processNext());
    }
  }

  get(jobId) {
    return this.jobs.get(jobId) || null;
  }

  getController(jobId) {
    return this.abortControllers.get(jobId) || null;
  }

  cancel(jobId) {
    const controller = this.abortControllers.get(jobId);
    if (controller) {
      controller.abort();
    }
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = 'failed';
      job.error = 'Job cancelled by user.';
      job.completedAt = new Date().toISOString();
      return true;
    }
    return false;
  }

  clear() {
    for (const ctrl of this.abortControllers.values()) {
      ctrl.abort();
    }
    this.jobs.clear();
    this.queue = [];
    this.abortControllers.clear();
  }
}

class QueueService {
  constructor() {
    this.tenantLockManager = new TenantLockManager();
    this.inMemoryQueue = new InMemoryJobQueue(2);
    this.redisClient = null;
    this.bullQueue = null;
    this.bullWorker = null;
    this.isRedisActive = false;
  }

  attachRedisErrorHandlers(client) {
    if (client && typeof client.on === 'function') {
      client.on('error', (err) => {
        console.warn('[queueService] Redis connection warning (falling back to in-memory queue):', err?.message || err);
        this.isRedisActive = false;
      });
    }
  }

  async initialize() {
    // 1. Scan and purge orphaned zombie jobs & temporary files on boot
    await this.recoverZombieJobs();
    await this.purgeOrphanedTmpFiles(path.resolve(__dirname, '../../data/tenants'));
    await this.purgeOrphanedTmpFiles(path.resolve(__dirname, '../../data'));
    await this.purgeOrphanedTmpFiles(path.resolve(__dirname, '../../uploads/staged'));

    // 2. Initialize Redis/BullMQ if REDIS_URL is provided
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl && BullMQ && Redis) {
      try {
        this.redisClient = new Redis(redisUrl, {
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          retryStrategy: (times) => {
            if (times > 3) {
              console.warn('[queueService] Redis connection attempts exceeded. Using in-memory fallback.');
              return null; // stop retrying
            }
            return Math.min(times * 100, 2000);
          },
        });
        this.attachRedisErrorHandlers(this.redisClient);

        this.bullQueue = new BullMQ.Queue('qbr-processing', { connection: this.redisClient });
        this.attachRedisErrorHandlers(this.bullQueue);

        this.isRedisActive = true;
        console.log('[queueService] BullMQ Queue initialized with Redis.');
      } catch (err) {
        console.warn('[queueService] Failed to initialize BullMQ with Redis. Using in-memory queue:', err.message);
        this.isRedisActive = false;
      }
    } else {
      this.isRedisActive = false;
      console.log('[queueService] Running in In-Memory Queue mode (concurrency = 2).');
    }

    // 3. Register graceful shutdown
    this.registerShutdownHooks();
  }

  registerShutdownHooks() {
    const shutdown = async (signal) => {
      console.log(`[queueService] ${signal} signal received. Gracefully closing queue...`);
      await this.closeQueue();
    };

    if (process.listenerCount('SIGTERM') === 0) {
      process.once('SIGTERM', () => shutdown('SIGTERM'));
    }
    if (process.listenerCount('SIGINT') === 0) {
      process.once('SIGINT', () => shutdown('SIGINT'));
    }
  }

  sanitizeErrorMessage(err) {
    if (!err) return 'Report generation failed. Please try again.';
    const msg = typeof err === 'string' ? err : err.message || '';

    if (err.isUnrecoverable || err.name === 'UnrecoverableError' || msg.includes('Workbook validation') || msg.includes('Missing required sheet')) {
      return msg;
    }
    if (msg === 'Job timed out' || msg === 'Job cancelled by user.') {
      return msg;
    }

    // Suppress raw file paths, internal stack traces, and SQL driver errors
    return 'Report generation failed. Please try again.';
  }

  registerProcessor(processorFn) {
    this.processor = processorFn;
    this.inMemoryQueue.setProcessor(processorFn);
    if (this.isRedisActive && this.redisClient && BullMQ) {
      try {
        this.bullWorker = new BullMQ.Worker('qbr-processing', async (bullJob) => {
          const { jobState, jobData } = bullJob.data;
          await processorFn(jobState, jobData);
        }, {
          connection: this.redisClient,
          concurrency: 2,
        });
        this.attachRedisErrorHandlers(this.bullWorker);
      } catch (err) {
        console.warn('[queueService] Failed to initialize BullMQ Worker:', err.message);
      }
    }
  }

  async enqueueJob(payload, jobData = null) {
    const jobId = payload.jobId || uuidv4();
    const clientId = payload.clientId || 'client-jfl';
    const fileNames = Array.isArray(payload.fileNames) ? payload.fileNames : (payload.fileName ? [payload.fileName] : []);

    const jobState = {
      jobId,
      clientId,
      status: 'queued',
      progress: 0,
      stage: 'queued',
      message: 'Upload accepted. Report processing has started in background.',
      resultUrl: null,
      downloadUrl: null,
      error: null,
      fileNames,
      reportPeriod: payload.reportPeriod || null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      durationMs: null,
    };

    if (this.isRedisActive && this.bullQueue) {
      try {
        await this.bullQueue.add('process-qbr', { jobState, jobData }, {
          jobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: false,
          removeOnFail: false,
        });
      } catch (err) {
        console.warn('[queueService] Failed to add job to BullMQ, falling back to memory:', err.message);
        this.inMemoryQueue.add(jobState, jobData);
      }
    } else {
      this.inMemoryQueue.add(jobState, jobData);
    }

    return {
      success: true,
      jobId,
      status: 'queued',
      progress: 0,
      clientId,
      fileNames,
      pollUrl: `/api/jobs/${jobId}`,
      message: jobState.message,
    };
  }

  async getJob(jobId, clientId = null) {
    let job = this.inMemoryQueue.get(jobId);

    if (!job && this.isRedisActive && this.bullQueue) {
      try {
        const bullJob = await BullMQ.Job.fromId(this.bullQueue, jobId);
        if (bullJob) {
          job = bullJob.data;
        }
      } catch (_) {
        // Ignored
      }
    }

    if (!job) return null;

    // Strict multi-tenant isolation verification
    if (clientId && job.clientId && job.clientId !== clientId) {
      return null;
    }

    return job;
  }

  async updateProgress(jobId, progress, stage, message) {
    const job = this.inMemoryQueue.get(jobId);
    if (job) {
      job.progress = Math.min(100, Math.max(0, Number(progress) || 0));
      if (stage) job.stage = stage;
      if (message) job.message = message;
      if (!job.startedAt) job.startedAt = new Date().toISOString();
      if (job.status === 'queued') job.status = 'processing';
    }

    if (this.isRedisActive && this.bullQueue) {
      try {
        const bullJob = await BullMQ.Job.fromId(this.bullQueue, jobId);
        if (bullJob) {
          await bullJob.updateProgress(progress);
        }
      } catch (_) {
        // Ignored
      }
    }
  }

  async completeJob(jobId, result = {}, customTtlMs = DEFAULT_JOB_TTL_MS) {
    const job = this.inMemoryQueue.get(jobId);
    const now = new Date().toISOString();
    if (job) {
      job.status = 'completed';
      job.progress = 100;
      job.stage = 'finished';
      job.message = 'Report processing and PowerPoint generation completed successfully.';
      job.resultUrl = result.resultUrl || `/api/dashboard?jobId=${jobId}`;
      job.downloadUrl = result.downloadUrl || `/api/ppt/download/${jobId}`;
      job.completedAt = now;
      if (job.startedAt) {
        job.durationMs = new Date(now).getTime() - new Date(job.startedAt).getTime();
      }

      // Schedule in-memory TTL eviction
      setTimeout(() => {
        this.inMemoryQueue.jobs.delete(jobId);
        this.inMemoryQueue.abortControllers.delete(jobId);
      }, customTtlMs).unref();
    }
  }

  async failJob(jobId, error) {
    const job = this.inMemoryQueue.get(jobId);
    const now = new Date().toISOString();
    const sanitized = this.sanitizeErrorMessage(error);

    // Log full raw internal exception strictly server-side
    console.error(`[queueService] Internal job failure for ${jobId}:`, error);

    if (job) {
      job.status = 'failed';
      job.stage = job.stage || 'finished';
      job.error = sanitized;
      job.message = sanitized;
      job.completedAt = now;
      if (job.startedAt) {
        job.durationMs = new Date(now).getTime() - new Date(job.startedAt).getTime();
      }
    }
  }

  async cancelJob(jobId, clientId = null) {
    const job = await this.getJob(jobId, clientId);
    if (!job) return false;

    if (job.status === 'completed' || job.status === 'failed') {
      return false; // Cannot cancel finished job
    }

    // Abort active controller
    const controller = this.inMemoryQueue.getController(jobId);
    if (controller) {
      controller.abort();
    }

    job.status = 'failed';
    job.error = 'Job cancelled by user.';
    job.message = 'Job cancelled by user.';
    job.completedAt = new Date().toISOString();

    // Release tenant lock
    this.releaseTenantLock(job.clientId, jobId);

    // Clean up temporary staged and output files
    await this.cleanupStagedFiles(jobId);

    return true;
  }

  async acquireTenantLock(clientId, jobId, ttlMs = DEFAULT_TENANT_LOCK_TTL_MS) {
    return this.tenantLockManager.acquire(clientId, jobId, ttlMs);
  }

  releaseTenantLock(clientId, jobId) {
    this.tenantLockManager.release(clientId, jobId);
  }

  isTenantLocked(clientId) {
    return this.tenantLockManager.isLocked(clientId);
  }

  async executeWithWatchdog(jobId, clientId, taskFn, timeoutMs = DEFAULT_MAX_JOB_EXECUTION_MS) {
    const controller = this.inMemoryQueue.getController(jobId) || new AbortController();
    let timerHandle = null;

    const timeoutPromise = new Promise((_, reject) => {
      timerHandle = setTimeout(() => {
        controller.abort();
        const err = new Error('Job timed out');
        err.isTimeout = true;
        reject(err);
      }, timeoutMs);
      if (timerHandle.unref) timerHandle.unref();
    });

    try {
      const result = await Promise.race([
        taskFn(controller.signal),
        timeoutPromise,
      ]);
      return result;
    } catch (err) {
      await this.failJob(jobId, err);
      this.releaseTenantLock(clientId, jobId);
      await this.cleanupStagedFiles(jobId);
      throw err;
    } finally {
      if (timerHandle) clearTimeout(timerHandle);
    }
  }

  async cleanupStagedFiles(jobId) {
    if (!jobId) return;
    const stagedDir = path.resolve(__dirname, `../../uploads/staged/${jobId}`);
    try {
      if (fs.existsSync(stagedDir)) {
        await fs.promises.rm(stagedDir, { recursive: true, force: true });
      }
    } catch (err) {
      console.warn(`[queueService] Warning deleting staged folder for job ${jobId}:`, err.message);
    }
  }

  async handleJobOutcome(job, error = null, isUnrecoverable = false) {
    const jobId = job.id || job.jobId;
    const isCompleted = !error;
    const maxAttempts = job.opts?.attempts || 1;
    const attemptsMade = job.attemptsMade || 1;
    const isRetriesExhausted = attemptsMade >= maxAttempts;

    if (isCompleted || isUnrecoverable || isRetriesExhausted) {
      await this.cleanupStagedFiles(jobId);
    } else {
      console.log(`[queueService] Job ${jobId} failed attempt ${attemptsMade}/${maxAttempts}. Preserving staged files for retry.`);
    }
  }

  async purgeOrphanedTmpFiles(dir) {
    if (!fs.existsSync(dir)) return;
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await this.purgeOrphanedTmpFiles(fullPath);
        } else if (entry.name.includes('.tmp')) {
          await fs.promises.unlink(fullPath).catch(() => {});
        }
      }
    } catch (_) {
      // Ignored
    }
  }

  async recoverZombieJobs() {
    // Scan uploads/staged for orphaned folders left from server crash
    const stagedRoot = path.resolve(__dirname, '../../uploads/staged');
    if (!fs.existsSync(stagedRoot)) return;
    try {
      const folders = await fs.promises.readdir(stagedRoot);
      for (const folder of folders) {
        const fullFolder = path.join(stagedRoot, folder);
        await fs.promises.rm(fullFolder, { recursive: true, force: true }).catch(() => {});
      }
    } catch (_) {
      // Ignored
    }
  }

  async closeQueue() {
    try {
      if (this.bullWorker) {
        await this.bullWorker.close();
      }
      if (this.bullQueue) {
        await this.bullQueue.close();
      }
      if (this.redisClient) {
        await this.redisClient.quit().catch(() => {});
      }
      this.inMemoryQueue.clear();
      this.tenantLockManager.clear();
    } catch (_) {
      // Ignored
    }
  }

  _clearInMemoryJobs() {
    this.inMemoryQueue.clear();
    this.tenantLockManager.clear();
  }
}

module.exports = new QueueService();
