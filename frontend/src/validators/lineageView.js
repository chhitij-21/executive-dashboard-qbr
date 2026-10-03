// frontend/src/validators/lineageView.js

function freeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Object.isFrozen(obj)) return obj;
  Object.freeze(obj);
  return obj;
}

function sanitizePath(pathStr) {
  if (!pathStr || typeof pathStr !== 'string') return 'inventory.xlsx';
  const clean = pathStr.replace(/\\/g, '/');
  return clean.split('/').pop() || 'inventory.xlsx';
}

export function formatLineageEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;

  const derivedFromArr = Array.isArray(entry.derivedFrom) ? entry.derivedFrom : [];

  const sources = derivedFromArr.map(src => {
    if (!src || typeof src !== 'object') {
      return { type: 'UNKNOWN', aggregationType: 'NONE' };
    }
    return {
      type: String(src.sourceType || 'UNKNOWN'),
      file: src.file ? sanitizePath(src.file) : undefined,
      sheet: src.sheet ? String(src.sheet) : undefined,
      row: typeof src.row === 'number' ? src.row : undefined,
      formula: src.formula ? String(src.formula) : undefined,
      aggregationType: String(src.aggregationType || 'NONE'),
    };
  });

  return freeze({
    metricKey: String(entry.metricKey || 'unknown'),
    value: entry.value !== undefined ? entry.value : null,
    sources: freeze(sources),
  });
}

export function findLineageForMetric(lineage, metricKey) {
  if (!lineage || typeof lineage !== 'object' || !metricKey || typeof metricKey !== 'string') {
    return null;
  }

  const key = metricKey.trim();
  const devices = lineage.devices && typeof lineage.devices === 'object' ? lineage.devices : {};
  const sites = lineage.sites && typeof lineage.sites === 'object' ? lineage.sites : {};
  const metrics = lineage.metrics && typeof lineage.metrics === 'object' ? lineage.metrics : {};

  const entry = metrics[key] || devices[key] || sites[key] || devices[`device.${key}`] || sites[`site.${key}`] || null;

  return entry ? formatLineageEntry(entry) : null;
}
