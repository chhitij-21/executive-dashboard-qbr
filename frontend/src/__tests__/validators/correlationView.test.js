// frontend/src/__tests__/validators/correlationView.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { formatCorrelationRow, groupCorrelationsByType } from '../../validators/correlationView.js';

describe('correlationView validator suite', () => {
  it('1. groupCorrelationsByType([]) returns empty object', () => {
    const res = groupCorrelationsByType([]);
    assert.deepStrictEqual(res, {});
  });

  it('2. groupCorrelationsByType with mixed correlations produces correct keyed object', () => {
    const list = [
      { id: '1', type: 'SIMULTANEOUS_OUTAGE', confidence: 'HIGH' },
      { id: '2', type: 'SIMULTANEOUS_OUTAGE', confidence: 'HIGH' },
      { id: '3', type: 'RECURRING_DEVICE_FAILURE', confidence: 'HIGH' },
    ];
    const grouped = groupCorrelationsByType(list);
    assert.ok(Object.keys(grouped).includes('SIMULTANEOUS_OUTAGE'));
    assert.ok(Object.keys(grouped).includes('RECURRING_DEVICE_FAILURE'));
    assert.strictEqual(grouped.SIMULTANEOUS_OUTAGE.length, 2);
    assert.strictEqual(grouped.RECURRING_DEVICE_FAILURE.length, 1);
  });

  it('3. formatCorrelationRow(null) returns null safely', () => {
    assert.strictEqual(formatCorrelationRow(null), null);
    assert.strictEqual(formatCorrelationRow(undefined), null);
  });

  it('4. confidenceColor mapping is verified for HIGH, MEDIUM, LOW', () => {
    assert.strictEqual(formatCorrelationRow({ confidence: 'HIGH' })?.confidenceColor, 'green');
    assert.strictEqual(formatCorrelationRow({ confidence: 'MEDIUM' })?.confidenceColor, 'amber');
    assert.strictEqual(formatCorrelationRow({ confidence: 'LOW' })?.confidenceColor, 'gray');
  });

  it('5. input array is not mutated after groupCorrelationsByType call', () => {
    const list = [{ id: '1', type: 'TIME_OF_DAY_PATTERN' }];
    const copy = JSON.parse(JSON.stringify(list));
    groupCorrelationsByType(list);
    assert.deepStrictEqual(list, copy);
  });
});
