const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const xlsx = require('xlsx');
const { processJFLWorkbooks } = require('../services/processData');

// Helper to run pipeline in an isolated temp directory
async function runUptimePipeline(switches, incidents, periodOptions = { startDate: '2026-07-01', endDate: '2026-07-31', periodMode: 'monthly' }) {
  const tmpDir = path.join(os.tmpdir(), `sla_uptime_test_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const incFile = path.join(tmpDir, 'incidents.xlsx');
  const invFile = path.join(tmpDir, 'inventory.xlsx');

  const wbInc = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wbInc, xlsx.utils.json_to_sheet(incidents.length > 0 ? incidents : [{ 'Account Name': 'JFL' }]), 'Raw');
  xlsx.writeFile(wbInc, incFile);

  const wbInv = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wbInv, xlsx.utils.json_to_sheet(switches), 'Greater Noida');
  xlsx.writeFile(wbInv, invFile);

  try {
    const res = await processJFLWorkbooks(incFile, invFile, tmpDir, periodOptions);
    const dashData = JSON.parse(fs.readFileSync(res.dashboardPath, 'utf8'));
    return { dashData, gnSite: (dashData.siteSummary || []).find(s => s.siteId === 'Greater Noida') };
  } finally {
    if (fs.existsSync(tmpDir)) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
  }
}

test('slaUptimeFormula - Scenario A: Zero incidents returns 100.00% uptime', async () => {
  const switches = [
    { 'Serial No.': 'SW01', 'Device Hostname': 'SW01', 'Location': 'Greater Noida', 'Device Type': 'SW' },
    { 'Serial No.': 'SW02', 'Device Hostname': 'SW02', 'Location': 'Greater Noida', 'Device Type': 'SW' }
  ];
  const incidents = [];

  const { gnSite } = await runUptimePipeline(switches, incidents);
  assert.ok(gnSite, 'Site Greater Noida should exist');
  assert.equal(gnSite.proactiveSwitchUptime, '100.00');
  assert.equal(gnSite.jflSwitchUptime, '100.00');
});

test('slaUptimeFormula - Scenario B: RC1 Blank ActMin Fallback to (totMin - holdMin)', async () => {
  const switches = [
    { 'Serial No.': 'SW01', 'Device Hostname': 'SW01', 'Location': 'Greater Noida', 'Device Type': 'SW' }
  ];
  const incidents = [
    {
      'Account Name': 'JFL',
      'Ticket Number': 'INC-RC1',
      'Device Serial': 'SW01',
      'Device Type': 'SW',
      'Site': 'Greater Noida',
      'Status': 'Resolved',
      'Open Time': '2026-07-01 10:00:00',
      'Resolved Time': '2026-07-01 12:00:00',
      'Actual Resolution Time (min)': '',  // Blank - should fall back to totMin - holdMin = 20 min
      'Total Resolution Time (min)': 120,
      'Time on Hold (min)': 100,
      'SubCategory': 'Software Fault'
    }
  ];

  // Window July (31 days) = 44,640 min.
  // Fallback downtime = 120 - 100 = 20 min.
  // Expected proactive uptime: (44,640 - 20) / 44,640 * 100 = 99.955% -> '99.96'
  // Current buggy code evaluates actMin = 0 and returns '100.00'
  const { gnSite } = await runUptimePipeline(switches, incidents);
  assert.ok(gnSite, 'Site Greater Noida should exist');
  assert.equal(gnSite.proactiveSwitchUptime, '99.96', 'Blank ActMin should fall back to totMin - holdMin = 20 min downtime');
});

test('slaUptimeFormula - Scenario C: RC2 Broad Filter counts non-software switch incidents', async () => {
  const switches = [
    { 'Serial No.': 'SW01', 'Device Hostname': 'SW01', 'Location': 'Greater Noida', 'Device Type': 'SW' }
  ];
  const incidents = [
    {
      'Account Name': 'JFL',
      'Ticket Number': 'INC-RC2-A',
      'Device Serial': 'SW01',
      'Device Type': 'SW',
      'Site': 'Greater Noida',
      'Status': 'Resolved',
      'Open Time': '2026-07-01 10:00:00',
      'Resolved Time': '2026-07-01 11:00:00',
      'Actual Resolution Time (min)': 60,
      'Time on Hold (min)': 0,
      'SubCategory': 'Software Fault'
    },
    {
      'Account Name': 'JFL',
      'Ticket Number': 'INC-RC2-B',
      'Device Serial': 'SW01',
      'Device Type': 'SW',
      'Site': 'Greater Noida',
      'Status': 'Resolved',
      'Open Time': '2026-07-02 10:00:00',
      'Resolved Time': '2026-07-02 12:00:00',
      'Actual Resolution Time (min)': 120,
      'Time on Hold (min)': 0,
      'SubCategory': 'Hardware Fault'  // Non-software subcategory
    }
  ];

  // Window July (31 days) = 44,640 min.
  // Both incidents must be counted: 60 + 120 = 180 min total downtime.
  // Expected proactive uptime: (44,640 - 180) / 44,640 * 100 = 99.5967% -> '99.60'
  // Current buggy code filters with sub.includes('software'), skips Hardware Fault, and calculates from 60 min only -> '99.87'
  const { gnSite } = await runUptimePipeline(switches, incidents);
  assert.ok(gnSite, 'Site Greater Noida should exist');
  assert.equal(gnSite.proactiveSwitchUptime, '99.60', 'Hardware switch incident must be counted in switch uptime');
});

test('slaUptimeFormula - Scenario D: RC3 Cumulative Division vs Ticket Averaging', async () => {
  const switches = [
    { 'Serial No.': 'SW01', 'Device Hostname': 'SW01', 'Location': 'Greater Noida', 'Device Type': 'SW' }
  ];
  // 1 switch, 2 incidents (60 min + 120 min = 180 min total downtime).
  // Window = 44,640 min.
  // Cumulative: (44,640 - 180) / 44,640 * 100 = 44,460 / 44,640 * 100 = 99.5967% -> '99.60'
  // Buggy ticket average: avg((44640-60)/44640*100, (44640-120)/44640*100) = avg(99.865, 99.731) = 99.798% -> '99.80'
  const incidents = [
    {
      'Account Name': 'JFL',
      'Ticket Number': 'INC-D1',
      'Device Serial': 'SW01',
      'Device Type': 'SW',
      'Site': 'Greater Noida',
      'Status': 'Resolved',
      'Open Time': '2026-07-01 10:00:00',
      'Resolved Time': '2026-07-01 11:00:00',
      'Actual Resolution Time (min)': 60,
      'Time on Hold (min)': 0,
      'SubCategory': 'Software Fault'
    },
    {
      'Account Name': 'JFL',
      'Ticket Number': 'INC-D2',
      'Device Serial': 'SW01',
      'Device Type': 'SW',
      'Site': 'Greater Noida',
      'Status': 'Resolved',
      'Open Time': '2026-07-02 10:00:00',
      'Resolved Time': '2026-07-02 12:00:00',
      'Actual Resolution Time (min)': 120,
      'Time on Hold (min)': 0,
      'SubCategory': 'Software Fault'
    }
  ];

  const { gnSite } = await runUptimePipeline(switches, incidents);
  assert.ok(gnSite, 'Site Greater Noida should exist');
  assert.equal(gnSite.proactiveSwitchUptime, '99.60', 'Cumulative division must sum all downtime (180 min) and divide by switch window');
});

test('slaUptimeFormula - Scenario E: RC4 Bounds Clamping when cumulative downtime exceeds window', async () => {
  const switches = [
    { 'Serial No.': 'SW01', 'Device Hostname': 'SW01', 'Location': 'Greater Noida', 'Device Type': 'SW' }
  ];
  // 1 switch, July (44,640 min). Two incidents of 30,000 min each = 60,000 min total downtime (> 44,640 min).
  // Cumulative formula: (44,640 - 60,000) < 0 -> clamped to '0.00'.
  // Buggy ticket average: avg((44640-30000)/44640*100, (44640-30000)/44640*100) = 32.80% -> '32.80'!
  const incidents = [
    {
      'Account Name': 'JFL',
      'Ticket Number': 'INC-E1',
      'Device Serial': 'SW01',
      'Device Type': 'SW',
      'Site': 'Greater Noida',
      'Status': 'Resolved',
      'Open Time': '2026-07-01 10:00:00',
      'Resolved Time': '2026-07-15 10:00:00',
      'Actual Resolution Time (min)': 30000,
      'Time on Hold (min)': 0,
      'SubCategory': 'Software Fault'
    },
    {
      'Account Name': 'JFL',
      'Ticket Number': 'INC-E2',
      'Device Serial': 'SW01',
      'Device Type': 'SW',
      'Site': 'Greater Noida',
      'Status': 'Resolved',
      'Open Time': '2026-07-16 10:00:00',
      'Resolved Time': '2026-07-31 10:00:00',
      'Actual Resolution Time (min)': 30000,
      'Time on Hold (min)': 0,
      'SubCategory': 'Software Fault'
    }
  ];

  const { gnSite } = await runUptimePipeline(switches, incidents);
  assert.ok(gnSite, 'Site Greater Noida should exist');
  assert.equal(gnSite.proactiveSwitchUptime, '0.00', 'Cumulative downtime exceeding total window must clamp to 0.00%');
});
