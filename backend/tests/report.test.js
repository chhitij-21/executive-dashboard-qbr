// backend/tests/report.test.js
// Automated test suite for MMTC Reports Dashboard & Ticket Processing (TDD)

process.env.NODE_ENV = 'test';
process.env.ALLOW_DEMO_ACCOUNTS = 'true';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

let xlsx;
try {
  xlsx = require('xlsx');
} catch (e) {
  xlsx = require(path.resolve(__dirname, '../../node_modules/xlsx'));
}

// Import services and app (TDD red-first: modules may not exist yet)
let reportService = {};
try {
  reportService = require('../services/reportService');
} catch (e) {
  reportService = {};
}

let reportUpload = {};
try {
  reportUpload = require('../services/reportUpload');
} catch (e) {
  reportUpload = {};
}

const app = require('../index');

const {
  resolveClientId,
  classifyChannel,
  classifyTicketType,
  computeSla,
  extractSiteFromDeviceName,
  buildReport,
} = reportService;

const { parseTicketExcel } = reportUpload;

describe('Phase 1 — MMTC Reports Suite (TDD)', () => {
  let server;
  let baseUrl;
  let adminToken;
  let jflToken;
  let mmtcToken;

  before(async () => {
    // Start ephemeral HTTP server for route testing
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // Obtain access tokens for test personas
    const login = async (email, password) => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      assert.equal(res.status, 200, `Login failed for ${email}`);
      const json = await res.json();
      return json.token;
    };

    adminToken = await login('admin@portal.com', process.env.ADMIN_PASSWORD || 'admin123');
    jflToken = await login('jfl@portal.com', process.env.JFL_PASSWORD || 'jfl123');
    mmtcToken = await login('mmtc@portal.com', process.env.MMTC_PASSWORD || 'mmtc123');
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // ── T1. resolveClientId ──────────────────────────────────────────────────
  it('T1. resolveClientId correctly maps MMTC and rejects JFL/unknown', () => {
    assert.equal(typeof resolveClientId, 'function', 'resolveClientId must be a function');
    assert.equal(resolveClientId('mmtc'), 'mmtc');
    assert.equal(resolveClientId('client-mmtcpamp'), 'mmtc');
    assert.equal(resolveClientId('jfl'), null);
    assert.equal(resolveClientId('client-jfl'), null);
    assert.equal(resolveClientId('unknown'), null);
    assert.equal(resolveClientId(''), null);
    assert.equal(resolveClientId(null), null);
  });

  // ── T2. classifyChannel(ticket) ──────────────────────────────────────────
  it('T2. classifyChannel accurately buckets channel & category combinations', () => {
    assert.equal(typeof classifyChannel, 'function', 'classifyChannel must be a function');

    assert.equal(
      classifyChannel({ Channel: 'Alert', Category: 'Meraki Managed Services' }),
      'meraki_alerts'
    );
    assert.equal(
      classifyChannel({ Channel: 'Alert', Category: 'Security Managed Services' }),
      'security_alerts'
    );
    assert.equal(
      classifyChannel({ Channel: 'Email', Category: 'Meraki Managed Services' }),
      'meraki_emails'
    );
    assert.equal(
      classifyChannel({ Channel: 'Support Email', Category: 'Meraki Managed Services' }),
      'meraki_emails'
    );
    assert.equal(
      classifyChannel({ Channel: 'Email', Category: 'Security Managed Services' }),
      'security_emails'
    );
    assert.equal(
      classifyChannel({ Channel: 'Other', Category: 'Unknown' }),
      'other'
    );
  });

  // ── T3. classifyTicketType(ticket) ───────────────────────────────────────
  it('T3. classifyTicketType classifies CR, RF, Upgrade, and Incident (F8)', () => {
    assert.equal(typeof classifyTicketType, 'function', 'classifyTicketType must be a function');

    assert.equal(
      classifyTicketType({ 'Sub Category': 'Change Request', Subject: 'Port config' }),
      'CR'
    );
    assert.equal(
      classifyTicketType({ 'Sub Category': 'Service Request', Subject: 'User access' }),
      'RF'
    );
    assert.equal(
      classifyTicketType({ 'Sub Category': 'Software / Config', Subject: 'Firmware upgrade for switch' }),
      'Upgrade'
    );
    assert.equal(
      classifyTicketType({ 'Sub Category': 'Software / Config', RCA: 'IOS Upgrade', Subject: 'Down' }),
      'Upgrade'
    );
    assert.equal(
      classifyTicketType({ 'Sub Category': 'Hardware Issue', Subject: 'Switch went down' }),
      'Incident'
    );
  });

  // ── T4. computeSla(ticket) ───────────────────────────────────────────────
  it('T4. computeSla recomputes SLA Met, Breached, and On Hold per D5 formula (F5)', () => {
    assert.equal(typeof computeSla, 'function', 'computeSla must be a function');

    // Case A: Actual=10, Agreed=30, Total=500, Hold=400 -> Eff=10 <= 30 -> Met
    const resA = computeSla({
      Status: 'Closed',
      'Actual Resolution Time (min)': 10,
      'Agreed Resolution SLA (min)': 30,
      'Total Resolution Time (min)': 500,
      'Time on Hold (min)': 400,
    });
    assert.equal(resA.bucket, 'SLA Met');
    assert.equal(resA.effectiveResolution, 10);

    // Case B: Actual=null, Total=500, Hold=400, Agreed=180 -> Eff=100 <= 180 -> Met
    const resB = computeSla({
      Status: 'Closed',
      'Actual Resolution Time (min)': null,
      'Agreed Resolution SLA (min)': 180,
      'Total Resolution Time (min)': 500,
      'Time on Hold (min)': 400,
    });
    assert.equal(resB.bucket, 'SLA Met');
    assert.equal(resB.effectiveResolution, 100);

    // Case C: Actual=null, Total=null, Hold=500, Agreed=240 -> Eff=500 > 240 -> Breached
    const resC = computeSla({
      Status: 'Closed',
      'Actual Resolution Time (min)': null,
      'Agreed Resolution SLA (min)': 240,
      'Total Resolution Time (min)': null,
      'Time on Hold (min)': 500,
    });
    assert.equal(resC.bucket, 'SLA Breached');
    assert.equal(resC.effectiveResolution, 500);

    // Case D: all null except Excel status "SLA Breached" -> Breached
    const resD = computeSla({
      Status: 'Closed',
      'Actual Resolution Time (min)': null,
      'Resolution SLA Status': 'SLA Breached',
    });
    assert.equal(resD.bucket, 'SLA Breached');

    // Case E: Status="On Hold" -> bucket "On Hold"
    const resE = computeSla({
      Status: 'On Hold',
      'Actual Resolution Time (min)': 10,
    });
    assert.equal(resE.bucket, 'On Hold');
  });

  // ── T5. extractSiteFromDeviceName ────────────────────────────────────────
  it('T5. extractSiteFromDeviceName parses site accurately (F9)', () => {
    assert.equal(typeof extractSiteFromDeviceName, 'function', 'extractSiteFromDeviceName must be a function');

    assert.equal(extractSiteFromDeviceName('IND-PVC-CHENNAI-MX01'), 'CHENNAI');
    assert.equal(extractSiteFromDeviceName('IND-GGN-PLANT-IT-AP23'), 'GGN');
    assert.equal(extractSiteFromDeviceName('INDIA-PVC-MADURAI - MX01'), 'MADURAI');
    assert.equal(extractSiteFromDeviceName(''), 'Unknown');
    assert.equal(extractSiteFromDeviceName(null), 'Unknown');
  });

  // ── T6. buildReport matches PPT snapshot when given PPT-snapshot data ─────
  it('T6. buildReport matches PPT snapshot when given PPT-snapshot data', () => {
    assert.equal(typeof buildReport, 'function', 'buildReport must be a function');

    const fixturePath = path.resolve(__dirname, 'fixtures/mmtc_july_ppt_snapshot.json');
    assert.ok(fs.existsSync(fixturePath), 'PPT snapshot fixture must exist');
    const tickets = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

    const report = buildReport('mmtc', '2026-07-01', '2026-07-31', { tickets });

    assert.ok(report, 'Report must be generated');
    assert.equal(report.summary.total, 124, 'Total tickets must be 124');
    assert.equal(report.sla.met + report.sla.breached + report.sla.on_hold, report.summary.total);
    assert.equal(report.channel.meraki_alerts, 120, 'Meraki alerts must be 120');
    assert.equal(report.channel.security_emails, 3, 'Security emails must be 3');

    const ispRca = report.rca_breakdown.find((r) => r.rca === 'ISP Issue');
    assert.ok(ispRca, 'ISP Issue must be present in RCA breakdown');
    assert.equal(ispRca.tickets, 115, 'ISP Issue tickets count must be 115');

    assert.equal(report.isp_pct.rca_denom, 93.5, 'ISP% of closed (RCA denom) must be 93.50%');
    assert.equal(report.isp_pct.channel_denom, 92.74, 'ISP% of all (Channel denom) must be 92.74%');
  });

  // ── T11. buildReport on live data returns live On Hold=0 and ISP%=92.74 ────
  it('T11. buildReport on live data returns live On Hold=0 and ISP%=92.74', () => {
    const liveFixturePath = path.resolve(__dirname, 'fixtures/mmtc_july_live.json');
    assert.ok(fs.existsSync(liveFixturePath), 'Live fixture must exist');
    const tickets = JSON.parse(fs.readFileSync(liveFixturePath, 'utf8'));

    const report = buildReport('mmtc', '2026-07-01', '2026-07-31', { tickets });

    assert.equal(report.summary.total, 124);
    assert.equal(report.summary.on_hold, 0);
    assert.equal(report.sla.on_hold, 0);
    assert.equal(report.sla.met, 124);
    assert.equal(report.sla.breached, 0);

    const rcaTotal = report.rca_breakdown.reduce((s, r) => s + r.tickets, 0);
    assert.equal(rcaTotal, 124, 'RCA breakdown total count must be 124');

    const othersRca = report.rca_breakdown.find((r) => r.rca === 'Others');
    assert.ok(othersRca, 'Others RCA must be present');
    assert.equal(othersRca.tickets, 3, 'Others RCA count must be 3');

    assert.equal(report.isp_pct.rca_denom, 92.74, 'ISP% of closed (RCA denom) must be 92.74%');
    assert.equal(report.isp_pct.channel_denom, 92.74, 'ISP% of all (Channel denom) must be 92.74%');
  });

  // ── T7. Empty window handling ────────────────────────────────────────────
  it('T7. buildReport on empty window returns zeroed summary without crash or NaN', () => {
    const report = buildReport('mmtc', '2029-01-01', '2029-01-31', { tickets: [] });

    assert.equal(report.summary.total, 0);
    assert.equal(report.summary.closed, 0);
    assert.equal(report.summary.on_hold, 0);
    assert.equal(report.sla.met, 0);
    assert.equal(report.sla.breached, 0);
    assert.equal(report.sla.on_hold, 0);
    assert.equal(report.isp_pct.rca_denom, 0);
    assert.equal(report.isp_pct.channel_denom, 0);
    assert.ok(Array.isArray(report.rca_breakdown));
    assert.equal(report.rca_breakdown.length, 0);
    assert.ok(Array.isArray(report.top_sites));
    assert.equal(report.top_sites.length, 0);
  });

  // ── T8. Boundary inclusion/exclusion ─────────────────────────────────────
  it('T8. Boundary conditions: ticket at start is included; ticket 1s before is excluded', () => {
    const tickets = [
      {
        'Account Name': 'MMTC',
        'Ticket Number': 'T-EXACT-START',
        'Created Time': '2026-07-01 00:00',
        Status: 'Closed',
        RCA: 'ISP Issue',
        Channel: 'Alert',
        Category: 'Meraki Managed Services',
        'Actual Resolution Time (min)': 10,
      },
      {
        'Account Name': 'MMTC',
        'Ticket Number': 'T-BEFORE-START',
        'Created Time': '2026-06-30 23:59',
        Status: 'Closed',
        RCA: 'ISP Issue',
        Channel: 'Alert',
        Category: 'Meraki Managed Services',
        'Actual Resolution Time (min)': 10,
      },
      {
        'Account Name': 'MMTC',
        'Ticket Number': 'T-EXACT-END',
        'Created Time': '2026-07-31 23:59',
        Status: 'Closed',
        RCA: 'ISP Issue',
        Channel: 'Alert',
        Category: 'Meraki Managed Services',
        'Actual Resolution Time (min)': 10,
      },
      {
        'Account Name': 'MMTC',
        'Ticket Number': 'T-AFTER-END',
        'Created Time': '2026-08-01 00:00',
        Status: 'Closed',
        RCA: 'ISP Issue',
        Channel: 'Alert',
        Category: 'Meraki Managed Services',
        'Actual Resolution Time (min)': 10,
      },
    ];

    const report = buildReport('mmtc', '2026-07-01', '2026-07-31', { tickets });
    assert.equal(report.summary.total, 2, 'Should include exact start and exact end tickets only');
  });

  // ── T9. GET /api/reports/:clientId route authorization & response ────────
  it('T9. Route GET /api/reports/mmtc enforces authentication and tenant boundaries', async () => {
    // 1. Unauthenticated request -> 401
    const unauthRes = await fetch(`${baseUrl}/api/reports/mmtc?start=2026-07-01&end=2026-07-31`);
    assert.equal(unauthRes.status, 401, 'Unauth request must return 401');

    // 2. Authed JFL accessing MMTC route -> 403
    const jflRes = await fetch(`${baseUrl}/api/reports/mmtc?start=2026-07-01&end=2026-07-31`, {
      headers: { Authorization: `Bearer ${jflToken}` },
    });
    assert.equal(jflRes.status, 403, 'JFL user accessing MMTC reports must be 403');
    const jflBody = await jflRes.json();
    assert.ok(
      jflBody.code === 'CUSTOMER_ACCESS_FORBIDDEN' || jflBody.error === 'JFL not in scope',
      'Body must match expected 403 error'
    );

    // 3. Authed MMTC accessing MMTC route -> 200
    const mmtcRes = await fetch(`${baseUrl}/api/reports/mmtc?start=2026-07-01&end=2026-07-31`, {
      headers: { Authorization: `Bearer ${mmtcToken}` },
    });
    assert.equal(mmtcRes.status, 200, 'MMTC user accessing MMTC reports must be 200');
    const data = await mmtcRes.json();
    assert.ok(data.summary, 'Response must include summary');
    assert.ok(data.sla, 'Response must include sla');
    assert.ok(data.channel, 'Response must include channel');
  });

  // ── T10. POST /api/reports/:clientId/tickets/upload validation & persistence ──
  it('T10. POST /api/reports/mmtc/tickets/upload validates columns and enforces security', async () => {
    // 1. JFL user upload attempt -> 403
    const jflRes = await fetch(`${baseUrl}/api/reports/mmtc/tickets/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jflToken}` },
    });
    assert.equal(jflRes.status, 403, 'JFL upload attempt must return 403');

    // 2. Missing required column -> 400 with column name
    const invalidWb = xlsx.utils.book_new();
    const invalidSheet = xlsx.utils.json_to_sheet([
      { 'Account Name': 'MMTC', Channel: 'Alert' }, // missing 31 columns
    ]);
    xlsx.utils.book_append_sheet(invalidWb, invalidSheet, 'SLA_Compliance_Report');
    const invalidBuf = xlsx.write(invalidWb, { type: 'buffer', bookType: 'xlsx' });

    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
    const invalidBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="excel"; filename="test.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`),
      invalidBuf,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const badUploadRes = await fetch(`${baseUrl}/api/reports/mmtc/tickets/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mmtcToken}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: invalidBody,
    });
    assert.equal(badUploadRes.status, 400, 'Missing columns must return 400');
    const badUploadJson = await badUploadRes.json();
    assert.ok(badUploadJson.error && badUploadJson.error.includes('Missing required column'));

    // 3. Valid 33-column Excel buffer -> 201
    const validHeaders = [
      'Account Name', 'Channel', 'Ticket Owner', 'Ticket Number', 'Subject',
      'Category', 'Sub Category', 'Device Name', 'Serial/Subscription',
      'Device Serial', 'Rack Number', 'Replaced Serial Number', 'Priority',
      'Status', 'RCA', 'Hold Reason', 'Resolution', 'Created Time',
      'Resolution Time (min)', 'Total Resolution Time (min)', 'Response Time',
      'Actual Response Time (min)', 'Agreed Response SLA (min)',
      'Response SLA Status', 'First Hold Time', 'Last Hold Time',
      'Time on Hold (min)', 'Actual Resolution Time (min)',
      'Agreed Resolution SLA (min)', 'Resolution SLA Status',
      'On-Site Time', 'Time to Site SLA Status', 'Time to Site (min)'
    ];

    const sampleRow = {};
    validHeaders.forEach((h) => {
      sampleRow[h] = '';
    });
    sampleRow['Account Name'] = 'MMTC';
    sampleRow['Ticket Number'] = 'PRO/TEST/001';
    sampleRow['Created Time'] = '2026-07-05 10:00';
    sampleRow['Status'] = 'Closed';
    sampleRow['RCA'] = 'ISP Issue';
    sampleRow['Channel'] = 'Alert';
    sampleRow['Category'] = 'Meraki Managed Services';

    const validWb = xlsx.utils.book_new();
    const validSheet = xlsx.utils.json_to_sheet([sampleRow], { header: validHeaders });
    xlsx.utils.book_append_sheet(validWb, validSheet, 'SLA_Compliance_Report');
    const validBuf = xlsx.write(validWb, { type: 'buffer', bookType: 'xlsx' });

    const validBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="excel"; filename="valid.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`),
      validBuf,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const goodUploadRes = await fetch(`${baseUrl}/api/reports/mmtc/tickets/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mmtcToken}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: validBody,
    });
    assert.equal(goodUploadRes.status, 201, 'Valid upload must return 201');
    const goodUploadJson = await goodUploadRes.json();
    assert.ok(goodUploadJson.insertedCount >= 1 || goodUploadJson.totalRows >= 1);
  });
});
