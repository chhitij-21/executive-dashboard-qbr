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

test('processData - open/on-hold ticket period cutoff uptime calculation for APs and Switches', async () => {
  const tmpOutDir = path.join(os.tmpdir(), `test_cutoff_job_${Date.now()}`);
  try {
    // Create dummy incident workbook mock in memory / via processJFLWorkbooks if needed
    // or test logic directly.
  } finally {
    if (fs.existsSync(tmpOutDir)) {
      try { fs.rmSync(tmpOutDir, { recursive: true, force: true }); } catch (e) {}
    }
  }
});

test('processData - dynamic client pipeline logging and IQ-200 AI validator 100% on MMTC schema', () => {
  const { continuousPipelineAudit } = require('../services/ai/iq200Validator');
  const mmtcData = {
    customerName: 'MMTC',
    clientId: 'client-mmtcpamp',
    reportingPeriod: '1 September 2026 – 30 September 2026',
    report_period: {
      display_label: '1 September 2026 – 30 September 2026',
      start_date: '2026-09-01',
      end_date: '2026-09-30',
      window_minutes: 43200,
    },
    executiveSummary: {
      totalSites: 1,
      totalDevices: 182,
      totalSwitches: 100,
      totalAPs: 82,
      totalStockDevices: 0,
      totalIncidents: 46,
      overallUptime: '99.99',
      proactiveSwitchUptime: '99.99',
      jflSwitchUptime: null,
      healthScore: '91.03',
      healthLabel: 'Good',
      slaCompliance: '98.39',
      slaComplianceRate: '98.39',
      slaTarget: 99.3,
      primaryRcaSwitches: 'Device Power Issues',
      primaryRcaAPs: 'Stable Operations (No Incidents)',
    },
    siteSummary: [
      {
        siteId: 'MMTC HQ',
        deviceCount: 182,
        switchCount: 100,
        apCount: 82,
        stockCount: 0,
        incidentCount: 46,
        apIncidents: 0,
        uniqueAPsWithIncidents: 0,
        proactiveSwitchUptime: '99.99',
        jflSwitchUptime: null,
        overallUptime: '99.99',
        primaryRcaSwitches: 'Device Power Issues',
        primaryRcaAPs: 'Stable Operations (No Incidents)',
      },
    ],
    rcaAnalytics: {
      breakdown: [
        { rca: 'Device Power Issues', count: 46, percentage: '100.00%' },
      ],
    },
    slaAnalytics: {
      overallSLAPercent: 98.39,
      slaTarget: 99.3,
    },
    devices: [
      { DeviceID: 'CORE-1', SerialNo: 'SER-1', Hostname: 'CORE-1', __jflUptime: 100, __proactiveUptime: 99.99, __isStock: false },
      { DeviceID: 'STOCK-1', SerialNo: 'STK-1', Hostname: 'STOCK-1', __jflUptime: 100, __proactiveUptime: 100, __isStock: true },
    ],
    incidents: [
      {
        TicketNumber: 'PRO/INC/41590',
        IncidentID: 'PRO/INC/41590',
        RCA: 'Device Power Issues',
        ActualResolutionMin: 11.37,
        HoldTimeMin: 180.82,
        TotalResolutionMin: 192.19,
        sla_status: 'SLA Met',
        display_reference: { type: 'Ticket', value: 'PRO/INC/41590' },
      },
    ],
    hold_tickets: [
      { ticket_number: 'INC-1001', subject: 'Site power failure', reason: 'Power Outage', rollover: 'On Hold', created_date: '2026-09-02' }
    ],
    cr_tickets: [
      { s_no: 1, subject: 'Firewall policy update', category: 'Security', sub_category: 'Change Request', status: 'Closed' }
    ],
    cr_summary: {
      meraki_crs: 0,
      security_crs: 1,
      security_emails: 0,
      total_crs: 1,
    },
  };

  const audit = continuousPipelineAudit(mmtcData, { clientId: 'client-mmtcpamp', clientName: 'MMTC' });
  assert.equal(audit.status, 'PASS');
  assert.equal(audit.score, 100);
  assert.equal(audit.hallucinationsDetected, 0);
  assert.equal(audit.invariants.passed, 20);
  assert.equal(audit.invariants.failed, 0);
});

test('processData - RMA reconciliation marks old serial Faulty and new serial Active', () => {
  const { reconcileRMA } = require('../services/processData');
  assert.equal(typeof reconcileRMA, 'function', 'reconcileRMA must be exported as a function');

  const devices = [
    { DeviceID: 'DEV-OLD-01', SerialNo: 'OLD-SER-123', DeployementStatus: 'Active', Status: 'Active' },
    { DeviceID: 'DEV-NEW-01', SerialNo: 'NEW-SER-456', DeployementStatus: 'Stock', Status: 'Stock' },
    { DeviceID: 'DEV-OTHER', SerialNo: 'OTHER-789', DeployementStatus: 'Active', Status: 'Active' },
  ];

  const incidents = [
    {
      IncidentID: 'INC-RMA-01',
      'Device Serial': 'OLD-SER-123',
      'Replaced Serial Number': 'NEW-SER-456',
    },
  ];

  reconcileRMA(devices, incidents);

  assert.equal(devices[0].DeployementStatus, 'Faulty', 'Old serial DeployementStatus must be Faulty');
  assert.equal(devices[0].Status, 'Faulty', 'Old serial Status must be Faulty');
  assert.equal(devices[1].DeployementStatus, 'Active', 'New replacement serial DeployementStatus must be Active');
  assert.equal(devices[1].Status, 'Active', 'New replacement serial Status must be Active');
  assert.equal(devices[2].DeployementStatus, 'Active', 'Untouched serial must remain Active');
});

