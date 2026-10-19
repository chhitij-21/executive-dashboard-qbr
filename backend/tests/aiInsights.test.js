// backend/tests/aiInsights.test.js
process.env.NODE_ENV = 'test';
process.env.ALLOW_DEMO_ACCOUNTS = 'true';

const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../index');
const { generateEnterpriseInsights } = require('../services/aiInsightsService');

test('aiInsightsService - returns strict JSON structure with fallback logic', async () => {
  const dummyQbrData = {
    customerName: 'Jubilant Foodworks Ltd (JFL)',
    reportingPeriod: '1 July 2026 – 31 July 2026',
    executiveSummary: {
      totalSites: 5,
      totalDevices: 12,
      totalSwitches: 8,
      totalAPs: 4,
      jflSwitchUptime: '98.50',
      proactiveSwitchUptime: '98.10',
      overallUptime: '98.50',
      healthScore: 88,
      healthLabel: 'Good',
      incidentFreePercent: '95.00',
      slaCompliance: '98.10',
      slaTarget: 99.3,
      totalIncidents: 6,
      criticalIncidents: 1,
      majorIncidents: 2,
      apIncidents: 2,
      primaryRcaSwitches: 'Power Outage',
      primaryRcaAPs: 'Fiber Cut',
    },
    slaAnalytics: {
      slaTarget: 99.3,
      complianceRate: 98.10,
      metCount: 5,
      breachedCount: 1,
    },
    siteSummary: [
      {
        siteId: 'Greater Noida',
        deviceCount: 3,
        proactiveSwitchUptime: '98.10',
        jflSwitchUptime: '98.50',
        primaryRcaSwitches: 'Power Outage',
      }
    ]
  };

  // Test 1: Overview / Executive section
  const overviewResult = await generateEnterpriseInsights({ section: 'overview', data: dummyQbrData });
  assert.ok(overviewResult, 'Result must exist');
  assert.ok(typeof overviewResult.executive_summary === 'string' && overviewResult.executive_summary.length > 0, 'executive_summary must be a string');
  assert.ok(Array.isArray(overviewResult.business_risks), 'business_risks must be an array');
  assert.ok(Array.isArray(overviewResult.action_items), 'action_items must be an array');
  assert.ok(overviewResult.business_risks.length > 0, 'Should have at least 1 risk');
  assert.ok(overviewResult.action_items.length > 0, 'Should have at least 1 action item');

  // Verify SLA < target creates SLA breach risk
  const hasSlaRisk = overviewResult.business_risks.some(r => /sla/i.test(r) && /breach|target|compliance/i.test(r));
  assert.ok(hasSlaRisk, 'Business risks should include SLA breach risk when compliance < target');

  // Test 2: Switches section
  const switchesResult = await generateEnterpriseInsights({ section: 'switches', data: dummyQbrData });
  assert.ok(typeof switchesResult.executive_summary === 'string');
  assert.ok(switchesResult.business_risks.length > 0);
  assert.ok(switchesResult.action_items.length > 0);

  // Test 3: APs section
  const apsResult = await generateEnterpriseInsights({ section: 'aps', data: dummyQbrData });
  assert.ok(typeof apsResult.executive_summary === 'string');
  assert.ok(apsResult.business_risks.length > 0);

  // Test 4: Incidents section
  const incidentsResult = await generateEnterpriseInsights({ section: 'incidents', data: dummyQbrData });
  assert.ok(typeof incidentsResult.executive_summary === 'string');

  // Test 5: Fallback on empty or missing data
  const emptyResult = await generateEnterpriseInsights({ section: 'sla', data: null });
  assert.ok(typeof emptyResult.executive_summary === 'string');
  assert.ok(Array.isArray(emptyResult.business_risks));
  assert.ok(Array.isArray(emptyResult.action_items));
});

test('POST /api/ai/insights - endpoint requires auth and returns insights for authenticated user', async () => {
  let server;
  let baseUrl;
  try {
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // 1. Unauthenticated request -> 401 UNAUTHORIZED
    const unauthRes = await fetch(`${baseUrl}/api/ai/insights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: 'overview' }),
    });
    assert.equal(unauthRes.status, 401, 'Unauthenticated request should return 401');

    // 2. Login as admin
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@portal.com', password: process.env.ADMIN_PASSWORD || 'admin123' }),
    });
    assert.equal(loginRes.status, 200, 'Admin login should succeed');
    const { token } = await loginRes.json();

    // 3. Authenticated request with custom data
    const authRes = await fetch(`${baseUrl}/api/ai/insights`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        clientId: 'client-jfl',
        section: 'switches',
        data: {
          customerName: 'JFL Test',
          executiveSummary: { totalSwitches: 10, jflSwitchUptime: '99.80', slaCompliance: '99.50' }
        }
      }),
    });

    assert.equal(authRes.status, 200, 'Authenticated request should return 200');
    const json = await authRes.json();
    assert.equal(json.success, true);
    assert.equal(json.section, 'switches');
    assert.ok(typeof json.executive_summary === 'string');
    assert.ok(Array.isArray(json.business_risks));
    assert.ok(Array.isArray(json.action_items));
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});
