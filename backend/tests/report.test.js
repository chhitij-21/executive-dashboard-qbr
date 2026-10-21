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
  buildDeterministicSummary,
} = reportService;

const { parseTicketExcel, dualWriteToReportsTickets } = reportUpload;

let reportHelpers = {};
try {
  reportHelpers = require('../../frontend/src/utils/reportHelpers');
} catch (e) {
  reportHelpers = {};
}
const { isTabHiddenForClient } = reportHelpers;

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

  // ── T12. buildDeterministicSummary — non-empty case ──────────────────────
  it('T12. buildDeterministicSummary returns structured text matching July live fixture', () => {
    assert.equal(typeof buildDeterministicSummary, 'function', 'buildDeterministicSummary must be a function');
    const liveFixturePath = path.resolve(__dirname, 'fixtures/mmtc_july_live.json');
    const tickets = JSON.parse(fs.readFileSync(liveFixturePath, 'utf8'));
    const report = buildReport('mmtc', '2026-07-01', '2026-07-31', { tickets });
    const summary = buildDeterministicSummary(report);

    assert.ok(typeof summary === 'string' && summary.trim().length > 0, 'Summary must be non-empty string');
    assert.ok(summary.includes('124'), 'Summary must include total ticket count 124');
    assert.ok(summary.includes('ISP Issue'), 'Summary must include top driver ISP Issue');
    assert.ok(summary.includes('Overall Ticket SLA Compliance stands at'), 'Summary must include Ticket SLA compliance');
    assert.doesNotMatch(summary, /empty/i, 'Summary must not contain "empty"');
    assert.doesNotMatch(summary, /no data/i, 'Summary must not contain "no data"');
    assert.doesNotMatch(summary, /configuration missing/i, 'Summary must not contain "configuration missing"');
  });

  // ── T13. buildDeterministicSummary — empty fixture ───────────────────────
  it('T13. buildDeterministicSummary on empty fixture returns fallback without NaN or throwing', () => {
    assert.equal(typeof buildDeterministicSummary, 'function', 'buildDeterministicSummary must be a function');
    const emptyReport = {
      summary: { total: 0, closed: 0, on_hold: 0 },
      sla: { met: 0, breached: 0, on_hold: 0, by_type: {} },
      channel: {},
      rca_breakdown: [],
      isp_pct: { rca_denom: 0, channel_denom: 0 },
      top_sites: [],
      meta: { start: '2026-01-01', end: '2026-01-05' },
    };
    const summary = buildDeterministicSummary(emptyReport);
    assert.ok(typeof summary === 'string', 'Summary must be a string');
    assert.ok(summary.includes('No tickets'), 'Summary must mention "No tickets"');
    assert.doesNotMatch(summary, /NaN/, 'Summary must not contain NaN');
  });

  // ── T14. dualWriteToReportsTickets — MMTC case ───────────────────────────
  it('T14. dualWriteToReportsTickets writes to reports_tickets for MMTC with DELETE then INSERTs', async () => {
    assert.equal(typeof dualWriteToReportsTickets, 'function', 'dualWriteToReportsTickets must be a function');
    const dbMockCalls = [];
    let db = null;
    try {
      db = require('../config/database');
    } catch (_) {}
    const origExecute = db?.execute;

    try {
      if (db) {
        db.execute = async (sql, params) => {
          dbMockCalls.push({ sql, params });
          return { rows: [] };
        };
      }

      const sampleTickets = [
        { 'Ticket Number': 'T1', 'Created Time': '2026-07-02 10:00', Status: 'Closed', Channel: 'Alert', Category: 'Meraki' },
        { 'Ticket Number': 'T2', 'Created Time': '2026-07-03 11:00', Status: 'Closed', Channel: 'Email', Category: 'Meraki' },
        { 'Ticket Number': 'T3', 'Created Time': '2026-07-04 12:00', Status: 'Closed', Channel: 'Alert', Category: 'Security' },
        { 'Ticket Number': 'T4', 'Created Time': '2026-07-05 13:00', Status: 'Closed', Channel: 'Email', Category: 'Security' },
        { 'Ticket Number': 'T5', 'Created Time': '2026-07-06 14:00', Status: 'Closed', Channel: 'Alert', Category: 'Meraki' },
      ];

      const res = await dualWriteToReportsTickets('mmtc', sampleTickets, { start: '2026-07-01', end: '2026-07-31' });
      assert.equal(res.written, 5, 'Must return written: 5');

      const deleteCalls = dbMockCalls.filter(c => c.sql.toUpperCase().includes('DELETE FROM REPORTS_TICKETS'));
      assert.ok(deleteCalls.length >= 1, 'Must call DELETE FROM reports_tickets');
      assert.equal(deleteCalls[0].params[0], 'mmtc', 'DELETE must target client_id=mmtc');

      const insertCalls = dbMockCalls.filter(c => c.sql.toUpperCase().includes('INSERT OR REPLACE INTO REPORTS_TICKETS'));
      assert.equal(insertCalls.length, 5, 'Must execute 5 INSERT calls');
    } finally {
      if (db && origExecute) db.execute = origExecute;
    }
  });

  // ── T15. dualWriteToReportsTickets — JFL safety ──────────────────────────
  it('T15. dualWriteToReportsTickets safely returns early for JFL with ZERO database calls', async () => {
    assert.equal(typeof dualWriteToReportsTickets, 'function', 'dualWriteToReportsTickets must be a function');
    const dbMockCalls = [];
    let db = null;
    try {
      db = require('../config/database');
    } catch (_) {}
    const origExecute = db?.execute;

    try {
      if (db) {
        db.execute = async (sql, params) => {
          dbMockCalls.push({ sql, params });
          return { rows: [] };
        };
      }

      const sampleTickets = [
        { 'Ticket Number': 'JFL-1', Status: 'Closed' },
      ];

      const res = await dualWriteToReportsTickets('jfl', sampleTickets, { start: '2026-07-01', end: '2026-07-31' });
      assert.equal(res.written, 0, 'Must return written: 0');
      assert.equal(res.skipped, 'not-mmtc', 'Must return skipped: not-mmtc');
      assert.equal(dbMockCalls.length, 0, 'Must make ZERO database calls for JFL');

      const resClientJfl = await dualWriteToReportsTickets('client-jfl', sampleTickets, { start: '2026-07-01', end: '2026-07-31' });
      assert.equal(resClientJfl.written, 0);
      assert.equal(resClientJfl.skipped, 'not-mmtc');
      assert.equal(dbMockCalls.length, 0, 'Must make ZERO database calls for client-jfl');
    } finally {
      if (db && origExecute) db.execute = origExecute;
    }
  });

  // ── T16. GET /api/reports/mmtc/latest — no uploads ───────────────────────
  it('T16. GET /api/reports/mmtc/latest returns 200 with zeroed report when no uploads exist', async () => {
    let db = null;
    try {
      db = require('../config/database');
    } catch (_) {}
    // Ensure reports_tickets for mmtc is empty
    if (db && typeof db.execute === 'function') {
      await db.execute('DELETE FROM reports_tickets WHERE client_id = ?', ['mmtc']).catch(() => {});
    }

    const res = await fetch(`${baseUrl}/api/reports/mmtc/latest`, {
      headers: { Authorization: `Bearer ${mmtcToken}` },
    });
    assert.equal(res.status, 200, 'Endpoint must return 200');
    const json = await res.json();
    assert.equal(json.summary?.total, 0, 'Total tickets must be 0');
    assert.equal(json.meta?.uploaded_at, null, 'meta.uploaded_at must be null');
  });

  // ── T17. GET /api/reports/mmtc/latest — with July fixture loaded ──────────
  it('T17. GET /api/reports/mmtc/latest returns 200 and latest batch data when uploads exist', async () => {
    const liveFixturePath = path.resolve(__dirname, 'fixtures/mmtc_july_live.json');
    const tickets = JSON.parse(fs.readFileSync(liveFixturePath, 'utf8'));
    const { persistTickets } = reportService;
    assert.equal(typeof persistTickets, 'function');

    await persistTickets('mmtc', tickets);

    const res = await fetch(`${baseUrl}/api/reports/mmtc/latest`, {
      headers: { Authorization: `Bearer ${mmtcToken}` },
    });
    assert.equal(res.status, 200, 'Endpoint must return 200');
    const json = await res.json();
    assert.equal(json.summary?.total, 124, 'Total tickets must be 124 from latest upload');
    assert.ok(typeof json.meta?.uploaded_at === 'string' && json.meta.uploaded_at.length > 0, 'meta.uploaded_at must be ISO string');
  });

  // ── T18. GET /api/reports/jfl/latest — JFL rejected (403) ────────────────
  it('T18. GET /api/reports/jfl/latest is strictly rejected with 403 Forbidden', async () => {
    const res = await fetch(`${baseUrl}/api/reports/jfl/latest`, {
      headers: { Authorization: `Bearer ${jflToken}` },
    });
    assert.equal(res.status, 403, 'JFL client access to reports must return 403');
  });

  // ── T19. frontend isTabHiddenForClient helper ────────────────────────────
  it('T19. isTabHiddenForClient correctly identifies hidden tabs for MMTC vs JFL', () => {
    assert.equal(typeof isTabHiddenForClient, 'function', 'isTabHiddenForClient must be a function');
    assert.equal(isTabHiddenForClient('client-mmtcpamp', 'sites'), true);
    assert.equal(isTabHiddenForClient('client-mmtcpamp', 'switches'), true);
    assert.equal(isTabHiddenForClient('client-mmtcpamp', 'aps'), true);
    assert.equal(isTabHiddenForClient('client-mmtcpamp', 'executive'), false);
    assert.equal(isTabHiddenForClient('client-jfl', 'sites'), false);
    assert.equal(isTabHiddenForClient('client-jfl', 'switches'), false);
    assert.equal(isTabHiddenForClient('client-jfl', 'aps'), false);
  });

  // ── T20. buildReport date filtering & hold_tickets / cr_tickets data shape (Phase 1 & 2) ──
  it('T20. buildReport strictly filters by date window (Sept window returns ~103 incidents, hold_tickets and cr_tickets)', () => {
    assert.equal(typeof buildReport, 'function', 'buildReport must be a function');
    const report = buildReport('mmtc', '2026-09-01', '2026-09-30');

    assert.ok(report, 'Report must be generated');
    assert.notEqual(report.summary.total, 349, 'Must not dump all 349 tickets into Sept report');
    assert.ok(report.summary.total >= 100 && report.summary.total <= 110, `Sept total tickets must be ~103-105, got ${report.summary.total}`);
    assert.equal(report.sla.by_type.Incident, 103, `Sept incidents must be 103, got ${report.sla.by_type.Incident}`);

    // TASK 2b: Data Shape checks
    assert.ok(Array.isArray(report.hold_tickets), 'report.hold_tickets must be an array');
    assert.ok(Array.isArray(report.cr_tickets), 'report.cr_tickets must be an array');

    // Also verify CR tickets data shape with window having CR tickets (e.g. August 2026)
    const augReport = buildReport('mmtc', '2026-08-01', '2026-08-31');
    assert.ok(Array.isArray(augReport.cr_tickets), 'augReport.cr_tickets must be an array');
    assert.ok(augReport.cr_tickets.length > 0, 'August window must have CR tickets');
    augReport.cr_tickets.forEach((cr, idx) => {
      assert.equal(cr.s_no, idx + 1, 'cr_ticket must have 1-based s_no');
      assert.ok('subject' in cr, 'cr_ticket must have subject');
      assert.ok('category' in cr, 'cr_ticket must have category');
      assert.ok('sub_category' in cr, 'cr_ticket must have sub_category');
      assert.ok('status' in cr, 'cr_ticket must have status');
    });

    // Also verify hold_tickets shape when present
    if (report.hold_tickets.length > 0) {
      report.hold_tickets.forEach(ht => {
        assert.ok('ticket_number' in ht, 'hold_ticket must have ticket_number');
        assert.ok('subject' in ht, 'hold_ticket must have subject');
        assert.ok('reason' in ht, 'hold_ticket must have reason');
        assert.ok('rollover' in ht, 'hold_ticket must have rollover');
        assert.ok('created_date' in ht, 'hold_ticket must have created_date');
      });
    }
  });

  // ── T21. isp_device_breakdown sort & grand total (Phase 2) ────────────────
  it('T21. isp_device_breakdown filters RCA == "ISP Issue", groups by Device Name, sorts descending, and calculates isp_grand_total', () => {
    const liveFixturePath = path.resolve(__dirname, 'fixtures/mmtc_july_live.json');
    const tickets = JSON.parse(fs.readFileSync(liveFixturePath, 'utf8'));
    const report = buildReport('mmtc', '2026-07-01', '2026-07-31', { tickets });

    assert.ok(Array.isArray(report.isp_device_breakdown), 'report.isp_device_breakdown must be an array');
    assert.ok(report.isp_device_breakdown.length > 0, 'Must have at least one ISP device entry');
    assert.equal(typeof report.isp_grand_total, 'number', 'isp_grand_total must be a number');

    let sum = 0;
    for (let i = 0; i < report.isp_device_breakdown.length; i++) {
      const item = report.isp_device_breakdown[i];
      assert.equal(item.s_no, i + 1, 's_no must be 1-indexed');
      assert.equal(typeof item.month, 'string', 'month must be a string');
      assert.ok(item.month.length > 0, 'month must not be empty');
      assert.equal(typeof item.device_name, 'string', 'device_name must be a string');
      assert.ok(item.device_name.length > 0, 'device_name must not be empty');
      assert.equal(typeof item.total, 'number', 'total must be a number');
      assert.ok(item.total > 0, 'total must be > 0');
      sum += item.total;

      if (i > 0) {
        assert.ok(
          report.isp_device_breakdown[i - 1].total >= item.total,
          `Must be sorted descending by total: ${report.isp_device_breakdown[i - 1].total} >= ${item.total}`
        );
      }
    }

    assert.equal(report.isp_grand_total, sum, 'isp_grand_total must equal sum of device totals');
    assert.equal(report.isp_grand_total, 115, 'July fixture ISP tickets total must be 115');
  });

  // ── T22. buildDeterministicSummary rich string template (Phase 2) ─────────
  it('T22. buildDeterministicSummary outputs exact rich template with total, met, breached, topRca, topIspDevice, and slaPercentage', () => {
    const liveFixturePath = path.resolve(__dirname, 'fixtures/mmtc_july_live.json');
    const tickets = JSON.parse(fs.readFileSync(liveFixturePath, 'utf8'));
    const report = buildReport('mmtc', '2026-07-01', '2026-07-31', { tickets });
    const summary = buildDeterministicSummary(report);

    const topRca = report.rca_breakdown[0].rca;
    const topRcaCount = report.rca_breakdown[0].tickets;
    const topIspDevice = report.isp_device_breakdown[0].device_name;
    const topIspCount = report.isp_device_breakdown[0].total;
    const expected = `MMTC received a total of 124 tickets. Out of these, 124 met the SLA and 0 were breached. The primary RCA driver was ${topRca} (${topRcaCount} tickets). The top ISP-affected device was ${topIspDevice} with ${topIspCount} tickets. Overall Ticket SLA Compliance stands at 100.00%.`;

    assert.equal(summary, expected);
  });

  // ── T23. GET /api/reports/mmtc/latest?jobId=<batch> filtering ────────────
  it('T23. GET /api/reports/mmtc/latest?jobId=<batch> filters by specific jobId and returns exact batch dates', async () => {
    let db = null;
    try {
      db = require('../config/database');
    } catch (_) {}

    if (!db || typeof db.execute !== 'function') return;

    // Clean up test tickets
    await db.execute("DELETE FROM reports_tickets WHERE client_id = 'mmtc'");

    // Insert July batch (job-july-test)
    const tJuly1 = { 'Ticket Number': 'TEST-JULY-1', 'Created Time': '2026-07-10 10:00', Status: 'Closed', Channel: 'Alert', Category: 'Meraki' };
    const tJuly2 = { 'Ticket Number': 'TEST-JULY-2', 'Created Time': '2026-07-15 11:00', Status: 'Closed', Channel: 'Email', Category: 'Meraki' };
    await db.execute(
      `INSERT INTO reports_tickets (client_id, ticket_number, period_start, period_end, payload_json, bucket, ticket_type, uploaded_at, job_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['mmtc', 'TEST-JULY-1', '2026-07-01', '2026-07-31', JSON.stringify(tJuly1), 'within_sla', 'incident', '2026-08-01T10:00:00.000Z', 'job-july-test']
    );
    await db.execute(
      `INSERT INTO reports_tickets (client_id, ticket_number, period_start, period_end, payload_json, bucket, ticket_type, uploaded_at, job_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['mmtc', 'TEST-JULY-2', '2026-07-01', '2026-07-31', JSON.stringify(tJuly2), 'within_sla', 'incident', '2026-08-01T10:00:00.000Z', 'job-july-test']
    );

    // Insert August batch (job-aug-test)
    const tAug1 = { 'Ticket Number': 'TEST-AUG-1', 'Created Time': '2026-08-05 10:00', Status: 'Closed', Channel: 'Alert', Category: 'Meraki' };
    const tAug2 = { 'Ticket Number': 'TEST-AUG-2', 'Created Time': '2026-08-12 11:00', Status: 'Closed', Channel: 'Email', Category: 'Meraki' };
    const tAug3 = { 'Ticket Number': 'TEST-AUG-3', 'Created Time': '2026-08-20 12:00', Status: 'Closed', Channel: 'Alert', Category: 'Meraki' };
    await db.execute(
      `INSERT INTO reports_tickets (client_id, ticket_number, period_start, period_end, payload_json, bucket, ticket_type, uploaded_at, job_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['mmtc', 'TEST-AUG-1', '2026-08-01', '2026-08-31', JSON.stringify(tAug1), 'within_sla', 'incident', '2026-09-01T10:00:00.000Z', 'job-aug-test']
    );
    await db.execute(
      `INSERT INTO reports_tickets (client_id, ticket_number, period_start, period_end, payload_json, bucket, ticket_type, uploaded_at, job_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['mmtc', 'TEST-AUG-2', '2026-08-01', '2026-08-31', JSON.stringify(tAug2), 'within_sla', 'incident', '2026-09-01T10:00:00.000Z', 'job-aug-test']
    );
    await db.execute(
      `INSERT INTO reports_tickets (client_id, ticket_number, period_start, period_end, payload_json, bucket, ticket_type, uploaded_at, job_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['mmtc', 'TEST-AUG-3', '2026-08-01', '2026-08-31', JSON.stringify(tAug3), 'within_sla', 'incident', '2026-09-01T10:00:00.000Z', 'job-aug-test']
    );

    // 1. Query specifically for July job
    const resJuly = await fetch(`${baseUrl}/api/reports/mmtc/latest?jobId=job-july-test`, {
      headers: { Authorization: `Bearer ${mmtcToken}` },
    });
    assert.equal(resJuly.status, 200);
    const jsonJuly = await resJuly.json();
    assert.equal(jsonJuly.summary?.total, 2, 'July batch must return exactly 2 tickets');
    assert.equal(jsonJuly.meta?.start, '2026-07-01', 'Start date must match July batch');
    assert.equal(jsonJuly.meta?.end, '2026-07-31', 'End date must match July batch');

    // 2. Query default latest (should return August)
    const resLatest = await fetch(`${baseUrl}/api/reports/mmtc/latest`, {
      headers: { Authorization: `Bearer ${mmtcToken}` },
    });
    assert.equal(resLatest.status, 200);
    const jsonLatest = await resLatest.json();
    assert.equal(jsonLatest.summary?.total, 3, 'Latest batch must return 3 August tickets');
    assert.equal(jsonLatest.meta?.start, '2026-08-01', 'Start date must match August batch');
    assert.equal(jsonLatest.meta?.end, '2026-08-31', 'End date must match August batch');
  });

  // ── T24. isp_location_breakdown groups by location (Phase 2 update) ─────────
  it('T24. isp_location_breakdown groups ISP issues by site location and includes location field', () => {
    const liveFixturePath = path.resolve(__dirname, 'fixtures/mmtc_july_live.json');
    const tickets = JSON.parse(fs.readFileSync(liveFixturePath, 'utf8'));
    const report = buildReport('mmtc', '2026-07-01', '2026-07-31', { tickets });

    assert.ok(Array.isArray(report.isp_location_breakdown), 'report.isp_location_breakdown must be an array');
    assert.ok(report.isp_location_breakdown.length > 0, 'Must have at least one ISP location entry');
    assert.equal(typeof report.isp_grand_total, 'number');
    assert.ok(report.isp_location_breakdown[0].location, 'Entry must have a location field');
    assert.equal(typeof report.isp_location_breakdown[0].location, 'string');
  });
});


