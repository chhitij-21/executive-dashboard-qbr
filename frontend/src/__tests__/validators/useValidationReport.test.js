// frontend/src/__tests__/validators/useValidationReport.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { useValidationReport } from '../../validators/useValidationReport.js';

describe('useValidationReport hook test suite', () => {
  it('1. useValidationReport is exported as a function', () => {
    assert.strictEqual(typeof useValidationReport, 'function');
  });
});
