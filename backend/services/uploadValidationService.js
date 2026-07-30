// backend/services/uploadValidationService.js
// Validates uploaded files before triggering the heavy calculation pipeline.
// Verifies presence, file format, workbook readabilities, sheet existence, and column presence.

const xlsx = require('xlsx');
const path = require('path');

function validateUpload(incidentInput, inventoryInput) {
  const errors = [];
  const warnings = [];

  const incidentFilePath = typeof incidentInput === 'object' ? incidentInput?.path : incidentInput;
  const incidentOrigName = typeof incidentInput === 'object' ? (incidentInput?.originalname || incidentInput?.path) : incidentInput;

  const inventoryFilePath = typeof inventoryInput === 'object' ? inventoryInput?.path : inventoryInput;
  const inventoryOrigName = typeof inventoryInput === 'object' ? (inventoryInput?.originalname || inventoryInput?.path) : inventoryInput;

  if (!incidentFilePath) {
    errors.push('Mandatory Incident Excel file is missing.');
    return { valid: false, errors, warnings };
  }

  // 1. Validate File Extensions
  const incExt = path.extname(incidentOrigName || incidentFilePath).toLowerCase();
  if (!['.xlsx', '.xls', '.csv'].includes(incExt)) {
    errors.push(`Invalid file format for Incidents (${incidentOrigName}): expected .xlsx or .xls`);
  }

  if (inventoryFilePath && inventoryOrigName) {
    const invExt = path.extname(inventoryOrigName || inventoryFilePath).toLowerCase();
    if (!['.xlsx', '.xls'].includes(invExt)) {
      errors.push(`Invalid file format for Inventory (${inventoryOrigName}): expected .xlsx or .xls`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  // 2. Validate Incident Workbook Structure
  let incWb;
  try {
    incWb = xlsx.readFile(incidentFilePath, { cellDates: false, raw: true, dense: true });
  } catch (err) {
    errors.push(`Corrupted or unreadable Incident Excel file: ${err.message}`);
    return { valid: false, errors, warnings };
  }

  if (!incWb.SheetNames || incWb.SheetNames.length === 0) {
    errors.push('Incident Excel file contains no worksheets.');
    return { valid: false, errors, warnings };
  }

  // Check main sheet availability
  const sheetNames = incWb.SheetNames;
  const mainSheetName = sheetNames.find((s) => s.trim() === 'Raw') ||
    sheetNames.find((s) => s.trim() === 'JFL') ||
    sheetNames.find((s) => s.trim().toLowerCase() === 'raw') ||
    sheetNames[0];

  const mainSheet = incWb.Sheets[mainSheetName];
  if (!mainSheet) {
    errors.push(`Primary worksheet "${mainSheetName}" could not be read.`);
    return { valid: false, errors, warnings };
  }

  const mainRows = xlsx.utils.sheet_to_json(mainSheet, { defval: '' });
  if (!mainRows || mainRows.length === 0) {
    errors.push(`Worksheet "${mainSheetName}" contains no data rows.`);
    return { valid: false, errors, warnings };
  }

  // Column verification
  const firstRow = mainRows[0];
  const requiredCandidates = ['DeviceID', 'Device ID', 'Serial No.', 'Serial No', 'Location', 'Incident Number'];
  const hasIdentifierCol = Object.keys(firstRow).some((k) =>
    requiredCandidates.some((c) => k.toLowerCase().includes(c.toLowerCase()))
  );

  if (!hasIdentifierCol) {
    warnings.push(`Worksheet "${mainSheetName}" missing standard device identifier headers (e.g. DeviceID, Serial No). Logic will attempt auto-mapping.`);
  }

  // 3. Validate Inventory Workbook Structure (if provided)
  if (inventoryFilePath) {
    let invWb;
    try {
      invWb = xlsx.readFile(inventoryFilePath, { cellDates: false, raw: true, dense: true });
    } catch (err) {
      warnings.push(`Inventory file unreadable: ${err.message}. Processing will fall back to incident-only data.`);
    }

    if (invWb && (!invWb.SheetNames || invWb.SheetNames.length === 0)) {
      warnings.push('Inventory Excel file has no worksheets. Processing will fall back to incident-only data.');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: {
      sheetsDetected: sheetNames,
      totalIncidentRows: mainRows.length,
    }
  };
}

module.exports = {
  validateUpload,
};
