process.env.NODE_ENV = 'test';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ciscoPsirtClient = require('../services/ciscoPsirtClient');
const vulnerabilityFetcher = require('../services/vulnerabilityFetcher');
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
});
