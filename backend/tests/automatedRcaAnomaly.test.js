require('./_setup');
// backend/tests/automatedRcaAnomaly.test.js
// Automated Incident RCA Clustering, Temporal Anomaly Tuning & Grounded AI Narrative (Item #20)

process.env.NODE_ENV = 'test';
process.env.ALLOW_DEMO_ACCOUNTS = 'true';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../index');
const authService = require('../services/authService');
const { detectAnomalies, parseTimestamp } = require('../services/validators/anomalyDetector');
const { buildRCAAnalytics, filterDashboardBySite } = require('../services/processData');
const { generateFallbackInsights } = require('../services/aiInsightsService');

describe('Automated Incident RCA & Anomaly Detection Tuning (Item #20)', () => {
  let server;
  let baseUrl;
  let adminToken;
  let jflToken;

  before(async () => {
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
      const body = await res.json();
      return body.token;
    };

    adminToken = await login('admin@portal.com', process.env.ADMIN_PASSWORD || 'admin123');
    jflToken = await login('jfl@portal.com', process.env.JFL_PASSWORD || 'jfl123');
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('1. parseTimestamp handles ISO strings, DD-MM-YYYY, Excel serials and dates correctly', () => {
    const isoDate = parseTimestamp('2026-05-10T14:30:00Z');
    assert.ok(isoDate instanceof Date);
    assert.equal(isoDate.getUTCFullYear(), 2026);
    assert.equal(isoDate.getUTCMonth(), 4); // May = 4
    assert.equal(isoDate.getUTCDate(), 10);

    const ddmmyyyy = parseTimestamp('15-04-2026 10:15:00');
    assert.ok(ddmmyyyy instanceof Date);
    assert.equal(ddmmyyyy.getFullYear(), 2026);
    assert.equal(ddmmyyyy.getMonth(), 3); // April = 3
    assert.equal(ddmmyyyy.getDate(), 15);

    const excelSerial = parseTimestamp(46150); // Valid Excel serial day
    assert.ok(excelSerial instanceof Date);

    const dateObj = new Date('2026-06-01');
    assert.equal(parseTimestamp(dateObj), dateObj);

    assert.equal(parseTimestamp(null), null);
    assert.equal(parseTimestamp(''), null);
    assert.equal(parseTimestamp('invalid-date-string-xyz'), null);
  });

  it('2. Rule K: DEVICE_FLAPPING detects 3+ incidents in 72h window or >= 5 total incidents', () => {
    const qbrData = {
      devices: [{ DeviceID: 'SW-MUM-01', SiteID: 'Mumbai', __proactiveUptime: 99.8, __jflUptime: 99.5 }],
      incidents: [
        { DeviceID: 'SW-MUM-01', SiteID: 'Mumbai', 'Created Time': '2026-05-01 10:00:00', IncidentNumber: 'INC-101' },
        { DeviceID: 'SW-MUM-01', SiteID: 'Mumbai', 'Created Time': '2026-05-02 12:00:00', IncidentNumber: 'INC-102' },
        { DeviceID: 'SW-MUM-01', SiteID: 'Mumbai', 'Created Time': '2026-05-03 08:00:00', IncidentNumber: 'INC-103' },
      ],
      siteSummary: [{ siteId: 'Mumbai', jflSwitchUptime: 99.5, deviceCount: 1, incidentCount: 3 }],
      executiveSummary: { totalIncidents: 3, slaTarget: 99.3 },
    };

    const result = detectAnomalies(qbrData);
    assert.ok(result.success);
    const flapping = result.anomalies.find(a => a.type === 'DEVICE_FLAPPING');
    assert.ok(flapping, 'Should detect DEVICE_FLAPPING for 3 incidents within 72h');
    assert.equal(flapping.severity, 'HIGH');
    assert.equal(flapping.entity.device, 'SW-MUM-01');
    assert.equal(flapping.evidence.flappingWindow72h, true);

    // Test >= 5 incidents triggering CRITICAL severity
    const qbrData5 = {
      devices: [{ DeviceID: 'SW-DEL-02', SiteID: 'Delhi', __proactiveUptime: 99.0, __jflUptime: 99.0 }],
      incidents: [
        { DeviceID: 'SW-DEL-02', SiteID: 'Delhi', 'Created Time': '2026-05-01 10:00:00', IncidentNumber: 'INC-201' },
        { DeviceID: 'SW-DEL-02', SiteID: 'Delhi', 'Created Time': '2026-05-10 12:00:00', IncidentNumber: 'INC-202' },
        { DeviceID: 'SW-DEL-02', SiteID: 'Delhi', 'Created Time': '2026-05-15 08:00:00', IncidentNumber: 'INC-203' },
        { DeviceID: 'SW-DEL-02', SiteID: 'Delhi', 'Created Time': '2026-05-20 09:00:00', IncidentNumber: 'INC-204' },
        { DeviceID: 'SW-DEL-02', SiteID: 'Delhi', 'Created Time': '2026-05-25 11:00:00', IncidentNumber: 'INC-205' },
      ],
      siteSummary: [{ siteId: 'Delhi', jflSwitchUptime: 99.0, deviceCount: 1, incidentCount: 5 }],
      executiveSummary: { totalIncidents: 5, slaTarget: 99.3 },
    };

    const result5 = detectAnomalies(qbrData5);
    const flapping5 = result5.anomalies.find(a => a.type === 'DEVICE_FLAPPING');
    assert.ok(flapping5);
    assert.equal(flapping5.severity, 'CRITICAL', '5+ incidents should elevate flapping to CRITICAL');
  });

  it('3. Rule L: CORRELATED_AP_OUTAGE detects >= 2 distinct APs failing within 15 minutes', () => {
    const qbrData = {
      devices: [
        { DeviceID: 'AP-BLR-01', DeviceType: 'AP', SiteID: 'Bangalore', __proactiveUptime: 99.5, __jflUptime: 99.5 },
        { DeviceID: 'AP-BLR-02', DeviceType: 'AP', SiteID: 'Bangalore', __proactiveUptime: 99.5, __jflUptime: 99.5 },
      ],
      incidents: [
        { DeviceID: 'AP-BLR-01', DeviceType: 'AP', SiteID: 'Bangalore', 'Created Time': '2026-05-12 14:00:00', IncidentNumber: 'INC-301' },
        { DeviceID: 'AP-BLR-02', DeviceType: 'AP', SiteID: 'Bangalore', 'Created Time': '2026-05-12 14:08:00', IncidentNumber: 'INC-302' },
      ],
      siteSummary: [{ siteId: 'Bangalore', jflSwitchUptime: 100.0, deviceCount: 2, incidentCount: 2 }],
      executiveSummary: { totalIncidents: 2, slaTarget: 99.3 },
    };

    const result = detectAnomalies(qbrData);
    assert.ok(result.success);
    const correlated = result.anomalies.find(a => a.type === 'CORRELATED_AP_OUTAGE');
    assert.ok(correlated, 'Should detect CORRELATED_AP_OUTAGE');
    assert.equal(correlated.severity, 'HIGH');
    assert.equal(correlated.entity.site, 'Bangalore');
    assert.equal(correlated.evidence.apCount, 2);
  });

  it('4. Rule M: EXTENDED_OUTAGE_RESOLUTION detects resolution > 1440 min or hold > 2880 min', () => {
    const qbrData = {
      devices: [{ DeviceID: 'SW-KOL-01', SiteID: 'Kolkata', __proactiveUptime: 95.0, __jflUptime: 95.0 }],
      incidents: [
        {
          DeviceID: 'SW-KOL-01',
          SiteID: 'Kolkata',
          IncidentNumber: 'INC-401',
          'Actual Resolution Time (min)': 1800, // 30 hours
          'Time on Hold (min)': 100,
        },
        {
          DeviceID: 'SW-KOL-01',
          SiteID: 'Kolkata',
          IncidentNumber: 'INC-402',
          'Actual Resolution Time (min)': 120,
          'Time on Hold (min)': 3200, // 53 hours hold
        },
      ],
      siteSummary: [{ siteId: 'Kolkata', jflSwitchUptime: 95.0, deviceCount: 1, incidentCount: 2 }],
      executiveSummary: { totalIncidents: 2, slaTarget: 99.3 },
    };

    const result = detectAnomalies(qbrData);
    const extendedAnomalies = result.anomalies.filter(a => a.type === 'EXTENDED_OUTAGE_RESOLUTION');
    assert.equal(extendedAnomalies.length, 2, 'Should flag both extended resolution and extended hold time');
    assert.ok(extendedAnomalies.some(a => a.evidence.actualResolutionMinutes === 1800));
    assert.ok(extendedAnomalies.some(a => a.evidence.holdMinutes === 3200));
  });

  it('5. Rule N: INCIDENT_VOLUME_OUTLIER detects sites exceeding mean + 2*sigma (>= 5 incidents)', () => {
    const baselineSites = Array.from({ length: 10 }, (_, i) => ({
      SiteID: `Site-${i + 1}`,
      DeviceID: `D-${i + 1}`,
      IncidentNumber: `INC-BASE-${i + 1}`,
    }));
    const outlierIncidents = Array.from({ length: 15 }, (_, i) => ({
      SiteID: 'Site-Outlier',
      DeviceID: `D-OUT-${i + 1}`,
      IncidentNumber: `INC-OUT-${i + 1}`,
    }));

    const qbrData = {
      devices: [],
      incidents: [...baselineSites, ...outlierIncidents],
      siteSummary: [
        ...Array.from({ length: 10 }, (_, i) => ({
          siteId: `Site-${i + 1}`,
          deviceCount: 1,
          switchCount: 1,
          apCount: 0,
          incidentCount: 1,
          jflSwitchUptime: 99.9,
        })),
        { siteId: 'Site-Outlier', deviceCount: 5, switchCount: 3, apCount: 2, incidentCount: 15, jflSwitchUptime: 99.9 },
      ],
      executiveSummary: { totalIncidents: 25, slaTarget: 99.3 },
    };

    const result = detectAnomalies(qbrData);
    const outlier = result.anomalies.find(a => a.type === 'INCIDENT_VOLUME_OUTLIER');
    assert.ok(outlier, 'Should detect INCIDENT_VOLUME_OUTLIER for Site-Outlier');
    assert.equal(outlier.entity.site, 'Site-Outlier');
    assert.equal(outlier.evidence.incidentCount, 15);
    assert.ok(outlier.evidence.zScore > 2.0);
  });

  it('6. buildRCAAnalytics produces byDeviceClass and duration-weighted impact analysis', () => {
    const incidents = [
      {
        DeviceType: 'Switch',
        DeviceID: 'SW-01',
        RCA: 'Device Power Issues',
        ActualResolutionMin: 200,
        HoldTimeMin: 100,
      },
      {
        DeviceType: 'Switch',
        DeviceID: 'SW-02',
        RCA: 'Device Power Issues',
        ActualResolutionMin: 150,
        HoldTimeMin: 50,
      },
      {
        DeviceType: 'Switch',
        DeviceID: 'SW-03',
        RCA: 'ISP Issues',
        ActualResolutionMin: 800,
        HoldTimeMin: 400,
      },
      {
        DeviceType: 'AP',
        DeviceID: 'AP-01',
        RCA: 'Hardware Failure',
        ActualResolutionMin: 300,
        HoldTimeMin: 0,
      },
    ];

    const rcaAnalytics = buildRCAAnalytics(incidents);
    assert.equal(rcaAnalytics.totalIncidents, 4);

    // Device class separation
    assert.ok(rcaAnalytics.byDeviceClass);
    assert.equal(rcaAnalytics.byDeviceClass.switches.totalIncidents, 3);
    assert.equal(rcaAnalytics.byDeviceClass.aps.totalIncidents, 1);
    assert.equal(rcaAnalytics.byDeviceClass.switches.topRca, 'Device Power Issues');
    assert.equal(rcaAnalytics.byDeviceClass.aps.topRca, 'Hardware Failure');

    // Impact-weighted breakdown
    // Device Power Issues: (200+100) + (150+50) = 500 mins
    // ISP Issues: (800+400) = 1200 mins
    // Hardware Failure: 300 mins
    // Total: 2000 mins
    assert.ok(Array.isArray(rcaAnalytics.impactWeighted));
    assert.equal(rcaAnalytics.totalOutageMinutes, 2000);
    assert.equal(rcaAnalytics.impactWeighted[0].rca, 'ISP Issues', 'Highest duration driver should be top');
    assert.equal(rcaAnalytics.impactWeighted[0].totalMinutes, 1200);
    assert.equal(rcaAnalytics.impactWeighted[0].percentage, '60.0%');
    assert.equal(rcaAnalytics.impactWeighted[1].rca, 'Device Power Issues');
    assert.equal(rcaAnalytics.impactWeighted[1].totalMinutes, 500);
    assert.equal(rcaAnalytics.impactWeighted[1].percentage, '25.0%');
  });

  it('7. filterDashboardBySite attaches anomalies and anomalySummary to site slice', () => {
    const rawData = {
      customerName: 'JFL',
      devices: [
        { DeviceID: 'SW-NOIDA-01', SiteID: 'Noida', DeviceType: 'Switch', __proactiveUptime: 99.8, __jflUptime: 99.5 },
        { DeviceID: 'SW-MUM-01', SiteID: 'Mumbai', DeviceType: 'Switch', __proactiveUptime: 99.8, __jflUptime: 99.5 },
      ],
      incidents: [
        { DeviceID: 'SW-NOIDA-01', SiteID: 'Noida', IncidentNumber: 'INC-N1', 'Actual Resolution Time (min)': 2000 },
        { DeviceID: 'SW-MUM-01', SiteID: 'Mumbai', IncidentNumber: 'INC-M1', 'Actual Resolution Time (min)': 30 },
      ],
      siteSummary: [
        { siteId: 'Noida', deviceCount: 1, switchCount: 1, apCount: 0, incidentCount: 1, jflSwitchUptime: 99.5 },
        { siteId: 'Mumbai', deviceCount: 1, switchCount: 1, apCount: 0, incidentCount: 1, jflSwitchUptime: 99.5 },
      ],
      executiveSummary: { totalDevices: 2, totalSites: 2, slaTarget: 99.3 },
    };

    const siteSlice = filterDashboardBySite(rawData, 'Noida');
    assert.ok(siteSlice.anomalies, 'Should attach anomalies to site slice');
    assert.ok(siteSlice.anomalySummary, 'Should attach anomalySummary to site slice');
    assert.ok(siteSlice.anomalies.some(a => a.type === 'EXTENDED_OUTAGE_RESOLUTION'));
  });

  it('8. generateFallbackInsights grounds narrative with anomaly alerts and duration-weighted RCA', () => {
    const mockData = {
      customerName: 'JFL',
      report_period: { display_label: '1 May 2026 – 31 May 2026' },
      executiveSummary: {
        healthScore: 92,
        slaCompliance: 99.8,
        jflSwitchUptime: 99.85,
        totalDevices: 145,
        totalSwitches: 90,
        totalAPs: 55,
        totalIncidents: 10,
        slaTarget: 99.3,
        primaryRcaSwitches: 'Device Power Issues',
        primaryRcaAPs: 'Stable Operations (No Incidents)',
      },
      rcaAnalytics: {
        impactWeighted: [
          { rca: 'ISP Fiber Cut', totalMinutes: 1440, percentage: '72.0%' },
        ],
      },
      anomalies: [
        {
          id: 'test-anom-1',
          severity: 'CRITICAL',
          type: 'EXTENDED_OUTAGE_RESOLUTION',
          message: 'Incident INC-999 experienced extended resolution time (1440 min).',
          recommendation: 'Escalate carrier fiber restoration SLA.',
        },
      ],
    };

    const overviewInsights = generateFallbackInsights('overview', mockData);
    assert.ok(overviewInsights.business_risks.some(r => r.includes('Critical Anomaly Alert')));
    assert.ok(overviewInsights.action_items.some(a => a.includes('Escalate carrier fiber restoration SLA')));

    const rcaInsights = generateFallbackInsights('rca', mockData);
    assert.ok(rcaInsights.executive_summary.includes('Duration-weighted analysis reveals'));
    assert.ok(rcaInsights.executive_summary.includes('ISP Fiber Cut'));
    assert.ok(rcaInsights.business_risks.some(r => r.includes('1440 minutes')));
  });

  it('9. GET /api/v1/anomalies enforces authentication and supports severity/site filtering', async () => {
    // 401 without token
    const unauthRes = await fetch(`${baseUrl}/api/v1/anomalies`);
    assert.equal(unauthRes.status, 401);

    // 200 with admin token
    const res = await fetch(`${baseUrl}/api/v1/anomalies`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.anomalies));
    assert.ok(body.summary);
    assert.equal(typeof body.total, 'number');

    // Filter by severity
    const sevRes = await fetch(`${baseUrl}/api/v1/anomalies?severity=CRITICAL`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(sevRes.status, 200);
    const sevBody = await sevRes.json();
    assert.ok(sevBody.anomalies.every(a => a.severity === 'CRITICAL'));

    // Filter by type
    const typeRes = await fetch(`${baseUrl}/api/v1/anomalies?type=DEVICE_FLAPPING`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(typeRes.status, 200);
    const typeBody = await typeRes.json();
    assert.ok(typeBody.anomalies.every(a => a.type === 'DEVICE_FLAPPING'));

    // Cross-tenant access with jflToken accessing client-jfl
    const jflRes = await fetch(`${baseUrl}/api/v1/anomalies?client=client-jfl`, {
      headers: { Authorization: `Bearer ${jflToken}` },
    });
    assert.equal(jflRes.status, 200);
    const jflBody = await jflRes.json();
    assert.equal(jflBody.clientId, 'client-jfl');
  });
});
