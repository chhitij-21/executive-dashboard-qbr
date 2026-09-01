// backend/services/excelParser.js
// JFL-specific parser: handles the two-file format (incidents + inventory).
// ZERO ASSUMPTION: every read is traced to Sheet → Row → Column.

const xlsx = require('xlsx');
const path = require('path');

/**
 * Load a workbook and return all sheets as parsed row arrays.
 * Rows preserve raw values; __source is attached for traceability.
 */
function loadWorkbook(filePath) {
  const wb = xlsx.readFile(filePath, { cellDates: false, raw: true, dense: true });
  const result = {};
  wb.SheetNames.forEach((name) => {
    const rows = xlsx.utils.sheet_to_json(wb.Sheets[name], { defval: '' });
    result[name] = rows.map((row, idx) => ({
      ...row,
      __source: { file: path.basename(filePath), sheet: name, row: idx + 2 },
    }));
  });
  result.__sheetNames = wb.SheetNames;
  result.__filePath = filePath;
  return result;
}

/**
 * Helper to extract a column value from a row using multiple alias candidate names.
 * Supports exact match, case-insensitive match, and normalized key match (no spaces/underscores/dots).
 */
function getColVal(row, candidates) {
  if (!row || typeof row !== 'object') return '';
  const keys = Object.keys(row);
  for (const candidate of candidates) {
    if (row[candidate] !== undefined && row[candidate] !== null && String(row[candidate]).trim() !== '') {
      return row[candidate];
    }
    const normCand = candidate.toLowerCase().replace(/[\s_\.#-]/g, '');
    const foundKey = keys.find(k => k.toLowerCase().replace(/[\s_\.#-]/g, '') === normCand);
    if (foundKey && row[foundKey] !== undefined && row[foundKey] !== null && String(row[foundKey]).trim() !== '') {
      return row[foundKey];
    }
  }
  return '';
}

/**
 * JFL-specific sheet detection for the two-file setup.
 */
function detectSheets(workbookData) {
  const sheets = workbookData.__sheetNames || [];

  const matchedIncidentSheet = sheets.find((s) => s.trim() === 'Raw')
    || sheets.find((s) => s.trim() === 'JFL')
    || sheets.find((s) => s.trim().toLowerCase() === 'raw')
    || sheets.find((s) => s.trim().toLowerCase().includes('incident'))
    || sheets.find((s) => s.trim().toLowerCase().includes('compliance'))
    || sheets.find((s) => s.trim().toLowerCase().includes('sla'))
    || sheets.find((s) => s.trim().toLowerCase().includes('jfl'));

  const incidentSheet = matchedIncidentSheet || (sheets.length > 0 ? sheets[0] : null);

  const uptimeSheet = sheets.find((s) => s.trim().toLowerCase().startsWith('all location'))
    || sheets.find((s) => s.trim().toLowerCase().includes('uptime'))
    || null;

  // Location sheets: if explicit matchedIncidentSheet exists, exclude it.
  // Otherwise, all non-summary/non-uptime sheets in the workbook are location inventory sheets.
  const locationSheets = sheets.filter((s) => {
    const lower = s.trim().toLowerCase();
    if (matchedIncidentSheet && s === matchedIncidentSheet) return false;
    return (
      !lower.startsWith('all location') &&
      !lower.includes('uptime') &&
      !lower.startsWith('rca') &&
      !lower.startsWith('device wise')
    );
  });

  return {
    incidentSheet,
    uptimeSheet,
    locationSheets: locationSheets.length > 0 ? locationSheets : sheets,
    allSheets: sheets,
  };
}

function normalizeSiteName(site) {
  if (!site) return 'Unknown';
  const str = String(site).trim();
  const lower = str.toLowerCase();

  if (/blr|bangalore/i.test(lower)) return 'Bangalore';
  if (/g.*noida|gr.*noida|greater.*noida|grater.*noida|gnsc/i.test(lower)) return 'Greater Noida';
  if (/guwahati|gau/i.test(lower)) return 'Guwahati';
  if (/hyd|hyderabad/i.test(lower)) return 'Hyderabad';
  if (/mohali|moh/i.test(lower)) return 'Mohali';
  if (/mumbai|mumd|mumbai_dc|mumbai-dc/i.test(lower)) return 'Mumbai-DC';
  if (/nagpur|nag/i.test(lower)) return 'Nagpur';
  if (/noida/i.test(lower)) return 'Noida';

  return str;
}

function isGenericLocation(loc) {
  if (!loc) return true;
  const str = String(loc).trim().toLowerCase();
  if (['unknown', 'sheet1', 'sheet 1', 'raw', 'jfl', 'sla_compliance_report', 'sla compliance report', 'all location', 'all locations', 'n/a', 'none', 'null'].includes(str)) return true;
  if (/^raw$/i.test(str) || /^sheet\d*$/i.test(str) || /^sla$/i.test(str) || /^jfl$/i.test(str) || /^incident$/i.test(str)) return true;
  if (str.includes('sla_compliance') || str.includes('sla compliance') || str.includes('report') || str.includes('compliance')) return true;

  return false;
}

/**
 * Merge all location sheets from the inventory file into one flat device array.
 */
function mergeInventorySheets(workbookData, locationSheets) {
  const deviceMap = {};

  locationSheets.forEach((sheet) => {
    const rows = workbookData[sheet] || [];
    rows.forEach((row, idx) => {
      const serial = String(
        getColVal(row, [
          'Serial No.', 'Serial No', 'SerialNo', 'Serial Number', 'SerialNumber', 'Serial_No', 'Serial_Number',
          'Device Serial', 'Device Serial Number', 'Device Serial No', 'Device_Serial', 'DeviceID', 'Device ID',
          'Serial', 'Serial #', 'Asset Tag', 'Asset Serial', 'Service Tag', 'MAC Address', 'Host', 'Hostname'
        ])
      ).trim();
      if (!serial) return;

      const rawLoc = getColVal(row, ['Location', 'Site', 'Site Name', 'SiteID', 'Site ID', 'Location Name', 'City', 'Branch', 'Store', 'Facility']);
      const normLoc = rawLoc ? normalizeSiteName(rawLoc) : (isGenericLocation(sheet) ? 'Unknown' : normalizeSiteName(sheet));

      const host = String(getColVal(row, ['Hostname', 'Host Name', 'Device Hostname', 'Host', 'Device Host', 'Device Name', 'Node Name', 'Name'])).trim();
      const devType = String(getColVal(row, ['Device Type', 'DeviceType', 'Type', 'Device_Type', 'Category', 'Hardware Type', 'Model Type'])).trim();
      const rack = String(getColVal(row, ['Rack no.', 'Rack', 'Rack Number', 'Rack No', 'Rack No.', 'RackID', 'Rack ID'])).trim();
      const core = String(getColVal(row, ['Core/Non Core', 'Core Non Core', 'Core_Non_Core', 'Core / Non Core', 'Core Status'])).trim();
      const model = String(getColVal(row, ['Model', 'Model Name', 'Device Model', 'Hardware Model'])).trim();

      if (!deviceMap[serial]) {
        deviceMap[serial] = {
          DeviceID:   serial,
          SerialNo:   serial,
          Hostname:   host,
          Location:   normLoc,
          SiteID:     normLoc,
          DeviceType: devType,
          Rack:       rack,
          CoreNonCore:core,
          Model:      model,
          NetworkName:getColVal(row, ['Network Name', 'NetworkName', 'Network']) || '',
          ReplacedSerial: getColVal(row, ['Faulty Serial no', 'Faulty Serial No', 'Faulty Serial', 'Faulty Serial Number', 'Replaced Serial', 'Old Serial', 'Replaced Device', 'Replaced Serial No']) || '',
          __source:   row.__source || { file: 'inventory', sheet, row: idx + 2 },
        };
      } else {
        const existing = deviceMap[serial];
        if (host && (!existing.Hostname || existing.Hostname.toLowerCase() === 'n/a')) existing.Hostname = host;
        if (devType && (!existing.DeviceType || existing.DeviceType === 'N/A')) existing.DeviceType = devType;
        if (rack && !existing.Rack) existing.Rack = rack;
        if (core && !existing.CoreNonCore) existing.CoreNonCore = core;
        if (model && !existing.Model) existing.Model = model;
        if (normLoc && normLoc !== 'Unknown' && existing.Location === 'Unknown') {
          existing.Location = normLoc;
          existing.SiteID = normLoc;
        }
      }
    });
  });

  return Object.values(deviceMap);
}

/**
 * Build a lookup map of Serial Number -> Hostname from inventory and incident rows.
 */
function buildSerialToHostnameMap(devices = [], incidents = []) {
  const serialToHostMap = {};

  const processRow = (serial, hostname) => {
    const s = String(serial || '').trim();
    const h = String(hostname || '').trim();
    if (s && h && h.toLowerCase() !== 'n/a' && h.toLowerCase() !== 'unknown' && h.toLowerCase() !== 'null') {
      serialToHostMap[s] = h;
    }
  };

  devices.forEach(d => processRow(d.SerialNo || d.DeviceID, d.Hostname));
  incidents.forEach(i => processRow(i.SerialNo || i.DeviceID, i.Hostname));

  return serialToHostMap;
}

function formatExcelDate(val) {
  if (!val && val !== 0) return 'N/A';
  if (val instanceof Date) {
    return val.toISOString().replace('T', ' ').substring(0, 16);
  }
  if (typeof val === 'string' && val.includes('-') && val.includes(':')) {
    return val;
  }
  const num = Number(val);
  if (!isNaN(num) && num > 30000 && num < 60000) {
    const jsDate = new Date(Math.round((num - 25569) * 86400 * 1000));
    if (!isNaN(jsDate.getTime())) {
      const year = jsDate.getUTCFullYear();
      const month = String(jsDate.getUTCMonth() + 1).padStart(2, '0');
      const day = String(jsDate.getUTCDate()).padStart(2, '0');
      const hours = String(jsDate.getUTCHours()).padStart(2, '0');
      const mins = String(jsDate.getUTCMinutes()).padStart(2, '0');
      return `${year}-${month}-${day} ${hours}:${mins}`;
    }
  }
  return String(val);
}

/**
 * Parse and normalise the main incident sheet.
 * Ticket Number and Incident Number are kept as separate fields so that
 * display_reference can choose: show Ticket if present, else show Incident ID.
 */
function parseIncidentSheet(rows) {
  return rows.map((row, idx) => {
    const ticketNo = String(
      getColVal(row, [
        'Ticket Number', 'TicketNumber', 'Ticket No', 'TicketNo', 'Ticket #', 'Ticket', 'Ticket ID', 'TicketID', 'Ticket_Number', 'Case Number', 'Case ID', 'Ref No', 'Reference'
      ])
    ).trim();

    const incidentId = String(
      getColVal(row, [
        'Incident Number', 'IncidentNumber', 'Incident No', 'IncidentNo', 'Incident ID', 'IncidentID',
        'Number', 'ID', 'Incident #', 'Incident', 'Incident_Number', 'Incident_ID'
      ]) || `INC-${1000 + idx}`
    ).trim();

    const devId = String(
      getColVal(row, [
        'Device Serial', 'Serial/Subscription', 'Device Serial No', 'Device Serial Number', 'Serial No', 'Serial No.',
        'DeviceID', 'Device ID', 'Serial', 'Serial Number', 'SerialNumber', 'Serial_No', 'Serial_Number',
        'Device_Serial', 'Device Serial #', 'Asset Tag', 'Host', 'Hostname', 'Device Name', 'Device'
      ])
    ).trim();

    let rawLoc = getColVal(row, ['Location', 'Site', 'SiteID', 'Site ID', 'Site Name', 'Location Name', 'City', 'Branch', 'Store', 'Facility', 'Device Name']);
    if (rawLoc && (rawLoc.toLowerCase().includes('raw') || rawLoc.toLowerCase().includes('sheet') || rawLoc.toLowerCase().includes('sla_compliance'))) {
      rawLoc = '';
    }
    const normLoc = normalizeSiteName(rawLoc);

    const cat = String(getColVal(row, ['Category', 'Ticket Category', 'Type', 'Ticket Type', 'Class', 'Category Name'])).trim();
    const desc = String(getColVal(row, ['Description', 'Short Description', 'Subject', 'Summary', 'Title', 'Incident Description'])).trim();
    const rcaStr = String(getColVal(row, ['RCA 2', 'RCA', 'Root Cause', 'RCA Category', 'Root Cause Analysis', 'RCA Reason', 'Primary RCA'])).trim();

    const openTimeRaw = getColVal(row, [
      'Created Time', 'Open Time', 'OpenTime', 'Created Date', 'Open Date', 'Opened Date', 'Opened', 'Created',
      'Incident Date', 'Date', 'Start Time', 'Start Date', 'Creation Date', 'Creation Time', 'Logged Date', 'Submit Date'
    ]);

    const resolvedTimeRaw = getColVal(row, [
      'Resolved Time', 'Close Time', 'ResolvedTime', 'Resolved Date', 'Close Date', 'Closed Date', 'Closed Time',
      'Resolved', 'Closed', 'Finish Time', 'Completion Date', 'End Time'
    ]);

    const isCR = /change|change\s*request|^cr$|normal\s*change|standard\s*change|emergency\s*change/i.test(cat) ||
                 /change|change\s*request|^cr$/i.test(rcaStr) ||
                 /change\s*request|change\s*management/i.test(desc);

    return {
      IncidentNumber: incidentId,
      TicketNumber:   ticketNo,
      DeviceID:       devId,
      SerialNo:       devId,
      Hostname:       getColVal(row, ['Hostname', 'Device Name', 'Host Name', 'Device Hostname', 'Host', 'Subject']) || '',
      Location:       normLoc,
      SiteID:         normLoc,
      DeviceType:     getColVal(row, ['Device Type', 'DeviceType', 'Type', 'Hardware Type']) || '',
      Rack:           getColVal(row, ['Rack Number', 'Rack', 'Rack No', 'Rack ID']) || '',
      Priority:       getColVal(row, ['Priority', 'Severity', 'Priority Level']) || '',
      RCA:            rcaStr || 'Unknown',
      Status:         getColVal(row, ['Status', 'Ticket Status', 'State', 'Incident Status']) || 'Closed',
      Category:       cat,
      Description:    desc,
      IsChangeRequest: isCR,
      ResolutionSLAStatusRaw: getColVal(row, ['Resolution SLA Status', 'Resolution SLA', 'SLA Status']) || '',
      ResponseSLAStatus:      getColVal(row, ['Response SLA Status', 'Response SLA']) || '',
      CreatedTime:    formatExcelDate(openTimeRaw),
      OpenTime:       openTimeRaw || null,
      ResolvedTime:   resolvedTimeRaw || null,
      ActualResolutionMin: getColVal(row, [
        'Total Proactive Downtime (Mins)- Actual resolution mint',
        'Total Proactive Downtime (Mins)- Actual resolution mint ',
        'Actual Resolution Time (min)',
        'Actual Resolution Time (min) ',
        'ActualResolutionMin',
        'Actual Resolution Time(min)',
        'Actual Resolution Time',
        'Actual Resolution (min)'
      ]),
      TotalResolutionMin: getColVal(row, [
        'Total Resolution Time (min)',
        'Total Resolution Time (min) ',
        'Total Resolution Time(min)',
        'Total Resolution Time',
        'Resolution Time (min)',
        'Resolution Time(min)'
      ]),
      ResolutionTimeMinRaw: getColVal(row, [
        'Resolution Time (min)',
        'Resolution Time (min) ',
        'Resolution Time(min)',
        'Resolution Time (min2)',
        'Duration (min)'
      ]),
      HoldTimeMin: getColVal(row, [
        'Total JFL Downtime (Mins)HOLD Minute',
        'Total JFL Downtime (Mins) HOLD Minute',
        'Total JFL Downtime (Mins)HOLD Minutes',
        'Total JFL Downtime (Mins) HOLD Minutes',
        'Time on Hold (min)',
        'Time on Hold (Minutes)',
        'Time on Hold',
        'Hold Time (min)',
        'Hold Time',
        'On Hold Duration (min)'
      ]),
      DowntimeHours:       getColVal(row, ['Downtime Hours', 'DowntimeHours', 'Outage Hours']),
      OutageHours:         getColVal(row, ['Outage Hours', 'OutageHours']),
      ResolutionTimeHours: getColVal(row, ['Resolution Time (Hrs)', 'ResolutionTimeHours', 'Duration Hours']),
      ReplacedSerial: getColVal(row, ['Faulty Serial no', 'Faulty Serial No', 'Faulty Serial', 'Faulty Serial Number', 'Replaced Serial', 'Old Serial', 'Replaced Device', 'Replaced Serial No']),
      NewSerial:      getColVal(row, ['New Serial', 'Replacement Serial', 'New Serial No']),
      AccountName:    getColVal(row, ['Account Name', 'AccountName', 'Customer Name', 'Customer', 'Account']),
      ProactiveUptimePct:  getColVal(row, ['Proactive -Uptime%', 'Proactive Uptime %', 'Average of Proactive -Uptime%']),
      JFLUptimePct:        getColVal(row, ['JFL -Uptime %', 'JFL Uptime %', 'Average of JFL -Uptime %']),
      AgreedResolutionSLAMin: getColVal(row, ['Agreed Resolution SLA (min)', 'Agreed SLA (min)']),
      __source:       row.__source,
    };
  });
}

/**
 * Parse the "All Location" uptime summary sheet.
 */
// Normalise a raw uptime value from an Excel pivot table.
// Pivot tables store percentage fields as decimals (0.9987 = 99.87%).
// When the numeric value is in the range (0, 1] we scale it to 0–100.
function normaliseUptimePct(raw) {
  const n = parseFloat(String(raw).replace('%', ''));
  if (isNaN(n)) return null;
  if (n > 0 && n <= 1) return Math.max(0, Math.min(100, parseFloat((n * 100).toFixed(2))));
  return Math.max(0, Math.min(100, parseFloat(n.toFixed(2))));
}

function parseUptimeSummary(rows) {
  const map = {};
  rows.forEach((row) => {
    const serial = row['Serial No.'] || row['Serial No'] || row['__EMPTY_1'] || '';
    const location = row['Location'] || row['__EMPTY'] || '';
    const proactive = row['Average of Proactive -Uptime%'] || row['Values'] || '';
    const jfl = row['Average of JFL -Uptime %'] || row['__EMPTY_1'] || '';
    const devType = row['Device Type'] || row['__EMPTY_2'] || '';

    if (serial && typeof serial === 'string' && serial.length > 3) {
      map[serial] = {
        proactiveUptime: normaliseUptimePct(proactive),
        jflUptime:       normaliseUptimePct(jfl),
        location:        String(location),
        deviceType:      String(devType),
      };
    }
  });
  return map;
}

/**
 * AI Excel Schema Analyzer:
 * Performs an automated structure, column mapping, data health, and metric study of ANY Excel/CSV file.
 */
function analyzeWorkbookSchema(filePath) {
  const fs = require('fs');
  const stat = fs.statSync(filePath);
  const fileSizeMB = (stat.size / (1024 * 1024)).toFixed(2);
  const fileName = path.basename(filePath);

  const wb = loadWorkbook(filePath);
  const detected = detectSheets(wb);

  const sheetsInfo = wb.__sheetNames.map((sheetName) => {
    const rows = wb[sheetName] || [];
    const sampleRow = rows[0] || {};
    const columns = Object.keys(sampleRow).filter((k) => k !== '__source');

    return {
      sheetName,
      rowCount: rows.length,
      columnCount: columns.length,
      columns,
      sampleRows: rows.slice(0, 3).map((r) => {
        const copy = { ...r };
        delete copy.__source;
        return copy;
      }),
    };
  });

  // Schema classification: determine whether workbook is an Inventory file or Incident file
  const firstSheetCols = sheetsInfo[0]?.columns || [];
  const isInventoryFile = firstSheetCols.some((c) => /serial|model|hostname|rack|core/i.test(c)) &&
    !firstSheetCols.some((c) => /ticket|resolution|downtime|sla/i.test(c));

  if (isInventoryFile) {
    const devices = mergeInventorySheets(wb, detected.locationSheets);
    const totalDevices = devices.length;
    const apCount = devices.filter((d) => /ap|access/i.test(d.DeviceType || '')).length;
    const swCount = devices.filter((d) => /sw|switch/i.test(d.DeviceType || '')).length;
    const coreCount = devices.filter((d) => /core/i.test(d.CoreNonCore || '') && !/non/i.test(d.CoreNonCore || '')).length;
    const siteNames = [...new Set(devices.map((d) => d.Location).filter(Boolean))];

    return {
      fileName,
      fileSizeMB: `${fileSizeMB} MB`,
      fileType: 'Inventory Workbook',
      analyzedAt: new Date().toISOString(),
      totalSheets: wb.__sheetNames.length,
      sheetNames: wb.__sheetNames,
      detectedRoles: {
        locationSheets: detected.locationSheets,
      },
      sheetsInfo,
      metricsSummary: {
        totalDevicesCount: totalDevices,
        accessPointsCount: apCount,
        switchesCount: swCount,
        coreDevicesCount: coreCount,
        locationsDetectedCount: siteNames.length,
        detectedLocations: siteNames,
      },
      columnMappings: [
        { field: 'Device Serial Number', mappedColumn: firstSheetCols.find((c) => /serial/i.test(c)) || 'N/A' },
        { field: 'Faulty / Replaced Serial', mappedColumn: firstSheetCols.find((c) => /faulty|replaced/i.test(c)) || 'N/A' },
        { field: 'Location / Site', mappedColumn: firstSheetCols.find((c) => /location|site|city/i.test(c)) || 'N/A' },
        { field: 'Device Type', mappedColumn: firstSheetCols.find((c) => /type|category/i.test(c)) || 'N/A' },
        { field: 'Rack Number', mappedColumn: firstSheetCols.find((c) => /rack/i.test(c)) || 'N/A' },
        { field: 'Core / Non-Core', mappedColumn: firstSheetCols.find((c) => /core/i.test(c)) || 'N/A' },
      ],
    };
  }

  // Incident file schema analysis
  const primarySheetName = detected.incidentSheet || wb.__sheetNames[0];
  const primaryRows = wb[primarySheetName] || [];
  const parsedIncidents = parseIncidentSheet(primaryRows);

  const totalIncidents = parsedIncidents.length;
  const uniqueDevices = new Set(parsedIncidents.map((i) => i.DeviceID).filter(Boolean)).size;

  const rcaCounts = {};
  parsedIncidents.forEach((i) => {
    rcaCounts[i.RCA] = (rcaCounts[i.RCA] || 0) + 1;
  });
  const topRcas = Object.entries(rcaCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([rca, count]) => ({ rca, count, pct: ((count / Math.max(1, totalIncidents)) * 100).toFixed(1) + '%' }));

  const stockCount = parsedIncidents.filter((i) =>
    /stock|inventory|spare|warehouse/i.test(i.Location || '') || /stock|spare/i.test(i.Rack || '')
  ).length;

  return {
    fileName,
    fileSizeMB: `${fileSizeMB} MB`,
    fileType: 'Incident / SLA Compliance Workbook',
    analyzedAt: new Date().toISOString(),
    totalSheets: wb.__sheetNames.length,
    sheetNames: wb.__sheetNames,
    detectedRoles: {
      incidentSheet: detected.incidentSheet,
      uptimeSheet: detected.uptimeSheet,
      locationSheets: detected.locationSheets,
    },
    sheetsInfo,
    metricsSummary: {
      totalRowsAnalyzed: primaryRows.length,
      parsedIncidentsCount: totalIncidents,
      uniqueDevicesCount: uniqueDevices,
      stockDevicesDetected: stockCount,
      topRcaBreakdown: topRcas,
    },
    columnMappings: [
      { field: 'Ticket / Incident ID', mappedColumn: sheetsInfo[0]?.columns.find(c => /ticket|incident|id/i.test(c)) || 'Auto-Generated' },
      { field: 'Device Serial Number', mappedColumn: sheetsInfo[0]?.columns.find(c => /device|serial|hostname/i.test(c)) || 'N/A' },
      { field: 'Location / Site', mappedColumn: sheetsInfo[0]?.columns.find(c => /location|site|city/i.test(c)) || 'N/A' },
      { field: 'RCA Category', mappedColumn: sheetsInfo[0]?.columns.find(c => /rca|cause|reason/i.test(c)) || 'N/A' },
      { field: 'Resolution Time (Min)', mappedColumn: sheetsInfo[0]?.columns.find(c => /resolution|downtime|duration/i.test(c)) || 'N/A' },
    ],
  };
}

module.exports = {
  loadWorkbook,
  detectSheets,
  mergeInventorySheets,
  parseIncidentSheet,
  parseUptimeSummary,
  buildSerialToHostnameMap,
  analyzeWorkbookSchema,
  normalizeSiteName,
  isGenericLocation,
};
