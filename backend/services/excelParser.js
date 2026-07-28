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
    || (sheets.length > 0 ? sheets[0] : null);

  const uptimeSheet = sheets.find((s) => s.trim().toLowerCase().startsWith('all location')) || null;

  const locationSheets = sheets.filter((s) => {
    const lower = s.trim().toLowerCase();
    return (
      s !== incidentSheet &&
      !lower.startsWith('all location') &&
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

      devices.push({
        DeviceID:   String(serial).trim(),
        Hostname:   row['Hostname'] || row['Host Name'] || '',
        Location:   row['Location'] || sheet,
        SiteID:     row['Location'] || sheet,
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

    return {
      IncidentNumber: ticketNo,
      TicketNumber:   ticketNo,
      DeviceID:       devId,
      Location:       row['Device Name'] || row['Location'] || row['Site'] || row['SiteID'] || '',
      SiteID:         row['Device Name'] || row['Location'] || row['Site'] || row['SiteID'] || '',
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
      ProactiveUptimePct: row['Proactive -Uptime%'] || row['Average of Proactive -Uptime%'] || '',
      JFLUptimePct:       row['JFL -Uptime %'] || row['Average of JFL -Uptime %'] || '',
      TotalResolutionMin: row['Total Resolution Time (min)'] || '',
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

module.exports = {
  loadWorkbook,
  detectSheets,
  mergeInventorySheets,
  parseIncidentSheet,
  parseUptimeSummary,
};
