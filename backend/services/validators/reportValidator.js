// backend/services/validators/reportValidator.js
// Additive-only. No existing files modified.
// Orchestrates rollover detection, service request filtering, duration breakdown,
// data consistency checks, and anomaly detection.
// Reads ONLY from the allowed qbrData model fields. Never recalculates uptime metrics.
// Node built-ins only (no npm packages).

'use strict';

const { detectRollovers }       = require('./rolloverHandler');
const { filterUptimeIncidents } = require('./serviceRequestFilter');
const { breakdownDuration }     = require('./durationBreakdown');

// ─── Deep-Freeze (no npm "deep-freeze" package) ────────────────────────────

/**
 * Recursively freeze an object so qbrData cannot be mutated by any validator.
 * Returns the frozen object. Safe on primitives and null.
 * @param {*} obj
 * @returns {*}
 */
function deepFreeze(obj) {
  try {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Object.isFrozen(obj)) return obj;
    Object.getOwnPropertyNames(obj).forEach((key) => {
      try { deepFreeze(obj[key]); } catch (_) {}
    });
    Object.freeze(obj);
    return obj;
  } catch (_) {
    return obj;
  }
}

// ─── Severity ranking (for topIssues sort) ─────────────────────────────────
const SEVERITY_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };

function severityOrder(s) {
  return SEVERITY_RANK[String(s).toUpperCase()] !== undefined
    ? SEVERITY_RANK[String(s).toUpperCase()]
    : 99;
}

// ─── Data Consistency Checks ───────────────────────────────────────────────

/**
 * Run consistency checks against the allowed SSOT fields.
 * Reads: devices[].{__jflUptime, __proactiveUptime}
 *        siteSummary[].{deviceCount}
 *        executiveSummary.{totalDevices}
 * Never recalculates uptime values — only validates their range.
 *
 * @param {object} qbrData (frozen)
 * @returns {{ checks: Array<{ name: string, ok: boolean, detail: string }> }}
 */
function runDataConsistency(qbrData) {
  const checks = [];

  try {
    // Check 1: sum of siteSummary[].deviceCount === executiveSummary.totalDevices
    try {
      const sites      = Array.isArray(qbrData.siteSummary) ? qbrData.siteSummary : [];
      const execTotal  = typeof qbrData.executiveSummary === 'object' && qbrData.executiveSummary !== null
        ? Number(qbrData.executiveSummary.totalDevices)
        : NaN;
      const siteSum    = sites.reduce((acc, s) => {
        const cnt = s && typeof s === 'object' ? Number(s.deviceCount) : 0;
        return acc + (Number.isFinite(cnt) ? cnt : 0);
      }, 0);
      const ok = Number.isFinite(execTotal) && siteSum === execTotal;
      checks.push({
        name:   'device_count',
        ok,
        detail: ok
          ? `Site device sum (${siteSum}) matches executiveSummary.totalDevices (${execTotal})`
          : `MISMATCH — site device sum: ${siteSum}, executiveSummary.totalDevices: ${execTotal}`,
      });
    } catch (e) {
      checks.push({ name: 'device_count', ok: false, detail: `ERROR: ${e && e.message ? e.message : String(e)}` });
    }

    // Check 2: every device has 0 ≤ __jflUptime ≤ 100 AND 0 ≤ __proactiveUptime ≤ 100
    // Fields: devices[].{__jflUptime, __proactiveUptime}
    try {
      const devices = Array.isArray(qbrData.devices) ? qbrData.devices : [];
      const violations = [];

      for (let i = 0; i < devices.length; i++) {
        const d = devices[i];
        if (!d || typeof d !== 'object') continue;
        if (d.__isStock === true) continue; // stock devices excluded from SLA

        const jfl       = Number(d.__jflUptime);
        const proactive = Number(d.__proactiveUptime);
        const deviceId  = d.DeviceID != null ? String(d.DeviceID) : `idx_${i}`;

        const jflOk  = Number.isFinite(jfl)  && jfl  >= 0 && jfl  <= 100;
        const proaOk = Number.isFinite(proactive) && proactive >= 0 && proactive <= 100;

        if (!jflOk || !proaOk) {
          violations.push(`Device ${deviceId}: __jflUptime=${jfl}, __proactiveUptime=${proactive}`);
        }
      }

      const ok = violations.length === 0;
      checks.push({
        name:   'uptime_range',
        ok,
        detail: ok
          ? `All ${devices.filter(d => d && !d.__isStock).length} active devices have uptime in [0, 100]`
          : `${violations.length} device(s) outside [0, 100] range: ${violations.slice(0, 5).join('; ')}${violations.length > 5 ? ` (+${violations.length - 5} more)` : ''}`,
      });
    } catch (e) {
      checks.push({ name: 'uptime_range', ok: false, detail: `ERROR: ${e && e.message ? e.message : String(e)}` });
    }
  } catch (outer) {
    checks.push({ name: 'consistency_fatal', ok: false, detail: `FATAL: ${outer && outer.message ? outer.message : String(outer)}` });
  }

  return { checks };
}

