// backend/services/validators/predictiveForecast.js
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

function safeNum(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = typeof val === 'number' ? val : parseFloat(String(val));
  return Number.isFinite(n) ? n : null;
}

function forecastSLARisk(qbrData) {
  try {
    if (!qbrData || typeof qbrData !== 'object') {
      return {
        success: false,
        siteForecasts: [],
        globalForecast: {
          siteId: 'ALL',
          historicalPoints: [],
          slope: 0,
          intercept: 0,
          forecastUptime: null,
          forecastBreach: null,
          confidence: 'INSUFFICIENT',
          trend: 'STABLE',
          recommendation: 'Site is stable. Continue standard monitoring.',
        },
        error: 'INVALID_INPUT: qbrData must be an object',
      };
    }

    deepFreeze(qbrData);

    const slaAnalytics = qbrData.slaAnalytics || {};
    const slaTarget = safeNum(slaAnalytics.slaTarget) ?? safeNum(qbrData?.executiveSummary?.slaTarget) ?? 99.3;
    const siteSummary = Array.isArray(qbrData.siteSummary) ? qbrData.siteSummary : [];
    const monthlySLATrend = Array.isArray(slaAnalytics.monthlySLATrend) ? slaAnalytics.monthlySLATrend : [];

    const buildInsufficientForecast = (siteId) => ({
      siteId,
      historicalPoints: [],
      slope: 0,
      intercept: 0,
      forecastUptime: null,
      forecastBreach: null,
      confidence: 'INSUFFICIENT',
      trend: 'STABLE',
      recommendation: 'Site is stable. Continue standard monitoring.',
    });

    if (monthlySLATrend.length === 0) {
      const siteForecasts = siteSummary.map(s => buildInsufficientForecast(s.siteId || 'Unknown'));
      return {
        success: true,
        siteForecasts,
        globalForecast: buildInsufficientForecast('ALL'),
        error: null,
      };
    }

    const runOLS = (siteId, points) => {
      const n = points.length;
      if (n < 3) {
        return buildInsufficientForecast(siteId);
      }

      let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
      for (let i = 0; i < n; i++) {
        const x = i + 1;
        const y = points[i];
        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumXX += x * x;
      }

      const denom = (n * sumXX) - (sumX * sumX);
      if (denom === 0) {
        return buildInsufficientForecast(siteId);
      }

      const rawSlope = ((n * sumXY) - (sumX * sumY)) / denom;
      const rawIntercept = (sumY - (rawSlope * sumX)) / n;

      if (!Number.isFinite(rawSlope) || !Number.isFinite(rawIntercept)) {
        return buildInsufficientForecast(siteId);
      }

      const slope = parseFloat(rawSlope.toFixed(2));
      const intercept = parseFloat(rawIntercept.toFixed(2));

      // Step 4: forecastUptime = slope * n + intercept
      const rawForecast = (slope * n) + intercept;
      const clampedForecast = Math.max(0, Math.min(100, rawForecast));
      const forecastUptime = parseFloat(clampedForecast.toFixed(2));

      const forecastBreach = forecastUptime < slaTarget;

      let confidence = 'INSUFFICIENT';
      if (n >= 6) confidence = 'HIGH';
      else if (n >= 4) confidence = 'MEDIUM';
      else if (n >= 3) confidence = 'LOW';

      let trend = 'STABLE';
      if (slope < -0.05) trend = 'DEGRADING';
      else if (slope > 0.05) trend = 'IMPROVING';

      let recommendation = 'Site is stable. Continue standard monitoring.';
      if (forecastBreach) {
        recommendation = `Projected uptime ${forecastUptime.toFixed(2)}% is below SLA target ${slaTarget}%. Immediate remediation required.`;
      } else if (trend === 'DEGRADING') {
        recommendation = `Uptime trending down by ${Math.abs(slope).toFixed(2)}%/period. Monitor closely.`;
      }

      return {
        siteId,
        historicalPoints: points,
        slope,
        intercept,
        forecastUptime,
        forecastBreach,
        confidence,
        trend,
        recommendation,
      };
    };

    // Global trend points
    const globalPoints = monthlySLATrend
      .map(pt => safeNum(pt.overallSLAPercent ?? pt.slaPercent ?? pt.uptime))
      .filter(v => v !== null);

    const globalForecast = runOLS('ALL', globalPoints);

    // Site-level trend points
    const siteForecasts = siteSummary.map(site => {
      const siteId = site.siteId || 'Unknown';
      const sitePoints = monthlySLATrend
        .map(pt => {
          if (pt.siteSLA && typeof pt.siteSLA === 'object') {
            return safeNum(pt.siteSLA[siteId]);
          }
          return null;
        })
        .filter(v => v !== null);

      if (sitePoints.length >= 3) {
        return runOLS(siteId, sitePoints);
      } else {
        const currentUptime = safeNum(site.overallUptime ?? site.jflSwitchUptime) ?? 100;
        return runOLS(siteId, [currentUptime, currentUptime, currentUptime]);
      }
    });

    return {
      success: true,
      siteForecasts,
      globalForecast,
      error: null,
    };
  } catch (err) {
    return {
      success: false,
      siteForecasts: [],
      globalForecast: {
        siteId: 'ALL',
        historicalPoints: [],
        slope: 0,
        intercept: 0,
        forecastUptime: null,
        forecastBreach: null,
        confidence: 'INSUFFICIENT',
        trend: 'STABLE',
        recommendation: 'Site is stable. Continue standard monitoring.',
      },
      error: err?.message || 'UNKNOWN_ERROR',
    };
  }
}

module.exports = { forecastSLARisk };
