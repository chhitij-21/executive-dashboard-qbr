// backend/routes/scheduleRoutes.js
// Enterprise Scheduled QBR Routes
// Multi-schedule configuration, rate-limited triggers, health probes, and audit logging.

'use strict';

const express = require('express');
const router = express.Router();
const schedulerService = require('../services/schedulerService');
const clientService = require('../services/clientService');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// In-memory rate limiter for ad-hoc triggers: adminEmail -> timestamp[]
const _triggerRateLimiter = new Map();
const TRIGGER_RATE_LIMIT_MAX = 5;
const TRIGGER_RATE_LIMIT_WINDOW_MS = 60 * 1000;

function resolveTenantId(req) {
  const paramId = req.params.id || req.params.tenantId;
  return clientService.resolveCanonicalClientId(paramId);
}

// ── GET /api/health/scheduler ───────────────────────────────────────────────
// Health and readiness probe for container orchestrators
router.get('/health/scheduler', (req, res) => {
  const health = schedulerService.getHealth();
  const statusCode = health.ready ? 200 : 503;
  return res.status(statusCode).json(health);
});

// ── GET /api/tenants/:id/schedules ──────────────────────────────────────────
// Retrieve configured schedules and run history for a tenant.
router.get(['/:id/schedules', '/:id/schedule'], requireAuth, async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      return res.status(404).json({ error: 'Tenant not found', code: 'TENANT_NOT_FOUND' });
    }

    // Tenant isolation: Client users may only inspect their assigned tenant
    if (req.user.role !== 'admin') {
      const userTenant = clientService.resolveCanonicalClientId(req.user.assignedClient || req.user.clientId || req.tenantId);
      if (userTenant !== tenantId) {
        return res.status(403).json({
          error: 'Forbidden: You do not have permission to view schedules for this client.',
          code: 'FORBIDDEN_TENANT_ACCESS',
        });
      }
    }

    const { schedules, runs, initializing } = await schedulerService.getSchedules(tenantId, req.user.role);

    return res.json({
      success: true,
      tenantId,
      schedules,
      runs,
      initializing: Boolean(initializing),
    });
  } catch (err) {
    console.error(`[scheduleRoutes] Error fetching schedules for ${req.params.id}:`, err);
    return res.status(500).json({ error: err.message, code: 'SCHEDULE_FETCH_ERROR' });
  }
});

// ── POST /api/tenants/:id/schedules ─────────────────────────────────────────
// Create or update a schedule (Admin only).
router.post(['/:id/schedules', '/:id/schedule'], requireAuth, requireAdmin, async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      return res.status(404).json({ error: 'Tenant not found', code: 'TENANT_NOT_FOUND' });
    }

    const schedule = await schedulerService.saveSchedule(tenantId, req.body, req.user, req.ip);
    return res.json({
      success: true,
      tenantId,
      schedule,
      message: 'Schedule configuration saved successfully.',
    });
  } catch (err) {
    if (err.statusCode === 503 || err.code === 'SCHEDULER_INITIALIZING') {
      return res.status(503).json({ error: err.message, code: err.code });
    }
    if (err.statusCode === 409 || err.code === 'SCHEDULE_VERSION_CONFLICT') {
      return res.status(409).json({ error: err.message, code: err.code });
    }
    if (err.statusCode === 400 || err.code === 'SUB_DAILY_CRON_NOT_SUPPORTED' || err.code === 'INVALID_CRON_SYNTAX') {
      return res.status(400).json({ error: err.message, code: err.code });
    }
    console.error(`[scheduleRoutes] Error saving schedule for ${req.params.id}:`, err);
    return res.status(500).json({ error: err.message, code: 'SCHEDULE_SAVE_ERROR' });
  }
});

// ── POST /api/tenants/:id/schedules/:scheduleId/trigger ─────────────────────
// Immediate ad-hoc execution ("⚡ Run Now") with rate limiting (Admin only).
router.post(
  ['/:id/schedules/:scheduleId/trigger', '/:id/schedules/trigger', '/:id/schedule/trigger'],
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const tenantId = resolveTenantId(req);
      if (!tenantId) {
        return res.status(404).json({ error: 'Tenant not found', code: 'TENANT_NOT_FOUND' });
      }

      // Rate limit check: max 5 triggers per minute per admin user
      const userKey = req.user.email || req.ip || 'admin';
      const now = Date.now();
      const userHistory = (_triggerRateLimiter.get(userKey) || []).filter((t) => now - t < TRIGGER_RATE_LIMIT_WINDOW_MS);

      if (userHistory.length >= TRIGGER_RATE_LIMIT_MAX) {
        res.set('Retry-After', '60');
        return res.status(429).json({
          error: 'RATE_LIMIT_EXCEEDED: Maximum 5 ad-hoc triggers per minute permitted. Please wait before triggering another report.',
          code: 'TRIGGER_RATE_LIMIT_EXCEEDED',
          retryAfter: 60,
        });
      }

      userHistory.push(now);
      _triggerRateLimiter.set(userKey, userHistory);

      const scheduleId = req.params.scheduleId || req.body.scheduleId;
      const run = await schedulerService.executeScheduledQbr(tenantId, scheduleId, 'MANUAL', {
        user: req.user.email,
        referenceDate: req.body.referenceDate ? new Date(req.body.referenceDate) : new Date(),
        simulateEmptyData: Boolean(req.body.simulateEmptyData),
      });

      return res.json({
        success: true,
        tenantId,
        run,
        message: 'Ad-hoc scheduled QBR generation executed.',
      });
    } catch (err) {
      if (err.statusCode === 409 || err.code === 'DUPLICATE_JOB') {
        return res.status(409).json({ error: err.message, code: err.code });
      }
      console.error(`[scheduleRoutes] Error triggering run for ${req.params.id}:`, err);
      return res.status(500).json({ error: err.message, code: 'SCHEDULE_TRIGGER_ERROR' });
    }
  }
);

// ── DELETE /api/tenants/:id/schedules/:scheduleId ───────────────────────────
// Delete a specific schedule (Admin only).
router.delete(['/:id/schedules/:scheduleId', '/:id/schedules', '/:id/schedule'], requireAuth, requireAdmin, async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      return res.status(404).json({ error: 'Tenant not found', code: 'TENANT_NOT_FOUND' });
    }

    const scheduleId = req.params.scheduleId || req.body.scheduleId;
    if (!scheduleId) {
      return res.status(400).json({ error: 'scheduleId is required for deletion', code: 'MISSING_SCHEDULE_ID' });
    }

    const schedule = await schedulerService.deleteSchedule(tenantId, scheduleId, req.user, req.ip);
    return res.json({
      success: true,
      tenantId,
      schedule,
      message: 'Schedule deleted successfully.',
    });
  } catch (err) {
    if (err.statusCode === 404 || err.code === 'SCHEDULE_NOT_FOUND') {
      return res.status(404).json({ error: err.message, code: err.code });
    }
    console.error(`[scheduleRoutes] Error deleting schedule for ${req.params.id}:`, err);
    return res.status(500).json({ error: err.message, code: 'SCHEDULE_DELETE_ERROR' });
  }
});

module.exports = router;