// ─── Inline Anomaly Detection ──────────────────────────────────────────────

/**
 * Detect inline anomalies from the qbrData model.
 * Reads: devices[].{DeviceID, SiteID, __jflUptime, __proactiveUptime, __isStock}
 *        siteSummary[].{siteId, jflSwitchUptime, healthScore}
 *        executiveSummary.{slaTarget}
 * Never recalculates values — only flags outliers in the pre-computed data.
 *
 * @param {object} qbrData (frozen)
 * @returns {{ anomalies: Array<{ severity: string, entity: object, message: string, recommendation: string }> }}
 */
function detectAnomalies(qbrData) {
  const anomalies = [];

  try {
    const devices = Array.isArray(qbrData.devices) ? qbrData.devices : [];
    const sites   = Array.isArray(qbrData.siteSummary) ? qbrData.siteSummary : [];
    const slaTarget = (
      qbrData.executiveSummary &&
      typeof qbrData.executiveSummary === 'object' &&
      Number.isFinite(Number(qbrData.executiveSummary.slaTarget))
    ) ? Number(qbrData.executiveSummary.slaTarget) : 99.3;

    // ── Device-level anomalies ─────────────────────────────────────────────
    for (let i = 0; i < devices.length; i++) {
      try {
        const d = devices[i];
        if (!d || typeof d !== 'object') continue;
        if (d.__isStock === true) continue;

        // Fields: DeviceID, SiteID, __jflUptime, __proactiveUptime
        const deviceId  = d.DeviceID  != null ? String(d.DeviceID)  : `idx_${i}`;
        const siteId    = d.SiteID    != null ? String(d.SiteID)    : 'Unknown';
        const jfl       = Number(d.__jflUptime);
        const proactive = Number(d.__proactiveUptime);

        // Anomaly 1: __jflUptime < 0 or > 100 → CRITICAL
        if (Number.isFinite(jfl) && (jfl < 0 || jfl > 100)) {
          anomalies.push({
            severity: 'CRITICAL',
            entity: { deviceId, siteId },
            message: `Device ${deviceId} has __jflUptime=${jfl.toFixed(2)}% which is outside [0, 100]`,
            recommendation: 'Investigate uptime pipeline for this device — value must be clamped to [0, 100]',
          });
        }

        // Anomaly 2: |__proactiveUptime - __jflUptime| > 20 → HIGH
        if (Number.isFinite(proactive) && Number.isFinite(jfl)) {
          const divergence = Math.abs(proactive - jfl);
          if (divergence > 20) {
            anomalies.push({
              severity: 'HIGH',
              entity: { deviceId, siteId },
              message: `Device ${deviceId} has large uptime divergence: Proactive=${proactive.toFixed(2)}% vs JFL=${jfl.toFixed(2)}% (gap=${divergence.toFixed(2)}pp)`,
              recommendation: 'Review hold-time vs resolution-time data — large gap indicates long client-side hold or data inconsistency',
            });
          }
        }
      } catch (_) {
        continue;
      }
    }

    // ── Site-level anomalies ───────────────────────────────────────────────
    for (let i = 0; i < sites.length; i++) {
      try {
        const s = sites[i];
        if (!s || typeof s !== 'object') continue;

        // Fields: siteId, jflSwitchUptime, healthScore
        const siteId      = s.siteId != null ? String(s.siteId) : `site_idx_${i}`;
        const jflUptime   = Number(s.jflSwitchUptime);
        const healthScore = Number(s.healthScore);

        // Anomaly 3: site below SLA yet health score > 90 → MEDIUM (score/uptime mismatch)
        if (
          Number.isFinite(jflUptime) && jflUptime < slaTarget &&
          Number.isFinite(healthScore) && healthScore > 90
        ) {
          anomalies.push({
            severity: 'MEDIUM',
            entity: { siteId },
            message: `Site ${siteId} JFL Uptime=${jflUptime.toFixed(2)}% is below SLA target (${slaTarget}%) but healthScore=${healthScore}/100 (>90)`,
            recommendation: 'Health score formula may need revalidation — low uptime should not produce a score >90',
          });
        }
      } catch (_) {
        continue;
      }
    }
  } catch (err) {
    anomalies.push({
      severity: 'CRITICAL',
      entity: { global: true },
      message: `Anomaly detection encountered a fatal error: ${err && err.message ? err.message : String(err)}`,
      recommendation: 'Inspect qbrData structure passed to validateReport',
    });
  }

  return { anomalies };
}

