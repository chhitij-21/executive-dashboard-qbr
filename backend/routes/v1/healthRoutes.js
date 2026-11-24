// backend/routes/v1/healthRoutes.js
// Health, liveness, readiness, and observability status endpoints (Item #1, #14, #15, #16)

'use strict';

const express = require('express');
const router = express.Router();
const schedulerService = require('../../services/schedulerService');
const queueService = require('../../services/queueService');
const storageRepo = require('../../repositories/storageRepo');
const database = require('../../config/database');
const sentry = require('../../utils/sentry');

// ── Liveness Probe ──────────────────────────────────────────────────────────
// Lightweight probe: returns 200 OK immediately if the process event loop is active.
router.get(['/health/live', '/live'], (req, res) => {
  const mem = process.memoryUsage();
  res.json({
    status: 'ok',
    live: true,
    uptimeSec: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    pid: process.pid,
    memoryMb: {
      rss: Math.round(mem.rss / (1024 * 1024)),
      heapUsed: Math.round(mem.heapUsed / (1024 * 1024)),
      heapTotal: Math.round(mem.heapTotal / (1024 * 1024)),
    },
  });
});

// ── Readiness Probe ─────────────────────────────────────────────────────────
// Deep probe: validates database, storage, queue, and scheduler readiness.
router.get(['/health/ready', '/ready'], async (req, res) => {
  const [dbStatus, storageStatus] = await Promise.all([
    database.healthCheck().catch((err) => ({ healthy: false, error: err.message })),
    storageRepo.healthCheck().catch((err) => ({ healthy: false, error: err.message })),
  ]);

  const schedulerStatus = schedulerService.getHealth();
  const queueStatus = typeof queueService.getHealth === 'function'
    ? queueService.getHealth()
    : { ready: true, mode: 'in-memory' };

  const isReady = Boolean(dbStatus?.healthy && storageStatus?.healthy);
  const statusCode = isReady ? 200 : 503;

  return res.status(statusCode).json({
    status: isReady ? 'ok' : 'degraded',
    ready: isReady,
    timestamp: new Date().toISOString(),
    components: {
      database: dbStatus,
      storage: storageStatus,
      scheduler: schedulerStatus,
      queue: queueStatus,
    },
  });
});

// ── Canonical Summary Health ────────────────────────────────────────────────
router.get(['/health'], (req, res) => {
  const scheduler = schedulerService.getHealth();
  res.json({
    status: 'ok',
    ts: new Date().toISOString(),
    version: 'v1',
    scheduler: scheduler.status || (scheduler.ready ? 'healthy' : 'degraded'),
    observability: {
      logger: 'pino',
      logLevel: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
      sentryActive: sentry.isInitialized(),
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production',
    },
  });
});

router.get(['/health/scheduler', '/scheduler'], (req, res) => {
  const health = schedulerService.getHealth();
  const statusCode = health.ready ? 200 : 503;
  return res.status(statusCode).json({
    ...health,
    observability: {
      logger: 'pino',
      sentryActive: sentry.isInitialized(),
    },
  });
});

module.exports = router;
