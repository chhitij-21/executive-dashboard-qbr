process.env.NODE_ENV = 'test';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const ciscoPsirtClient = require('../services/ciscoPsirtClient');
const vulnerabilityFetcher = require('../services/vulnerabilityFetcher');
const historyService = require('../services/historyService');
const app = require('../index');

describe('Cisco PSIRT openVuln Integration Suite', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    ciscoPsirtClient.clearTokenCache();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    ciscoPsirtClient.clearTokenCache();
  });

  test('Part 1: OAuth2 token acquisition mock & rate limiter minimum 250ms spacing', async () => {
    let capturedTokenRequest = null;

    // Mock global.fetch
    global.fetch = async (url, options = {}) => {
      if (url === ciscoPsirtClient.TOKEN_URL) {
        capturedTokenRequest = { url, options };
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'mock-psirt-jwt-token-xyz-12345',
            token_type: 'Bearer',
            expires_in: '3600',
          }),
        };
      }

      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          advisories: [
            {
              advisoryId: 'cisco-sa-test-1',
              advisoryTitle: 'Cisco Security Advisory Test',
              sir: 'Critical',
              cvssBaseScore: '9.8',
              cves: ['CVE-2026-99999'],
              productNames: ['Cisco Catalyst 9300 Series Switches'],
              publicationUrl: 'https://sec.cloudapps.cisco.com/security/center/content/CiscoSecurityAdvisory/cisco-sa-test-1',
              firstPublished: '2026-10-10T12:00:00',
            },
          ],
        }),
      };
    };

    // 1. Verify Token Acquisition Format
    const token = await ciscoPsirtClient.getAccessToken({
      clientId: 'mock_client_id_key',
      clientSecret: 'mock_client_secret_val',
      forceRefresh: true,
    });

    assert.equal(token, 'mock-psirt-jwt-token-xyz-12345');
    assert.ok(capturedTokenRequest, 'Expected token request to be made');
    assert.equal(capturedTokenRequest.options.method, 'POST');
    assert.equal(capturedTokenRequest.options.headers['Content-Type'], 'application/x-www-form-urlencoded');

    const bodyParams = new URLSearchParams(capturedTokenRequest.options.body);
    assert.equal(bodyParams.get('grant_type'), 'client_credentials');
    assert.equal(bodyParams.get('client_id'), 'mock_client_id_key');
    assert.equal(bodyParams.get('client_secret'), 'mock_client_secret_val');

    // 2. Verify Rate Limiter: consecutive throttle calls enforce min 250ms spacing
    const tStart = Date.now();
    await ciscoPsirtClient.throttle(250);
    const elapsed = Date.now() - tStart;
    assert.ok(elapsed >= 0, 'Throttle completed cleanly');

    const t1 = Date.now();
    await ciscoPsirtClient.throttle(250);
    const interval = Date.now() - t1;
    assert.ok(interval >= 200, `Expected throttle delay >= 200ms, got ${interval}ms`);

    // 3. Verify Graceful Failure when credentials are missing
    const origId = process.env.CISCO_CLIENT_ID;
    const origSecret = process.env.CISCO_CLIENT_SECRET;
    delete process.env.CISCO_CLIENT_ID;
    delete process.env.CISCO_CLIENT_SECRET;

    await assert.rejects(
      () => ciscoPsirtClient.getAccessToken({ clientId: null, clientSecret: null, forceRefresh: true }),
      (err) => {
        assert.match(err.message, /Missing Cisco credentials in environment variables/);
        return true;
      }
    );

    if (origId) process.env.CISCO_CLIENT_ID = origId;
    if (origSecret) process.env.CISCO_CLIENT_SECRET = origSecret;
  });

  test('Part 2: CVRF data transformation & GET /api/vulnerabilities endpoint response', async () => {
    // 1. Verify Data Transformation
    const sampleAdvisories = [
      {
        advisoryId: 'cisco-sa-meraki-cve-test',
        advisoryTitle: 'Cisco Meraki Elevation of Privilege Vulnerability',
        sir: 'High',
        cvssBaseScore: '8.4',
        cves: ['CVE-2026-88001', 'CVE-2026-88002'],
        cwe: ['CWE-284'],
        productNames: ['Cisco Meraki MX Series', 'Cisco Meraki MS Switches'],
        publicationUrl: 'https://sec.cloudapps.cisco.com/security/center/content/CiscoSecurityAdvisory/cisco-sa-meraki-cve-test',
        firstPublished: '2026-10-12T08:00:00',
        firstFixed: 'Firmware 18.2.1',
      },
      {
        advisoryId: 'cisco-sa-catalyst-dos',
        advisoryTitle: 'Cisco IOS XE Denial of Service Vulnerability',
        sir: 'Medium',
        cvssBaseScore: '5.3',
        cves: ['CVE-2026-88003'],
        productNames: ['Cisco IOS XE Software'],
        publicationUrl: 'https://sec.cloudapps.cisco.com/security/center/content/CiscoSecurityAdvisory/cisco-sa-catalyst-dos',
        firstPublished: '2026-10-14T09:30:00',
      },
    ];

    const flatRows = vulnerabilityFetcher.transformAdvisoriesToCveList(sampleAdvisories);

    // 2 advisories: 1st has 2 CVEs, 2nd has 1 CVE -> exactly 3 flat rows
    assert.equal(flatRows.length, 3, 'Expected 3 flat CVE rows emitted');

    // Verify Row 1
    const row1 = flatRows[0];
    assert.equal(row1.cveId, 'CVE-2026-88001');
    assert.equal(row1.severity, 'High');
    assert.equal(row1.cvss, 8.4);
    assert.equal(row1.priority, 'P1');
    assert.equal(row1.fixedRelease, 'Firmware 18.2.1');
    assert.equal(row1.advisoryDate, '2026-10-12');
    assert.ok(row1.product.includes('Cisco Meraki MX Series'));

    // Verify Row 3 (Medium severity -> P2)
    const row3 = flatRows[2];
    assert.equal(row3.cveId, 'CVE-2026-88003');
    assert.equal(row3.severity, 'Medium');
    assert.equal(row3.cvss, 5.3);
    assert.equal(row3.priority, 'P2');
    assert.equal(row3.fixedRelease, 'Refer to advisory');

    // 2. Verify API Endpoint GET /api/vulnerabilities
    let server;
    try {
      await new Promise((resolve) => {
        server = app.listen(0, '127.0.0.1', () => resolve());
      });
      const port = server.address().port;

      const res = await originalFetch(`http://127.0.0.1:${port}/api/vulnerabilities`);
      assert.equal(res.status, 200, 'GET /api/vulnerabilities returned 200');

      const json = await res.json();
      assert.equal(json.success, true);
      assert.ok(typeof json.totalCount === 'number');
      assert.ok(Array.isArray(json.cveList));
      assert.ok(json.cveList.length > 0, 'Expected non-empty cveList from cached vulnerabilities.json');

      const sample = json.cveList[0];
      assert.ok(sample.cveId);
      assert.ok(sample.severity);
      assert.ok(sample.product);
      assert.ok(sample.vulnerabilityImpact);
    } finally {
      if (server) {
        await new Promise((resolve) => server.close(resolve));
      }
    }
  });

  test('Part 3: Multi-tenant vulnerability filtering returns Meraki CVE and excludes Windows CVE for MX68CW-WW inventory', async () => {
    let server;
    const testDir = path.join(os.tmpdir(), `test_vuln_${Date.now()}`);
    const testDashPath = path.join(testDir, 'dashboard_data.json');
    const metaFile = path.resolve(__dirname, '..', '..', 'data', 'reports_metadata.json');
    const origMeta = fs.existsSync(metaFile) ? fs.readFileSync(metaFile, 'utf8') : null;

    try {
      // 1. Create clean test dashboard data with only MX68CW-WW model
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(
        testDashPath,
        JSON.stringify({
          clientId: 'client-test-mx',
          devices: [
            { DeviceID: 'DEV-MX-01', SerialNo: 'Q2CW-TEST-1', Model: 'MX68CW-WW', DeviceType: 'SW' },
          ],
        }),
        'utf8'
      );

      // Record test report in history
      historyService.recordReport({
        jobId: 'test-job-mx-68',
        clientId: 'client-test-mx',
        clientName: 'Test Client MX',
        status: 'completed',
        dashboardPath: testDashPath,
        uploadTimestamp: new Date().toISOString(),
      });

      await new Promise((resolve) => {
        server = app.listen(0, '127.0.0.1', () => resolve());
      });
      const port = server.address().port;

      // Query with clientId=client-test-mx
      const res = await originalFetch(`http://127.0.0.1:${port}/api/vulnerabilities?clientId=client-test-mx`);
      assert.equal(res.status, 200, 'GET /api/vulnerabilities?clientId=client-test-mx returned 200');

      const json = await res.json();
      assert.equal(json.success, true);
      assert.ok(Array.isArray(json.modelsFound), 'modelsFound must be an array');
      assert.ok(json.modelsFound.includes('MX68CW-WW'), 'modelsFound must include MX68CW-WW');
      assert.ok(Array.isArray(json.vulnerabilities), 'vulnerabilities must be an array');
      assert.equal(json.filteredCount, json.vulnerabilities.length, 'filteredCount must match vulnerabilities length');
      assert.ok(json.vulnerabilities.length > 0, 'Expected at least 1 vulnerability for Meraki MX');

      // Meraki CVE must be returned
      const hasMeraki = json.vulnerabilities.some((v) => (v.product || '').toLowerCase().includes('meraki'));
      assert.ok(hasMeraki, 'Meraki CVE must be returned for MX68CW-WW inventory');

      // Windows CVE must be excluded
      const hasWindows = json.vulnerabilities.some((v) => (v.product || '').toLowerCase().includes('windows'));
      assert.equal(hasWindows, false, 'Windows CVE must be excluded for MX68CW-WW inventory');

      // Non-Meraki CVEs (like IOS XE) must be excluded for pure MX68CW-WW inventory
      const hasIosXe = json.vulnerabilities.some((v) => (v.product || '').toLowerCase().includes('ios xe'));
      assert.equal(hasIosXe, false, 'IOS XE CVEs must be excluded for purely Meraki inventory');
    } finally {
      if (server) {
        await new Promise((resolve) => server.close(resolve));
      }
      if (origMeta !== null) {
        try { fs.writeFileSync(metaFile, origMeta, 'utf8'); } catch (_) {}
      }
      if (fs.existsSync(testDir)) {
        try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (_) {}
      }
    }
  });
});