// ─── Overall Health Determination ─────────────────────────────────────────

/**
 * Determine overall report health from sections.
 * FAIL if any CRITICAL anomaly OR any failed consistency check.
 * WARN if any HIGH anomaly OR any rollover with excessMin > 0.
 * PASS otherwise.
 *
 * @param {object} sections
 * @returns {'PASS'|'WARN'|'FAIL'}
 */
function determineOverallHealth(sections) {
  try {
    // FAIL conditions
    const hasCritical = (sections.anomalies && sections.anomalies.anomalies || [])
      .some(a => String(a && a.severity).toUpperCase() === 'CRITICAL');
    const hasFailedConsistency = (sections.dataConsistency && sections.dataConsistency.checks || [])
      .some(c => c && c.ok === false);

    if (hasCritical || hasFailedConsistency) return 'FAIL';

    // WARN conditions
    const hasHigh = (sections.anomalies && sections.anomalies.anomalies || [])
      .some(a => String(a && a.severity).toUpperCase() === 'HIGH');
    const hasExcessRollovers = (sections.rolloverAnalysis && sections.rolloverAnalysis.rollovers || [])
      .some(r => r && r.excessMin > 0);

    if (hasHigh || hasExcessRollovers) return 'WARN';

    return 'PASS';
  } catch (_) {
    return 'FAIL';
  }
}

// ─── Main Export ───────────────────────────────────────────────────────────

/**
 * Validate a complete qbrData snapshot.
 *
 * @param {object} qbrData  The processed dashboard data model (consumed read-only).
 * @returns {Promise<{
 *   success: boolean,
 *   overallHealth: string,
 *   sections: object,
 *   topIssues: Array,
 *   ranAt: string,
 *   error: string|null
 * }>}
 */
