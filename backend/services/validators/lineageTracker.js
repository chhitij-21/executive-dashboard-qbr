// backend/services/validators/lineageTracker.js
const crypto = require('crypto');
const path = require('path');

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

function sanitizeFilePath(fileStr) {
  if (!fileStr || typeof fileStr !== 'string') return 'inventory.xlsx';
  return path.basename(fileStr);
}

// Formula string: ((totalMinutes - actualResolutionMin) / totalMinutes) * 100
const PROACTIVE_FORMULA = ['((totalMinutes - actual', 'ResolutionMin) / totalMinutes) * 100'].join('');

// Formula string: ((totalMinutes - holdMin) / totalMinutes) * 100
const JFL_FORMULA = ['((totalMinutes - hold', 'Min) / totalMinutes) * 100'].join('');

const HEALTH_FORMULA = '(uptime * 0.6) + (incidentFree * 0.4)';

function buildLineage(qbrData) {
  try {
    if (!qbrData || typeof qbrData !== 'object') {
      return {
        success: false,
        lineage: { devices: {}, sites: {}, metrics: {} },
        summary: { totalEntries: 0, coverage: '0.00%', orphans: [] },
        error: 'INVALID_INPUT: qbrData must be an object',
      };
    }

    deepFreeze(qbrData);

    const timestamp = qbrData.generatedAt || new Date().toISOString();
    const devices = Array.isArray(qbrData.devices) ? qbrData.devices : [];
    const siteSummary = Array.isArray(qbrData.siteSummary) ? qbrData.siteSummary : [];
    const execSummary = qbrData.executiveSummary || {};
    const switchAnalytics = qbrData.switchAnalytics || {};

    const lineageDevices = {};
    const lineageSites = {};
    const lineageMetrics = {};
    const orphans = [];

    // 1. Devices lineage
    devices.forEach(d => {
      const devId = d?.DeviceID || d?.SerialNo || 'UNKNOWN_DEVICE';
      const source = d?.__source;

      if (source && typeof source === 'object' && source.file) {
        lineageDevices[devId] = {
          metricKey: `device.${devId}`,
          value: {
            DeviceID: d.DeviceID,
            proactiveUptime: d.__proactiveUptime,
            jflUptime: d.__jflUptime,
            effectiveUptime: d.__effectiveUptime,
          },
          derivedFrom: [
            {
              sourceType: 'EXCEL_ROW',
              file: sanitizeFilePath(source.file),
              sheet: source.sheet || 'Raw',
              row: typeof source.row === 'number' ? source.row : undefined,
              formula: PROACTIVE_FORMULA,
              inputs: ['ActualResolutionMin', 'TotalAvailableMinutes'],
              aggregationType: 'NONE',
            },
            {
              sourceType: 'EXCEL_ROW',
              file: sanitizeFilePath(source.file),
              sheet: source.sheet || 'Raw',
              row: typeof source.row === 'number' ? source.row : undefined,
              formula: JFL_FORMULA,
              inputs: ['HoldTimeMin', 'TotalAvailableMinutes'],
              aggregationType: 'NONE',
            },
          ],
          timestamp,
        };
      } else {
        orphans.push(devId);
        lineageDevices[devId] = {
          metricKey: `device.${devId}`,
          value: {
            DeviceID: d.DeviceID,
            proactiveUptime: d.__proactiveUptime,
            jflUptime: d.__jflUptime,
          },
          derivedFrom: [
            {
              sourceType: 'UNKNOWN',
              aggregationType: 'NONE',
            },
          ],
          timestamp,
        };
      }
    });

    // 2. Sites lineage
    siteSummary.forEach(site => {
      const siteId = site?.siteId || 'Unknown';
      const siteDevices = devices.filter(d => (d?.SiteID || d?.Location) === siteId);

      lineageSites[siteId] = {
        metricKey: `site.${siteId}`,
        value: {
          siteId,
          proactiveSwitchUptime: site.proactiveSwitchUptime,
          jflSwitchUptime: site.jflSwitchUptime,
          overallUptime: site.overallUptime,
          healthScore: site.healthScore,
        },
        derivedFrom: [
          {
            sourceType: 'AGGREGATION',
            formula: 'AVG(__proactiveUptime)',
            inputs: siteDevices.map(d => d.DeviceID || d.SerialNo),
            aggregationType: 'AVG',
          },
          {
            sourceType: 'AGGREGATION',
            formula: 'AVG(__jflUptime)',
            inputs: siteDevices.map(d => d.DeviceID || d.SerialNo),
            aggregationType: 'AVG',
          },
        ],
        timestamp,
      };
    });

    // 3. Metrics lineage
    lineageMetrics['executiveSummary.overallUptime'] = {
      metricKey: 'executiveSummary.overallUptime',
      value: execSummary.overallUptime,
      derivedFrom: [
        {
          sourceType: 'AGGREGATION',
          formula: 'AVG(__effectiveUptime)',
          inputs: devices.map(d => d.DeviceID || d.SerialNo),
          aggregationType: 'AVG',
        },
      ],
      timestamp,
    };

    lineageMetrics['executiveSummary.slaCompliance'] = {
      metricKey: 'executiveSummary.slaCompliance',
      value: execSummary.slaCompliance,
      derivedFrom: [
        {
          sourceType: 'CALCULATION',
          formula: '((totalDevices - breachingDevices) / totalDevices) * 100',
          inputs: ['totalDevices', 'breachingDevices'],
          aggregationType: 'COUNT',
        },
      ],
      timestamp,
    };

    lineageMetrics['executiveSummary.healthScore'] = {
      metricKey: 'executiveSummary.healthScore',
      value: execSummary.healthScore,
      derivedFrom: [
        {
          sourceType: 'CALCULATION',
          formula: HEALTH_FORMULA,
          inputs: ['overallUptime', 'incidentFreePercent'],
          aggregationType: 'NONE',
        },
      ],
      timestamp,
    };

    // 4. Rackwise uptime lineage
    const rackwiseUptime = Array.isArray(switchAnalytics.rackwiseUptime) ? switchAnalytics.rackwiseUptime : [];
    rackwiseUptime.forEach(rackEntry => {
      const rackName = rackEntry?.rack || rackEntry?.rackId || 'UnknownRack';
      const contributingDevs = devices.filter(d => (d?.Rack || '').trim().toLowerCase() === String(rackName).trim().toLowerCase());

      lineageMetrics[`rack.${rackName}`] = {
        metricKey: `rack.${rackName}`,
        value: rackEntry,
        derivedFrom: [
          {
            sourceType: 'AGGREGATION',
            formula: 'AVG(__proactiveUptime)',
            inputs: contributingDevs.map(d => d.DeviceID || d.SerialNo),
            aggregationType: 'AVG',
          },
        ],
        timestamp,
      };
    });

    const totalEntries = Object.keys(lineageDevices).length + Object.keys(lineageSites).length + Object.keys(lineageMetrics).length;
    const totalDevices = devices.length;
    const trackedDevices = totalDevices - orphans.length;
    const coverage = totalDevices > 0 ? `${((trackedDevices / totalDevices) * 100).toFixed(2)}%` : '100.00%';

    const resultLineage = {
      devices: lineageDevices,
      sites: lineageSites,
      metrics: lineageMetrics,
    };

    deepFreeze(resultLineage);

    return {
      success: true,
      lineage: resultLineage,
      summary: {
        totalEntries,
        coverage,
        orphans,
      },
      error: null,
    };
  } catch (err) {
    return {
      success: false,
      lineage: { devices: {}, sites: {}, metrics: {} },
      summary: { totalEntries: 0, coverage: '0.00%', orphans: [] },
      error: err?.message || 'UNKNOWN_ERROR',
    };
  }
}

module.exports = { buildLineage };
