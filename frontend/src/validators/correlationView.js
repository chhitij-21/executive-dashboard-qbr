// frontend/src/validators/correlationView.js

function freeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Object.isFrozen(obj)) return obj;
  Object.freeze(obj);
  return obj;
}

export function formatCorrelationRow(correlation) {
  if (!correlation || typeof correlation !== 'object') return null;

  const confidence = String(correlation.confidence || 'MEDIUM').toUpperCase();
  let confidenceColor = 'amber';
  if (confidence === 'HIGH') confidenceColor = 'green';
  else if (confidence === 'LOW') confidenceColor = 'gray';

  const entities = correlation.entities || {};

  return freeze({
    id: String(correlation.id || ''),
    type: String(correlation.type || 'UNKNOWN'),
    confidence,
    site: String(entities.site || 'Global'),
    rack: String(entities.rack || 'N/A'),
    incidentCount: typeof correlation.incidentCount === 'number' ? correlation.incidentCount : 0,
    recommendation: String(correlation.recommendation || ''),
    confidenceColor,
  });
}

export function groupCorrelationsByType(correlations) {
  const result = {};

  if (!Array.isArray(correlations)) return freeze(result);

  correlations.forEach(item => {
    if (!item || typeof item !== 'object') return;
    const formatted = formatCorrelationRow(item);
    if (!formatted) return;

    const type = formatted.type;
    if (!result[type]) result[type] = [];
    result[type].push(formatted);
  });

  Object.keys(result).forEach(k => {
    freeze(result[k]);
  });

  return freeze(result);
}
