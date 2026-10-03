// frontend/src/__tests__/validators/lineageView.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { formatLineageEntry, findLineageForMetric } from '../../validators/lineageView.js';

describe('lineageView validator suite', () => {
  it('1. formatLineageEntry sanitizes ../ in file paths', () => {
    const entry = {
      metricKey: 'device.SW-01',
      value: 99.5,
      derivedFrom: [
        { sourceType: 'EXCEL_ROW', file: '../../secret/inventory.xlsx', sheet: 'Raw', row: 12 },
      ],
    };
    const formatted = formatLineageEntry(entry);
    assert.strictEqual(formatted?.sources[0].file, 'inventory.xlsx');
  });

  it('2. formatLineageEntry strips absolute path prefixes', () => {
    const entryUnix = {
      metricKey: 'device.SW-01',
      derivedFrom: [{ sourceType: 'EXCEL_ROW', file: '/var/data/reports/incidents.xlsx' }],
    };
    assert.strictEqual(formatLineageEntry(entryUnix)?.sources[0].file, 'incidents.xlsx');

    const entryWin = {
      metricKey: 'device.SW-01',
      derivedFrom: [{ sourceType: 'EXCEL_ROW', file: 'C:\\Users\\Admin\\Desktop\\inventory.xlsx' }],
    };
    assert.strictEqual(formatLineageEntry(entryWin)?.sources[0].file, 'inventory.xlsx');
  });

  it('3. formatLineageEntry(null) returns null without throwing', () => {
    assert.strictEqual(formatLineageEntry(null), null);
    assert.strictEqual(formatLineageEntry(undefined), null);
  });

  it('4. findLineageForMetric with missing lineage returns null', () => {
    assert.strictEqual(findLineageForMetric(null, 'executiveSummary.overallUptime'), null);
    assert.strictEqual(findLineageForMetric({}, 'executiveSummary.overallUptime'), null);
  });

  it('5. findLineageForMetric with valid key returns formatted entry', () => {
    const lineage = {
      metrics: {
        'executiveSummary.overallUptime': {
          metricKey: 'executiveSummary.overallUptime',
          value: '99.43',
          derivedFrom: [{ sourceType: 'AGGREGATION', formula: 'AVG(__effectiveUptime)' }],
        },
      },
    };
    const entry = findLineageForMetric(lineage, 'executiveSummary.overallUptime');
    assert.ok(entry);
    assert.strictEqual(entry?.metricKey, 'executiveSummary.overallUptime');
    assert.strictEqual(entry?.value, '99.43');
    assert.strictEqual(entry?.sources[0].formula, 'AVG(__effectiveUptime)');
  });
});
