// backend/services/qoqComparisonService.js
// Single Source of Truth for Quarter-over-Quarter (QoQ) Analytics
'use strict';

const { normalizeSiteName } = require('./excelParser');

/**
 * Normalizes an RCA category string to prevent casing and whitespace fragmentation.
 * E.g., "Power", "power", "Power " -> "power"
 */
function normalizeRcaCategory(cat) {
  if (!cat) return 'unspecified';
  return String(cat).trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Capitalizes a normalized string to Title Case for executive presentation.
 */
function toTitleCase(str) {
  if (!str) return 'Unspecified';
  return str
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Calculates the exact preceding quarter tuple in Indian Fiscal Year notation.
 * E.g., Q1 FY2026 -> Q4 FY2025; Q2 FY2026 -> Q1 FY2026
 */
function getPrecedingQuarter(quarter, fiscalYear) {
  if (!quarter || !fiscalYear) return null;
  const qUpper = String(quarter).toUpperCase().trim();
  const fyMatch = String(fiscalYear).match(/\d{4}/);
  if (!fyMatch) return null;
  const year = parseInt(fyMatch[0], 10);

  switch (qUpper) {
    case 'Q1':
      return { quarter: 'Q4', fiscal_year: `FY${year - 1}` };
    case 'Q2':
      return { quarter: 'Q1', fiscal_year: `FY${year}` };
    case 'Q3':
      return { quarter: 'Q2', fiscal_year: `FY${year}` };
    case 'Q4':
      return { quarter: 'Q3', fiscal_year: `FY${year}` };
    default:
      return null;
  }
}

/**
 * Calculates safe RCA delta percentage with division-by-zero protection.
 */
function calculateRcaDelta(currentCount, priorCount) {
  const curr = Number(currentCount) || 0;
  const prior = Number(priorCount) || 0;
  const delta = curr - prior;

  if (prior === 0 && curr > 0) {
    return {
      delta,
      pctChange: 100.0,
      changeLabel: 'New Occurrence (+100%)',
      isNewOccurrence: true,
      direction: 'degraded',
    };
  }

  if (prior > 0 && curr === 0) {
    return {
      delta,
      pctChange: -100.0,
      changeLabel: 'Resolved (-100%)',
      isNewOccurrence: false,
      direction: 'improved',
    };
  }

  if (prior === 0 && curr === 0) {
    return {
      delta: 0,
      pctChange: 0.0,
      changeLabel: 'Unchanged (0%)',
      isNewOccurrence: false,
      direction: 'unchanged',
    };
  }

  const pct = Number((((curr - prior) / prior) * 100).toFixed(2));
  let direction = 'unchanged';
  if (delta < 0) direction = 'improved'; // fewer incidents is better
  if (delta > 0) direction = 'degraded';

  const sign = pct > 0 ? '+' : '';
  return {
    delta,
    pctChange: pct,
    changeLabel: `${sign}${pct}%`,
    isNewOccurrence: false,
    direction,
  };
}

/**
 * Calculates normalized RCA category shifts between quarters.
 */
function calculateRcaShifts(currentRca = [], priorRca = []) {
  const categoryMap = new Map();

  // Aggregate prior counts by normalized key
  (Array.isArray(priorRca) ? priorRca : []).forEach(item => {
    const rawCat = item.category || item.RCA || item.name || 'Unspecified';
    const norm = normalizeRcaCategory(rawCat);
    const count = Number(item.count || item.tickets || item.value || 0);
    const existing = categoryMap.get(norm) || { display: rawCat.trim(), priorCount: 0, currentCount: 0 };
    existing.priorCount += count;
    categoryMap.set(norm, existing);
  });

  // Aggregate current counts by normalized key
  (Array.isArray(currentRca) ? currentRca : []).forEach(item => {
    const rawCat = item.category || item.RCA || item.name || 'Unspecified';
    const norm = normalizeRcaCategory(rawCat);
    const count = Number(item.count || item.tickets || item.value || 0);
    const existing = categoryMap.get(norm) || { display: rawCat.trim(), priorCount: 0, currentCount: 0 };
    existing.currentCount += count;
    existing.display = rawCat.trim(); // prefer current capitalization
    categoryMap.set(norm, existing);
  });

  const shifts = [];
  for (const [normKey, data] of categoryMap.entries()) {
    const { delta, pctChange, changeLabel, isNewOccurrence, direction } = calculateRcaDelta(
      data.currentCount,
      data.priorCount
    );

    shifts.push({
      category: toTitleCase(data.display),
      normalizedCategory: normKey,
      priorCount: data.priorCount,
      currentCount: data.currentCount,
      delta,
      pctChange,
      changeLabel,
      isNewOccurrence,
      direction,
    });
  }

  // Sort by highest absolute change or highest current volume
  shifts.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return shifts;
}

/**
 * Calculates per-site QoQ differences and generates executive narratives.
 */
function calculateSiteComparisons(currentSites = [], priorSites = []) {
  const result = {};
  const priorMap = new Map();

  (Array.isArray(priorSites) ? priorSites : []).forEach(site => {
    const key = site.siteId || site.Location || site.name;
    if (key) {
      priorMap.set(normalizeSiteName(key), site);
    }
  });

  (Array.isArray(currentSites) ? currentSites : []).forEach(site => {
    const siteId = site.siteId || site.Location || site.name;
    if (!siteId) return;

    const normKey = normalizeSiteName(siteId);
    const prior = priorMap.get(normKey);

    const currUptime = Number(site.jflUptime ?? site.overallUptime ?? site.uptime ?? 100);
    const currIncidents = Number(site.incidentCount ?? site.incidents ?? 0);
    const currSla = Number(site.slaCompliancePercent ?? (site.slaStatus === 'SLA Met' ? 100 : 95));

    if (!prior) {
      result[siteId] = {
        siteId,
        isNewSite: true,
        uptimeDelta: 0.0,
        incidentDelta: 0,
        slaDelta: 0.0,
        status: 'stable',
        narrative: 'New site added this quarter (no prior baseline).',
      };
      return;
    }

    const priorUptime = Number(prior.jflUptime ?? prior.overallUptime ?? prior.uptime ?? 100);
    const priorIncidents = Number(prior.incidentCount ?? prior.incidents ?? 0);
    const priorSla = Number(prior.slaCompliancePercent ?? (prior.slaStatus === 'SLA Met' ? 100 : 95));

    const uptimeDelta = Number((currUptime - priorUptime).toFixed(2));
    const incidentDelta = currIncidents - priorIncidents;
    const slaDelta = Number((currSla - priorSla).toFixed(2));

    let status = 'stable';
    if (uptimeDelta > 0.05 || incidentDelta < 0 || slaDelta > 0) status = 'improved';
    if (uptimeDelta < -0.05 || incidentDelta > 0 || slaDelta < 0) status = 'degraded';

    // Formulate concise executive narrative
    let narrative = 'Operational performance remained stable vs last quarter.';
    if (slaDelta < 0) {
      narrative = `This site's SLA dropped ${Math.abs(slaDelta)}% vs last quarter.`;
    } else if (slaDelta > 0 && incidentDelta <= 0) {
      narrative = `This site's SLA improved by +${slaDelta}% vs last quarter.`;
    } else if (uptimeDelta > 0 && incidentDelta < 0) {
      narrative = `Uptime increased by +${uptimeDelta}% with ${Math.abs(incidentDelta)} fewer incidents vs last quarter.`;
    } else if (incidentDelta > 0) {
      narrative = `Incidents increased by +${incidentDelta} vs last quarter.`;
    } else if (uptimeDelta > 0) {
      narrative = `Uptime increased by +${uptimeDelta}% vs last quarter.`;
    } else if (uptimeDelta < 0) {
      narrative = `Uptime dropped by ${uptimeDelta}% vs last quarter.`;
    }

    result[siteId] = {
      siteId,
      isNewSite: false,
      priorUptime,
      currentUptime: currUptime,
      uptimeDelta,
      priorIncidents,
      currentIncidents: currIncidents,
      incidentDelta,
      priorSla,
      currentSla: currSla,
      slaDelta,
      status,
      narrative,
    };
  });

  return result;
}

/**
 * Generates mini 2-point coordinate series for sparkline visualization.
 */
function generateSparklineSeries(metricKey, priorVal, currentVal, priorPeriod, currentPeriod) {
  const pVal = typeof priorVal === 'string' ? parseFloat(priorVal) || 0 : Number(priorVal || 0);
  const cVal = typeof currentVal === 'string' ? parseFloat(currentVal) || 0 : Number(currentVal || 0);

  return [
    { period: priorPeriod || 'Prior Qtr', value: Number(pVal.toFixed(2)) },
    { period: currentPeriod || 'Current Qtr', value: Number(cVal.toFixed(2)) },
  ];
}

/**
 * Compares two QBR data models and generates complete comparative analytics.
 */
function compareQoQ(currentQbrData, priorQbrData) {
  if (!currentQbrData) return null;

  const currentPeriod = currentQbrData.report_period || {};
  const priorPeriod = priorQbrData?.report_period || {};

  // Standard Quarter Validation Guard
  if (currentPeriod.is_standard_quarter === false) {
    return {
      is_standard_quarter: false,
      has_prior_quarter: false,
      qoq_disabled_reason: 'QoQ comparison is only available for standard quarterly periods.',
      kpis: null,
      siteComparisons: {},
      rcaShifts: [],
    };
  }

  if (!priorQbrData) {
    return {
      is_standard_quarter: true,
      has_prior_quarter: false,
      qoq_disabled_reason: 'No previous quarterly data available (Initial QBR).',
      kpis: null,
      siteComparisons: {},
      rcaShifts: [],
    };
  }

  const currExec = currentQbrData.executiveSummary || {};
  const priorExec = priorQbrData.executiveSummary || {};

  const currPeriodLabel = currentPeriod.quarter && currentPeriod.fiscal_year
    ? `${currentPeriod.quarter} ${currentPeriod.fiscal_year}`
    : currentPeriod.display_label || 'Current Quarter';

  const priorPeriodLabel = priorPeriod.quarter && priorPeriod.fiscal_year
    ? `${priorPeriod.quarter} ${priorPeriod.fiscal_year}`
    : priorPeriod.display_label || 'Prior Quarter';

  // Helper for KPI comparison
  function buildKpiDelta(currVal, priorVal, isHigherBetter = true) {
    const c = typeof currVal === 'string' ? parseFloat(currVal) || 0 : Number(currVal || 0);
    const p = typeof priorVal === 'string' ? parseFloat(priorVal) || 0 : Number(priorVal || 0);
    const delta = Number((c - p).toFixed(2));
    let direction = 'unchanged';
    if (delta > 0) direction = isHigherBetter ? 'improved' : 'degraded';
    if (delta < 0) direction = isHigherBetter ? 'degraded' : 'improved';
    const sign = delta > 0 ? '+' : '';
    return {
      current: c,
      prior: p,
      delta,
      direction,
      formattedDelta: `${sign}${delta}`,
      sparkline: generateSparklineSeries('kpi', p, c, priorPeriodLabel, currPeriodLabel),
    };
  }

  const kpis = {
    overallUptime: buildKpiDelta(currExec.overallUptime ?? 100, priorExec.overallUptime ?? 100, true),
    jflUptime: buildKpiDelta(currExec.jflUptime ?? 100, priorExec.jflUptime ?? 100, true),
    proactiveUptime: buildKpiDelta(currExec.proactiveUptime ?? 100, priorExec.proactiveUptime ?? 100, true),
    totalIncidents: buildKpiDelta(currExec.totalIncidents ?? 0, priorExec.totalIncidents ?? 0, false), // lower is better
    slaCompliance: buildKpiDelta(
      currExec.incidentFreeSitesPercent ?? currExec.slaCompliancePercent ?? 100,
      priorExec.incidentFreeSitesPercent ?? priorExec.slaCompliancePercent ?? 100,
      true
    ),
    healthScore: buildKpiDelta(currExec.healthScore ?? 100, priorExec.healthScore ?? 100, true),
  };

  const rcaShifts = calculateRcaShifts(
    currentQbrData.rcaBreakdown || [],
    priorQbrData.rcaBreakdown || []
  );

  const siteComparisons = calculateSiteComparisons(
    currentQbrData.siteSummary || [],
    priorQbrData.siteSummary || []
  );

  return {
    is_standard_quarter: true,
    has_prior_quarter: true,
    qoq_disabled_reason: null,
    currentPeriod: currPeriodLabel,
    priorPeriod: priorPeriodLabel,
    kpis,
    rcaShifts,
    siteComparisons,
  };
}

/**
 * Performance Guard: Resolves QoQ or skips computation if has_prior_quarter is false.
 */
function resolveOrSkipQoQ(qbrData, priorQbrData) {
  if (!qbrData) return null;
  if (qbrData.report_period?.is_standard_quarter === false) return null;
  if (!priorQbrData && qbrData.has_prior_quarter === false) return null;
  return compareQoQ(qbrData, priorQbrData);
}

module.exports = {
  normalizeRcaCategory,
  toTitleCase,
  getPrecedingQuarter,
  calculateRcaDelta,
  calculateRcaShifts,
  calculateSiteComparisons,
  generateSparklineSeries,
  compareQoQ,
  resolveOrSkipQoQ,
};
