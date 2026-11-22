// backend/routes/v1/healthRoutes.js
// Health, readiness, and observability status endpoints (Item #14, #15, #16)

'use strict';

const express = require('express');
const router = express.Router();
const schedulerService = require('../../services/schedulerService');
const sentry = require('../../utils/sentry');

// ── Canonical Health & Scheduler Health Endpoints ───────────────────────────
router.get(['/health', '/api/health'], (req, res) => {
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

router.get(['/health/scheduler', '/api/health/scheduler'], (req, res) => {
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
