require('./_setup');
// backend/tests/webhookConnectors.test.js
// Real-Time IT Connectors: Webhook Ingestion Engine & HMAC Verification Suite (Item #19)

process.env.NODE_ENV = 'test';
process.env.ALLOW_DEMO_ACCOUNTS = 'true';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const app = require('../index');
const authService = require('../services/authService');
const auditService = require('../services/auditService');
const connectorService = require('../services/connectorService');

function signHmac(secret, payloadObj, prefix = '') {
  const raw = JSON.stringify(payloadObj);
  const hex = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  return `${prefix}${hex}`;
}

describe('Real-Time IT Connectors & Webhook Engine (Item #19)', () => {
  let server;
  let baseUrl;
  let adminToken;
  let jflToken;
  let mmtcToken;

  let merakiConnector;
  let catalystConnector;
  let mmtcConnector;

  before(async () => {
    await auditService.ensureTable();
    await connectorService.ensureTables();

    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });

    if (typeof app.resetRateLimits === 'function') app.resetRateLimits();
    if (typeof authService.resetRateLimits === 'function') authService.resetRateLimits();

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

  beforeEach(() => {
    if (typeof app.resetRateLimits === 'function') app.resetRateLimits();
    if (typeof authService.resetRateLimits === 'function') authService.resetRateLimits();
  });

  it('1. Admin creates Meraki & Catalyst connectors; secrets are returned once and masked in listings', async () => {
    // Client user cannot create connectors (RBAC)
    const forbiddenRes = await fetch(`${baseUrl}/api/v1/connectors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jflToken}`,
      },
      body: JSON.stringify({ clientId: 'client-jfl', provider: 'meraki', name: 'Unauthorized Meraki' }),
    });
    assert.equal(forbiddenRes.status, 403);

    // Admin creates JFL Meraki connector
    const res1 = await fetch(`${baseUrl}/api/v1/connectors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        clientId: 'client-jfl',
        provider: 'meraki',
        name: 'JFL Store Meraki Alerts',
        sharedSecret: 'meraki-shared-secret-jfl-99',
      }),
    });
    assert.equal(res1.status, 201);
    const body1 = await res1.json();
    assert.equal(body1.success, true);
    assert.ok(body1.connector.webhookSecret.startsWith('whsec_'));
    merakiConnector = body1.connector;

    // Admin creates JFL Catalyst Center connector
    const res2 = await fetch(`${baseUrl}/api/v1/connectors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        clientId: 'client-jfl',
        provider: 'catalyst_center',
        name: 'JFL Core Catalyst DNA-C',
      }),
    });
    assert.equal(res2.status, 201);
    catalystConnector = (await res2.json()).connector;

    // Admin creates MMTC connector for isolation test
    const res3 = await fetch(`${baseUrl}/api/v1/connectors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        clientId: 'client-mmtcpamp',
        provider: 'meraki',
        name: 'MMTC Refinery Meraki',
      }),
    });
    assert.equal(res3.status, 201);
    mmtcConnector = (await res3.json()).connector;

    // Listing omits plain webhookSecret
    const listRes = await fetch(`${baseUrl}/api/v1/connectors?clientId=client-jfl`, {
      headers: { Authorization: `Bearer ${jflToken}` },
    });
    assert.equal(listRes.status, 200);
    const listBody = await listRes.json();
    assert.equal(listBody.connectors.length, 2);
    listBody.connectors.forEach((c) => {
      assert.equal(c.webhookSecret, undefined, 'Raw webhookSecret MUST NOT be returned in listings');
      assert.ok(c.secretPreview.includes('...'));
    });
  });

  it('2. Webhook ingestion rejects missing or invalid HMAC signatures (401) and logs audit failure', async () => {
    const payload = { alertId: 'meraki-bad-1', alertType: 'AP went down', deviceSerial: 'Q2KD-1111-2222' };

    // Missing signature
    const missingRes = await fetch(`${baseUrl}/api/v1/webhooks/meraki/${merakiConnector.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(missingRes.status, 401);

    // Forged signature
    const forgedRes = await fetch(`${baseUrl}/api/v1/webhooks/meraki/${merakiConnector.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-meraki-signature': '0000deadbeef0000deadbeef',
      },
      body: JSON.stringify(payload),
    });
    assert.equal(forgedRes.status, 401);

    // Check audit trail recorded signature failure
    const logs = await auditService.queryLogs({ eventType: 'WEBHOOK_SIGNATURE_FAILED', tenantId: 'client-jfl' });
    assert.ok(logs.total >= 2, 'Should log WEBHOOK_SIGNATURE_FAILED events to audit log');
  });

  it('3. Meraki webhook verifies HMAC-SHA256 & sharedSecret, normalizes site/RCA, and deduplicates retries', async () => {
    const merakiPayload = {
      alertId: 'meraki-evt-1001',
      alertType: 'AP went down',
      alertLevel: 'critical',
      occurredAt: '2026-05-15T10:00:00Z',
      networkName: 'IND-PVC-SEC70',
      deviceSerial: 'Q2KD-AAAA-0001',
      deviceName: 'AP-SEC70-01',
      deviceModel: 'MR46',
      alertData: { reason: 'PoE budget power loss detected' },
    };
    const rawStr = JSON.stringify(merakiPayload);
    const sig = signHmac(merakiConnector.webhookSecret, merakiPayload);

    const res1 = await fetch(`${baseUrl}/api/v1/webhooks/meraki/${merakiConnector.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-meraki-signature': sig,
      },
      body: rawStr,
    });
    assert.equal(res1.status, 202);
    const body1 = await res1.json();
    assert.equal(body1.success, true);
    assert.equal(body1.duplicate, false);
    assert.equal(body1.method, 'hmac-sha256');
    assert.equal(body1.event.eventType, 'AP_DOWN');
    assert.equal(body1.event.deviceType, 'AP');
    assert.equal(body1.event.severity, 'CRITICAL');
    assert.equal(body1.event.rcaHint, 'Device Power Issues');
    assert.equal(body1.event.siteId, 'Gurgaon Head Office');

    // Replay same alertId -> 200 deduplicated
    const resDup = await fetch(`${baseUrl}/api/v1/webhooks/meraki/${merakiConnector.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-meraki-signature': sig,
      },
      body: rawStr,
    });
    assert.equal(resDup.status, 200);
    const bodyDup = await resDup.json();
    assert.equal(bodyDup.duplicate, true);

    // Meraki sharedSecret fallback payload auth for second AP within 15 mins (same site!)
    const merakiPayload2 = {
      sharedSecret: 'meraki-shared-secret-jfl-99',
      alertId: 'meraki-evt-1002',
      alertType: 'AP went down',
      alertLevel: 'critical',
      occurredAt: '2026-05-15T10:06:00Z',
      networkName: 'Gurgaon Head Office',
      deviceSerial: 'Q2KD-AAAA-0002',
      deviceName: 'AP-SEC70-02',
      deviceModel: 'MR46',
      alertData: { reason: 'Power interruption' },
    };

    const res2 = await fetch(`${baseUrl}/api/v1/webhooks/meraki/${merakiConnector.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(merakiPayload2),
    });
    assert.equal(res2.status, 202);
    const body2 = await res2.json();
    assert.equal(body2.method, 'shared-secret');
  });

  it('4. Catalyst Center webhook verifies sha256= prefixed HMAC and normalizes DNA-C Assurance issue', async () => {
    const catalystPayload = {
      eventId: 'dnac-issue-9001',
      category: 'ALERT',
      severity: 'P1',
      timestamp: '2026-05-15T11:30:00Z',
      enrichmentInfo: {
        issueDetails: {
          issue: [
            {
              issueId: 'dnac-issue-9001',
              issueName: 'Network Device Unreachable',
              issueSeverity: 'P1',
              issueLocation: 'Okhla',
              probableCause: 'ISP WAN uplink connectivity lost',
              entityId: 'FOC2419L0AA',
            },
          ],
        },
      },
      details: {
        hostname: 'SW-OKHLA-CORE-01',
        deviceSerialNumber: 'FOC2419L0AA',
        deviceType: 'Cisco Catalyst 9300 Switch',
        site: 'Okhla',
      },
    };

    const sig = signHmac(catalystConnector.webhookSecret, catalystPayload, 'sha256=');
    const res = await fetch(`${baseUrl}/api/v1/webhooks/catalyst/${catalystConnector.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-catalyst-signature': sig,
      },
      body: JSON.stringify(catalystPayload),
    });
    assert.equal(res.status, 202);
    const body = await res.json();
    assert.equal(body.event.eventType, 'SWITCH_DOWN');
    assert.equal(body.event.deviceId, 'SW-OKHLA-CORE-01');
    assert.equal(body.event.deviceType, 'Switch');
    assert.equal(body.event.severity, 'CRITICAL');
    assert.equal(body.event.rcaHint, 'ISP Issues');
    assert.equal(body.event.siteId, 'Okhla');

    // Provider mismatch check: sending to meraki route on catalyst connector returns 400
    const mismatchRes = await fetch(`${baseUrl}/api/v1/webhooks/meraki/${catalystConnector.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-meraki-signature': sig,
      },
      body: JSON.stringify(catalystPayload),
    });
    assert.equal(mismatchRes.status, 400);
  });

  it('5. Buffered incidents feed live anomaly detection (CORRELATED_AP_OUTAGE) and support flush', async () => {
    const bufRes = await fetch(`${baseUrl}/api/v1/webhooks/buffered-incidents?clientId=client-jfl`, {
      headers: { Authorization: `Bearer ${jflToken}` },
    });
    assert.equal(bufRes.status, 200);
    const bufBody = await bufRes.json();
    assert.equal(bufBody.total, 3);
    assert.ok(
      bufBody.anomalies.some((a) => a.type === 'CORRELATED_AP_OUTAGE' && a.entity.site === 'Gurgaon Head Office'),
      'Two Meraki AP outages within 6 mins at Gurgaon Head Office should trigger CORRELATED_AP_OUTAGE'
    );

    // Flush buffer as admin
    const flushRes = await fetch(`${baseUrl}/api/v1/webhooks/flush`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ clientId: 'client-jfl' }),
    });
    assert.equal(flushRes.status, 200);
    const flushBody = await flushRes.json();
    assert.equal(flushBody.flushed, 3);

    // Verify buffer is now empty
    const afterRes = await fetch(`${baseUrl}/api/v1/webhooks/buffered-incidents?clientId=client-jfl`, {
      headers: { Authorization: `Bearer ${jflToken}` },
    });
    const afterBody = await afterRes.json();
    assert.equal(afterBody.total, 0);
  });

  it('6. Tenant isolation prevents JFL user from inspecting MMTC connector events (403)', async () => {
    const crossRes = await fetch(`${baseUrl}/api/v1/connectors/${mmtcConnector.id}/events`, {
      headers: { Authorization: `Bearer ${jflToken}` },
    });
    assert.equal(crossRes.status, 403);

    // MMTC user CAN access MMTC connector events
    const ownRes = await fetch(`${baseUrl}/api/v1/connectors/${mmtcConnector.id}/events`, {
      headers: { Authorization: `Bearer ${mmtcToken}` },
    });
    assert.equal(ownRes.status, 200);
  });

  it('7. Connector secret rotation, disable enforcement (403), and deletion', async () => {
    const oldSecret = catalystConnector.webhookSecret;

    // Rotate secret
    const rotRes = await fetch(`${baseUrl}/api/v1/connectors/${catalystConnector.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ rotateSecret: true }),
    });
    assert.equal(rotRes.status, 200);
    const rotBody = await rotRes.json();
    const newSecret = rotBody.connector.webhookSecret;
    assert.ok(newSecret && newSecret !== oldSecret);

    // Old secret fails
    const testPayload = { eventId: 'dnac-rot-1', category: 'WARN', details: { hostname: 'SW-ROT', site: 'Pune' } };
    const oldFailRes = await fetch(`${baseUrl}/api/v1/webhooks/catalyst/${catalystConnector.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-catalyst-signature': signHmac(oldSecret, testPayload),
      },
      body: JSON.stringify(testPayload),
    });
    assert.equal(oldFailRes.status, 401);

    // New secret succeeds
    const newOkRes = await fetch(`${baseUrl}/api/v1/webhooks/catalyst/${catalystConnector.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-catalyst-signature': signHmac(newSecret, testPayload),
      },
      body: JSON.stringify(testPayload),
    });
    assert.equal(newOkRes.status, 202);

    // Disable connector -> 403 on webhook ingest
    const disRes = await fetch(`${baseUrl}/api/v1/connectors/${catalystConnector.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(disRes.status, 200);

    const disabledIngest = await fetch(`${baseUrl}/api/v1/webhooks/catalyst/${catalystConnector.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-catalyst-signature': signHmac(newSecret, testPayload),
      },
      body: JSON.stringify(testPayload),
    });
    assert.equal(disabledIngest.status, 403);

    // Delete connector
    const delRes = await fetch(`${baseUrl}/api/v1/connectors/${catalystConnector.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(delRes.status, 200);
    assert.equal((await delRes.json()).deleted, true);
  });
});

