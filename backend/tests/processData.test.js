// backend/tests/processData.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { processJFLWorkbooks, filterDashboardBySite } = require('../services/processData');

test('processData - filterDashboardBySite', () => {
  const dummyDashboard = {
    reportingPeriod: 'Q1 FY2026',
    devices: [
      { DeviceID: 'SW-01', Location: 'Bangalore', DeviceType: 'Switch', __isStock: false, __effectiveUptime: 99.8 },
      { DeviceID: 'SW-02', Location: 'Mumbai', DeviceType: 'Switch', __isStock: false, __effectiveUptime: 98.5 },
    ],
    incidents: [
      { DeviceID: 'SW-02', Location: 'Mumbai', RCA: 'Power Issue' }
    ],
    siteSummary: [
      { siteId: 'Bangalore', deviceCount: 1 },
      { siteId: 'Mumbai', deviceCount: 1 }
    ]
  };

  const filtered = filterDashboardBySite(dummyDashboard, 'Bangalore');
  assert.equal(filtered.siteFilterApplied, 'Bangalore');
  assert.equal(filtered.devices.length, 1);
  assert.equal(filtered.devices[0].Location, 'Bangalore');
  assert.equal(filtered.incidents.length, 0);
});

test('processData - processJFLWorkbooks integration on sample data', async () => {
  const incFile = path.resolve(__dirname, '..', '..', 'SLA_Compliance_Report.csv');
  if (!fs.existsSync(incFile)) {
    console.log('Skipping integration test: sample SLA_Compliance_Report.csv not found locally.');
    return;
  }

  const tmpOutDir = path.join(os.tmpdir(), `test_job_${Date.now()}`);
  try {
    const result = await processJFLWorkbooks(incFile, null, tmpOutDir, { periodMode: 'monthly' });
    assert.ok(result.success, 'Processing should succeed');
    assert.ok(fs.existsSync(result.dashboardPath), 'Dashboard JSON should be created');
    assert.ok(fs.existsSync(result.reportPath), 'Validation report should be created');

    const dashContent = JSON.parse(fs.readFileSync(result.dashboardPath, 'utf8'));
    assert.ok(dashContent.executiveSummary, 'Executive summary should be present');
    assert.ok(dashContent.executiveSummary.overallUptime, 'Overall uptime should be present');
  } finally {
    if (fs.existsSync(tmpOutDir)) {
      try { fs.rmSync(tmpOutDir, { recursive: true, force: true }); } catch (e) {}
    }
  }
});
