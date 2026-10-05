const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const expect = (actual) => ({
  toBeGreaterThan: (expected) => assert.ok(actual > expected, `Expected ${actual} > ${expected}`)
});

describe('Canonical dashboard_data.json guard', () => {
  const canonicalPath = path.resolve(__dirname, '..', '..', 'data', 'dashboard_data.json');

  test('canonical file size and incident count sanity check', () => {
    if (!fs.existsSync(canonicalPath)) {
      console.log('[canonicalGuard] No canonical file — skipping check.');
      return;
    }
    const size = fs.statSync(canonicalPath).size;
    // A real dataset is > 50KB. A test fixture would be much smaller.
    expect(size).toBeGreaterThan(50 * 1024);

    const rawData = fs.readFileSync(canonicalPath, 'utf8');
    const data = JSON.parse(rawData);
    const incidentCount = Array.isArray(data.incidents) ? data.incidents.length : (data.executiveSummary?.totalIncidents || 0);
    expect(incidentCount).toBeGreaterThan(0);
  });
});

