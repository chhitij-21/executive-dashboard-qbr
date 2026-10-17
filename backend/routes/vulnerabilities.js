// backend/routes/vulnerabilities.js
// Express routes for Cisco PSIRT openVuln automated vulnerabilities.
// GET  /api/vulnerabilities         - Public: returns cached vulnerabilities dataset (optional date/product filters)
// GET  /api/vulnerabilities/refresh - Admin-only: triggers manual fetch and returns updated dataset

'use strict';

const express = require('express');
const { getCachedVulnerabilities, fetchAndSave, VULN_FILE } = require('../services/vulnerabilityFetcher');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/vulnerabilities
 * Public endpoint returning cached CVE records with optional query filtering.
 */
router.get('/', async (req, res) => {
  try {
    let data = getCachedVulnerabilities();

    // If cache does not exist yet, trigger initial fetch
    if (!data || !data.cveList) {
      try {
        data = await fetchAndSave();
      } catch (fetchErr) {
        console.error('[vulnerabilitiesRoute] Initial fetch error:', fetchErr.message);
        data = {
          lastFetched: new Date().toISOString(),
          advisoryCount: 0,
          cveCount: 0,
          sources: [{ name: 'Cisco PSIRT openVuln API', url: 'https://developer.cisco.com/psirt/' }],
          cveList: [],
        };
      }
    }

    const { startDate, endDate, severity, priority, product } = req.query;
    let filteredCves = data.cveList || [];

    // Date range filtering (advisoryDate is YYYY-MM-DD)
    if (startDate) {
      filteredCves = filteredCves.filter((item) => item.advisoryDate >= startDate);
    }
    if (endDate) {
      filteredCves = filteredCves.filter((item) => item.advisoryDate <= endDate);
    }

    // Severity filtering
    if (severity && severity !== 'ALL') {
      const targetSev = severity.toLowerCase();
      filteredCves = filteredCves.filter((item) => (item.severity || '').toLowerCase() === targetSev);
    }

    // Priority filtering
    if (priority && priority !== 'ALL') {
      filteredCves = filteredCves.filter((item) => item.priority === priority);
    }

    // Product substring filtering
    if (product && product.trim()) {
      const q = product.toLowerCase();
      filteredCves = filteredCves.filter((item) => (item.product || '').toLowerCase().includes(q));
    }

    return res.status(200).json({
      success: true,
      lastFetched: data.lastFetched,
      totalCount: data.cveCount || (data.cveList || []).length,
      filteredCount: filteredCves.length,
      advisoryCount: data.advisoryCount || 0,
      sources: data.sources || [],
      cveList: filteredCves,
    });
  } catch (err) {
    console.error('[vulnerabilitiesRoute] Error in GET /:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve vulnerabilities',
      details: err.message,
    });
  }
});

/**
 * GET /api/vulnerabilities/refresh & POST /api/vulnerabilities/refresh
 * Admin-only endpoint triggering an on-demand sync from Cisco PSIRT API.
 */
const handleRefresh = async (req, res) => {
  try {
    console.log(`[vulnerabilitiesRoute] Admin ${req.user ? req.user.email : 'system'} triggered vulnerability refresh`);
    const count = parseInt(req.query.count, 10) || 100;
    const result = await fetchAndSave(count);
    return res.status(200).json({
      success: true,
      message: 'Vulnerabilities successfully refreshed from Cisco PSIRT API',
      lastFetched: result.lastFetched,
      advisoryCount: result.advisoryCount,
      cveCount: result.cveCount,
      sample: result.cveList ? result.cveList.slice(0, 3) : [],
    });
  } catch (err) {
    console.error('[vulnerabilitiesRoute] Refresh failed:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to refresh vulnerabilities from Cisco PSIRT API',
      details: err.message,
    });
  }
};

router.get('/refresh', requireAuth, requireAdmin, handleRefresh);
router.post('/refresh', requireAuth, requireAdmin, handleRefresh);

module.exports = router;
