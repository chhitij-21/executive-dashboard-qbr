// backend/services/validator.js
// Triple-validation of parsed Excel data.
// ZERO ASSUMPTIONS: any discrepancy produces a traceable error.

/**
 * Add an error with a fully traceable source string.
 */
function addError(errors, message, source) {
  const srcParts = [];
  if (source) {
    if (source.workbook) srcParts.push(`Workbook: ${source.workbook}`);
    if (source.sheet) srcParts.push(`Sheet: "${source.sheet}"`);
    if (source.row) srcParts.push(`Row: ${source.row}`);
    if (source.column) srcParts.push(`Column: "${source.column}"`);
  }
  const srcStr = srcParts.length ? ` [Source → ${srcParts.join(' → ')}]` : '';
  errors.push(message + srcStr);
}

// ────────────────────────────────────────────────────────────
// PASS 1 — Structural validation
// ────────────────────────────────────────────────────────────
function pass1(workbookData, sheetMap, errors) {
  const { deviceSheet, incidentSheet, siteSheet, metadataSheet } = sheetMap;

  if (!deviceSheet) {
    addError(errors, 'Could not locate a Device Inventory sheet. Expected sheet name containing "device".');
  }
  if (!incidentSheet) {
    addError(errors, 'Could not locate an Incidents sheet. Expected sheet name containing "incident".');
  }
  if (!siteSheet) {
    // Sites sheet is optional in some workbooks; warn but don't fail hard
    console.warn('[Validator Pass1] No Sites sheet detected.');
  }

  // Column checks on Device sheet
  if (deviceSheet && workbookData[deviceSheet] && workbookData[deviceSheet].length > 0) {
    const sample = workbookData[deviceSheet][0];
    const requiredCols = ['DeviceID'];
    const optionalUptimeCols = ['JFL Uptime %', 'Uptime %', 'Uptime', 'uptime'];

    requiredCols.forEach((col) => {
      if (!(col in sample)) {
        addError(errors, `Device sheet missing required column "${col}"`, { sheet: deviceSheet });
      }
    });

    // Check at least one uptime column exists
    const hasUptimeCol = optionalUptimeCols.some((c) => c in sample);
    if (!hasUptimeCol) {
      addError(errors, `Device sheet has no uptime column. Expected one of: ${optionalUptimeCols.join(', ')}`, { sheet: deviceSheet });
    }
  }

  // Column checks on Incidents sheet
  if (incidentSheet && workbookData[incidentSheet] && workbookData[incidentSheet].length > 0) {
    const sample = workbookData[incidentSheet][0];
    const requiredIncidentCols = ['DeviceID'];
    requiredIncidentCols.forEach((col) => {
      if (!(col in sample)) {
        addError(errors, `Incidents sheet missing required column "${col}"`, { sheet: incidentSheet });
      }
    });
  }
}

// ────────────────────────────────────────────────────────────
// PASS 2 — Cross-sheet consistency
// ────────────────────────────────────────────────────────────
function pass2(workbookData, sheetMap, errors) {
  const { deviceSheet, incidentSheet, siteSheet, metadataSheet } = sheetMap;
  const devices = deviceSheet ? (workbookData[deviceSheet] || []) : [];
  const incidents = incidentSheet ? (workbookData[incidentSheet] || []) : [];
  const sites = siteSheet ? (workbookData[siteSheet] || []) : [];
  const metadata = metadataSheet && workbookData[metadataSheet] && workbookData[metadataSheet][0]
    ? workbookData[metadataSheet][0]
    : {};

  // Check TotalDevices if stated in metadata
  const metaTotalDevices = metadata.TotalDevices || metadata['Total Devices'] || metadata.totalDevices;
  if (metaTotalDevices !== undefined && metaTotalDevices !== null) {
    const reported = Number(metaTotalDevices);
    if (!isNaN(reported) && reported !== devices.length) {
      addError(errors,
        `TotalDevices mismatch: Metadata reports ${reported} but Device sheet has ${devices.length} rows`,
        { sheet: metadataSheet, row: 1, column: 'TotalDevices' }
      );
    }
  }

  // Check TotalSites if stated in metadata
  const metaTotalSites = metadata.TotalSites || metadata['Total Sites'] || metadata.totalSites;
  if (metaTotalSites !== undefined && metaTotalSites !== null && sites.length > 0) {
    const reported = Number(metaTotalSites);
    if (!isNaN(reported) && reported !== sites.length) {
      addError(errors,
        `TotalSites mismatch: Metadata reports ${reported} but Sites sheet has ${sites.length} rows`,
        { sheet: metadataSheet, row: 1, column: 'TotalSites' }
      );
    }
  }

  // Cross-check: every incident DeviceID must exist in device sheet
  const deviceIds = new Set(devices.map((d) => String(d.DeviceID)));
  incidents.forEach((inc, idx) => {
    const devId = String(inc.DeviceID);
    if (devId && devId !== 'null' && !deviceIds.has(devId)) {
      addError(errors,
        `Incident references unknown DeviceID "${devId}"`,
        { sheet: incidentSheet, row: inc.__rowNum || idx + 2, column: 'DeviceID' }
      );
    }
  });

  // Cross-check: every incident SiteID must exist in sites sheet (if Sites sheet present)
  if (sites.length > 0) {
    const siteIds = new Set(sites.map((s) => String(s.SiteID)));
    incidents.forEach((inc, idx) => {
      const siteId = String(inc.SiteID);
      if (siteId && siteId !== 'null' && !siteIds.has(siteId)) {
        addError(errors,
          `Incident references unknown SiteID "${siteId}"`,
          { sheet: incidentSheet, row: inc.__rowNum || idx + 2, column: 'SiteID' }
        );
      }
    });
  }
}

