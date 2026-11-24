// backend/services/dataHealthExporter.js
// ─────────────────────────────────────────────────────────────────────────────
// Enterprise Data Health Exporter (Excel & PDF) (Item #12)
// Generates multi-tab Excel workbooks (.xlsx) and Unicode-safe executive PDFs.
// Strictly observes MAX_EXPORT_ISSUES = 2000 and event-loop safety limits.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

let _xlsx = null;
function getXlsx() {
  if (!_xlsx) _xlsx = require('xlsx');
  return _xlsx;
}

const MAX_EXPORT_ISSUES = 2000;

/**
 * Validates issues count against maximum export threshold.
 */
function validateExportLimit(count, options = {}) {
  if (count > MAX_EXPORT_ISSUES && options.strict) {
    const err = new Error(`Payload too large: issue count (${count}) exceeds maximum export threshold of ${MAX_EXPORT_ISSUES}.`);
    err.code = 'PAYLOAD_TOO_LARGE';
    err.statusCode = 413;
    throw err;
  }
}

/**
 * Caps issues to MAX_EXPORT_ISSUES prioritizing CRITICAL > HIGH > MEDIUM > LOW.
 */
function capIssuesForExport(issues = []) {
  if (issues.length <= MAX_EXPORT_ISSUES) return issues;

  const severityWeight = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const sorted = [...issues].sort((a, b) => {
    const wa = severityWeight[a.severity] ?? 9;
    const wb = severityWeight[b.severity] ?? 9;
    return wa - wb;
  });

  return sorted.slice(0, MAX_EXPORT_ISSUES);
}

/**
 * Transliterates Unicode emojis and currency symbols to clean ASCII/Latin-1 strings
 * to prevent PDF Type 1 font "Glyph not found" errors.
 */
function sanitizeForPdf(text) {
  if (!text) return '';
  return String(text)
    .replace(/⚠️/g, '[!]')
    .replace(/🟢/g, '[PASS]')
    .replace(/🔴/g, '[FAIL]')
    .replace(/🟡/g, '[WARN]')
    .replace(/₹/g, 'INR ')
    .replace(/✓/g, '[OK]')
    .replace(/✗/g, '[X]')
    .replace(/🏢/g, '[HQ]')
    .replace(/📊/g, '[CHART]')
    .replace(/📄/g, '[DOC]')
    .replace(/⏳/g, '[PENDING]')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, ''); // Strip any non-Latin1 characters
}

/**
 * Generates a multi-sheet Excel (.xlsx) workbook for Data Health audit.
 */