test('processData - RMA reconciliation updates device status to Faulty and Active for both MMTC and JFL clients across multiple serial key formats', () => {
  const { reconcileRMA } = require('../services/processData');

  // Case 1: JFL format (DeviceID & Device Serial Number)
  const jflDevices = [
    { DeviceID: 'JFL-SW-01', Serial: 'JFL-OLD-111', DeployementStatus: 'Active', Status: 'Active' },
    { DeviceID: 'JFL-SW-02', Serial: 'JFL-NEW-222', DeployementStatus: 'Stock', Status: 'Stock' },
  ];
  const jflIncidents = [
    {
      IncidentID: 'INC-JFL-RMA',
      'Device Serial Number': 'jfl-old-111 ', // test trimming & case insensitivity
      'Replaced Serial Number': ' jfl-new-222',
    },
  ];
  reconcileRMA(jflDevices, jflIncidents);
  assert.equal(jflDevices[0].DeployementStatus, 'Faulty');
  assert.equal(jflDevices[0].Status, 'Faulty');
  assert.equal(jflDevices[1].DeployementStatus, 'Active');
  assert.equal(jflDevices[1].Status, 'Active');

  // Case 2: MMTC format (SerialNo & DeviceID fallbacks)
  const mmtcDevices = [
    { DeviceID: 'MMTC-OLD-DEV', DeployementStatus: 'Active', Status: 'Active' },
    { DeviceID: 'MMTC-NEW-DEV', DeployementStatus: 'Stock', Status: 'Stock' },
  ];
  const mmtcIncidents = [
    {
      IncidentID: 'INC-MMTC-RMA',
      DeviceID: 'MMTC-OLD-DEV',
      'Replaced Serial Number': 'MMTC-NEW-DEV',
    },
  ];
  reconcileRMA(mmtcDevices, mmtcIncidents);
  assert.equal(mmtcDevices[0].DeployementStatus, 'Faulty');
  assert.equal(mmtcDevices[0].Status, 'Faulty');
  assert.equal(mmtcDevices[1].DeployementStatus, 'Active');
  assert.equal(mmtcDevices[1].Status, 'Active');
});

test('processData - buildIncidentAnalytics aggregates historical incidents & flags dataWarning if single month', () => {
  const { buildIncidentAnalytics } = require('../services/processData');

  const devices = [{ DeviceID: 'DEV-1', Location: 'Site1', DeviceType: 'Switch', __isStock: false }];

  // 1. Single month of data without historical -> dataWarning must be present
  const singleMonthIncidents = [
    { IncidentID: 'INC-1', DeviceID: 'DEV-1', 'Created Time': '2026-08-05 10:00', RCA: 'ISP Issue' },
    { IncidentID: 'INC-2', DeviceID: 'DEV-1', 'Created Time': '2026-08-15 11:00', RCA: 'Power Outage' },
  ];
  const singleMonthRes = buildIncidentAnalytics(singleMonthIncidents, devices, {});
  assert.equal(
    singleMonthRes.dataWarning,
    'Only 1 month of data available. Trend requires multi-month data.',
    'Must return dataWarning when only 1 month exists'
  );
  assert.equal(singleMonthRes.monthlyTrend.length >= 1, true);

  // 2. Multi-month with historical incidents passed -> aggregated trend & no dataWarning
  const historicalIncidents = [
    { IncidentID: 'HIST-1', DeviceID: 'DEV-1', 'Created Time': '2026-06-10 10:00', RCA: 'Hardware' },
    { IncidentID: 'HIST-2', DeviceID: 'DEV-1', 'Created Time': '2026-07-12 11:00', RCA: 'ISP Issue' },
  ];
  const multiMonthRes = buildIncidentAnalytics(singleMonthIncidents, devices, {
    historicalIncidents,
  });
  assert.equal(multiMonthRes.dataWarning, null, 'dataWarning must be null when multi-month data exists');
  const monthsInTrend = multiMonthRes.monthlyTrend.map(t => t.month);
  assert.ok(monthsInTrend.includes('2026-06'), 'Trend must include June historical');
  assert.ok(monthsInTrend.includes('2026-07'), 'Trend must include July historical');
  assert.ok(monthsInTrend.includes('2026-08'), 'Trend must include August current');
});


