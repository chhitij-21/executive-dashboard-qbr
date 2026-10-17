const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const xlsx = require('xlsx');
const excelParser = require('../services/excelParser');
const { processJFLWorkbooks } = require('../services/processData');

test('otherActivities - Scenario 1: Bug 1 Date-Range Filter excludes out-of-period tickets', async () => {
  const tmpDir = path.join(os.tmpdir(), `oa_date_test_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const incFile = path.join(tmpDir, 'incidents.xlsx');
  const invFile = path.join(tmpDir, 'inventory.xlsx');

  // One May ticket (out of July range), one July ticket (in range)
  const incData = [
    {
      'Account Name': 'JFL',
      'Ticket Number': 'CR-MAY',
      'Site': 'Greater Noida',
      'Status': 'Closed',
      'Open Time': '2026-05-15 10:00:00',
      'Created Date': '2026-05-15 10:00:00',
      'Category': 'Change Request',
      'RCA': 'Change Request'
    },
    {
      'Account Name': 'JFL',
      'Ticket Number': 'CR-JUL',
      'Site': 'Greater Noida',
      'Status': 'Closed',
      'Open Time': '2026-07-15 10:00:00',
      'Created Date': '2026-07-15 10:00:00',
      'Category': 'Change Request',
      'RCA': 'Change Request'
    }
  ];

  const invData = [
    { 'Serial No.': 'SW01', 'Device Hostname': 'SW01', 'Location': 'Greater Noida', 'Device Type': 'Switch' }
  ];

  const wbInc = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wbInc, xlsx.utils.json_to_sheet(incData), 'Raw');
  xlsx.writeFile(wbInc, incFile);

  const wbInv = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wbInv, xlsx.utils.json_to_sheet(invData), 'Greater Noida');
  xlsx.writeFile(wbInv, invFile);

  try {
    const res = await processJFLWorkbooks(incFile, invFile, tmpDir, {
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      periodMode: 'monthly'
    });
    const dashData = JSON.parse(fs.readFileSync(res.dashboardPath, 'utf8'));

    // May ticket must be excluded. Only the July ticket should remain.
    const hasMayTicket = (dashData.otherActivities || []).some(t => t.TicketNumber === 'CR-MAY');
    assert.equal(hasMayTicket, false, 'Other Activity created outside date range must be excluded');
    assert.equal(dashData.otherActivities.length, 1, 'Only within-range Other Activity ticket should be preserved');
  } finally {
    if (fs.existsSync(tmpDir)) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
  }
});

test('otherActivities - Scenario 2: Bug 2 Site Alias Resolution from Subject/Description', () => {
  assert.equal(typeof excelParser.resolveSiteFromText, 'function', 'excelParser.resolveSiteFromText must be exported as a function');

  // "BLR" word boundary alias resolves to Bangalore
  const resBlr = excelParser.resolveSiteFromText('BLR-SCC-GUEST issue', '', 'Unknown');
  assert.equal(resBlr, 'Bangalore', 'BLR alias in subject should resolve to Bangalore');

  // "Ip to be blocked" has no site alias -> should be blank (site-agnostic)
  const resUnknown = excelParser.resolveSiteFromText('Ip to be blocked', '', 'Unknown');
  assert.equal(resUnknown, '', 'Subject without site alias must remain empty');

  // Verify 'Unknown' input from upstream is normalized to ''
  const normalized = excelParser.resolveSiteFromText(
    'Ip to be blocked', '', 'Unknown'
  );
  assert.equal(normalized, '', 'Upstream Unknown should normalize to empty');
});

test('otherActivities - Scenario 3: Bug 3 Prevent Phantom Device Fabrication from Subject', () => {
  // Raw incident row with Subject = "Ip to be blocked" and no Hostname column
  const rawRows = [
    {
      'Incident ID': 'INC-PHANTOM',
      'Subject': 'Ip to be blocked',
      'Category': 'Incident',
      'Description': 'Firewall rule update',
      'Status': 'Closed'
    }
  ];

  const parsed = excelParser.parseIncidentSheet(rawRows);
  assert.equal(parsed.length, 1);
  // Current buggy code in excelParser.js line 380 includes 'Subject' in Hostname candidates,
  // fabricating Hostname = "Ip to be blocked".
  assert.equal(parsed[0].Hostname, '', 'Hostname must not be fabricated from Subject');
});

test('otherActivities - Scenario 4: Bug 5 Slide 37 SSOT - do not fall back to hardware incidents', () => {
  // Test Slide 37 selection logic contract:
  // When qbrData.otherActivities is empty, it must NOT fall back to hardware incidents
  let pptGen;
  try { pptGen = require('../services/pptGenerator'); } catch (_) {}
  function resolveSlide37List(data) {
    if (pptGen && typeof pptGen.resolveSlide37List === 'function') {
      return pptGen.resolveSlide37List(data);
    }
    // Current buggy logic in pptGenerator.js line 2368-2376:
    // It filters nonSwApIncidents from incidents, and if empty, falls back to incidents.slice(0, 15)
    // Fixed logic must use data.otherActivities strictly.
    const allIncidents = [...(data.incidents || []), ...(data.otherActivities || [])];
    const nonSwApIncidents = allIncidents.filter(i => {
      const devType = String(i.DeviceType || i['Device Type'] || '').toLowerCase();
      const isNonSwAp = !(/^sw$|switch/i.test(devType) || /^ap$|access point/i.test(devType));
      return isNonSwAp;
    });
    // This reproduces the buggy fallback in pptGenerator.js
    return nonSwApIncidents.length > 0 ? nonSwApIncidents : (Array.isArray(allIncidents) ? allIncidents.slice(0, 15) : []);
  }

  const mockDataWithHardwareOnly = {
    otherActivities: [],
    incidents: [
      { TicketNumber: 'SW-INC-1', DeviceType: 'SW', Description: 'Switch 1 failure' },
      { TicketNumber: 'SW-INC-2', DeviceType: 'Switch', Description: 'Switch 2 failure' }
    ]
  };

  const list = resolveSlide37List(mockDataWithHardwareOnly);
  // Expected contract: When otherActivities is empty, displayList must NOT fall back to hardware switch incidents
  const hasHardwareLeak = list.some(i => /^sw$|switch/i.test(i.DeviceType || ''));
  assert.equal(hasHardwareLeak, false, 'Slide 37 must not leak hardware incidents when otherActivities is empty');
});
