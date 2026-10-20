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

      const { insertedCount } = await persistTickets(req.targetClientId, mmtcRows.length > 0 ? mmtcRows : rows);

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

/**
 * GET /api/reports/:clientId
 * Fetches computed 8-block report data for the selected date window.
 */
router.get('/:clientId', requireAuth, guard, async (req, res) => {
  // ADJUSTMENT A: Verify canonical client access strictly for MMTC
  if (req.targetClientId !== 'client-mmtcpamp') {
    return res.status(403).json({ error: 'JFL not in scope' });
  }

  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);

  const start = (req.query.start || thirtyDaysAgo).toString().trim();
  const end = (req.query.end || today).toString().trim();
  const label = req.query.label ? req.query.label.toString().trim() : '';

  try {
    const report = await buildReportAsync(req.targetClientId, start, end, { label });
    return res.status(200).json(report);
  } catch (err) {
    return res.status(500).json({ error: 'Failed generating reports data.', details: err.message });
  }
});

module.exports = router;
