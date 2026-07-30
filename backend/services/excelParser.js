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
  const wb = xlsx.readFile(filePath, { cellDates: false, raw: true });
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
 * JFL-specific sheet detection for the two-file setup.
 */
function detectSheets(workbookData) {
  const sheets = workbookData.__sheetNames || [];

  const incidentSheet = sheets.find((s) => s.trim() === 'Raw')
    || sheets.find((s) => s.trim() === 'JFL')
    || sheets.find((s) => s.trim().toLowerCase() === 'raw')
    || sheets.find((s) => s.trim().toLowerCase().includes('incident'))
    || sheets.find((s) => s.trim().toLowerCase().includes('jfl'))
    || (sheets.length > 0 ? sheets[0] : null);

  const uptimeSheet = sheets.find((s) => s.trim().toLowerCase().startsWith('all location'))
    || sheets.find((s) => s.trim().toLowerCase().includes('uptime'))
    || null;

  const locationSheets = sheets.filter((s) => {
    const lower = s.trim().toLowerCase();
    return (
      s !== incidentSheet &&
      !lower.startsWith('all location') &&
      !lower.includes('uptime') &&
      !lower.startsWith('rca') &&
      !lower.startsWith('device wise')
    );
  });

  return {
    incidentSheet,
    uptimeSheet,
    locationSheets,
    allSheets: sheets,
  };
}

function normalizeSiteName(site) {
  if (!site) return 'Unknown';
  const str = String(site).trim();
  const lower = str.toLowerCase();

  if (/blr|bangalore/i.test(lower)) return 'Bangalore';
  if (/g.*noida|gr.*noida|greater.*noida|grater.*noida/i.test(lower)) return 'Greater Noida';
  if (/guwahati/i.test(lower)) return 'Guwahati';
  if (/hyd|hyderabad/i.test(lower)) return 'Hyderabad';
  if (/mohali/i.test(lower)) return 'Mohali';
  if (/mumbai/i.test(lower)) return 'Mumbai';
  if (/nagpur/i.test(lower)) return 'Nagpur';
  if (/^noida$/i.test(lower)) return 'Noida';

  return str;
}

/**
 * Merge all location sheets from the inventory file into one flat device array.
 */
function mergeInventorySheets(workbookData, locationSheets) {
  const devices = [];
  locationSheets.forEach((sheet) => {
    const rows = workbookData[sheet] || [];
    rows.forEach((row, idx) => {
      const serial = row['Serial No.'] || row['Serial No'] || row['SerialNo'] || row['Device Serial'] || row['DeviceID'] || '';
      if (!serial) return;

      const rawLoc = row['Location'] || sheet;
      const normLoc = normalizeSiteName(rawLoc);

      devices.push({
        DeviceID:   String(serial).trim(),
        Hostname:   row['Hostname'] || row['Host Name'] || '',
        Location:   normLoc,
        SiteID:     normLoc,
        DeviceType: row['Device Type'] || row['DeviceType'] || '',
        Rack:       row['Rack no.'] || row['Rack'] || row['Rack Number'] || '',
        CoreNonCore:row['Core/Non Core'] || row['Core Non Core'] || '',
        Model:      row['Model'] || '',
        NetworkName:row['Network Name'] || '',
        ReplacedSerial: row['Replaced Serial'] || row['Old Serial'] || row['Replaced Device'] || '',
        __source:   row.__source || { file: 'inventory', sheet, row: idx + 2 },
      });
    });
  });
  return devices;
}

/**
 * Parse and normalise the main incident sheet.
 * Maps unique ticket number to BOTH TicketNumber AND IncidentNumber.
 */
function parseIncidentSheet(rows) {
  return rows.map((row, idx) => {
    const ticketNo = String(
      row['Ticket Number'] ||
      row['TicketNumber'] ||
      row['Ticket No'] ||
      row['TicketNo'] ||
      row['Incident Number'] ||
      row['IncidentNumber'] ||
      row['Incident No'] ||
      row['IncidentNo'] ||
      row['Incident ID'] ||
      row['IncidentID'] ||
      row['Number'] ||
      row['ID'] ||
      row['Ticket #'] ||
      row['Incident #'] ||
      `INC-${1000 + idx}`
    ).trim();

    const devId = String(
      row['Device Serial'] ||
      row['Device Serial No'] ||
      row['Device Serial Number'] ||
      row['Serial No'] ||
      row['Serial No.'] ||
      row['DeviceID'] ||
      ''
    ).trim();

    const rawLoc = row['Location'] || row['Site'] || row['SiteID'] || row['Site Name'] || row.__source?.sheet || '';
    const normLoc = normalizeSiteName(rawLoc);

    return {
      IncidentNumber: ticketNo,
      TicketNumber:   ticketNo,
      DeviceID:       devId,
      Location:       normLoc,
      SiteID:         normLoc,
      DeviceType:     row['Device Type'] || row['DeviceType'] || '',
      Rack:           row['Rack Number'] || row['Rack'] || '',
      Priority:       row['Priority'] || row['Severity'] || '',
      RCA:            row['RCA 2'] || row['RCA'] || row['Root Cause'] || row['RCA Category'] || 'Unknown',
      Status:         row['Status'] || row['Ticket Status'] || 'Closed',
      ResolutionSLAStatus: row['Resolution SLA Status'] || '',
      ResponseSLAStatus:   row['Response SLA Status'] || '',
      CreatedTime:    row['Created Time'] || row['Open Time'] || row['OpenTime'] || '',
      OpenTime:       row['Created Time'] || row['Open Time'] || row['OpenTime'] || '',
      ReplacedSerial: row['Replaced Serial'] || row['Old Serial'] || row['Replaced Device'] || '',
      NewSerial:      row['New Serial'] || row['Replacement Serial'] || '',
      ProactiveUptimePct:  row['Proactive -Uptime%'] || row['Average of Proactive -Uptime%'] || '',
      JFLUptimePct:        row['JFL -Uptime %'] || row['Average of JFL -Uptime %'] || '',
      ActualResolutionMin: row['Actual Resolution Time (min)'] || row['Actual Resolution Time'] || '',
      TotalResolutionMin:  row['Total Resolution Time (min)'] || row['Total Resolution Time'] || row['Resolution Time (min)'] || '',
      __source:       row.__source,
    };
  });
}

/**
 * Parse the "All Location" uptime summary sheet.
 */
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
        proactiveUptime: parseFloat(String(proactive).replace('%', '')) || null,
        jflUptime:       parseFloat(String(jfl).replace('%', '')) || null,
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

  // Data schema detection
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
  analyzeWorkbookSchema,
};
