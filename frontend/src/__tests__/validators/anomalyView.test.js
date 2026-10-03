// frontend/src/__tests__/validators/anomalyView.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { formatAnomalyRow, groupAnomaliesBySeverity, summarizeAnomalies } from '../../validators/anomalyView.js';

describe('anomalyView validator suite', () => {
  it('1. groupAnomaliesBySeverity([]) returns empty grouping shape', () => {
    const res = groupAnomaliesBySeverity([]);
    assert.deepStrictEqual(res, { critical: [], high: [], medium: [], low: [] });
  });

  it('2. groupAnomaliesBySeverity(null) handles null without throwing', () => {
    const res = groupAnomaliesBySeverity(null);
    assert.deepStrictEqual(res, { critical: [], high: [], medium: [], low: [] });
  });

  it('3. groupAnomaliesBySeverity with 5 mixed anomalies produces correct counts', () => {
    const anomalies = [
      { id: '1', severity: 'CRITICAL', type: 'UPTIME_FLOOR_BREACH' },
      { id: '2', severity: 'HIGH', type: 'UPTIME_DIVERGENCE' },
      { id: '3', severity: 'HIGH', type: 'INCIDENT_SPIKE_SITE' },
      { id: '4', severity: 'MEDIUM', type: 'RCA_DOMINANCE' },
      { id: '5', severity: 'LOW', type: 'EMPTY_SITE' },
    ];
    const grouped = groupAnomaliesBySeverity(anomalies);
    assert.strictEqual(grouped.critical.length, 1);
    assert.strictEqual(grouped.high.length, 2);
    assert.strictEqual(grouped.medium.length, 1);
    assert.strictEqual(grouped.low.length, 1);
  });

  it('4. formatAnomalyRow(null) returns null safely', () => {
    assert.strictEqual(formatAnomalyRow(null), null);
    assert.strictEqual(formatAnomalyRow(undefined), null);
  });

  it('5. formatAnomalyRow with valid anomaly returns id, severity, and badgeColor', () => {
    const anomaly = {
      id: 'a1',
      severity: 'CRITICAL',
      type: 'UPTIME_FLOOR_BREACH',
      entity: { site: 'Bangalore', device: 'SW-01' },
      message: 'Uptime floor breach',
      recommendation: 'Replace switch',
    };
    const row = formatAnomalyRow(anomaly);
    assert.ok(row);
    assert.strictEqual(row?.id, 'a1');
    assert.strictEqual(row?.severity, 'CRITICAL');
    assert.strictEqual(row?.badgeColor, 'red');
    assert.strictEqual(row?.site, 'Bangalore');
  });

  it('6. badgeColor mapping is correct for CRITICAL, HIGH, MEDIUM, LOW', () => {
    assert.strictEqual(formatAnomalyRow({ severity: 'CRITICAL' })?.badgeColor, 'red');
    assert.strictEqual(formatAnomalyRow({ severity: 'HIGH' })?.badgeColor, 'amber');
    assert.strictEqual(formatAnomalyRow({ severity: 'MEDIUM' })?.badgeColor, 'blue');
    assert.strictEqual(formatAnomalyRow({ severity: 'LOW' })?.badgeColor, 'gray');
  });

  it('7. summarizeAnomalies with mixed list has total equal to input length', () => {
    const list = [
      { severity: 'CRITICAL' },
      { severity: 'HIGH' },
      { severity: 'MEDIUM' },
    ];
    const summary = summarizeAnomalies(list);
    assert.strictEqual(summary.total, 3);
    assert.strictEqual(summary.critical, 1);
    assert.strictEqual(summary.high, 1);
    assert.strictEqual(summary.medium, 1);
    assert.strictEqual(summary.low, 0);
  });

  it('8. input array is not mutated after function call', () => {
    const list = [{ severity: 'CRITICAL' }, { severity: 'HIGH' }];
    const originalCopy = JSON.parse(JSON.stringify(list));
    groupAnomaliesBySeverity(list);
    assert.deepStrictEqual(list, originalCopy);
  });

  it('9. malformed entries missing severity fall back to LOW gracefully', () => {
    const malformed = [{ id: 'm1' }];
    const row = formatAnomalyRow(malformed[0]);
    assert.strictEqual(row?.severity, 'LOW');
    assert.strictEqual(row?.badgeColor, 'gray');
  });
});
