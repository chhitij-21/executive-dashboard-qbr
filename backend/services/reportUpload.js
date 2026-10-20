/**
 * backend/services/reportUpload.js
 * Excel parsing and validation service for MMTC Reports (Phase 1)
 */

const path = require('path');

let xlsx;
try {
  xlsx = require('xlsx');
} catch (e) {
  xlsx = require(path.resolve(__dirname, '../../node_modules/xlsx'));
}

const LOCKED_COLUMNS = [
  'Account Name',
  'Channel',
  'Ticket Owner',
  'Ticket Number',
  'Subject',
  'Category',
  'Sub Category',
  'Device Name',
  'Serial/Subscription',
  'Device Serial',
  'Rack Number',
  'Replaced Serial Number',
  'Priority',
  'Status',
  'RCA',
  'Hold Reason',
  'Resolution',
  'Created Time',
  'Resolution Time (min)',
  'Total Resolution Time (min)',
  'Response Time',
  'Actual Response Time (min)',
  'Agreed Response SLA (min)',
  'Response SLA Status',
  'First Hold Time',
  'Last Hold Time',
  'Time on Hold (min)',
  'Actual Resolution Time (min)',
  'Agreed Resolution SLA (min)',
  'Resolution SLA Status',
  'On-Site Time',
  'Time to Site SLA Status',
  'Time to Site (min)',
];

/**
 * Validates and parses a raw Excel buffer containing SLA tickets.
 * Requires exactly 33 locked columns matching specified names and order.
 * @param {Buffer} buffer Raw spreadsheet buffer
 * @returns {{ rows: Array<object>, errors: Array<string> }}
 */
function parseTicketExcel(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error('Invalid Excel file: missing or empty buffer.');
  }

  const wb = xlsx.read(buffer, { type: 'buffer' });
  if (!wb.SheetNames || wb.SheetNames.length === 0) {
    throw new Error('Invalid Excel file: workbook contains no sheets.');
  }

  const targetSheetName = wb.SheetNames.includes('SLA_Compliance_Report')
    ? 'SLA_Compliance_Report'
    : wb.SheetNames[0];

  const sheet = wb.Sheets[targetSheetName];
  if (!sheet || !sheet['!ref']) {
    throw new Error('Invalid Excel file: sheet is empty.');
  }

  // Decode range and extract row 1 (header row)
  const range = xlsx.utils.decode_range(sheet['!ref']);
  const actualHeaders = [];
  for (let C = range.s.c; C <= range.e.c; ++C) {
    const cell = sheet[xlsx.utils.encode_cell({ r: range.s.r, c: C })];
    if (cell && cell.v !== undefined) {
      actualHeaders.push(String(cell.v).trim());
    }
  }

  // Validate exact 33 locked columns
  for (let i = 0; i < LOCKED_COLUMNS.length; i++) {
    const expectedCol = LOCKED_COLUMNS[i];
    const actualCol = actualHeaders[i];
    if (!actualCol || actualCol !== expectedCol) {
      throw new Error(
        `Missing required column: "${expectedCol}" (expected at column index ${i + 1}, found "${actualCol || 'empty'}")`
      );
    }
  }

  const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
  return { rows, errors: [] };
}

module.exports = {
  LOCKED_COLUMNS,
  parseTicketExcel,
};