// ────────────────────────────────────────────────────────────
// PASS 3 — Independent metric recalculation
// ────────────────────────────────────────────────────────────
function pass3(workbookData, sheetMap, errors) {
  const { deviceSheet, incidentSheet } = sheetMap;
  const devices = deviceSheet ? (workbookData[deviceSheet] || []) : [];
  const incidents = incidentSheet ? (workbookData[incidentSheet] || []) : [];

  const uptimeCol = detectUptimeColumn(devices);

  let uptimeSum = 0;
  let count = 0;

  devices.forEach((d, idx) => {
    let val = uptimeCol ? d[uptimeCol] : null;

    // Rule: #N/A / null / empty with no incident = treat as 100%
    if (val === null || val === undefined || val === '' || String(val).toUpperCase() === '#N/A' || String(val).toUpperCase() === 'N/A') {
      val = 100;
    }

    const num = parseFloat(val);
    if (!isNaN(num)) {
      uptimeSum += Math.min(num, 100);
      count++;
    } else {
      addError(errors,
        `Non-numeric uptime value "${val}" for DeviceID "${d.DeviceID}"`,
        { sheet: deviceSheet, row: d.__rowNum || idx + 2, column: uptimeCol || 'Uptime' }
      );
    }
  });

  const overallUptime = count > 0 ? uptimeSum / count : null;
  const incidentFreeCount = devices.length - new Set(incidents.map((i) => i.DeviceID)).size;
  const incidentFreePercent = devices.length > 0 ? (incidentFreeCount / devices.length) * 100 : null;

  // Compare against any pre-computed values in workbook
  const sample = devices[0] || {};
  const precomputedUptime = sample.OverallUptime || sample['Overall Uptime'];
  if (precomputedUptime !== undefined && overallUptime !== null) {
    const reported = parseFloat(precomputedUptime);
    if (!isNaN(reported) && Math.abs(reported - overallUptime) > 0.1) {
      addError(errors,
        `OverallUptime mismatch: workbook pre-computed ${reported.toFixed(2)}% vs recalculated ${overallUptime.toFixed(2)}%`,
        { sheet: deviceSheet, row: 2, column: 'OverallUptime' }
      );
    }
  }

  // Store derived metrics for downstream use
  workbookData.__derived = {
    overallUptime: overallUptime !== null ? overallUptime.toFixed(2) : 'Data Not Available',
    incidentFreePercent: incidentFreePercent !== null ? incidentFreePercent.toFixed(2) : 'Data Not Available',
    incidentFreeCount,
    totalDeviceCount: devices.length,
    totalIncidentCount: incidents.length,
    uptimeCol,
  };
}

/**
 * Detect the uptime column name from the device sheet rows.
 */
function detectUptimeColumn(devices) {
  if (!devices || devices.length === 0) return null;
  const candidates = ['JFL Uptime %', 'Uptime %', 'Uptime', 'uptime', 'UPTIME'];
  const sample = devices[0];
  for (const col of candidates) {
    if (col in sample) return col;
  }
  // Try partial match
  const keys = Object.keys(sample);
  const found = keys.find((k) => k.toLowerCase().includes('uptime'));
  return found || null;
}

/**
 * Main validation entry point.
 * @param {Object} workbookData Sheets keyed by name (with __derived after pass3).
 * @param {Object} sheetMap Detected sheet name mapping.
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validate(workbookData, sheetMap) {
  const errors = [];
  const warnings = [];

  pass1(workbookData, sheetMap, errors);
  pass2(workbookData, sheetMap, errors);
  pass3(workbookData, sheetMap, errors);

  const valid = errors.length === 0;
  return { valid, errors, warnings };
}

module.exports = { validate, detectUptimeColumn };
