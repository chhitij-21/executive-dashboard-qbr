// backend/services/historyService.js
// Stores and retrieves report metadata history.
// PRIVACY RULE: Uploaded Excel data is NEVER retained permanently.
// Only metadata (Client, Location, Period, Timestamp, User, Status, Dashboard Path, PPT Path) is saved.

const fs = require('fs');
const path = require('path');
const os = require('os');
const qoqComparisonService = require('./qoqComparisonService');

const BASE_STORAGE_DIR = process.env.PERSISTENT_DIR || process.env.STORAGE_DIR || process.env.RENDER_DISK_PATH;
const DATA_DIR = BASE_STORAGE_DIR
  ? path.join(BASE_STORAGE_DIR, 'data')
  : (process.env.VERCEL
      ? path.join(os.tmpdir(), 'data')
      : path.resolve(__dirname, '..', '..', 'data'));
const METADATA_FILE = path.join(DATA_DIR, 'reports_metadata.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Migration helper: Backfills quarter, fiscal_year, and is_standard_quarter on legacy entries.
 */
function migrateLegacyQuarterMetadata(list) {
  if (!Array.isArray(list)) return [];
  let modified = false;

  const migrated = list.map(item => {
    if (item.quarter && item.fiscal_year !== undefined) {
      return item;
    }

    let startDate = item.startDate || item.report_period?.start_date;
    let endDate = item.endDate || item.report_period?.end_date;

    // Try parsing from reportPeriod string (e.g. "1 Apr 2026 – 30 Jun 2026")
    if ((!startDate || !endDate) && typeof item.reportPeriod === 'string') {
      const parts = item.reportPeriod.split(/[–-]/);
      if (parts.length === 2) {
        const d1 = new Date(parts[0].trim());
        const d2 = new Date(parts[1].trim());
        if (!isNaN(d1.getTime()) && !isNaN(d2.getTime())) {
          startDate = d1.toISOString().split('T')[0];
          endDate = d2.toISOString().split('T')[0];
        }
      }
    }

    let qInfo = { quarter: 'CUSTOM', fiscal_year: 'CUSTOM', is_standard_quarter: false };
    if (startDate && endDate) {
      const sMatch = String(startDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const eMatch = String(endDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (sMatch && eMatch) {
        const sYear = parseInt(sMatch[1], 10);
        const sMonth = parseInt(sMatch[2], 10);
        const sDay = parseInt(sMatch[3], 10);
        const eYear = parseInt(eMatch[1], 10);
        const eMonth = parseInt(eMatch[2], 10);
        const eDay = parseInt(eMatch[3], 10);

        if (sYear === eYear && sMonth === 4 && sDay === 1 && eMonth === 6 && eDay === 30) {
          qInfo = { quarter: 'Q1', fiscal_year: `FY${sYear}`, is_standard_quarter: true };
        } else if (sYear === eYear && sMonth === 7 && sDay === 1 && eMonth === 9 && eDay === 30) {
          qInfo = { quarter: 'Q2', fiscal_year: `FY${sYear}`, is_standard_quarter: true };
        } else if (sYear === eYear && sMonth === 10 && sDay === 1 && eMonth === 12 && eDay === 31) {
          qInfo = { quarter: 'Q3', fiscal_year: `FY${sYear}`, is_standard_quarter: true };
        } else if (sYear === eYear && sMonth === 1 && sDay === 1 && eMonth === 3 && eDay === 31) {
          qInfo = { quarter: 'Q4', fiscal_year: `FY${sYear - 1}`, is_standard_quarter: true };
        }
      }
    }

    modified = true;
    return {
      ...item,
      quarter: qInfo.quarter,
      fiscal_year: qInfo.fiscal_year,
      is_standard_quarter: qInfo.is_standard_quarter,
    };
  });

  return migrated;
}

function loadHistory() {
  ensureDataDir();
  if (!fs.existsSync(METADATA_FILE)) {
    saveHistory([]);
    return [];
  }
  try {
    const raw = fs.readFileSync(METADATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];

    const rootDir = path.resolve(__dirname, '..', '..');
    const migrated = migrateLegacyQuarterMetadata(data);

    return migrated.map((item) => {
      const normalize = (p) => {
        if (!p) return null;
        if (fs.existsSync(p)) return p;
        const relRoot = path.resolve(rootDir, p);
        if (fs.existsSync(relRoot)) return relRoot;
        const relData = path.resolve(DATA_DIR, path.basename(p));
        if (fs.existsSync(relData)) return relData;
        const relBundled = path.resolve(DATA_DIR, 'bundled_default', path.basename(p));
        if (fs.existsSync(relBundled)) return relBundled;
        return p;
      };

      return {
        ...item,
        dashboardPath: normalize(item.dashboardPath),
        pdfPath: normalize(item.pdfPath),
        pptPath: normalize(item.pptPath),
        reportPath: normalize(item.reportPath),
        dataQualityPath: normalize(item.dataQualityPath),
        processingLogPath: normalize(item.processingLogPath),
      };
    });
  } catch (err) {
    console.error('[historyService] Error loading metadata history:', err.message);
    return [];
  }
}

function saveHistory(history) {
  ensureDataDir();
  const tempPath = path.join(DATA_DIR, `reports_metadata.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}.json`);
  const payload = JSON.stringify(history, null, 2);
  fs.writeFileSync(tempPath, payload, 'utf8');
  try {
    fs.renameSync(tempPath, METADATA_FILE);
  } catch (err) {
    try {
      fs.copyFileSync(tempPath, METADATA_FILE);
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch (_) {
      fs.writeFileSync(METADATA_FILE, payload, 'utf8');
    }
  }
}

function parseSafeTimestamp(ts) {
  if (!ts) return null;
  const t = new Date(ts).getTime();
  return isNaN(t) ? null : t;
}

function getHistory(filters = {}) {
  let list = loadHistory();

  if (filters.clientId && filters.clientId !== 'all') {
    list = list.filter((item) => item.clientId === filters.clientId);
  }

  if (filters.location && filters.location !== 'ALL' && filters.location !== 'All Locations') {
    list = list.filter((item) => item.location === filters.location || item.location === 'ALL' || item.location === 'All Locations');
  }

  if (filters.status) {
    list = list.filter((item) => item.status === filters.status);
  }

  // Sort descending by validated timestamp; fallback to natural insertion order
  return list.sort((a, b) => {
    const tb = parseSafeTimestamp(b.uploadTimestamp);
    const ta = parseSafeTimestamp(a.uploadTimestamp);
    if (tb !== null && ta !== null) return tb - ta;
    if (tb !== null) return 1;
    if (ta !== null) return -1;
    return 0;
  });
}

function getReportByJobId(jobId) {
  const list = loadHistory();
  return list.find((item) => item.jobId === jobId) || null;
}

function recordReport(metadata) {
  const list = loadHistory();
  const index = list.findIndex((item) => item.jobId === metadata.jobId);

  const entry = {
    jobId: metadata.jobId,
    clientId: metadata.clientId || 'client-jfl',
    clientName: metadata.clientName || 'Jubilant Foodworks Ltd (JFL)',
    location: metadata.location || 'All Locations',
    reportPeriod: metadata.reportPeriod || 'Q1 FY2026',
    quarter: metadata.quarter || null,
    fiscal_year: metadata.fiscal_year || null,
    is_standard_quarter: metadata.is_standard_quarter !== undefined ? metadata.is_standard_quarter : false,
    uploadTimestamp: metadata.uploadTimestamp || new Date().toISOString(),
    uploadedBy: metadata.uploadedBy || 'System User',
    reportVersion: metadata.reportVersion || '1.0',
    status: metadata.status || 'processing',
    dashboardPath: metadata.dashboardPath || null,
    pdfPath: metadata.pdfPath || null,
    pptPath: metadata.pptPath || null,
    reportPath: metadata.reportPath || null,
    dataQualityPath: metadata.dataQualityPath || null,
    processingLogPath: metadata.processingLogPath || null,
    error: metadata.error || null,
  };

  if (index !== -1) {
    list[index] = { ...list[index], ...entry };
  } else {
    list.unshift(entry);
  }

  saveHistory(list);
  return entry;
}

/**
 * Strict privacy enforcement helper: Removes uploaded Excel files post-processing.
 */
function cleanupTempFiles(filePaths = []) {
  filePaths.forEach((fp) => {
    if (fp && fs.existsSync(fp)) {
      try {
        fs.unlinkSync(fp);
        console.log(`[historyService] Privacy enforcement: Deleted uploaded raw file ${path.basename(fp)}`);
      } catch (e) {
        console.warn(`[historyService] Could not delete temp file ${fp}:`, e.message);
      }
    }
  });

  // Also purge incoming directory to ensure zero residual raw excel files
  const incomingDir = path.resolve(__dirname, '..', '..', 'data', 'incoming');
  if (fs.existsSync(incomingDir)) {
    try {
      const files = fs.readdirSync(incomingDir);
      files.forEach((f) => {
        const fullPath = path.join(incomingDir, f);
        if (fs.statSync(fullPath).isFile()) {
          fs.unlinkSync(fullPath);
        }
      });
      console.log('[historyService] Purged incoming temporary uploads directory.');
    } catch (e) {
      console.warn('[historyService] Warning during incoming purge:', e.message);
    }
  }
}

/**
 * Delete a report metadata entry and cleanup associated generated files.
 */
function deleteReport(jobId) {
  try {
    const list = loadHistory();
    const targetId = String(jobId || '').trim().toLowerCase();
    const index = list.findIndex((item) => String(item.jobId || '').trim().toLowerCase() === targetId);

    if (index === -1) {
      console.log(`[historyService] deleteReport: jobId "${jobId}" not found in metadata (treated as already deleted).`);
      return true;
    }

    const targetReport = list[index];
    list.splice(index, 1);
    saveHistory(list);

    // Attempt to delete output report folder
    try {
      const REPORTS_DIR = process.env.VERCEL
        ? path.join(os.tmpdir(), 'reports')
        : path.resolve(__dirname, '..', '..', 'reports');
      const jobDir = path.join(REPORTS_DIR, `job_${targetReport.jobId}`);
      if (fs.existsSync(jobDir)) {
        fs.rmSync(jobDir, { recursive: true, force: true });
        console.log(`[historyService] Deleted report output directory for job ${targetReport.jobId}`);
      }
    } catch (err) {
      console.warn(`[historyService] Warning removing report directory for job ${targetReport.jobId}:`, err.message);
    }

    return true;
  } catch (err) {
    console.error('[historyService] Error in deleteReport:', err.message);
    return false;
  }
} // ← end of deleteReport

/**
 * Delete ALL report history metadata and purge generated output report files.
 */
function clearAllHistory() {
  try {
    saveHistory([]);
    const REPORTS_DIR = process.env.VERCEL
      ? path.join(os.tmpdir(), 'reports')
      : path.resolve(__dirname, '..', '..', 'reports');
    if (fs.existsSync(REPORTS_DIR)) {
      const entries = fs.readdirSync(REPORTS_DIR);
      entries.forEach((e) => {
        const full = path.join(REPORTS_DIR, e);
        try {
          fs.rmSync(full, { recursive: true, force: true });
        } catch (err) {}
      });
    }
    console.log('[historyService] Purged all report history and output files.');
    return true;
  } catch (err) {
    console.error('[historyService] Error clearing all history:', err.message);
    return false;
  }
}

/**
 * Clean up older reports keeping only the latest N reports PER CLIENT.
 * Preserves multi-client isolation so that uploads for one client never
 * purge reports belonging to another client.
 */
function cleanupOldReports(maxKeep = 3) {
  try {
    const list = loadHistory();
    if (!Array.isArray(list) || list.length === 0) {
      return { removed: 0, kept: 0 };
    }

    // Group history by clientId
    const byClient = {};
    list.forEach(item => {
      const cid = item.clientId || 'unknown';
      if (!byClient[cid]) byClient[cid] = [];
      byClient[cid].push(item);
    });

    let removedCount = 0;
    Object.keys(byClient).forEach(cid => {
      const clientReports = byClient[cid].sort((a, b) => {
        const tb = parseSafeTimestamp(b.uploadTimestamp);
        const ta = parseSafeTimestamp(a.uploadTimestamp);
        if (tb !== null && ta !== null) return tb - ta;
        if (tb !== null) return 1;
        if (ta !== null) return -1;
        return 0;
      });
      if (clientReports.length > maxKeep) {
        const toRemove = clientReports.slice(maxKeep);
        for (const item of toRemove) {
          if (item && item.jobId) {
            try {
              deleteReport(item.jobId);
              removedCount++;
            } catch (err) {
              console.warn(`[cleanup] Failed to delete report for jobId ${item.jobId}:`, err.message);
            }
          }
        }
      }
    });

    const keptCount = list.length - removedCount;
    console.log(`[cleanup] Per-client cleanup complete. Removed: ${removedCount}, Kept: ${keptCount}`);
    return { removed: removedCount, kept: keptCount };
  } catch (err) {
    console.error('[historyService] Error in cleanupOldReports:', err.message);
    return { removed: 0, kept: 0 };
  }
}

/**
 * Strict Multi-Tenant Lookup: Searches an in-memory report list for matching client, quarter, and FY.
 */
function findPreviousQuarterReportFromList(list, clientId, targetQuarter, targetFiscalYear) {
  if (!Array.isArray(list) || !clientId || !targetQuarter || !targetFiscalYear) return null;

  // Strict tenant filtering: Tenant B can NEVER match Tenant A
  const candidates = list.filter((item) => {
    const isTenantMatch = item.clientId === clientId;
    const isQuarterMatch = item.quarter === targetQuarter && item.fiscal_year === targetFiscalYear;
    const isCompleted = item.status === 'completed';
    return isTenantMatch && isQuarterMatch && isCompleted;
  });

  if (candidates.length === 0) return null;

  // Reverse scan: most recent completed report
  return candidates[candidates.length - 1];
}

/**
 * Resolves the preceding quarter report dataset from disk for a given tenant.
 */
function findPreviousQuarterReport(clientId, currentQuarter, currentFiscalYear) {
  if (!clientId || !currentQuarter || !currentFiscalYear) return null;
  const preceding = qoqComparisonService.getPrecedingQuarter(currentQuarter, currentFiscalYear);
  if (!preceding) return null;

  const list = loadHistory();
  const matched = findPreviousQuarterReportFromList(list, clientId, preceding.quarter, preceding.fiscal_year);
  if (!matched) return null;

  if (matched.data) return matched.data;

  // If dashboardPath exists on disk, read and parse it
  if (matched.dashboardPath && fs.existsSync(matched.dashboardPath)) {
    try {
      const raw = fs.readFileSync(matched.dashboardPath, 'utf8');
      return JSON.parse(raw);
    } catch (e) {
      console.warn(`[historyService] Could not read prior dashboard json: ${e.message}`);
    }
  }

  return null;
}

module.exports = {
  getHistory,
  getReportByJobId,
  recordReport,
  cleanupTempFiles,
  deleteReport,
  clearAllHistory,
  cleanupOldReports,
  migrateLegacyQuarterMetadata,
  findPreviousQuarterReportFromList,
  findPreviousQuarterReport,
};