function generateExcelReport(qbrData, health, options = {}) {
  validateExportLimit(health?.issues?.length || 0, options);

  const cappedIssues = capIssuesForExport(health?.issues || []);
  const xlsx = getXlsx();
  const wb = xlsx.utils.book_new();

  // ── Sheet 1: Overview & Invariants ────────────────────────────────
  const summaryRows = [
    ['Executive Data Quality & Invariant Audit Report'],
    ['Generated At', health.evaluatedAt || new Date().toISOString()],
    ['Overall Status', health.status || 'UNKNOWN'],
    ['Composite Health Score', `${health.score || 0}%`],
    ['Inventory Completeness', `${health.metrics?.inventoryCompleteness || 0}%`],
    ['Incident Hygiene', `${health.metrics?.incidentHygiene || 0}%`],
    ['Total Issues Found', health.issues?.length || 0],
    ['Issues in this Export', cappedIssues.length],
    [],
    ['Mathematical Invariant Checks (Zero-Tolerance Laws)'],
    ['Rule ID', 'Name', 'Expected Value', 'Actual Value', 'Status', 'Audit Detail'],
  ];

  (health.invariants?.checks || []).forEach((c) => {
    summaryRows.push([
      c.id,
      c.name,
      String(c.expected),
      String(c.actual),
      c.passed ? 'PASS' : 'FAIL',
      c.detail,
    ]);
  });

  const wsSummary = xlsx.utils.aoa_to_sheet(summaryRows);
  xlsx.utils.book_append_sheet(wb, wsSummary, 'Overview & Invariants');

  // ── Sheet 2: Data Hygiene Issues ──────────────────────────────────
  const issueRows = [
    ['Issue ID', 'Severity', 'Sheet Name', 'Row #', 'Offending Field', 'Offending Value', 'Message', 'Recommendation'],
  ];

  cappedIssues.forEach((issue) => {
    issueRows.push([
      issue.id,
      issue.severity,
      issue.sheetName,
      issue.rowNumber,
      issue.fieldName,
      issue.rawValue !== null && issue.rawValue !== undefined ? String(issue.rawValue) : 'NULL/EMPTY',
      issue.message,
      issue.recommendation,
    ]);
  });

  const wsIssues = xlsx.utils.aoa_to_sheet(issueRows);
  xlsx.utils.book_append_sheet(wb, wsIssues, 'Data Hygiene Issues');

  // ── Sheet 3: Action Recommendations ───────────────────────────────
  const recRows = [
    ['Priority', 'Action Item Title', 'Operational Description'],
  ];

  (health.recommendations || []).forEach((r) => {
    recRows.push([r.priority, r.title, r.description]);
  });

  const wsRecs = xlsx.utils.aoa_to_sheet(recRows);
  xlsx.utils.book_append_sheet(wb, wsRecs, 'Recommendations');

  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * Pure Node.js zero-dependency PDF 1.4 document builder.
 * Produces valid, crash-free, compliant PDF buffers without pdfGenerator.js.
 */
function generatePdfReport(qbrData, health, options = {}) {
  validateExportLimit(health?.issues?.length || 0, options);

  const cappedIssues = capIssuesForExport(health?.issues || []);
  const evalDate = sanitizeForPdf(health.evaluatedAt || new Date().toISOString().slice(0, 10));
  const statusStr = sanitizeForPdf(health.status || 'HEALTHY');
  const scoreStr = `${health.score || 0}%`;
  const clientName = sanitizeForPdf(qbrData?.executiveSummary?.clientName || 'Executive QBR Client');

  // Build PDF 1.4 objects
  const objects = [];

  const addObj = (str) => {
    objects.push(str);
    return objects.length; // 1-based obj num
  };

  // 1: Catalog
  addObj('<< /Type /Catalog /Pages 2 0 R >>');

  // 2: Pages
  addObj('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');

  // We will build content stream for Page 3
  const lines = [];
  lines.push('BT');
  lines.push('/F2 18 Tf');
  lines.push('50 740 Td');
  lines.push(`(Executive Data Quality & Invariant Audit Report) Tj`);
  lines.push('ET');

  lines.push('BT');
  lines.push('/F1 10 Tf');
  lines.push('50 720 Td');
  lines.push(`(Customer: ${clientName}  |  Evaluated: ${evalDate}) Tj`);
  lines.push('ET');

  // Health summary box
  lines.push('0.95 0.95 0.95 rg');
  lines.push('50 640 512 60 re');
  lines.push('f');

  lines.push('BT');
  lines.push('/F2 12 Tf');
  lines.push('0 0 0 rg');
  lines.push('65 675 Td');
  lines.push(`(Data Health Score: ${scoreStr}   Status: [${statusStr}]) Tj`);
  lines.push('ET');

  lines.push('BT');
  lines.push('/F1 9 Tf');
  lines.push('65 655 Td');
  lines.push(`(Inventory Completeness: ${health.metrics?.inventoryCompleteness || 0}%   Incident Hygiene: ${health.metrics?.incidentHygiene || 0}%   Invariants: ${health.invariants?.passed || 0}/${health.invariants?.total || 5} Passed) Tj`);
  lines.push('ET');

  // Invariant table header
  lines.push('BT');
  lines.push('/F2 11 Tf');
  lines.push('50 615 Td');
  lines.push('(Mathematical Invariant Conservation Audits) Tj');
  lines.push('ET');

  let y = 595;
  (health.invariants?.checks || []).forEach((c) => {
    const statusTag = c.passed ? '[PASS]' : '[FAIL]';
    const cleanName = sanitizeForPdf(c.name);
    const cleanDetail = sanitizeForPdf(c.detail);

    lines.push('BT');
    lines.push('/F1 8 Tf');
    lines.push(`50 ${y} Td`);
    lines.push(`(${statusTag} ${cleanName}: ${cleanDetail}) Tj`);
    lines.push('ET');
    y -= 15;
  });

  // Top issues section
  y -= 10;
  lines.push('BT');
  lines.push('/F2 11 Tf');
  lines.push(`50 ${y} Td`);
  lines.push(`(Top Data Hygiene & Classification Issues [Showing ${Math.min(10, cappedIssues.length)} of ${cappedIssues.length}]) Tj`);
  lines.push('ET');
  y -= 18;

  const topSample = cappedIssues.slice(0, 10);
  if (topSample.length === 0) {
    lines.push('BT');
    lines.push('/F1 9 Tf');
    lines.push(`50 ${y} Td`);
    lines.push('(Zero data hygiene issues found. Dataset is 100% compliant.) Tj');
    lines.push('ET');
    y -= 15;
  } else {
    topSample.forEach((iss) => {
      const cleanMsg = sanitizeForPdf(`${iss.severity} | Sheet: ${iss.sheetName} R#${iss.rowNumber} [${iss.fieldName}]: ${iss.message}`);
      lines.push('BT');
      lines.push('/F1 8 Tf');
      lines.push(`50 ${y} Td`);
      lines.push(`(${cleanMsg.slice(0, 95)}) Tj`);
      lines.push('ET');
      y -= 14;
    });
  }

  // Footer
  lines.push('BT');
  lines.push('/F1 8 Tf');
  lines.push('0.5 0.5 0.5 rg');
  lines.push('50 40 Td');
  lines.push('(Executive QBR Automation System -- Confidential Data Quality Audit) Tj');
  lines.push('ET');

  const contentStream = lines.join('\n');

  // 4: Content stream obj
  addObj(`<< /Length ${Buffer.byteLength(contentStream, 'utf8')} >>\nstream\n${contentStream}\nendstream`);

  // 5: Font F1 (Helvetica Regular)
  addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

  // 6: Font F2 (Helvetica Bold)
  addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  // 3: Page obj
  // Insert at index 2 (1-based index 3)
  const pageObj = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>';
  objects.splice(2, 0, pageObj);

  // Assemble full PDF
  let pdf = '%PDF-1.4\n';
  const xref = [0];

  for (let i = 0; i < objects.length; i++) {
    xref.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const startxref = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;

  for (let i = 1; i <= objects.length; i++) {
    const offset = String(xref[i]).padStart(10, '0');
    pdf += `${offset} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;

  return Buffer.from(pdf, 'utf8');
}

module.exports = {
  validateExportLimit,
  capIssuesForExport,
  sanitizeForPdf,
  generateExcelReport,
  generatePdfReport,
  MAX_EXPORT_ISSUES,
};

