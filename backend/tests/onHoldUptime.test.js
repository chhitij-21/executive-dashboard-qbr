const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const xlsx = require('xlsx');
const { processJFLWorkbooks } = require('../services/processData');

test('On-Hold Ticket Period Cutoff Uptime Calculation & Impact on Dashboard Devices', async () => {
  const tmpDir = path.join(os.tmpdir(), `on_hold_test_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const incFile = path.join(tmpDir, 'incidents.xlsx');
  const invFile = path.join(tmpDir, 'inventory.xlsx');

  // Build Incident Workbook (Raw sheet)
  const incData = [
    {
      'Ticket Number': 'PRO/INC/62624',
      'Incident Number': 'INC/62624',
      'Device Serial': 'CN123456AP05',
      'Device Name': 'JFL-GNSC-AP05',
      'Device Type': 'AP',
      'Site': 'Greater Noida',
      'Status': 'On-Hold',
      'Open Time': '2026-07-15 10:00:00',
      'Resolved Time': '',
      'Actual Resolution Time (min)': 0,
      'Time on Hold (min)': 0,
      'RCA': 'Fiber Cut'
    },
    {
      'Ticket Number': 'PRO/INC/62625',
      'Incident Number': 'INC/62625',
      'Device Serial': 'CN123456SW01',
      'Device Name': 'JFL-GNSC-SW01',
      'Device Type': 'Switch',
      'Site': 'Greater Noida',
      'Status': 'Open',
      'Open Time': '2026-07-01 00:00:00',
      'Resolved Time': '',
      'Actual Resolution Time (min)': 0,
      'Time on Hold (min)': 0,
      'RCA': 'Power Outage'
    },
    {
      'Ticket Number': 'PRO/INC/62626',
      'Incident Number': 'INC/62626',
      'Device Serial': 'CN123456SW02',
      'Device Name': 'JFL-GNSC-SW02',
      'Device Type': 'Switch',
      'Site': 'Greater Noida',
      'Status': 'Resolved',
      'Open Time': '2026-07-05 08:00:00',
      'Resolved Time': '2026-07-05 10:00:00',
      'Actual Resolution Time (min)': 120,
      'Time on Hold (min)': 30,
      'RCA': 'Hardware Failure'
    }
  ];

  // Build Inventory Workbook
  const invData = [
    {
      'Serial No.': 'CN123456AP05',
      'Device Hostname': 'JFL-GNSC-AP05',
      'Location': 'Greater Noida',
      'Device Type': 'AP'
    },
    {
      'Serial No.': 'CN123456SW01',
      'Device Hostname': 'JFL-GNSC-SW01',
      'Location': 'Greater Noida',
      'Device Type': 'Switch'
    },
    {
      'Serial No.': 'CN123456SW02',
      'Device Hostname': 'JFL-GNSC-SW02',
      'Location': 'Greater Noida',
      'Device Type': 'Switch'
    }
  ];

  const wbInc = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wbInc, xlsx.utils.json_to_sheet(incData), 'Raw');
  xlsx.writeFile(wbInc, incFile);

  const wbInv = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wbInv, xlsx.utils.json_to_sheet(invData), 'Greater Noida');
  xlsx.writeFile(wbInv, invFile);

  try {
    const result = await processJFLWorkbooks(incFile, invFile, tmpDir, {
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      periodMode: 'monthly'
    });

    assert.ok(result.success, 'Pipeline execution should succeed');

    const dashData = JSON.parse(fs.readFileSync(result.dashboardPath, 'utf8'));

    // 1. Multi-Key Device Matching Verification
    const ap05 = dashData.devices.find(d => d.DeviceID === 'JFL-GNSC-AP05' || d.SerialNo === 'CN123456AP05');
    const sw01 = dashData.devices.find(d => d.DeviceID === 'JFL-GNSC-SW01' || d.SerialNo === 'CN123456SW01');
    const sw02 = dashData.devices.find(d => d.DeviceID === 'JFL-GNSC-SW02' || d.SerialNo === 'CN123456SW02');

    assert.ok(ap05, 'AP05 device should be found and matched');
    assert.ok(sw01, 'SW01 device should be found and matched');
    assert.ok(sw02, 'SW02 device should be found and matched');

    // Total available minutes in July (31 days) = 44,640 minutes.
    // Ticket 1 (AP05) On-Hold since July 15 10:00:00 to July 31 23:59:59 = 23,880 mins elapsed hold.
    // AP05 JFL Uptime % = (44,640 - 23,880) / 44,640 * 100 = 46.51%
    // AP05 Proactive Uptime % = 46.51% (falls back to holdMins since actResMins is 0)
    assert.ok(ap05.__jflUptime < 100, `AP05 JFL Uptime should be reduced below 100%, got ${ap05.__jflUptime}`);
    assert.equal(ap05.__jflUptime, ap05.__proactiveUptime, 'AP05 Proactive Uptime should fall back to holdMins deduction');

    // Ticket 2 (SW01) Open since July 1 00:00:00 to July 31 23:59:59 = 44,640 mins elapsed hold.
    // SW01 JFL Uptime % = 0.00%
    assert.equal(sw01.__jflUptime, 0, 'SW01 open for full period should have 0% JFL uptime');
    assert.equal(sw01.__proactiveUptime, 0, 'SW01 open for full period should have 0% Proactive uptime');

    // Ticket 3 (SW02) Resolved: actRes = 120, hold = 30
    // JFL Uptime = (44,640 - 30) / 44,640 * 100 = 99.93%
    // Proactive Uptime = (44,640 - 120) / 44,640 * 100 = 99.73%
    assert.equal(sw02.__jflUptime, 99.93, 'SW02 JFL Uptime should deduct explicit 30 mins hold time');
    assert.equal(sw02.__proactiveUptime, 99.73, 'SW02 Proactive Uptime should deduct explicit 120 mins resolution time');

    // Site Summary Verification
    const gnSite = dashData.siteSummary.find(s => s.siteId === 'Greater Noida');
    assert.ok(gnSite, 'Greater Noida site summary should be present');

    // Switch uptime average for Greater Noida (sw01 = 0%, sw02 = 99.93%) -> Avg JFL Uptime = 49.97%
    assert.equal(gnSite.jflSwitchUptime, '49.97', 'Site jflSwitchUptime should equal average of switches');

  } finally {
    if (fs.existsSync(tmpDir)) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
  }
});
