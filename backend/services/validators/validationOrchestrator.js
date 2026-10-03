// backend/services/validators/validationOrchestrator.js
const { detectAnomalies } = require('./anomalyDetector');
const { crossValidate } = require('./crossValidationEngine');
const { buildLineage } = require('./lineageTracker');
const { forecastSLARisk } = require('./predictiveForecast');
const { findCorrelations } = require('./correlationEngine');

function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Object.isFrozen(obj)) return obj;
  Object.freeze(obj);
  Object.getOwnPropertyNames(obj).forEach(prop => {
    const val = obj[prop];
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  });
  return obj;
}

async function runValidation(qbrData, options = {}) {
  const startTime = Date.now();
  const ranAt = new Date().toISOString();

  try {
    if (!qbrData || typeof qbrData !== 'object') {
      return {
        success: false,
        ranAt,
        durationMs: Date.now() - startTime,
        results: {
          anomalies: { success: false, anomalies: [], summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0 }, error: 'INVALID_INPUT' },
          crossValidation: { success: false, passed: [], failed: [], summary: { total: 0, passedCount: 0, failedCount: 0 }, error: 'INVALID_INPUT' },
          lineage: { success: false, lineage: { devices: {}, sites: {}, metrics: {} }, summary: { totalEntries: 0, coverage: '0.00%', orphans: [] }, error: 'INVALID_INPUT' },
          forecast: { success: false, siteForecasts: [], globalForecast: { siteId: 'ALL', historicalPoints: [], slope: 0, intercept: 0, forecastUptime: null, forecastBreach: null, confidence: 'INSUFFICIENT', trend: 'STABLE', recommendation: '' }, error: 'INVALID_INPUT' },
          correlation: { success: false, correlations: [], summary: { total: 0, byType: {} }, error: 'INVALID_INPUT' },
        },
        overallHealth: 'FAIL',
        error: 'INVALID_INPUT: qbrData must be an object',
      };
    }

    deepFreeze(qbrData);

    let anomaliesRes;
    try {
      anomaliesRes = detectAnomalies(qbrData, options);
    } catch (e) {
      anomaliesRes = { success: false, anomalies: [], summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0 }, error: e?.message || 'MODULE_EXECUTION_ERROR' };
    }

    let crossValidationRes;
    try {
      crossValidationRes = crossValidate(qbrData);
    } catch (e) {
      crossValidationRes = { success: false, passed: [], failed: [], summary: { total: 0, passedCount: 0, failedCount: 0 }, error: e?.message || 'MODULE_EXECUTION_ERROR' };
    }

    let lineageRes;
    try {
      lineageRes = buildLineage(qbrData);
    } catch (e) {
      lineageRes = { success: false, lineage: { devices: {}, sites: {}, metrics: {} }, summary: { totalEntries: 0, coverage: '0.00%', orphans: [] }, error: e?.message || 'MODULE_EXECUTION_ERROR' };
    }

    let forecastRes;
    try {
      forecastRes = forecastSLARisk(qbrData);
    } catch (e) {
      forecastRes = { success: false, siteForecasts: [], globalForecast: { siteId: 'ALL', historicalPoints: [], slope: 0, intercept: 0, forecastUptime: null, forecastBreach: null, confidence: 'INSUFFICIENT', trend: 'STABLE', recommendation: '' }, error: e?.message || 'MODULE_EXECUTION_ERROR' };
    }

    let correlationRes;
    try {
      correlationRes = findCorrelations(qbrData, options);
    } catch (e) {
      correlationRes = { success: false, correlations: [], summary: { total: 0, byType: {} }, error: e?.message || 'MODULE_EXECUTION_ERROR' };
    }

    // Determine overallHealth:
    // FAIL if any CRITICAL anomaly OR any FAIL cross-check with severity CRITICAL
    // WARN if any HIGH anomaly OR any forecastBreach === true
    // PASS otherwise
    let overallHealth = 'PASS';

    const hasCriticalAnomaly = Array.isArray(anomaliesRes.anomalies) && anomaliesRes.anomalies.some(a => a.severity === 'CRITICAL');
    const hasCriticalCrossFail = Array.isArray(crossValidationRes.failed) && crossValidationRes.failed.some(c => c.severity === 'CRITICAL');

    if (hasCriticalAnomaly || hasCriticalCrossFail) {
      overallHealth = 'FAIL';
    } else {
      const hasHighAnomaly = Array.isArray(anomaliesRes.anomalies) && anomaliesRes.anomalies.some(a => a.severity === 'HIGH');
      const hasForecastBreach = (forecastRes.globalForecast && forecastRes.globalForecast.forecastBreach === true) ||
        (Array.isArray(forecastRes.siteForecasts) && forecastRes.siteForecasts.some(f => f.forecastBreach === true));

      if (hasHighAnomaly || hasForecastBreach) {
        overallHealth = 'WARN';
      }
    }

    const durationMs = Date.now() - startTime;

    return {
      success: true,
      ranAt,
      durationMs,
      results: {
        anomalies: anomaliesRes,
        crossValidation: crossValidationRes,
        lineage: lineageRes,
        forecast: forecastRes,
        correlation: correlationRes,
      },
      overallHealth,
      error: null,
    };
  } catch (err) {
    return {
      success: false,
      ranAt,
      durationMs: Date.now() - startTime,
      results: {
        anomalies: { success: false, anomalies: [], summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0 }, error: 'ORCHESTRATOR_ERROR' },
        crossValidation: { success: false, passed: [], failed: [], summary: { total: 0, passedCount: 0, failedCount: 0 }, error: 'ORCHESTRATOR_ERROR' },
        lineage: { success: false, lineage: { devices: {}, sites: {}, metrics: {} }, summary: { totalEntries: 0, coverage: '0.00%', orphans: [] }, error: 'ORCHESTRATOR_ERROR' },
        forecast: { success: false, siteForecasts: [], globalForecast: { siteId: 'ALL', historicalPoints: [], slope: 0, intercept: 0, forecastUptime: null, forecastBreach: null, confidence: 'INSUFFICIENT', trend: 'STABLE', recommendation: '' }, error: 'ORCHESTRATOR_ERROR' },
        correlation: { success: false, correlations: [], summary: { total: 0, byType: {} }, error: 'ORCHESTRATOR_ERROR' },
      },
      overallHealth: 'FAIL',
      error: err?.message || 'UNKNOWN_ERROR',
    };
  }
}

module.exports = { runValidation };