async function validateReport(qbrData) {
  try {
    if (!qbrData || typeof qbrData !== 'object') {
      return {
        success: false,
        overallHealth: 'FAIL',
        sections: {},
        topIssues: [],
        ranAt: new Date().toISOString(),
        error: 'INVALID_INPUT: qbrData must be a non-null object',
      };
    }

    // ── 1. Deep-freeze to prevent any mutation ─────────────────────────────
    deepFreeze(qbrData);

    const sections = {};
    const ranAt    = new Date().toISOString();

    // Field aliases (read-only)
    const incidents    = Array.isArray(qbrData.incidents)    ? qbrData.incidents    : [];
    const report_period = (qbrData.report_period && typeof qbrData.report_period === 'object')
      ? qbrData.report_period : {};

    // ── 2. Rollover analysis ───────────────────────────────────────────────
    try {
      sections.rolloverAnalysis = detectRollovers(incidents, report_period);
    } catch (e) {
      sections.rolloverAnalysis = {
        success: false,
        rollovers: [],
        summary: { totalRollovers: 0, totalRawHold: 0, totalCapped: 0, totalExcess: 0 },
        error: `SECTION_ERROR: ${e && e.message ? e.message : String(e)}`,
      };
    }

    // ── 3. Service request / change request filtering ──────────────────────
    try {
      sections.serviceRequestAnalysis = filterUptimeIncidents(incidents);
    } catch (e) {
      sections.serviceRequestAnalysis = {
        success: false,
        uptimeIncidents: [],
        excluded: [],
        summary: { total: 0, uptimeCount: 0, excludedCount: 0, byType: {} },
        error: `SECTION_ERROR: ${e && e.message ? e.message : String(e)}`,
      };
    }

    // ── 4. Duration breakdown for each rollover ────────────────────────────
    try {
      const rollovers = (sections.rolloverAnalysis && sections.rolloverAnalysis.rollovers) || [];
      const periodStart = report_period.start_date  || null;
      const periodEnd   = report_period.end_date    || null;

      const durationSegments = [];

      for (let i = 0; i < rollovers.length; i++) {
        try {
          const r   = rollovers[i];
          // Find the matching incident to get CreatedTime
          const inc = incidents.find(inc =>
            inc && inc.TicketNumber != null && String(inc.TicketNumber) === String(r.ticketNumber)
          );

          if (!inc || !inc.CreatedTime) {
            // Cannot do breakdown without start time — record empty result
            durationSegments.push({
              ticketNumber: r.ticketNumber,
              breakdown: {
                success: false,
                segments: [],
                summary: { totalMinutes: 0, segmentCount: 0, primaryMonth: '' },
                error: 'MISSING_CREATED_TIME',
              },
            });
            continue;
          }

          // Use CreatedTime as start, period end as end (rollover extends into this period)
          const breakdown = breakdownDuration(
            inc.CreatedTime,
            periodEnd || inc.CreatedTime,
            periodStart,
            periodEnd,
          );

          durationSegments.push({ ticketNumber: r.ticketNumber, breakdown });
        } catch (_) {
          continue;
        }
      }

      sections.durationAnalysis = { success: true, durationSegments, error: null };
    } catch (e) {
      sections.durationAnalysis = {
        success: false,
        durationSegments: [],
        error: `SECTION_ERROR: ${e && e.message ? e.message : String(e)}`,
      };
    }

    // ── 5. Data consistency checks ─────────────────────────────────────────
    try {
      sections.dataConsistency = runDataConsistency(qbrData);
    } catch (e) {
      sections.dataConsistency = {
        checks: [{ name: 'consistency_fatal', ok: false, detail: `SECTION_ERROR: ${e && e.message ? e.message : String(e)}` }],
      };
    }

    // ── 6. Inline anomaly detection ────────────────────────────────────────
    try {
      sections.anomalies = detectAnomalies(qbrData);
    } catch (e) {
      sections.anomalies = {
        anomalies: [{
          severity: 'CRITICAL',
          entity: { global: true },
          message: `Anomaly section fatal: ${e && e.message ? e.message : String(e)}`,
          recommendation: 'Inspect qbrData structure',
        }],
      };
    }

    // ── 7. Overall health ──────────────────────────────────────────────────
    const overallHealth = determineOverallHealth(sections);

    // ── 8. Top 5 issues by severity ────────────────────────────────────────
    const allIssues = [];

    // From anomalies
    (sections.anomalies && sections.anomalies.anomalies || []).forEach(a => {
      if (a && a.severity) allIssues.push(a);
    });

    // From failed consistency checks
    (sections.dataConsistency && sections.dataConsistency.checks || []).forEach(c => {
      if (c && c.ok === false) {
        allIssues.push({
          severity: 'CRITICAL',
          entity: { check: c.name },
          message: `Consistency check [${c.name}] failed: ${c.detail}`,
          recommendation: 'Investigate data pipeline for this consistency check',
        });
      }
    });

    // From rollovers with excess minutes
    (sections.rolloverAnalysis && sections.rolloverAnalysis.rollovers || []).forEach(r => {
      if (r && r.excessMin > 0) {
        allIssues.push({
          severity: 'HIGH',
          entity: { ticketNumber: r.ticketNumber, siteId: r.siteId, deviceId: r.deviceId },
          message: `Rollover ticket ${r.ticketNumber} has ${r.excessMin} min from prior period excluded`,
          recommendation: r.recommendation,
        });
      }
    });

    allIssues.sort((a, b) => severityOrder(a && a.severity) - severityOrder(b && b.severity));
    const topIssues = allIssues.slice(0, 5);

    return {
      success: true,
      overallHealth,
      sections,
      topIssues,
      ranAt,
      error: null,
    };
  } catch (err) {
    return {
      success: false,
      overallHealth: 'FAIL',
      sections: {},
      topIssues: [],
      ranAt: new Date().toISOString(),
      error: `INTERNAL_ERROR: ${err && err.message ? err.message : String(err)}`,
    };
  }
}

module.exports = { validateReport };
