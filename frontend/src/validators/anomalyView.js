// frontend/src/validators/anomalyView.js

function freeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Object.isFrozen(obj)) return obj;
  Object.freeze(obj);
  return obj;
}

export function formatAnomalyRow(anomaly) {
  if (!anomaly || typeof anomaly !== 'object') return null;

  const severity = String(anomaly.severity || 'LOW').toUpperCase();
  let badgeColor = 'gray';
  if (severity === 'CRITICAL') badgeColor = 'red';
  else if (severity === 'HIGH') badgeColor = 'amber';
  else if (severity === 'MEDIUM') badgeColor = 'blue';

  const formatted = {
    id: String(anomaly.id || ''),
    severity,
    type: String(anomaly.type || 'UNKNOWN'),
    site: String(anomaly.entity?.site || 'Global'),
    device: String(anomaly.entity?.device || 'N/A'),
    message: String(anomaly.message || ''),
    recommendation: String(anomaly.recommendation || ''),
    badgeColor,
  };

  return freeze(formatted);
}

export function groupAnomaliesBySeverity(anomalies) {
  const result = {
    critical: [],
    high: [],
    medium: [],
    low: [],
  };

  if (!Array.isArray(anomalies)) return freeze(result);

  anomalies.forEach(item => {
    if (!item || typeof item !== 'object') return;
    const formatted = formatAnomalyRow(item);
    if (!formatted) return;

    const sev = formatted.severity.toLowerCase();
    if (sev === 'critical') result.critical.push(formatted);
    else if (sev === 'high') result.high.push(formatted);
    else if (sev === 'medium') result.medium.push(formatted);
    else result.low.push(formatted);
  });

  return freeze({
    critical: freeze(result.critical),
    high: freeze(result.high),
    medium: freeze(result.medium),
    low: freeze(result.low),
  });
}

export function summarizeAnomalies(anomalies) {
  if (!Array.isArray(anomalies)) {
    return freeze({ total: 0, critical: 0, high: 0, medium: 0, low: 0 });
  }

  const grouped = groupAnomaliesBySeverity(anomalies);
  const total = grouped.critical.length + grouped.high.length + grouped.medium.length + grouped.low.length;

  return freeze({
    total,
    critical: grouped.critical.length,
    high: grouped.high.length,
    medium: grouped.medium.length,
    low: grouped.low.length,
  });
}
