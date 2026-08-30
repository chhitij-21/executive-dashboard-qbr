// backend/services/ruleEngine.js
// Loads business rules from YAML and provides all calculation helpers.
// ZERO ASSUMPTION policy: every function returns 'Data Not Available' when input is invalid.

const fs = require('fs');
const yaml = require('yaml');
const path = require('path');

let rules = {};

function getRulesPath(configFile = 'rules.yaml') {
  const safeFilename = path.basename(configFile || 'rules.yaml');
  return path.resolve(__dirname, '..', 'config', safeFilename);
}

function loadRules(configFile = 'rules.yaml') {
  try {
    const targetPath = getRulesPath(configFile);
    let filePath = targetPath;
    if (!fs.existsSync(targetPath)) {
      filePath = path.resolve(__dirname, '..', 'config', 'rules.yaml');
    }
    const file = fs.readFileSync(filePath, 'utf8');
    rules = yaml.parse(file);
    console.log(`[ruleEngine] Business rules loaded successfully from ${path.basename(filePath)}`);
    return rules;
  } catch (err) {
    console.error('[ruleEngine] Failed to load rules file:', err.message);
    rules = {};
    return rules;
  }
}

function getRulesYaml(configFile = 'rules.yaml') {
  try {
    const targetPath = getRulesPath(configFile);
    const filePath = fs.existsSync(targetPath) ? targetPath : path.resolve(__dirname, '..', 'config', 'rules.yaml');
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
    }
  } catch (err) {
    console.error('[ruleEngine] Error reading rules file:', err.message);
  }
  return '';
}

