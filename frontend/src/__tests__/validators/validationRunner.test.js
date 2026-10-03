// frontend/src/__tests__/validators/validationRunner.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { runValidationReport } from '../../validators/validationRunner.js';

describe('validationRunner test suite', () => {
  it('1. runValidationReport(null) returns NO_DATA error', async () => {
    const res = await runValidationReport(null);
    assert.deepStrictEqual(res, { success: false, report: null, error: 'NO_DATA' });
  });

  it('2. qbrData input object is not mutated during call', async () => {
    const qbrData = { customerName: 'JFL', executiveSummary: { totalSites: 8 } };
    const copy = JSON.parse(JSON.stringify(qbrData));
    await runValidationReport(qbrData);
    assert.deepStrictEqual(qbrData, copy);
  });
});
