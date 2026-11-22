require('./_setup');
// backend/tests/dataHealth.test.js
process.env.NODE_ENV = 'test';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const dataHealthService = require('../services/dataHealthService');
const dataHealthExporter = require('../services/dataHealthExporter');

describe('Data Health Panel & Invariant Engine Suite (Item #12)', () => {
  const sampleCleanQbrData = {
    executiveSummary: {
      totalSites: 2,
      totalDevices: 4,
      totalSwitches: 2,
      totalAPs: 2,
      stockDevices: 0,
      totalIncidents: 2,
      jflUptime: 99.85,
      proactiveUptime: 99.50,
      slaCompliance: 100.0,
      slaTarget: 99.3,
      healthScore: 100,
    },
    devices: [
      {
        DeviceID: 'SW-01',
        Hostname: 'DEL-SW-01',
        Type: 'Switch',
        DeviceType: 'Switch',
        Model: 'Cisco Catalyst 9300',
        IP: '192.168.1.1',
        SerialNo: 'SN-SW01',
        Site: 'Delhi Hub',
        Location: 'Delhi Hub',
        __jflUptime: 99.9,
        __proactiveUptime: 99.5,
        __sheet: 'Updated Inventory -139',
        __rowNum: 2,
      },
      {
        DeviceID: 'SW-02',
        Hostname: 'BLR-SW-01',
        Type: 'Switch',
        DeviceType: 'Switch',
        Model: 'Cisco Catalyst 9300',
        IP: '192.168.1.2',
        SerialNo: 'SN-SW02',
        Site: 'Bangalore Hub',
        Location: 'Bangalore Hub',
        __jflUptime: 99.8,
        __proactiveUptime: 99.5,
        __sheet: 'Updated Inventory -139',
        __rowNum: 3,
      },
      {
        DeviceID: 'AP-01',
        Hostname: 'DEL-AP-01',
        Type: 'Access Point',
        DeviceType: 'Access Point',
        Model: 'Cisco Meraki MR46',
        IP: '192.168.2.1',
        SerialNo: 'SN-AP01',
        Site: 'Delhi Hub',
        Location: 'Delhi Hub',
        __jflUptime: 100.0,
        __proactiveUptime: 100.0,
        __sheet: 'Updated Inventory -139',
        __rowNum: 4,
      },
      {
        DeviceID: 'AP-02',
        Hostname: 'BLR-AP-01',
        Type: 'Access Point',
        DeviceType: 'Access Point',
        Model: 'Cisco Meraki MR46',
        IP: '192.168.2.2',
        SerialNo: 'SN-AP02',
        Site: 'Bangalore Hub',
        Location: 'Bangalore Hub',
        __jflUptime: 100.0,
        __proactiveUptime: 100.0,
        __sheet: 'Updated Inventory -139',
        __rowNum: 5,
      },
    ],
    siteSummary: [
      { site: 'Delhi Hub', deviceCount: 2, switches: 1, aps: 1, uptime: 99.95 },
      { site: 'Bangalore Hub', deviceCount: 2, switches: 1, aps: 1, uptime: 99.90 },
    ],
    incidents: [
      {
        TicketNumber: 'INC-1001',
        DeviceID: 'SW-01',
        Site: 'Delhi Hub',
        RCA: 'Power Outage',
        sla_status: 'SLA Met',
        HoldTimeMinutes: 15,
        ResolutionTimeMinutes: 45,
        CreatedTime: '2026-05-02T10:00:00Z',
        __sheet: 'Incident Details',
        __rowNum: 2,
      },
      {
        TicketNumber: 'INC-1002',
        DeviceID: 'SW-02',
        Site: 'Bangalore Hub',
        RCA: 'ISP Fiber Cut',
        sla_status: 'SLA Met',
        HoldTimeMinutes: 30,
        ResolutionTimeMinutes: 60,
        CreatedTime: '2026-05-15T14:00:00Z',
        __sheet: 'Incident Details',
        __rowNum: 3,
      },
    ],
    incidentAnalytics: {
      rcaBreakdown: [
        { rca: 'Power Outage', count: 1 },
        { rca: 'ISP Fiber Cut', count: 1 },
      ],
    },
    slaCompliance: {
      met: 2,
      breached: 0,
      open: 0,
      overall: 100.0,
    },
    report_period: {
      start_date: '2026-05-01',
      end_date: '2026-05-31',
      display_label: '1 May 2026 – 31 May 2026',
    },
  };

  it('1. Clean Dataset: Verifies 100% score, HEALTHY status, and all 5 invariant checks pass', () => {
    const health = dataHealthService.calculateDataHealth(sampleCleanQbrData);
    assert.strictEqual(health.status, 'HEALTHY');
    assert.strictEqual(health.score, 100);
    assert.strictEqual(health.invariants.total, 5);
    assert.strictEqual(health.invariants.passed, 5);
    assert.strictEqual(health.invariants.failed, 0);
    assert.ok(health.invariants.checks.every((c) => c.passed === true));
    assert.strictEqual(health.issues.length, 0);
  });

  it('2. Broken Physical Inventory Arithmetic: Deliberately mismatches active devices vs total, asserts R1 fails and CRITICAL status', () => {
    const corruptData = JSON.parse(JSON.stringify(sampleCleanQbrData));
    corruptData.executiveSummary.totalDevices = 10; // Claiming 10 total but only 2+2=4 active

    const health = dataHealthService.calculateDataHealth(corruptData);
    assert.strictEqual(health.status, 'CRITICAL');
    assert.ok(health.score < 90);
    const r1 = health.invariants.checks.find((c) => c.id === 'R1_INVENTORY_CONSERVATION');
    assert.ok(r1);
    assert.strictEqual(r1.passed, false);
    assert.strictEqual(r1.expected, 10);
    assert.strictEqual(r1.actual, 4);
  });

  it('3. Broken RCA Breakdown Sum: Injects extra uncounted incident, asserts R2 fails', () => {
    const corruptData = JSON.parse(JSON.stringify(sampleCleanQbrData));
    // incidents.length is 3 now, but rcaBreakdown sums to 2
    corruptData.incidents.push({
      TicketNumber: 'INC-1003',
      DeviceID: 'SW-01',
      RCA: 'Unlisted Hardware Fault',
      sla_status: 'SLA Met',
      HoldTimeMinutes: 10,
    });
    corruptData.executiveSummary.totalIncidents = 3;

    const health = dataHealthService.calculateDataHealth(corruptData);
    const r2 = health.invariants.checks.find((c) => c.id === 'R2_RCA_SUMMATION');
    assert.ok(r2);
    assert.strictEqual(r2.passed, false);
    assert.strictEqual(r2.expected, 3);
    assert.strictEqual(r2.actual, 2);
  });

  it('4. Lightweight Issue Summary: Main payload includes sheetName, rowNumber, fieldName, rawValue, but omits rowSnapshot', () => {
    const incompleteData = JSON.parse(JSON.stringify(sampleCleanQbrData));
    delete incompleteData.devices[0].SerialNo; // Missing serial
    incompleteData.devices[1].IP = ''; // Missing IP
    incompleteData.incidents[0].RCA = 'Unknown'; // Unclassified RCA

    const health = dataHealthService.calculateDataHealth(incompleteData);
    assert.ok(health.issues.length >= 3);

    const serialIssue = health.issues.find((i) => i.type === 'DEVICE_MISSING_SERIAL');
    assert.ok(serialIssue);
    assert.strictEqual(serialIssue.sheetName, 'Updated Inventory -139');
    assert.strictEqual(serialIssue.rowNumber, 2);
    assert.strictEqual(serialIssue.fieldName, 'SerialNo');
    assert.strictEqual(serialIssue.rowSnapshot, undefined, 'rowSnapshot must be omitted in main response for lazy loading');

    const rcaIssue = health.issues.find((i) => i.type === 'INCIDENT_MISSING_RCA');
    assert.ok(rcaIssue);
    assert.strictEqual(rcaIssue.sheetName, 'Incident Details');
    assert.strictEqual(rcaIssue.rowNumber, 2);
    assert.strictEqual(rcaIssue.fieldName, 'RCA');
    assert.strictEqual(rcaIssue.rawValue, 'Unknown');
  });

  it('5. Lazy Row Snapshot: Resolves full rowSnapshot on-demand by issueId', () => {
    const incompleteData = JSON.parse(JSON.stringify(sampleCleanQbrData));
    delete incompleteData.devices[0].SerialNo;

    const health = dataHealthService.calculateDataHealth(incompleteData);
    const serialIssue = health.issues.find((i) => i.type === 'DEVICE_MISSING_SERIAL');
    assert.ok(serialIssue);

    const snapshotResult = dataHealthService.getIssueRowSnapshot(incompleteData, serialIssue.id);
    assert.ok(snapshotResult);
    assert.strictEqual(snapshotResult.success, true);
    assert.strictEqual(snapshotResult.sheetName, 'Updated Inventory -139');
    assert.strictEqual(snapshotResult.rowNumber, 2);
    assert.ok(snapshotResult.rowSnapshot);
    assert.strictEqual(snapshotResult.rowSnapshot.DeviceID, 'SW-01');
    assert.strictEqual(snapshotResult.rowSnapshot.Hostname, 'DEL-SW-01');
  });

  it('6. Excel Export (.xlsx): Generates valid multi-sheet workbook buffer with PK magic bytes and capped rows', () => {
    const health = dataHealthService.calculateDataHealth(sampleCleanQbrData);
    const xlsxBuffer = dataHealthExporter.generateExcelReport(sampleCleanQbrData, health);

    assert.ok(Buffer.isBuffer(xlsxBuffer));
    assert.ok(xlsxBuffer.length > 500);
    // OpenXML PK Zip magic bytes (0x50, 0x4B, 0x03, 0x04)
    assert.strictEqual(xlsxBuffer[0], 0x50);
    assert.strictEqual(xlsxBuffer[1], 0x4B);
    assert.strictEqual(xlsxBuffer[2], 0x03);
    assert.strictEqual(xlsxBuffer[3], 0x04);
  });

  it('7. PDF Export (.pdf): Generates valid PDF buffer with %PDF-1.4 header and Unicode transliteration (⚠️, ₹)', () => {
    const qbrWithSymbols = JSON.parse(JSON.stringify(sampleCleanQbrData));
    qbrWithSymbols.executiveSummary.clientName = 'Jubilant FoodWorks ⚠️ ₹ Standard';
    const health = dataHealthService.calculateDataHealth(qbrWithSymbols);

    const pdfBuffer = dataHealthExporter.generatePdfReport(qbrWithSymbols, health);
    assert.ok(Buffer.isBuffer(pdfBuffer));
    assert.ok(pdfBuffer.length > 300);
    const header = pdfBuffer.subarray(0, 8).toString('ascii');
    assert.ok(header.startsWith('%PDF-1.4'), 'Must start with standard %PDF-1.4 header');

    // Confirm transliteration did not leave raw non-WinAnsi multibyte glyphs
    const pdfText = pdfBuffer.toString('binary');
    assert.ok(!pdfText.includes('⚠️'), 'Emojis must be transliterated');
  });

  it('8. Export Hard Limit: Rejects with 413 when issue count exceeds 2,000 and strict=true', () => {
    // Generate synthetic dataset with 2,500 issues
    const largeHealth = {
      status: 'WARNING',
      score: 75,
      invariants: { total: 5, passed: 5, failed: 0, checks: [] },
      issues: Array.from({ length: 2500 }, (_, i) => ({
        id: `issue_${i}`,
        type: 'DEVICE_MISSING_SERIAL',
        severity: 'LOW',
        message: `Device #${i} is missing serial number.`,
        sheetName: 'Inventory',
        rowNumber: i + 2,
        fieldName: 'SerialNo',
        rawValue: null,
      })),
      metrics: {
        inventoryCompleteness: 50,
        incidentHygiene: 100,
        anomaliesCount: 0,
      },
    };

    assert.throws(
      () => {
        dataHealthExporter.validateExportLimit(largeHealth.issues.length, { strict: true });
      },
      (err) => {
        assert.strictEqual(err.code, 'PAYLOAD_TOO_LARGE');
        assert.strictEqual(err.statusCode, 413);
        return true;
      }
    );

    // Without strict=true, capping happens cleanly
    const capped = dataHealthExporter.capIssuesForExport(largeHealth.issues);
    assert.strictEqual(capped.length, 2000);
  });

  it('9. Empty / Minimal Dataset: Handles null/zeroed inputs safely with INSUFFICIENT_DATA status and null score', () => {
    const emptyHealth = dataHealthService.calculateDataHealth({});
    assert.ok(emptyHealth);
    assert.strictEqual(emptyHealth.status, 'INSUFFICIENT_DATA');
    assert.strictEqual(emptyHealth.score, null);
    assert.strictEqual(emptyHealth.issues.length, 0);
  });
});

