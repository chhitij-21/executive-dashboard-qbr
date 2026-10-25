/**
 * backend/routes/reports.js
 * MMTC Reports Dashboard and Ticket Upload API Routes (Phase 1)
 */

const express = require('express');
const multer = require('multer');
const router = express.Router({ mergeParams: true });

const { requireAuth, requireClientAccess } = require('../middleware/auth');
const { buildReportAsync, persistTickets } = require('../services/reportService');
const { parseTicketExcel } = require('../services/reportUpload');

// Isolated in-memory multer instance for reports Excel upload (never writes to disk)
const reportsUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// Fail-closed client access middleware
const guard = requireClientAccess((req) =>
  req.params.clientId || req.query?.clientId || req.body?.clientId || req.user?.assignedClient
);

/**
 * POST /api/reports/:clientId/tickets/upload
 * Validates 33-column Excel and persists tickets into reports_tickets table.
 */
router.post(
  '/:clientId/tickets/upload',
  requireAuth,
  guard,
  reportsUpload.single('excel'),
  async (req, res) => {
    // ADJUSTMENT A: Verify canonical client access strictly for MMTC
    if (req.targetClientId !== 'client-mmtcpamp') {
      return res.status(403).json({ error: 'JFL not in scope' });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'Missing uploaded Excel file in "excel" field.' });
    }

    try {
      const { rows } = parseTicketExcel(req.file.buffer);

      // Filter only for MMTC account rows if present
      const mmtcRows = rows.filter((r) => {
        const acc = (r['Account Name'] || '').toString().toLowerCase();
        return !acc || acc.includes('mmtc');
      });

      const uploadPeriod = {
        start: req.body?.start_date || req.body?.start || null,
        end: req.body?.end_date || req.body?.end || null,
      };
      const { insertedCount } = await persistTickets(req.targetClientId, mmtcRows.length > 0 ? mmtcRows : rows, uploadPeriod);

      return res.status(201).json({
        message: 'Tickets uploaded and validated successfully',
        totalRows: rows.length,
        insertedCount,
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }
);

function getZeroedReport(clientId) {
  return {
    summary: { total: 0, closed: 0, on_hold: 0, open: 0 },
    sla: { met: 0, breached: 0, on_hold: 0, by_type: { Incident: 0, CR: 0, RF: 0, Upgrade: 0 } },
    channel: { meraki_alerts: 0, meraki_emails: 0, security_alerts: 0, security_emails: 0 },
    rca_breakdown: [],
    isp_pct: { rca_denom: 0, channel_denom: 0 },
    isp_location: [],
    top_sites: [],
    hold_tickets: [],
    cr_tickets: [],
    cr_summary: { meraki_crs: 0, security_crs: 0, security_emails: 0, total_crs: 0 },
    meta: {
      client_id: clientId,
      start: null,
      end: null,
      label: 'No data',
      uploaded_at: null,
    },
  };
}

/**
 * GET /api/reports/:clientId/latest
 * Fetches computed 8-block report data for the most recent upload batch.
 */
router.get('/:clientId/latest', requireAuth, guard, async (req, res) => {
  // Guard: MMTC only, JFL rejected
  if (req.targetClientId !== 'client-mmtcpamp') {
    return res.status(403).json({ error: 'JFL not in scope' });
  }

  const clientId = 'mmtc';

  try {
    let db = null;
    try {
      db = require('../config/database');
    } catch (_) {}

    if (!db || typeof db.execute !== 'function') {
      return res.status(200).json(getZeroedReport(clientId));
    }

    const requestedJobId = (req.query?.jobId || '').toString().trim();
    let rows = [];
    let batchTimestamp = null;
    const testFilter = process.env.NODE_ENV !== 'test' ? " AND ticket_number NOT LIKE 'TEST-%'" : "";

    if (requestedJobId && requestedJobId !== 'latest' && requestedJobId !== 'default') {
      // 1. If req.query.jobId is provided and not 'latest', filter reports_tickets by that specific job_id (or uploaded_at batch).
      const jobRes = await db.execute(
        `SELECT payload_json, period_start, period_end, uploaded_at FROM reports_tickets WHERE client_id = ? AND (job_id = ? OR uploaded_at = ?) AND period_start IS NOT NULL AND payload_json IS NOT NULL AND payload_json != 'null'${testFilter}`,
        [clientId, requestedJobId, requestedJobId]
      );
      rows = jobRes?.rows || [];

      // If not found by direct query, check historyService for the job's upload timestamp
      if (rows.length === 0) {
        try {
          const historyService = require('../services/historyService');
          const job = historyService.getReportByJobId(requestedJobId);
          if (job?.uploadTimestamp) {
            const tsRes = await db.execute(
              `SELECT payload_json, period_start, period_end, uploaded_at FROM reports_tickets WHERE client_id = ? AND uploaded_at = ? AND period_start IS NOT NULL AND payload_json IS NOT NULL AND payload_json != 'null'${testFilter}`,
              [clientId, job.uploadTimestamp]
            );
            rows = tsRes?.rows || [];
          }
        } catch (_) {}
      }
    }

    // Only fallback to MAX(uploaded_at) if jobId is 'latest' or missing or no rows were found
    if (rows.length === 0) {
      const maxRes = await db.execute(
        `SELECT MAX(uploaded_at) AS latest FROM reports_tickets WHERE client_id = ? AND period_start IS NOT NULL AND payload_json IS NOT NULL AND payload_json != 'null'${testFilter}`,
        [clientId]
      );

      const latestUploadedAt = maxRes?.rows?.[0]?.latest || maxRes?.rows?.[0]?.[0];
      if (!latestUploadedAt) {
        return res.status(200).json(getZeroedReport(clientId));
      }

      batchTimestamp = latestUploadedAt;
      const batchRes = await db.execute(
        `SELECT payload_json, period_start, period_end, uploaded_at FROM reports_tickets WHERE client_id = ? AND uploaded_at = ? AND period_start IS NOT NULL AND payload_json IS NOT NULL AND payload_json != 'null'${testFilter}`,
        [clientId, latestUploadedAt]
      );
      rows = batchRes?.rows || [];
    }

    if (rows.length === 0) {
      return res.status(200).json(getZeroedReport(clientId));
    }

    batchTimestamp = batchTimestamp || rows[0]?.uploaded_at || rows[0]?.[3];

    const tickets = rows.map((r) => {
      const raw = r.payload_json || r[0];
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    });

    const firstWithStart = rows.find(r => r.period_start || r[1]);
    const firstWithEnd = rows.find(r => r.period_end || r[2]);
    let start = firstWithStart ? (firstWithStart.period_start || firstWithStart[1]) : null;
    let end = firstWithEnd ? (firstWithEnd.period_end || firstWithEnd[2]) : null;

    const { buildReport, parseTicketDate } = require('../services/reportService');

    // CRITICAL: buildReport must receive the exact start and end dates of that specific batch
    if (!start || !end) {
      const dates = tickets
        .map((t) => parseTicketDate(t['Created Time'] || t.created_time || t.CreatedTime))
        .filter(Boolean)
        .sort((a, b) => a - b);

      if (dates.length > 0) {
        if (!start) start = dates[0].toISOString().slice(0, 10);
        if (!end) end = dates[dates.length - 1].toISOString().slice(0, 10);
      } else {
        if (!start) start = new Date().toISOString().slice(0, 10);
        if (!end) end = start;
      }
    }

    // Reject if all tickets are test rows
    if (tickets.length === 0 || (process.env.NODE_ENV !== 'test' && tickets.every(t => String(t['Ticket Number'] || t.ticket_number || '').startsWith('TEST-')))) {
      return res.status(200).json(getZeroedReport(clientId));
    }

    const report = buildReport(clientId, start, end, { tickets });
    report.meta = {
      ...report.meta,
      client_id: clientId,
      start,
      end,
      uploaded_at: batchTimestamp,
      job_id: requestedJobId && requestedJobId !== 'latest' ? requestedJobId : undefined,
    };

    return res.status(200).json(report);
  } catch (err) {
    return res.status(500).json({ error: 'Failed retrieving latest report.', details: err.message });
  }
});

/**
 * GET /api/reports/:clientId
 * Fetches computed 8-block report data for the selected date window.
 */
router.get('/:clientId', requireAuth, guard, async (req, res) => {
  // ADJUSTMENT A: Verify canonical client access strictly for MMTC
  if (req.targetClientId !== 'client-mmtcpamp') {
    return res.status(403).json({ error: 'JFL not in scope' });
  }

  const start = (req.query.start || req.body?.startDate || '').toString().trim();
  const end = (req.query.end || req.body?.endDate || '').toString().trim();
  if (!start || !end) {
    return res.status(400).json({ error: 'Start date and end date are required', code: 'MISSING_DATE_RANGE' });
  }
  const label = req.query.label ? req.query.label.toString().trim() : '';

  try {
    const report = await buildReportAsync(req.targetClientId, start, end, { label });
    return res.status(200).json(report);
  } catch (err) {
    return res.status(500).json({ error: 'Failed generating reports data.', details: err.message });
  }
});

module.exports = router;
