// frontend/src/validators/forecastView.js

function freeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Object.isFrozen(obj)) return obj;
  Object.freeze(obj);
  return obj;
}

export function formatForecastRow(siteForecast) {
  if (!siteForecast || typeof siteForecast !== 'object') return null;

  const trend = String(siteForecast.trend || 'STABLE').toUpperCase();
  let trendColor = 'blue';
  if (trend === 'DEGRADING') trendColor = 'red';
  else if (trend === 'IMPROVING') trendColor = 'green';

  const confidence = String(siteForecast.confidence || 'INSUFFICIENT').toUpperCase();
  let confidenceColor = 'gray';
  if (confidence === 'HIGH') confidenceColor = 'green';
  else if (confidence === 'MEDIUM') confidenceColor = 'amber';

  const forecastUptime = typeof siteForecast.forecastUptime === 'number' ? siteForecast.forecastUptime : null;

  return freeze({
    siteId: String(siteForecast.siteId || 'Unknown'),
    historicalPoints: Array.isArray(siteForecast.historicalPoints) ? siteForecast.historicalPoints : [],
    forecastUptime,
    forecastBreach: Boolean(siteForecast.forecastBreach),
    confidence,
    trend,
    recommendation: String(siteForecast.recommendation || ''),
    trendColor,
    confidenceColor,
  });
}

export function summarizeForecasts(siteForecasts) {
  if (!Array.isArray(siteForecasts)) {
    return freeze({ total: 0, breaching: 0, degrading: 0, stable: 0, improving: 0 });
  }

  let breaching = 0;
  let degrading = 0;
  let stable = 0;
  let improving = 0;

  siteForecasts.forEach(item => {
    if (!item || typeof item !== 'object') return;
    const formatted = formatForecastRow(item);
    if (!formatted) return;

    if (formatted.forecastBreach) breaching++;
    if (formatted.trend === 'DEGRADING') degrading++;
    else if (formatted.trend === 'IMPROVING') improving++;
    else stable++;
  });

  return freeze({
    total: siteForecasts.length,
    breaching,
    degrading,
    stable,
    improving,
  });
}
