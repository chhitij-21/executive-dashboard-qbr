// backend/routes/v1/auditRoutes.js
// Enterprise Security Audit Trail & Compliance API Endpoints (Item #21)

'use strict';

const express = require('express');
const router = express.Router();
const auditService = require('../../services/auditService');
const { requireAuth, requireAdmin, requireClientAccess } = require('../../middleware/auth');

// ── Admin-Wide Audit Log Inspection ─────────────────────────────────────────
router.get(['/audit', '/api/audit'], requireAuth, requireAdmin, async (req, res) => {
  const {
    tenantId,
    eventType,
    severity,
    userId,
    action,
    status,
    startDate,
    endDate,
    limit,
    offset,
  } = req.query;

  const result = await auditService.queryLogs({
    tenantId,
    eventType,
    severity,
    userId,
    action,
    status,
    startDate,
    endDate,
    limit,
    offset,
  });

  res.json(result);
});

// ── Admin-Wide Audit CSV Export ─────────────────────────────────────────────
router.get(['/audit/export', '/api/audit/export'], requireAuth, requireAdmin, async (req, res) => {
  const { tenantId, eventType, severity, startDate, endDate } = req.query;
  const csv = await auditService.exportCsv({ tenantId, eventType, severity, startDate, endDate });

  const filename = `audit_log_${new Date().toISOString().substring(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

// ── Tenant-Scoped Audit Log Inspection ──────────────────────────────────────
router.get(
  ['/tenants/:id/audit', '/api/tenants/:id/audit'],
  requireAuth,
  requireClientAccess((req) => req.params.id),
  async (req, res) => {
    const tenantId = req.params.id;
    const { eventType, severity, action, status, startDate, endDate, limit, offset } = req.query;

    const result = await auditService.queryLogs({
      tenantId,
      eventType,
      severity,
      action,
      status,
      startDate,
      endDate,
      limit,
      offset,
    });

    res.json(result);
  }
);

// ── Tenant-Scoped Audit CSV Export ──────────────────────────────────────────
router.get(
  ['/tenants/:id/audit/export', '/api/tenants/:id/audit/export'],
  requireAuth,
  requireClientAccess((req) => req.params.id),
  async (req, res) => {
    const tenantId = req.params.id;
    const { eventType, severity, startDate, endDate } = req.query;

    const csv = await auditService.exportCsv({ tenantId, eventType, severity, startDate, endDate });
    const filename = `audit_${tenantId}_${new Date().toISOString().substring(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }
);

module.exports = router;
