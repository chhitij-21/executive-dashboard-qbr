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

    const devices = Array.isArray(qbrData.devices) ? qbrData.devices : [];
    const incidents = Array.isArray(qbrData.incidents) ? qbrData.incidents : [];
    const siteSummary = Array.isArray(qbrData.siteSummary) ? qbrData.siteSummary : [];
    const execSummary = qbrData.executiveSummary && typeof qbrData.executiveSummary === 'object' ? qbrData.executiveSummary : {};
    const switchAnalytics = qbrData.switchAnalytics && typeof qbrData.switchAnalytics === 'object' ? qbrData.switchAnalytics : {};

    // Check if input is effectively empty
    if (devices.length === 0 && incidents.length === 0 && siteSummary.length === 0 && Object.keys(execSummary).length === 0) {
      return {
        success: true,
        lineage: { devices: {}, sites: {}, metrics: {} },
        summary: { totalEntries: 0, coverage: '100.00%', orphans: [] },
        error: null,
      };
    }

    const timestamp = qbrData.generatedAt || new Date().toISOString();
    const lineageDevices = {};
    const lineageSites = {};
    const lineageMetrics = {};
    const orphans = [];

    // 1. Devices lineage
    devices.forEach(d => {
      const devId = d?.DeviceID || d?.SerialNo || 'UNKNOWN_DEVICE';
      const source = d?.__source;

      if (source && typeof source === 'object' && source.file) {
        const row = typeof source.row === 'number' ? source.row : undefined;
        const sheet = source.sheet || 'Raw';
        const cellCoordinates = row !== undefined ? {
          sheet,
          row,
          cellRef: `${sheet}!E${row}`,
        } : undefined;

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
              sheet,
              row,
              cellCoordinates,
              contributingRows: row !== undefined ? [row] : [],
              formula: PROACTIVE_FORMULA,
              inputs: ['ActualResolutionMin', 'TotalAvailableMinutes'],
              aggregationType: 'NONE',
            },
            {
              sourceType: 'EXCEL_ROW',
              file: sanitizeFilePath(source.file),
              sheet,
              row,
              cellCoordinates,
              contributingRows: row !== undefined ? [row] : [],
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
    if (Object.keys(execSummary).length > 0 || devices.length > 0) {
      if (execSummary.totalDevices !== undefined || devices.length > 0) {
        lineageMetrics['executiveSummary.totalDevices'] = {
          metricKey: 'executiveSummary.totalDevices',
          value: execSummary.totalDevices !== undefined ? execSummary.totalDevices : devices.length,
          derivedFrom: [
            {
              sourceType: 'INVENTORY_SHEET',
              formula: 'COUNT(devices)',
              file: sanitizeFilePath(devices[0]?.__source?.file || 'inventory.xlsx'),
              sheet: devices[0]?.__source?.sheet || 'Inventory',
              contributingRows: devices.map(d => d.__source?.row).filter(r => typeof r === 'number'),
              inputs: ['DeviceID', 'Hostname', 'SerialNo'],
              aggregationType: 'COUNT',
            },
          ],
          timestamp,
        };
      }

      if (execSummary.totalIncidents !== undefined || incidents.length > 0) {
        lineageMetrics['executiveSummary.totalIncidents'] = {
          metricKey: 'executiveSummary.totalIncidents',
          value: execSummary.totalIncidents !== undefined ? execSummary.totalIncidents : incidents.length,
          derivedFrom: [
            {
              sourceType: 'INCIDENT_SHEET',
              formula: 'COUNT(incidents)',
              file: sanitizeFilePath(incidents[0]?.__source?.file || 'incidents.xlsx'),
              sheet: incidents[0]?.__source?.sheet || 'Incident Dump',
              contributingRows: incidents.map(i => i.__source?.row).filter(r => typeof r === 'number'),
              inputs: ['TicketNumber', 'HoldTimeMin', 'ActualResolutionMin'],
              aggregationType: 'COUNT',
            },
          ],
          timestamp,
        };
      }

      if (execSummary.healthyDevices !== undefined) {
        lineageMetrics['executiveSummary.healthyDevices'] = {
          metricKey: 'executiveSummary.healthyDevices',
          value: execSummary.healthyDevices,
          derivedFrom: [
            {
              sourceType: 'CALCULATION',
              formula: 'totalDevices - atRiskDevices',
              inputs: ['totalDevices', 'atRiskDevices'],
              aggregationType: 'NONE',
            },
          ],
          timestamp,
        };
      }

      if (execSummary.atRiskDevices !== undefined) {
        lineageMetrics['executiveSummary.atRiskDevices'] = {
          metricKey: 'executiveSummary.atRiskDevices',
          value: execSummary.atRiskDevices,
          derivedFrom: [
            {
              sourceType: 'CALCULATION',
              formula: 'COUNT(DISTINCT incidents.DeviceID)',
              inputs: ['incidents.DeviceID'],
              aggregationType: 'COUNT_DISTINCT',
            },
          ],
          timestamp,
        };
      }

      if (execSummary.jflSwitchUptime !== undefined) {
        const switchDevs = devices.filter(d => (d.DeviceType || '').toLowerCase() === 'sw');
        lineageMetrics['executiveSummary.jflSwitchUptime'] = {
          metricKey: 'executiveSummary.jflSwitchUptime',
          value: execSummary.jflSwitchUptime,
          derivedFrom: [
            {
              sourceType: 'AGGREGATION',
              formula: 'AVG(switch.__jflUptime)',
              inputs: switchDevs.map(d => d.DeviceID || d.SerialNo),
              aggregationType: 'AVG',
            },
          ],
          timestamp,
        };
      }

      if (execSummary.proactiveSwitchUptime !== undefined) {
        const switchDevs = devices.filter(d => (d.DeviceType || '').toLowerCase() === 'sw');
        lineageMetrics['executiveSummary.proactiveSwitchUptime'] = {
          metricKey: 'executiveSummary.proactiveSwitchUptime',
          value: execSummary.proactiveSwitchUptime,
          derivedFrom: [
            {
              sourceType: 'AGGREGATION',
              formula: 'AVG(switch.__proactiveUptime)',
              inputs: switchDevs.map(d => d.DeviceID || d.SerialNo),
              aggregationType: 'AVG',
            },
          ],
          timestamp,
        };
      }

      if (execSummary.overallUptime !== undefined || devices.length > 0) {
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
      }

      if (execSummary.slaCompliance !== undefined) {
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
      }

      if (execSummary.healthScore !== undefined) {
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
      }
    }

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
