// backend/services/historyService.js
// Stores and retrieves report metadata history.
// PRIVACY RULE: Uploaded Excel data is NEVER retained permanently.
// Only metadata (Client, Location, Period, Timestamp, User, Status, Dashboard Path, PPT Path) is saved.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const METADATA_FILE = path.join(DATA_DIR, 'reports_metadata.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
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
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('[historyService] Error loading metadata history:', err.message);
    return [];
  }
}

function saveHistory(history) {
  ensureDataDir();
  fs.writeFileSync(METADATA_FILE, JSON.stringify(history, null, 2), 'utf8');
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

  // Sort descending by timestamp
  return list.sort((a, b) => new Date(b.uploadTimestamp) - new Date(a.uploadTimestamp));
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
    uploadTimestamp: metadata.uploadTimestamp || new Date().toISOString(),
    uploadedBy: metadata.uploadedBy || 'System User',
    reportVersion: metadata.reportVersion || '1.0',
    status: metadata.status || 'processing',
    dashboardPath: metadata.dashboardPath || null,
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

module.exports = {
  getHistory,
  getReportByJobId,
  recordReport,
  cleanupTempFiles,
};
