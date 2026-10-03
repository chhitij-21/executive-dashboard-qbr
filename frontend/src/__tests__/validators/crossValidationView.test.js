// frontend/src/__tests__/validators/crossValidationView.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { formatCheckRow, summarizeChecks } from '../../validators/crossValidationView.js';

describe('crossValidationView validator suite', () => {
  it('1. summarizeChecks([], []) returns 0 totals and 0 passRate', () => {
    const res = summarizeChecks([], []);
    assert.deepStrictEqual(res, { total: 0, passedCount: 0, failedCount: 0, passRate: 0 });
  });

  it('2. summarizeChecks with 3 passed and 1 failed calculates passRate 0.75', () => {
    const passed = [{ rule: 'R1' }, { rule: 'R2' }, { rule: 'R3' }];
    const failed = [{ rule: 'R4' }];
    const summary = summarizeChecks(passed, failed);
    assert.strictEqual(summary.total, 4);
    assert.strictEqual(summary.passedCount, 3);
    assert.strictEqual(summary.failedCount, 1);
    assert.strictEqual(summary.passRate, 0.75);
  });

  it('3. summarizeChecks(null, null) returns empty shape without throwing', () => {
    const res = summarizeChecks(null, null);
    assert.deepStrictEqual(res, { total: 0, passedCount: 0, failedCount: 0, passRate: 0 });
  });

  it('4. formatCheckRow with valid PASS and FAIL checks sets statusColor correctly', () => {
    const passRow = formatCheckRow({ rule: 'R1', status: 'PASS', expected: 10, actual: 10 });
    assert.strictEqual(passRow?.statusColor, 'green');

    const failRow = formatCheckRow({ rule: 'R2', status: 'FAIL', expected: 10, actual: 8 });
    assert.strictEqual(failRow?.statusColor, 'red');
  });

  it('5. formatCheckRow(null) returns null safely', () => {
    assert.strictEqual(formatCheckRow(null), null);
    assert.strictEqual(formatCheckRow(undefined), null);
  });
});
