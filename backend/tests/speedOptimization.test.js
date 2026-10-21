const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const xlsx = require('xlsx');
const { loadWorkbook, isRemovedSheet } = require('../services/excelParser');

test('speedOptimization - PDF eradication: pdfGenerator service is completely removed', () => {
  const pdfGeneratorPath = path.resolve(__dirname, '..', 'services', 'pdfGenerator.js');
  assert.equal(fs.existsSync(pdfGeneratorPath), false, 'backend/services/pdfGenerator.js must be completely eradicated');
});

test('speedOptimization - excelParser strictly excludes "Remove from the network" sheet from JSON parsing loops', () => {
  const tmpDir = path.join(os.tmpdir(), `excel_speed_test_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const testWbPath = path.join(tmpDir, 'test_speed.xlsx');

  try {
    const wb = xlsx.utils.book_new();
    const activeData = [
      { Hostname: 'SW-01', SerialNo: 'SER001', Location: 'Bangalore' },
      { Hostname: 'SW-02', SerialNo: 'SER002', Location: 'Mumbai' }
    ];
    const removedData = [
      { Hostname: 'OLD-01', SerialNo: 'OLD001', Location: 'DecomSite' },
      { Hostname: 'OLD-02', SerialNo: 'OLD002', Location: 'DecomSite' }
    ];
    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(activeData), 'Updated Inventory -139');
    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(removedData), 'Remove from the network');
    xlsx.writeFile(wb, testWbPath);

    const loaded = loadWorkbook(testWbPath);
    assert.ok(loaded['Updated Inventory -139'].length === 2, 'Active sheets should be parsed');
    assert.ok(Array.isArray(loaded['Remove from the network']), 'Removed sheet key should exist');
    assert.equal(loaded['Remove from the network'].length, 0, 'Remove from the network sheet must be strictly excluded from row parsing loops');
  } finally {
    if (fs.existsSync(tmpDir)) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
  }
});

test('speedOptimization - processData returns cleanly without pdfPath in result object', async () => {
  const { processJFLWorkbooks } = require('../services/processData');
  const incFile = path.resolve(__dirname, '..', '..', 'SLA_Compliance_Report.csv');
  if (!fs.existsSync(incFile)) return;

  const tmpOutDir = path.join(os.tmpdir(), `test_speed_job_${Date.now()}`);
  try {
    const result = await processJFLWorkbooks(incFile, null, tmpOutDir, { periodMode: 'monthly' });
    assert.ok(result.success, 'Processing should succeed');
    assert.equal(result.pdfPath, undefined, 'pdfPath should not be in pipeline result');
    assert.ok(result.pptPath, 'pptPath should be present');
  } finally {
    if (fs.existsSync(tmpOutDir)) {
      try { fs.rmSync(tmpOutDir, { recursive: true, force: true }); } catch (_) {}
    }
  }
});