function saveRulesYaml(rawYaml, configFile = 'rules.yaml') {
  try {
    const parsed = yaml.parse(rawYaml);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid YAML format: Root content must be an object.');
    }
    const targetPath = getRulesPath(configFile);
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(targetPath, rawYaml, 'utf8');
    rules = parsed;
    console.log(`[ruleEngine] Business rules updated and saved to ${path.basename(targetPath)} successfully.`);
    return { success: true, rules: parsed, configFile: path.basename(targetPath) };
  } catch (err) {
    console.error('[ruleEngine] Error saving rules file:', err.message);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Health Score
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate health score: (uptime% × 0.6) + (incident_free% × 0.4)
 * Returns numeric string or 'Data Not Available'.
 */
function calculateHealthScore(uptimePercent, incidentFreePercent) {
  if (!isValidNumber(uptimePercent) || !isValidNumber(incidentFreePercent)) {
    return 'Data Not Available';
  }
  const weights = rules.health_score?.weights || { uptime: 0.6, incident_free: 0.4 };
  const score = (Number(uptimePercent) * weights.uptime) + (Number(incidentFreePercent) * weights.incident_free);
  return Number.isFinite(score) ? score.toFixed(2) : 'Data Not Available';
}

/**
 * Returns label: Excellent / Good / Fair / Poor based on thresholds.
 */
function getHealthLabel(score) {
  if (!isValidNumber(score)) return 'Data Not Available';
  const t = rules.health_score?.thresholds || { excellent: 95, good: 85, fair: 70 };
  const n = Number(score);
  if (n >= t.excellent) return 'Excellent';
  if (n >= t.good) return 'Good';
  if (n >= t.fair) return 'Fair';
  return 'Poor';
}

// ─────────────────────────────────────────────────────────────────────────────
// SLA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the correct SLA UPTIME target for the given reporting period.
 * FINDING-010 FIX: Period-aware — monthly uses 99.9%, quarterly uses 99.3%.
 * NOTE: This is the JFL Switch Uptime SLA — NOT the per-incident resolution SLA.
 * @param {string} [periodMode] - 'monthly' | 'quarterly' | undefined (default: quarterly)
 */
function getSLATarget(periodMode) {
  const monthly   = rules.sla?.monthly_uptime_target_percent ?? 99.3;
  const quarterly = rules.sla?.quarterly_uptime_target_percent ?? rules.sla?.uptime_target_percent ?? 99.3;
  return periodMode === 'monthly' ? monthly : quarterly;
}

/**
 * Returns the incident resolution SLA target in HOURS.
 * This is entirely separate from the JFL Switch Uptime SLA.
 * Source: rules.yaml → sla.resolution_threshold_hours (default: 2)
 *
 * Used to compute per-incident SLA status:
 *   resolution_time_hours <= target → "SLA Met"
 *   resolution_time_hours >  target → "SLA Breached"
 */
function getIncidentSLATargetHours() {
  return rules.sla?.resolution_threshold_hours ?? 2;
}

/**
 * Enrich each device with SLA fields.
 * N/A or blank uptime → treated as 100% (no incidents reported).
 * @param {Array} devicesArray
 * @param {string} [periodMode] - 'monthly' | 'quarterly'
 */
function applySLAThresholds(devicesArray, periodMode) {
  const target = getSLATarget(periodMode);
  return devicesArray.map((d) => {
    const raw = d['JFL Uptime %'];
    let effective;
    if (raw === null || raw === undefined || raw === '' ||
        String(raw).toUpperCase() === '#N/A' || String(raw).toUpperCase() === 'N/A') {
      effective = 100; // spec: no incidents → treat as 100%
    } else {
      const n = parseFloat(raw);
      effective = isNaN(n) ? 100 : Math.min(n, 100); // cap at 100%
    }
    const slaBreach = effective < target;
    return { ...d, __slaTarget: target, __slaBreach: slaBreach, __effectiveUptime: effective };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Severity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map device type string to severity label using rules.yaml mapping.
 */
function getDeviceSeverity(deviceType, isCoreDevice) {
  const mapping = rules.severity_device_mapping || { core: 'High', non_core: 'Medium', ap: 'Low' };
  if (isCoreDevice === true) return mapping.core || 'High';
  const t = String(deviceType || '').toLowerCase();
  if (/ap|access.?point|wireless/i.test(t)) return mapping.ap || 'Low';
  return mapping.non_core || 'Medium';
}

/**
 * Split an array of incident rows into { critical, major, minor, total }.
 * Uses incident_severity_values from rules.yaml for matching.
 */
function splitBySeverity(incidents) {
  const sevValues = rules.incident_severity_values || {
    critical: ['P1', 'Critical', 'High'],
    major: ['P2', 'Major', 'Medium'],
    minor: ['P3', 'Minor', 'Low'],
  };

  let critical = 0, major = 0, minor = 0;

  incidents.forEach((inc) => {
    const rawVal = inc.Severity ?? inc.Priority ?? inc.Impact ?? inc['P1/P2/P3'] ?? inc.severity ?? inc.priority ?? '';
    const raw = String(rawVal ?? '').trim();
    if (sevValues.critical.some((v) => v.toLowerCase() === raw.toLowerCase())) {
      critical++;
    } else if (sevValues.major.some((v) => v.toLowerCase() === raw.toLowerCase())) {
      major++;
    } else if (sevValues.minor.some((v) => v.toLowerCase() === raw.toLowerCase())) {
      minor++;
    } else {
      minor++; // unclassified → minor
    }
  });

  return { critical, major, minor, total: incidents.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// RCA Classification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a raw RCA string to one of the 6 standard categories.
 * Falls back to 'Unknown' if no match found.
 */
function mapRcaToCategory(rawRca) {
  if (!rawRca) return 'Unknown';
  const mapping = rules.rca_category_mapping || {};
  // Exact match first
  if (mapping[rawRca]) return mapping[rawRca];
  // Case-insensitive partial match
  const raw = String(rawRca).toLowerCase();
  for (const [key, val] of Object.entries(mapping)) {
    if (raw.includes(key.toLowerCase()) || key.toLowerCase().includes(raw)) return val;
  }
  return 'Unknown';
}

/**
 * Classify incidents by raw RCA column.
 * Returns array sorted by count DESC. Handles ties — all tied RCAs shown.
 * @param {Array} incidentRows
 * @param {boolean} useStandardCategories - if true, map raw → standard 6 categories
 */
function classifyRCA(incidentRows, useStandardCategories = false) {
  if (!incidentRows || incidentRows.length === 0) return [];

  const rcaCol = detectRCAColumn(incidentRows);
  const counts = {};

  incidentRows.forEach((inc) => {
    let rca = rcaCol ? (inc[rcaCol] ?? 'Unknown') : 'Unknown';
    if (useStandardCategories) rca = mapRcaToCategory(rca);
    counts[rca] = (counts[rca] || 0) + 1;
  });

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const topCount = sorted[0]?.[1] ?? 0;
  const topRcas = sorted.filter(([, c]) => c === topCount);

  return sorted.map(([rca, count]) => ({
    rca,
    count,
    percentage: ((count / incidentRows.length) * 100).toFixed(1) + '%',
    isTop: count === topCount,
    tied: topRcas.length > 1 && count === topCount,
  }));
}

/**
 * Produce RCA breakdown mapped to the 6 standard categories.
 * Categories with 0 incidents are still included (with count=0).
 */
function buildStandardRCABreakdown(incidentRows) {
  const standardCategories = rules.rca_standard_categories || [
    'Device Power Issues', 'ISP Issues', 'Client Side Issues',
    'Hardware Failure', 'Configuration Issues', 'Unknown',
  ];

  const rawBreakdown = classifyRCA(incidentRows, true);
  const countMap = {};
  rawBreakdown.forEach((r) => {
    countMap[r.rca] = (countMap[r.rca] || 0) + r.count;
  });

  const total = incidentRows.length;
  return standardCategories.map((cat) => {
    const count = countMap[cat] || 0;
    return {
      category: cat,
      count,
      percentage: total > 0 ? ((count / total) * 100).toFixed(1) + '%' : '0.0%',
    };
  });
}

function detectRCAColumn(rows) {
  if (!rows || rows.length === 0) return null;
  const candidates = ['RCA', 'Root Cause', 'Root Cause Analysis', 'Reason', 'Cause', 'rca'];
  const sample = rows[0];
  for (const c of candidates) { if (c in sample) return c; }
  const keys = Object.keys(sample);
  return keys.find((k) => /rca|root.?cause|reason|cause/i.test(k)) || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// AP Unique Incident Counting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Count unique APs that have at least 1 incident.
 * Spec: "if 10 incidents from 4 APs, count = 4 unique APs"
 * @param {Array} incidents
 * @param {Array} devices - to filter only AP-type devices
 * @returns {{ uniqueAPsWithIncidents: number, apIncidentMap: Object }}
 */
function countUniqueAPsWithIncidents(incidents, devices) {
  const typeKey = detectColumnFromRows(devices, ['Type', 'DeviceType', 'Device Type']);
  const apDeviceIds = new Set(
    devices
      .filter((d) => typeKey && /ap|access.?point|wireless/i.test(String(d[typeKey] || '')))
      .map((d) => String(d.DeviceID))
  );

  const apIncidentMap = {}; // DeviceID → incident count
  incidents.forEach((inc) => {
    const devId = String(inc.DeviceID || '');
    if (apDeviceIds.has(devId)) {
      apIncidentMap[devId] = (apIncidentMap[devId] || 0) + 1;
    }
  });

  return {
    uniqueAPsWithIncidents: Object.keys(apIncidentMap).length,
    apIncidentMap,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────────────────────────────────────

function isValidNumber(v) {
  if (v === null || v === undefined || v === '' || v === 'Data Not Available') return false;
  return !isNaN(Number(v));
}

function detectColumnFromRows(rows, candidates) {
  if (!rows || rows.length === 0) return null;
  const sample = rows[0];
  for (const c of candidates) { if (c in sample) return c; }
  const keys = Object.keys(sample);
  for (const c of candidates) {
    const found = keys.find((k) => k.toLowerCase() === c.toLowerCase());
    if (found) return found;
  }
  return null;
}

module.exports = {
  loadRules,
  getRules: () => rules,
  getRulesYaml,
  saveRulesYaml,
  // Health
  calculateHealthScore,
  getHealthLabel,
  // SLA — TWO DISTINCT METRICS:
  getSLATarget,             // JFL Switch Uptime SLA (% target, period-aware)
  getIncidentSLATargetHours, // Incident Resolution SLA (hours TAT target)
  applySLAThresholds,
  // Severity
  getDeviceSeverity,
  splitBySeverity,
  // RCA
  classifyRCA,
  mapRcaToCategory,
  buildStandardRCABreakdown,
  // AP
  countUniqueAPsWithIncidents,
  // Utils
  isValidNumber,
  detectColumnFromRows,
};