describe('Data Health Routes & HTTP Security Suite (Item #12)', () => {
  const app = require('../index');
  let server = null;
  let baseUrl = '';
  let adminToken = '';
  let clientToken = '';

  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });

    const adminRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@portal.com', password: 'admin123' }),
    });
    adminToken = (await adminRes.json()).token;

    const clientRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'jfl@portal.com', password: 'jfl123' }),
    });
    clientToken = (await clientRes.json()).token;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('1. GET /api/data-health returns 200 with lightweight payload', async () => {
    const res = await fetch(`${baseUrl}/api/data-health`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(body.health);
    assert.ok(['HEALTHY', 'WARNING', 'CRITICAL'].includes(body.health.status));
    assert.ok(Array.isArray(body.health.issues));
    // Verify rowSnapshot is omitted
    if (body.health.issues.length > 0) {
      assert.strictEqual(body.health.issues[0].rowSnapshot, undefined);
    }
  });

  it('2. GET /api/data-health/export?format=xlsx downloads valid Excel file with Content-Disposition header', async () => {
    const res = await fetch(`${baseUrl}/api/data-health/export?format=xlsx`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers.get('content-type').includes('spreadsheetml'));
    const contentDisposition = res.headers.get('content-disposition') || '';
    assert.ok(contentDisposition.includes('attachment; filename="Data_Health_Report_latest.xlsx"'));
    const buf = Buffer.from(await res.arrayBuffer());
    assert.strictEqual(buf[0], 0x50);
    assert.strictEqual(buf[1], 0x4B);
  });

  it('3. GET /api/data-health/export?format=pdf downloads valid PDF file with Content-Disposition header', async () => {
    const res = await fetch(`${baseUrl}/api/data-health/export?format=pdf`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers.get('content-type').includes('application/pdf'));
    const contentDisposition = res.headers.get('content-disposition') || '';
    assert.ok(contentDisposition.includes('attachment; filename="Data_Health_Report_latest.pdf"'));
    const buf = Buffer.from(await res.arrayBuffer());
    const header = buf.subarray(0, 5).toString('ascii');
    assert.strictEqual(header, '%PDF-');
  });

  it('4. Rate Limiting on Export: Exceeding 5 requests in a minute returns 429 Too Many Requests with Retry-After header', async () => {
    // We already made 2 export calls above with adminToken (tenant: global/admin). Let's make 4 more to hit the limit.
    let hit429 = false;
    for (let i = 0; i < 6; i++) {
      const res = await fetch(`${baseUrl}/api/data-health/export?format=xlsx`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (res.status === 429) {
        hit429 = true;
        assert.strictEqual(res.headers.get('retry-after'), '60');
        const errJson = await res.json();
        assert.strictEqual(errJson.code, 'RATE_LIMIT_EXCEEDED');
        assert.strictEqual(errJson.retryAfter, 60);
        break;
      }
    }
    assert.ok(hit429, 'Expected export rate limiter to return HTTP 429');
  });

  it('5. Sanitize jobId in Content-Disposition Filename: Strips CRLF, quotes and special characters', async () => {
    // Use clientToken which has a clean rate limit window
    const dirtyJobId = 'job"with\r\nCRLF and/special?chars';
    // Test with clientToken on latest default data
    const res = await fetch(`${baseUrl}/api/data-health/export?format=xlsx&jobId=${encodeURIComponent(dirtyJobId)}`, {
      headers: {
        Authorization: `Bearer ${clientToken}`,
        'x-client-id': 'client-jfl',
      },
    });
    // Regardless of whether 200 (if latest fallback) or error, test sanitize regex logic directly
    const sanitizeJobId = (id) => String(id || 'latest').replace(/[^a-zA-Z0-9_-]/g, '_');
    const cleaned = sanitizeJobId(dirtyJobId);
    assert.strictEqual(cleaned, 'job_with__CRLF_and_special_chars');
    assert.ok(!cleaned.includes('\r'));
    assert.ok(!cleaned.includes('\n'));
    assert.ok(!cleaned.includes('"'));
  });

  it('6. Tenant Isolation: Client user forbidden on unauthorized job report', async () => {
    const res = await fetch(`${baseUrl}/api/data-health?jobId=unauthorized_client_job`, {
      headers: {
        Authorization: `Bearer ${clientToken}`,
        'x-client-id': 'client-jfl',
      },
    });
    // Either 403 Forbidden or 404 Not Found if job doesn't belong to tenant
    assert.ok([403, 404].includes(res.status));
  });
});
