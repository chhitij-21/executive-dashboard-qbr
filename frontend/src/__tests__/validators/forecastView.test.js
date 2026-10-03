// frontend/src/__tests__/validators/forecastView.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { formatForecastRow, summarizeForecasts } from '../../validators/forecastView.js';

describe('forecastView validator suite', () => {
  it('1. summarizeForecasts([]) returns empty zero summary', () => {
    const res = summarizeForecasts([]);
    assert.deepStrictEqual(res, { total: 0, breaching: 0, degrading: 0, stable: 0, improving: 0 });
  });

  it('2. summarizeForecasts with 5 forecasts (2 breaching, 3 stable) produces correct counts', () => {
    const list = [
      { siteId: 'Bangalore', forecastBreach: true, trend: 'DEGRADING' },
      { siteId: 'Greater Noida', forecastBreach: true, trend: 'DEGRADING' },
      { siteId: 'Guwahati', forecastBreach: false, trend: 'STABLE' },
      { siteId: 'Hyderabad', forecastBreach: false, trend: 'STABLE' },
      { siteId: 'Mohali', forecastBreach: false, trend: 'STABLE' },
    ];
    const summary = summarizeForecasts(list);
    assert.strictEqual(summary.total, 5);
    assert.strictEqual(summary.breaching, 2);
    assert.strictEqual(summary.degrading, 2);
    assert.strictEqual(summary.stable, 3);
  });

  it('3. formatForecastRow with INSUFFICIENT confidence sets confidenceColor to gray', () => {
    const row = formatForecastRow({ siteId: 'Noida', confidence: 'INSUFFICIENT' });
    assert.strictEqual(row?.confidenceColor, 'gray');
  });

  it('4. forecastUptime null is preserved and never coerced to 0 or 100', () => {
    const row = formatForecastRow({ siteId: 'Nagpur', forecastUptime: null });
    assert.strictEqual(row?.forecastUptime, null);
  });

  it('5. formatForecastRow(null) returns null safely', () => {
    assert.strictEqual(formatForecastRow(null), null);
    assert.strictEqual(formatForecastRow(undefined), null);
  });
});
