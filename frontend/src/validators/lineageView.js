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
      cellCoordinates: src.cellCoordinates && typeof src.cellCoordinates === 'object' ? src.cellCoordinates : undefined,
      contributingRows: Array.isArray(src.contributingRows) ? src.contributingRows : (typeof src.row === 'number' ? [src.row] : []),
      formula: src.formula ? String(src.formula) : undefined,
      inputs: Array.isArray(src.inputs) ? src.inputs : [],
      aggregationType: String(src.aggregationType || 'NONE'),
    };
  });

  return freeze({
    metricKey: String(entry.metricKey || 'unknown'),
    value: entry.value !== undefined ? entry.value : null,
    sources: freeze(sources),
    timestamp: entry.timestamp || undefined,
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

  // Check exact key first
  let entry = metrics[key] || devices[key] || sites[key];

  // Check common prefixes / aliases
  if (!entry) {
    entry = metrics[`executiveSummary.${key}`] ||
            metrics[`executiveSummary.${key.charAt(0).toLowerCase() + key.slice(1)}`] ||
            devices[`device.${key}`] ||
            sites[`site.${key}`] ||
            metrics[`rack.${key}`];
  }

  // Case-insensitive search fallback across metrics keys
  if (!entry) {
    const lowerKey = key.toLowerCase();
    const matchedMetricKey = Object.keys(metrics).find(k => k.toLowerCase() === lowerKey || k.toLowerCase().endsWith(`.${lowerKey}`));
    if (matchedMetricKey) {
      entry = metrics[matchedMetricKey];
    }
  }

  return entry ? formatLineageEntry(entry) : null;
}
