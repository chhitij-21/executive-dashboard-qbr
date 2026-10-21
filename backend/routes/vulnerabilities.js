// backend/routes/vulnerabilities.js
// Express routes for Cisco PSIRT openVuln automated vulnerabilities.
// GET  /api/vulnerabilities         - Public: returns cached vulnerabilities dataset (optional date/product filters)
// GET  /api/vulnerabilities/refresh - Admin-only: triggers manual fetch and returns updated dataset

'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { getCachedVulnerabilities, fetchAndSave, VULN_FILE } = require('../services/vulnerabilityFetcher');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const historyService = require('../services/historyService');
const clientService = require('../services/clientService');

const router = express.Router();

/**
 * Maps a hardware device model string to an OS family.
 * Rules:
 *   MS*, MX*, MR*     -> 'Meraki'
 *   C9300*, C9200*    -> 'Cisco IOS XE'
 *   FPR*              -> 'Cisco FTD'
 *   FMC*              -> 'Cisco FMC'
 */
function mapModelToOsFamily(model) {
  if (!model || typeof model !== 'string') return null;
  const m = model.trim().toUpperCase();
  if (m.startsWith('MS') || m.startsWith('MX') || m.startsWith('MR')) {
    return 'Meraki';
  }
  if (m.startsWith('C9300') || m.startsWith('C9200')) {
    return 'Cisco IOS XE';
  }
  if (m.startsWith('FPR')) {
    return 'Cisco FTD';
  }
  if (m.startsWith('FMC')) {
    return 'Cisco FMC';
  }
  return null;
}

/**
 * Checks if a CVE advisory matches a given OS family.
 */
function cveMatchesOsFamily(cve, family) {
  const text = `${cve.product || ''} ${cve.vulnerabilityImpact || ''} ${cve.advisoryId || ''}`.toLowerCase();
  switch (family) {
    case 'Meraki':
      return text.includes('meraki');
    case 'Cisco IOS XE':
      return text.includes('ios xe') || text.includes('ios-xe') || text.includes('catalyst 9300') || text.includes('catalyst 9200');
    case 'Cisco FTD':
      return text.includes('ftd') || text.includes('firepower threat defense');
    case 'Cisco FMC':
      return text.includes('fmc') || text.includes('firepower management center');
    default:
      return false;
  }
}

/**
 * Loads the latest dashboard_data.json for a given clientId.
 */
function getClientDashboardData(clientId) {
  if (!clientId) return null;
  const canonicalId = clientService ? clientService.resolveCanonicalClientId(clientId) : clientId;

  let dPath = null;
  const history = historyService.getHistory({ clientId: canonicalId, status: 'completed' });
  if (history && history.length > 0 && history[0].dashboardPath) {
    const candidate = history[0].dashboardPath;
    if (fs.existsSync(candidate)) {
      dPath = candidate;
    } else {
      const relCandidate = path.resolve(__dirname, '..', '..', 'reports', `job_${history[0].jobId}`, 'dashboard_data.json');
      if (fs.existsSync(relCandidate)) {
        dPath = relCandidate;
      }
    }
  }

  // Fallback for client-jfl
  if (!dPath && canonicalId === 'client-jfl') {
    const canonicalPath = path.resolve(__dirname, '..', '..', 'data', 'dashboard_data.json');
    const bundledPath = path.resolve(__dirname, '..', '..', 'data', 'bundled_default', 'dashboard_data.json');
    if (fs.existsSync(canonicalPath)) dPath = canonicalPath;
    else if (fs.existsSync(bundledPath)) dPath = bundledPath;
  }

  if (dPath && fs.existsSync(dPath)) {
    try {
      const raw = fs.readFileSync(dPath, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      console.error('[vulnerabilitiesRoute] Error reading dashboard_data for client', clientId, err.message);
      return null;
    }
  }
  return null;
}

/**
 * GET /api/vulnerabilities
 * Public endpoint returning cached CVE records with optional query filtering and multi-tenant inventory scoping.
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

    const { startDate, endDate, severity, priority, product, clientId } = req.query;
    let filteredCves = data.cveList || [];
    let modelsFound = [];

    // Multi-tenant inventory filtering by clientId
    if (clientId) {
      const dashboardData = getClientDashboardData(clientId);
      if (dashboardData && Array.isArray(dashboardData.devices)) {
        const modelSet = new Set();
        for (const dev of dashboardData.devices) {
          const m = (dev.Model || dev.model || dev.DeviceModel || dev['Device Model'] || dev.PartNumber || '').trim();
          if (m) modelSet.add(m);
        }
        modelsFound = Array.from(modelSet);
      }

      const familiesFound = new Set();
      for (const model of modelsFound) {
        const fam = mapModelToOsFamily(model);
        if (fam) familiesFound.add(fam);
      }

      if (familiesFound.size === 0) {
        filteredCves = [];
      } else {
        const activeFamilies = Array.from(familiesFound);
        filteredCves = filteredCves.filter((item) =>
          activeFamilies.some((fam) => cveMatchesOsFamily(item, fam))
        );
      }
    }

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
      vulnerabilities: filteredCves,
      modelsFound,
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
