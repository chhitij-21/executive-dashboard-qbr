const express = require('express');
const router = express.Router();
const fs = require('fs');
const os = require('os');
const path = require('path');
const multer = require('multer');

const { requireAuth } = require('../middleware/auth');
const { execute } = require('../config/database');
const {
  parseUploadedInventory,
  loadCurrentInventory,
  createSyncPreview,
  approveSync,
  computeDiff,
  regenerateDashboardFileForClient,
} = require('../services/inventorySyncService');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, os.tmpdir()),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.xlsx';
    cb(null, `inv_sync_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB max
});

router.use(requireAuth);

// ── POST /api/inventory/sync/upload ─────────────────────────
router.post('/sync/upload', upload.single('file'), async (req, res) => {
  const tempFile = req.file?.path; // if disk storage
  try {
    const clientId = String(req.body.clientId || '').toLowerCase();
    if (clientId !== 'jfl' && clientId !== 'mmtc') {
      return res.status(400).json({ error: 'clientId must be jfl or mmtc' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'file is required' });
    }

    const { devices, warnings } = await parseUploadedInventory(
      tempFile, clientId
    );
    const current = await loadCurrentInventory(clientId, true);
    const diff = computeDiff(current, devices);
    const { syncId } = await createSyncPreview({
      clientId,
      triggeredBy: req.user?.username || 'api',
      fileName: req.file.originalname,
      diff,
    });

    return res.json({
      syncId,
      fileName: req.file.originalname,
      counts: {
        added: diff.added.length,
        removed: diff.removed.length,
        replaced: diff.replaced.length,
        unchanged: diff.unchanged.length,
      },
      warnings,
      diff,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    // Clean up temp file
    if (tempFile && fs.existsSync(tempFile)) {
      fs.unlink(tempFile, () => {});
    }
  }
});

// ── GET /api/inventory/sync/:syncId ─────────────────────────
router.get('/sync/:syncId', async (req, res) => {
  try {
    const syncId = Number(req.params.syncId);
    if (!Number.isInteger(syncId) || syncId <= 0) {
      return res.status(400).json({ error: 'invalid syncId' });
    }
    const result = await execute({
      sql: 'SELECT * FROM inventory_syncs WHERE id = ?',
      args: [syncId],
    });
    const sync = result.rows[0];
    if (!sync) return res.status(404).json({ error: 'Sync not found' });
    let diff = null;
    try {
      diff = JSON.parse(sync.diff_summary);
    } catch (_) {
      return res.status(500).json({ error: 'Malformed diff_summary' });
    }
    return res.json({
      id: sync.id,
      clientId: sync.client_id,
      triggeredBy: sync.triggered_by,
      fileName: sync.uploaded_file_name,
      status: sync.status,
      createdAt: sync.created_at,
      approvedAt: sync.approved_at,
      diff,
      counts: {
        added: diff.added.length,
        removed: diff.removed.length,
        replaced: diff.replaced.length,
        unchanged: diff.unchanged.length,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/inventory/sync/:syncId/approve ────────────────
router.post('/sync/:syncId/approve', async (req, res) => {
  try {
    const syncId = Number(req.params.syncId);
    if (!Number.isInteger(syncId) || syncId <= 0) {
      return res.status(400).json({ error: 'invalid syncId' });
    }
    const approval = await approveSync(syncId);
    const clientId = approval.clientId;
    if (clientId) {
      try {
        approval.regen = await regenerateDashboardFileForClient(clientId);
      } catch (e) {
        approval.regen = { skipped: true, reason: 'regen-error', message: e.message };
      }
    } else {
      approval.regen = { skipped: true, reason: 'no-client-id' };
      console.warn(`[inventory] approveSync returned no clientId for sync ${syncId}; regen skipped`);
    }
    return res.json(approval);
  } catch (err) {
    // Map known errors to 4xx
    if (/not found/i.test(err.message)) {
      return res.status(404).json({ error: err.message });
    }
    if (/cannot approve|not pending|malformed/i.test(err.message)) {
      return res.status(409).json({ error: err.message });
    }
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/inventory/sync/:syncId/reject ─────────────────
router.post('/sync/:syncId/reject', async (req, res) => {
  try {
    const syncId = Number(req.params.syncId);
    if (!Number.isInteger(syncId) || syncId <= 0) {
      return res.status(400).json({ error: 'invalid syncId' });
    }
    const result = await execute({
      sql: `UPDATE inventory_syncs
            SET status = 'rejected'
            WHERE id = ? AND status = 'pending'`,
      args: [syncId],
    });
    if (Number(result.rowsAffected) !== 1) {
      return res.status(409).json({
        error: 'Sync not pending or not found',
      });
    }
    return res.json({ syncId, status: 'rejected' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/inventory/syncs?clientId= ──────────────────────
router.get('/syncs', async (req, res) => {
  try {
    const clientId = String(req.query.clientId || '').toLowerCase();
    if (clientId !== 'jfl' && clientId !== 'mmtc') {
      return res.status(400).json({ error: 'clientId required (jfl|mmtc)' });
    }
    const result = await execute({
      sql: `SELECT id, client_id, triggered_by, uploaded_file_name,
                   status, created_at, approved_at
            FROM inventory_syncs
            WHERE client_id = ?
            ORDER BY id DESC LIMIT 50`,
      args: [clientId],
    });
    return res.json({ syncs: result.rows || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/inventory/current?clientId=&include=all ────────
router.get('/current', async (req, res) => {
  try {
    const clientId = String(req.query.clientId || '').toLowerCase();
    if (clientId !== 'jfl' && clientId !== 'mmtc') {
      return res.status(400).json({ error: 'clientId required (jfl|mmtc)' });
    }
    const includeAll = req.query.include === 'all';
    const sql = includeAll
      ? 'SELECT * FROM inventory_devices WHERE client_id = ? ORDER BY serial_no'
      : "SELECT * FROM inventory_devices WHERE client_id = ? AND status = 'active' ORDER BY serial_no";
    const result = await execute({ sql, args: [clientId] });
    return res.json({
      clientId,
      count: (result.rows || []).length,
      devices: result.rows || [],
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
