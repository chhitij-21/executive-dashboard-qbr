// backend/tests/ai/iq200Validator.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { auditHallucinations, verifyAndGroundResponse, buildSsotGroundTruth } = require('../../services/ai/iq200Validator');
const { crossValidate } = require('../../services/validators/crossValidationEngine');

const mockQbrData = {
  customerName: 'Jubilant Foodworks Ltd (JFL)',
  reportingPeriod: '7 July 2026 – 6 October 2026',
  report_period: {
    display_label: '7 July 2026 – 6 October 2026',
    window_minutes: 132480,
  },
  executiveSummary: {
    totalSites: 2,
    totalDevices: 242,
    totalSwitches: 92,
    totalAPs: 150,
    totalStockDevices: 62,
    totalIncidents: 46,
    overallUptime: '99.63',
    proactiveSwitchUptime: '99.99',
    jflSwitchUptime: '98.72',
    healthScore: '91.03',
    healthLabel: 'Good',
    slaCompliance: '98.39',
    slaTarget: 99.3,
    primaryRcaSwitches: 'Device Power Issues',
    primaryRcaAPs: 'Device Power Issues',
  },
  siteSummary: [
    {
      siteId: 'Bangalore',
      deviceCount: 182,
      switchCount: 50,
      apCount: 78,
      stockCount: 54,
      incidentCount: 46,
      apIncidents: 13,
      uniqueAPsWithIncidents: 11,
      proactiveSwitchUptime: '99.99',
      jflSwitchUptime: '98.72',
      primaryRcaSwitches: 'Device Power Issues',
      primaryRcaAPs: 'Device Power Issues',
    },
    {
      siteId: 'Greater Noida',
      deviceCount: 122,
      switchCount: 42,
      apCount: 72,
      stockCount: 8,
      incidentCount: 0,
      apIncidents: 0,
      uniqueAPsWithIncidents: 0,
      proactiveSwitchUptime: '99.99',
      jflSwitchUptime: '91.04',
      primaryRcaSwitches: 'Stable Operations (No Incidents)',
      primaryRcaAPs: 'Stable Operations (No Incidents)',
    },
  ],
  rcaAnalytics: {
    breakdown: [
      { rca: 'Device Power Issues', count: 46, percentage: '100.00%' },
    ],
  },
  slaAnalytics: {
    overallSLAPercent: 98.39,
    slaTarget: 99.3,
  },
  devices: [
    { DeviceID: 'CORE-1', SerialNo: 'SER-1', Hostname: 'CORE-1', __jflUptime: 100, __proactiveUptime: 99.99, __isStock: false },
    { DeviceID: 'STOCK-1', SerialNo: 'STK-1', Hostname: 'STOCK-1', __jflUptime: 100, __proactiveUptime: 100, __isStock: true },
  ],
  incidents: [
    {
      TicketNumber: 'PRO/INC/41590',
      IncidentID: 'PRO/INC/41590',
      RCA: 'Device Power Issues',
      ActualResolutionMin: 11.37,
      HoldTimeMin: 180.82,
      TotalResolutionMin: 192.19,
      sla_status: 'SLA Met',
      display_reference: { type: 'Ticket', value: 'PRO/INC/41590' },
    },
  ],
};

test('IQ-200 Hallucination-Free AI Validator & Checker Suite', async (t) => {
  await t.test('1. Ground Truth indexing extracts all SSOT entities & metrics', () => {
    const gt = buildSsotGroundTruth(mockQbrData);
    assert.ok(gt.knownSites.has('bangalore'));
    assert.ok(gt.knownSites.has('greater noida'));
    assert.ok(gt.knownDevices.has('core-1'));
    assert.ok(gt.knownIncidents.has('pro/inc/41590'));
    assert.ok(gt.knownRcas.has('Device Power Issues'));
    assert.ok(gt.numericPool.has(182));
    assert.ok(gt.numericPool.has(98.72));
    assert.ok(gt.numericPool.has(99.99));
  });

  await t.test('2. Clean answer matching SSOT metrics returns valid: true with zero issues', () => {
    const answer = 'In Bangalore, JFL Switch Uptime is 98.72% and Proactive Uptime is 99.99% across 182 devices.';
    const res = auditHallucinations(answer, mockQbrData);
    assert.equal(res.valid, true);
    assert.equal(res.score, 100);
    assert.deepEqual(res.issues, []);
  });

  await t.test('3. Detects and flags fabricated non-monitored city / site (e.g. Chennai site)', () => {
    const answer = 'The Chennai site suffered an outage with 45 switches down.';
    const res = auditHallucinations(answer, mockQbrData);
    assert.equal(res.valid, false);
    assert.ok(res.issues.some(i => i.type === 'FABRICATED_SITE'));
  });

  await t.test('4. Detects and flags imaginary / unrecorded ticket numbers', () => {
    const answer = 'Ticket PRO/INC/99999 was opened for power outage.';
    const res = auditHallucinations(answer, mockQbrData);
    assert.equal(res.valid, false);
    assert.ok(res.issues.some(i => i.type === 'FABRICATED_TICKET'));
  });

  await t.test('5. Detects metric hallucination when claimed uptime diverges from SSOT', () => {
    const answer = 'Bangalore uptime dropped to 81.5% during July.';
    const res = auditHallucinations(answer, mockQbrData);
    assert.equal(res.valid, false);
    assert.ok(res.issues.some(i => i.type === 'HALLUCINATED_METRIC'));
  });

  await t.test('6. verifyAndGroundResponse auto-corrects fabricated content with verified SSOT facts', () => {
    const hallucinatedAnswer = 'At Kolkata site, 25 devices had an issue.';
    const result = verifyAndGroundResponse(hallucinatedAnswer, mockQbrData, { autoCorrect: true });
    assert.equal(result.corrected, true);
    assert.ok(result.answer.includes('Jubilant Foodworks Ltd (JFL)'));
    assert.ok(result.answer.includes('Bangalore'));
    assert.ok(result.answer.includes('98.72%'));
  });

  await t.test('7. crossValidate executes IQ-200 mathematical invariant rules (R16-R20)', () => {
    const cvResult = crossValidate(mockQbrData);
    assert.equal(cvResult.success, true);
    assert.ok(cvResult.passed.some(p => p.rule === 'PHYSICAL_INVENTORY_IDENTITY'));
    assert.ok(cvResult.passed.some(p => p.rule === 'SITE_UPTIME_BOUNDS_AND_PARITY'));
    assert.ok(cvResult.passed.some(p => p.rule === 'ZERO_INCIDENT_PRIMARY_RCA_PARITY'));
    assert.ok(cvResult.passed.some(p => p.rule === 'EXECUTIVE_HEALTH_SCORE_BOUNDS'));
    assert.ok(cvResult.passed.some(p => p.rule === 'RESOLUTION_AND_HOLD_TIMING_BOUNDS'));
  });

  await t.test('8. crossValidate fails on broken physical inventory arithmetic', () => {
    const badData = JSON.parse(JSON.stringify(mockQbrData));
    badData.siteSummary[0].deviceCount = 999; // 50 + 78 + 54 != 999
    const cvResult = crossValidate(badData);
    assert.equal(cvResult.success, false);
    assert.ok(cvResult.failed.some(f => f.rule === 'PHYSICAL_INVENTORY_IDENTITY'));
  });
});
