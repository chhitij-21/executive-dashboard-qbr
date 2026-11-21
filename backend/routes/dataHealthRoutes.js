// backend/routes/dataHealthRoutes.js
// ─────────────────────────────────────────────────────────────────────────────
// Enterprise Data Health API Routes (Item #12)
// Exposes lightweight telemetry, lazy row snapshot resolver, and multi-format
// export (Excel & PDF) with tenant isolation and 2,000-row safety limits.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const dataHealthService = require('../services/dataHealthService');
const dataHealthExporter = require('../services/dataHealthExporter');
const historyService = require('../services/historyService');
const clientService = require('../services/clientService');
const { requireAuth } = require('../middleware/auth');

/**
 * Resolves qbrData for request with strict tenant isolation.
 */
function resolveQbrData(req) {
  const jobId = req.query.jobId;
  const callerTenant = clientService.resolveCanonicalClientId(req.user?.assignedClient || req.headers['x-client-id']);
  const isAdmin = req.user?.role === 'admin';

  if (jobId) {
    const report = historyService.getReportByJobId(jobId);
    if (!report) {
      const err = new Error(`Job report "${jobId}" not found.`);
      err.statusCode = 404;
      throw err;
    }

    const reportTenant = clientService.resolveCanonicalClientId(report.clientId);
    if (!isAdmin && callerTenant && reportTenant && callerTenant !== reportTenant) {
      const err = new Error('Forbidden: Access to another tenant dataset is restricted.');
      err.statusCode = 403;
      err.code = 'TENANT_FORBIDDEN';
      throw err;
    }

    const dashboardPath = report.dashboardPath;
    if (dashboardPath && fs.existsSync(dashboardPath)) {
      try {
        const raw = fs.readFileSync(dashboardPath, 'utf8');
        return { qbrData: JSON.parse(raw), tenantId: reportTenant, jobId };
      } catch (e) {
        console.warn(`[dataHealthRoutes] Could not read job dashboard data: ${e.message}`);
      }
    }
  }

  // Fallback to active canonical dataset
  const targetTenant = callerTenant || 'client-default';
  const tenantDir = path.resolve(__dirname, `../../data/tenants/${targetTenant}`);
  const tenantDashboard = path.join(tenantDir, 'reports', 'dashboard_data.json');

  let activePath = tenantDashboard;
  if (!fs.existsSync(activePath)) {
    activePath = path.resolve(__dirname, '../../data/dashboard_data.json');
  }
  if (!fs.existsSync(activePath)) {
    activePath = path.resolve(__dirname, '../../data/bundled_default/dashboard_data.json');
  }

  if (fs.existsSync(activePath)) {
    try {
      const raw = fs.readFileSync(activePath, 'utf8');
      return { qbrData: JSON.parse(raw), tenantId: targetTenant, jobId: null };
    } catch (_) {}
  }

  return { qbrData: {}, tenantId: targetTenant, jobId: null };
}

// ── GET /api/data-health (and /latest) ────────────────────────────────────────
router.get(['/', '/latest'], requireAuth, (req, res) => {
  try {
    const { qbrData, tenantId, jobId } = resolveQbrData(req);
    const health = dataHealthService.calculateDataHealth(qbrData);

    return res.json({
      success: true,
      tenantId,
      jobId,
      health,
    });
  } catch (err) {
    console.error('[dataHealthRoutes] Error calculating health:', err.message);
    return res.status(err.statusCode || 500).json({
      error: err.message,
      code: err.code || 'HEALTH_ERROR',
    });
  }
});

// ── GET /api/data-health/issue/:issueId (Lazy Row Snapshot) ──────────────────
router.get('/issue/:issueId', requireAuth, (req, res) => {
  try {
    const { issueId } = req.params;
    const { qbrData, tenantId, jobId } = resolveQbrData(req);

    const snapshotResult = dataHealthService.getIssueRowSnapshot(qbrData, issueId);
    if (!snapshotResult) {
      return res.status(404).json({ error: 'Issue record not found', code: 'ISSUE_NOT_FOUND' });
    }

    return res.json({
      success: true,
      tenantId,
      jobId,
      ...snapshotResult,
    });
  } catch (err) {
    console.error('[dataHealthRoutes] Error fetching issue snapshot:', err.message);
    return res.status(err.statusCode || 500).json({
      error: err.message,
      code: err.code || 'SNAPSHOT_ERROR',
    });
  }
});

// ── GET /api/data-health/export?format=xlsx|pdf ──────────────────────────────
router.get('/export', requireAuth, (req, res) => {
  try {
    const format = String(req.query.format || 'xlsx').toLowerCase();
    const strict = req.query.strict === 'true' || req.query.strict === '1';
    const { qbrData, tenantId, jobId } = resolveQbrData(req);
    const health = dataHealthService.calculateDataHealth(qbrData);

    if (format === 'xlsx') {
      const buffer = dataHealthExporter.generateExcelReport(qbrData, health, { strict });
      const filename = `Data_Health_Report_${Date.now()}.xlsx`;

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(buffer);
    }

    if (format === 'pdf') {
      const buffer = dataHealthExporter.generatePdfReport(qbrData, health, { strict });
      const filename = `Data_Health_Report_${Date.now()}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(buffer);
    }

    return res.status(400).json({
      error: `Unsupported export format "${format}". Supported formats: xlsx, pdf`,
      code: 'INVALID_FORMAT',
    });
  } catch (err) {
    if (err.statusCode === 413 || err.code === 'PAYLOAD_TOO_LARGE') {
      return res.status(413).json({
        error: err.message,
        code: 'PAYLOAD_TOO_LARGE',
        maxLimit: dataHealthExporter.MAX_EXPORT_ISSUES,
      });
    }

    console.error('[dataHealthRoutes] Export error:', err.message);
    return res.status(err.statusCode || 500).json({
      error: err.message,
      code: err.code || 'EXPORT_ERROR',
    });
  }
});

// ── GET /api/data-health/:jobId (Historical Job Health) ──────────────────────
router.get('/:jobId', requireAuth, (req, res) => {
  try {
    req.query.jobId = req.params.jobId;
    const { qbrData, tenantId, jobId } = resolveQbrData(req);
    const health = dataHealthService.calculateDataHealth(qbrData);

    return res.json({
      success: true,
      tenantId,
      jobId,
      health,
    });
  } catch (err) {
    console.error('[dataHealthRoutes] Error calculating job health:', err.message);
    return res.status(err.statusCode || 500).json({
      error: err.message,
      code: err.code || 'HEALTH_ERROR',
    });
  }
});

module.exports = router;
