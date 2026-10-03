// backend/services/validators/anomalyDetector.js
const crypto = require('crypto');
const { normalizeSiteName } = require('../excelParser');

function sha1(str) {
  return crypto.createHash('sha1').update(String(str || '')).digest('hex');
}

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

function detectAnomalies(qbrData, options = {}) {
  try {
    if (!qbrData || typeof qbrData !== 'object') {
      return {
        success: false,
        anomalies: [],
        summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0 },
        error: 'INVALID_INPUT: qbrData must be an object',
      };
    }

    deepFreeze(qbrData);

    const devices = Array.isArray(qbrData.devices) ? qbrData.devices : [];
    const incidents = Array.isArray(qbrData.incidents) ? qbrData.incidents : [];
    const siteSummary = Array.isArray(qbrData.siteSummary) ? qbrData.siteSummary : [];
    const executiveSummary = qbrData.executiveSummary || {};
    const rcaAnalytics = qbrData.rcaAnalytics || {};
    const slaAnalytics = qbrData.slaAnalytics || {};

    const anomalyMap = new Map();

    const addAnomaly = (severity, type, entity, message, evidence, recommendation) => {
      const siteKey = entity?.site || '';
      const devKey = entity?.device || '';
      const id = sha1(`${type}|${siteKey}|${devKey}`).slice(0, 16);
      if (!anomalyMap.has(id)) {
        anomalyMap.set(id, {
          id,
          severity,
          type,
          entity: entity || {},
          message,
          evidence: evidence || {},
          recommendation,
        });
      }
    };

    // A. UPTIME_DIVERGENCE
    // Condition: device.__proactiveUptime >= 99.5 AND device.__jflUptime < 95
    devices.forEach(device => {
      const proactive = safeNum(device?.__proactiveUptime);
      const jfl = safeNum(device?.__jflUptime);
      if (proactive !== null && jfl !== null) {
        if (proactive >= 99.5 && jfl < 95) {
          const delta = parseFloat((proactive - jfl).toFixed(2));
          addAnomaly(
            'HIGH',
            'UPTIME_DIVERGENCE',
            { device: device.DeviceID, site: device.SiteID || device.Location },
            `Device ${device.DeviceID || 'Unknown'} shows high proactive uptime (${proactive}%) but lower JFL uptime (${jfl}%).`,
            { proactive, jfl, delta },
            'Investigate hold time impact and client-side outage duration for this device.'
          );
        }
      }
    });

    // B. UPTIME_FLOOR_BREACH
    // Condition: device.__proactiveUptime < 50 OR device.__jflUptime < 50
    devices.forEach(device => {
      const proactive = safeNum(device?.__proactiveUptime);
      const jfl = safeNum(device?.__jflUptime);
      if ((proactive !== null && proactive < 50) || (jfl !== null && jfl < 50)) {
        addAnomaly(
          'CRITICAL',
          'UPTIME_FLOOR_BREACH',
          { device: device.DeviceID, site: device.SiteID || device.Location },
          `Device ${device.DeviceID || 'Unknown'} uptime breached critical floor (<50%).`,
          { proactive, jfl, deviceId: device.DeviceID, siteId: device.SiteID || device.Location },
          'Escalate immediately for hardware replacement or emergency site remediation.'
        );
      }
    });

    // C. SLA_TARGET_DEVIATION
    // Condition: siteSummary[i].jflSwitchUptime < qbrData.slaAnalytics.slaTarget
    const globalSlaTarget = safeNum(slaAnalytics.slaTarget) ?? safeNum(executiveSummary.slaTarget);
    if (globalSlaTarget !== null) {
      siteSummary.forEach(site => {
        const jflSwitchUptime = safeNum(site?.jflSwitchUptime);
        if (jflSwitchUptime !== null && jflSwitchUptime < globalSlaTarget) {
          const gap = parseFloat((globalSlaTarget - jflSwitchUptime).toFixed(2));
          addAnomaly(
            'HIGH',
            'SLA_TARGET_DEVIATION',
            { site: site.siteId },
            `Site ${site.siteId} JFL switch uptime (${jflSwitchUptime}%) is below SLA target (${globalSlaTarget}%).`,
            { siteId: site.siteId, jflSwitchUptime, slaTarget: globalSlaTarget, gap },
            'Review top outage drivers and hold time categories for switches at this site.'
          );
        }
      });
    }

    // D. INCIDENT_SPIKE_SITE
    // Condition: siteSummary[i].incidentCount > 100 AND (siteSummary[i].incidentCount / executiveSummary.totalIncidents) > 0.5
    const totalIncidentsCount = safeNum(executiveSummary.totalIncidents);
    if (totalIncidentsCount !== null && totalIncidentsCount > 0) {
      siteSummary.forEach(site => {
        const siteIncCount = safeNum(site?.incidentCount);
        if (siteIncCount !== null && siteIncCount > 100) {
          const ratio = siteIncCount / totalIncidentsCount;
          if (ratio > 0.5) {
            addAnomaly(
              'HIGH',
              'INCIDENT_SPIKE_SITE',
              { site: site.siteId },
              `Site ${site.siteId} accounts for ${parseFloat((ratio * 100).toFixed(1))}% of total organization incidents.`,
              { siteId: site.siteId, incidentCount: siteIncCount, totalIncidents: totalIncidentsCount, ratio },
              'Perform infrastructure health audit at site to identify systemic issues.'
            );
          }
        }
      });
    }

    // E. DEVICE_TICKET_BOMB
    // Condition: any DeviceID in incidents appears >= 20 times
    const deviceIncidentCounts = new Map();
    const deviceSiteMap = new Map();
    incidents.forEach(inc => {
      const devId = inc?.DeviceID;
      if (devId && typeof devId === 'string' && devId.trim()) {
        const key = devId.trim();
        deviceIncidentCounts.set(key, (deviceIncidentCounts.get(key) || 0) + 1);
        if (inc?.SiteID || inc?.Location) {
          deviceSiteMap.set(key, inc.SiteID || inc.Location);
        }
      }
    });

    deviceIncidentCounts.forEach((count, devId) => {
      if (count >= 20) {
        const siteId = deviceSiteMap.get(devId) || 'Unknown';
        addAnomaly(
          'CRITICAL',
          'DEVICE_TICKET_BOMB',
          { device: devId, site: siteId },
          `Device ${devId} generated ${count} incidents in reporting period.`,
          { deviceId: devId, incidentCount: count, siteId },
          'Schedule device hardware diagnostics or immediate RMA replacement.'
        );
      }
    });

    // F. STOCK_DEVICE_UPTIME_ANOMALY
    // Condition: device.__isStock === true AND device.__proactiveUptime < 100
    devices.forEach(device => {
      if (device?.__isStock === true) {
        const proactive = safeNum(device?.__proactiveUptime);
        if (proactive !== null && proactive < 100) {
          addAnomaly(
            'LOW',
            'STOCK_DEVICE_UPTIME_ANOMALY',
            { device: device.DeviceID, site: device.SiteID || device.Location },
            `Unassigned stock device ${device.DeviceID} registered non-100% uptime (${proactive}%).`,
            { deviceId: device.DeviceID, proactiveUptime: proactive },
            'Verify stock inventory designation and clear historical incident linkage.'
          );
        }
      }
    });

    // G. RCA_DOMINANCE
    // Condition: top RCA in rcaAnalytics.breakdown accounts for > 60% of totalIncidents
    const rcaBreakdown = Array.isArray(rcaAnalytics.breakdown) ? rcaAnalytics.breakdown : [];
    if (rcaBreakdown.length > 0 && totalIncidentsCount !== null && totalIncidentsCount > 0) {
      const topRcaItem = rcaBreakdown[0];
      const topCount = safeNum(topRcaItem?.count);
      if (topCount !== null) {
        const ratio = topCount / totalIncidentsCount;
        if (ratio > 0.6) {
          addAnomaly(
            'MEDIUM',
            'RCA_DOMINANCE',
            {},
            `Primary root cause "${topRcaItem.rca || 'Unknown'}" accounts for ${parseFloat((ratio * 100).toFixed(1))}% of all incidents.`,
            { topRca: topRcaItem.rca, count: topCount, percentage: parseFloat((ratio * 100).toFixed(2)) },
            'Focus preventive maintenance resources on addressing the dominant root cause driver.'
          );
        }
      }
    }

    // H. EMPTY_SITE
    // Condition: siteSummary[i].deviceCount === 0 OR (siteSummary[i].switchCount === 0 AND siteSummary[i].apCount === 0)
    siteSummary.forEach(site => {
      const devCount = safeNum(site?.deviceCount) ?? 0;
      const swCount = safeNum(site?.switchCount) ?? 0;
      const apCount = safeNum(site?.apCount) ?? 0;
      if (devCount === 0 || (swCount === 0 && apCount === 0)) {
        addAnomaly(
          'LOW',
          'EMPTY_SITE',
          { site: site.siteId },
          `Site ${site.siteId} contains zero active switches/APs in inventory.`,
          { siteId: site.siteId, deviceCount: devCount, switchCount: swCount, apCount: apCount },
          'Audit inventory mapping to ensure all active site assets are correctly tagged.'
        );
      }
    });

    // I. UNKNOWN_SITE_LEAKAGE
    // Condition: incidents where normalizeSiteName(SiteID) === 'Unknown' count > 0
    const unknownIncidents = incidents.filter(inc => {
      const rawLoc = inc?.SiteID || inc?.Location;
      return normalizeSiteName(rawLoc) === 'Unknown';
    });

    if (unknownIncidents.length > 0) {
      const sampleRefs = unknownIncidents
        .slice(0, 5)
        .map(inc => inc?.display_reference?.value || inc?.TicketNumber || inc?.IncidentNumber || 'N/A');
      addAnomaly(
        'MEDIUM',
        'UNKNOWN_SITE_LEAKAGE',
        {},
        `${unknownIncidents.length} incident(s) could not be mapped to a valid physical site.`,
        { unknownCount: unknownIncidents.length, sampleRefs },
        'Update device inventory serial-to-site lookup mapping for unassigned tickets.'
      );
    }

    // J. HEALTH_SCORE_OUTLIER
    // Condition: abs(siteSummary[i].healthScore - avgHealthScore) > 25
    const siteHealthScores = siteSummary
      .map(s => safeNum(s?.healthScore))
      .filter(v => v !== null);

    if (siteHealthScores.length > 0) {
      const sumHealth = siteHealthScores.reduce((acc, curr) => acc + curr, 0);
      const avgHealthScore = sumHealth / siteHealthScores.length;

      siteSummary.forEach(site => {
        const siteHealth = safeNum(site?.healthScore);
        if (siteHealth !== null) {
          const diff = Math.abs(siteHealth - avgHealthScore);
          if (diff > 25) {
            addAnomaly(
              'MEDIUM',
              'HEALTH_SCORE_OUTLIER',
              { site: site.siteId },
              `Site ${site.siteId} health score (${siteHealth}) deviates significantly from organization average (${parseFloat(avgHealthScore.toFixed(2))}).`,
              { siteId: site.siteId, healthScore: siteHealth, avgHealthScore: parseFloat(avgHealthScore.toFixed(2)), diff: parseFloat(diff.toFixed(2)) },
              'Investigate site operational disparities relative to peer site baseline.'
            );
          }
        }
      });
    }

    const allAnomalies = Array.from(anomalyMap.values());

    const severityOrder = { CRITICAL: 1, HIGH: 2, MEDIUM: 3, LOW: 4 };
    allAnomalies.sort((a, b) => (severityOrder[a.severity] || 99) - (severityOrder[b.severity] || 99));

    const summary = {
      total: allAnomalies.length,
      critical: allAnomalies.filter(a => a.severity === 'CRITICAL').length,
      high: allAnomalies.filter(a => a.severity === 'HIGH').length,
      medium: allAnomalies.filter(a => a.severity === 'MEDIUM').length,
      low: allAnomalies.filter(a => a.severity === 'LOW').length,
    };

    return {
      success: true,
      anomalies: allAnomalies,
      summary,
      error: null,
    };
  } catch (err) {
    return {
      success: false,
      anomalies: [],
      summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0 },
      error: err?.message || 'UNKNOWN_ERROR',
    };
  }
}

module.exports = { detectAnomalies };
