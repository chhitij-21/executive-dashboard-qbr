// backend/tests/ruleEngine.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const ruleEngine = require('../services/ruleEngine');

test('ruleEngine - loadRules', () => {
  ruleEngine.loadRules();
  const rules = ruleEngine.getRules();
  assert.ok(rules, 'Rules object should exist');
  assert.ok(rules.sla, 'SLA rules should be present');
});

test('ruleEngine - calculateHealthScore', () => {
  ruleEngine.loadRules();
  // 100% uptime, 100% incident free -> (100 * 0.6) + (100 * 0.4) = 100.00
  const score1 = ruleEngine.calculateHealthScore(100, 100);
  assert.equal(score1, '100.00');

  // 90% uptime, 80% incident free -> (90 * 0.6) + (80 * 0.4) = 54 + 32 = 86.00
  const score2 = ruleEngine.calculateHealthScore(90, 80);
  assert.equal(score2, '86.00');

  // Invalid inputs -> Data Not Available
  assert.equal(ruleEngine.calculateHealthScore(null, 100), 'Data Not Available');
  assert.equal(ruleEngine.calculateHealthScore('abc', 100), 'Data Not Available');
});

test('ruleEngine - getHealthLabel', () => {
  ruleEngine.loadRules();
  assert.equal(ruleEngine.getHealthLabel(98), 'Excellent');
  assert.equal(ruleEngine.getHealthLabel(88), 'Good');
  assert.equal(ruleEngine.getHealthLabel(75), 'Fair');
  assert.equal(ruleEngine.getHealthLabel(50), 'Poor');
  assert.equal(ruleEngine.getHealthLabel(null), 'Data Not Available');
});

test('ruleEngine - getSLATarget (period aware)', () => {
  ruleEngine.loadRules();
  assert.equal(ruleEngine.getSLATarget('monthly'), 99.9);
  assert.equal(ruleEngine.getSLATarget('quarterly'), 99.3);
  assert.equal(ruleEngine.getSLATarget(), 99.3);
});

test('ruleEngine - splitBySeverity', () => {
  ruleEngine.loadRules();
  const incidents = [
    { Severity: 'Critical' },
    { Priority: 'P1' },
    { Severity: 'Major' },
    { Severity: 'Minor' },
    { Severity: 'Unknown' },
  ];
  const split = ruleEngine.splitBySeverity(incidents);
  assert.equal(split.total, 5);
  assert.equal(split.critical, 2);
  assert.equal(split.major, 1);
  assert.equal(split.minor, 2); // Minor + Unknown unclassified
});

test('ruleEngine - classifyRCA', () => {
  ruleEngine.loadRules();
  const incidents = [
    { RCA: 'Power Outage' },
    { RCA: 'Power Outage' },
    { RCA: 'ISP Flapping' },
  ];
  const breakdown = ruleEngine.classifyRCA(incidents);
  assert.equal(breakdown.length, 2);
  assert.equal(breakdown[0].rca, 'Power Outage');
  assert.equal(breakdown[0].count, 2);
  assert.equal(breakdown[0].isTop, true);
});

test('ruleEngine - per-client configFile loading', () => {
  const rules = ruleEngine.loadRules('rules_custom_demo.yaml');
  assert.ok(rules, 'Should return valid rules object');
  // Falls back to rules.yaml if specific file does not exist yet
  assert.ok(rules.sla, 'SLA rules present in loaded config');
});
