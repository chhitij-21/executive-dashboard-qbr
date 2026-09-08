const test = require('node:test');
const assert = require('node:assert/strict');
const { processChatQuery } = require('../services/aiChatService');

test('aiChatService - processChatQuery returns native SSOT answers for formulas and metrics', async () => {
  const dummyQbrData = {
    customerName: 'Jubilant Foodworks Ltd (JFL)',
    reportingPeriod: '1 July 2026 – 31 July 2026',
    executiveSummary: {
      totalSites: 5,
      totalDevices: 12,
      totalSwitches: 8,
      totalAPs: 4,
      jflSwitchUptime: '99.50',
      proactiveSwitchUptime: '99.20',
      overallUptime: '99.50',
      healthScore: 98,
      healthLabel: 'Optimal Operations',
      incidentFreePercent: '95.00',
      slaCompliance: '98.50',
      slaTarget: 99.3,
      primaryRcaSwitches: 'Power Outage',
      primaryRcaAPs: 'Fiber Cut',
    },
    siteSummary: [
      {
        siteId: 'Greater Noida',
        deviceCount: 3,
        proactiveSwitchUptime: '99.20',
        jflSwitchUptime: '99.50',
        primaryRcaSwitches: 'Power Outage',
        apIncidents: 1,
        uniqueAPsWithIncidents: 1,
        primaryRcaAPs: 'Fiber Cut',
        healthScore: 98,
        healthLabel: 'Optimal Operations',
      }
    ]
  };

  // Test Formula Question
  const resFormula = await processChatQuery('Explain JFL Switch Uptime formula', dummyQbrData);
  assert.equal(resFormula.type, 'native_ssot');
  assert.ok(resFormula.answer.includes('JFL Uptime'), 'Answer should explain JFL Uptime formula');

  // Test Site Question
  const resSite = await processChatQuery('Tell me about Greater Noida site', dummyQbrData);
  assert.ok(resSite.answer.includes('Greater Noida'), 'Answer should contain site details for Greater Noida');
  assert.ok(resSite.answer.includes('99.50%'), 'Answer should contain JFL Uptime %');

  // Test SLA Question
  const resSLA = await processChatQuery('What is the SLA target?', dummyQbrData);
  assert.ok(resSLA.answer.includes('99.3%'), 'Answer should mention 99.3% SLA Target');
});
