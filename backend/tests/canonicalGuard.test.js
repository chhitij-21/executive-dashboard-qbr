const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const expect = (actual) => ({
  toBeGreaterThan: (expected) => assert.ok(actual > expected, `Expected ${actual} > ${expected}`)
});

describe('Canonical dashboard_data.json guard', () => {
  const canonicalPath = path.resolve(__dirname, '..', '..', 'data', 'dashboard_data.json');

  test('canonical file size is unchanged after test run', () => {
    if (!fs.existsSync(canonicalPath)) {
      console.log('[canonicalGuard] No canonical file — skipping size check.');
      return;
    }
    const size = fs.statSync(canonicalPath).size;
    // A real dataset is > 50KB. A test fixture would be much smaller.
    expect(size).toBeGreaterThan(50 * 1024);
  });
});
