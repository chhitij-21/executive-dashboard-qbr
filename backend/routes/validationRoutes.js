// backend/routes/validationRoutes.js
// Additive-only. No existing files modified.
// Express router exposing validation endpoints.
// Null-safe. Never throws. Node built-ins only (express is already in package).

'use strict';

const express        = require('express');
const { validateReport } = require('../services/validators/reportValidator');

const router = express.Router();

// ─── POST / — run full report validation ──────────────────────────────────

/**
 * POST /api/validate
 * Body: { qbrData: object }
 * Response: 200 { success, overallHealth, sections, topIssues, ranAt, error }
 *           400 if qbrData missing/invalid
 *           500 on unexpected error (should never reach — validateReport never throws)
 */
router.post('/', async (req, res) => {
  try {
    // Null-safe body extraction
    const body    = req && req.body && typeof req.body === 'object' ? req.body : {};
    const qbrData = body.qbrData;

    if (!qbrData || typeof qbrData !== 'object') {
      return res.status(400).json({
        success:       false,
        overallHealth: 'FAIL',
        sections:      {},
        topIssues:     [],
        ranAt:         new Date().toISOString(),
        error:         'MISSING_INPUT: request body must contain { qbrData: object }',
      });
    }

    const result = await validateReport(qbrData);

    return res.status(200).json(result);
  } catch (err) {
    // This block should never be reached — validateReport is fully wrapped.
    // Kept as final safety net.
    return res.status(500).json({
      success:       false,
      overallHealth: 'FAIL',
      sections:      {},
      topIssues:     [],
      ranAt:         new Date().toISOString(),
      error:         `ROUTE_ERROR: ${err && err.message ? err.message : String(err)}`,
    });
  }
});

// ─── GET /health — liveness probe ─────────────────────────────────────────

/**
 * GET /api/validate/health
 * Response: 200 { status: 'ok', route: '/api/validate', ts: ISO string }
 */
router.get('/health', (req, res) => {
  try {
    return res.status(200).json({
      status: 'ok',
      route:  '/api/validate',
      ts:     new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({
      status: 'error',
      error:  err && err.message ? err.message : String(err),
    });
  }
});

// ─── Mount helper ─────────────────────────────────────────────────────────

/**
 * Mount the validation router onto an Express app instance.
 *
 * Usage (add ONE line to backend/index.js after app.use(express.json(...))):
 *   require('./routes/validationRoutes').mount(app);
 *
 * @param {import('express').Application} app
 */
function mount(app) {
  try {
    if (!app || typeof app.use !== 'function') {
      console.error('[validationRoutes] mount() called with invalid app instance');
      return;
    }
    app.use('/api/validate', router);
    console.log('[validationRoutes] Mounted: POST /api/validate, GET /api/validate/health');
  } catch (err) {
    console.error(`[validationRoutes] mount() error: ${err && err.message ? err.message : String(err)}`);
  }
}

module.exports = { router, mount };
