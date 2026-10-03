// frontend/src/validators/crossValidationView.js

function freeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Object.isFrozen(obj)) return obj;
  Object.freeze(obj);
  return obj;
}

export function formatCheckRow(check) {
  if (!check || typeof check !== 'object') return null;

  const status = String(check.status || 'FAIL').toUpperCase();
  const statusColor = status === 'PASS' ? 'green' : 'red';

  const formatted = {
    id: String(check.id || ''),
    rule: String(check.rule || 'UNKNOWN_RULE'),
    expected: check.expected !== undefined ? check.expected : 'N/A',
    actual: check.actual !== undefined ? check.actual : 'N/A',
    status,
    severity: String(check.severity || 'MEDIUM').toUpperCase(),
    message: String(check.message || ''),
    statusColor,
  };

  return freeze(formatted);
}

export function summarizeChecks(passed, failed) {
  const passedArr = Array.isArray(passed) ? passed : [];
  const failedArr = Array.isArray(failed) ? failed : [];

  const passedCount = passedArr.length;
  const failedCount = failedArr.length;
  const total = passedCount + failedCount;
  const passRate = total > 0 ? parseFloat((passedCount / total).toFixed(4)) : 0;

  return freeze({
    total,
    passedCount,
    failedCount,
    passRate,
  });
}
