// backend/services/validators/crossValidationEngine.js
const crypto = require('crypto');

function sha1(str) {
  return crypto.createHash('sha1').update(String(str || '')).digest('hex');
}

function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Object.isFrozen(obj)) return obj;
  Object.freeze(obj);
  Object.getOwnPropertyNames(obj).forEach(prop => {
    const val = obj[prop];
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  });
  return obj;
}

function safeNum(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = typeof val === 'number' ? val : parseFloat(String(val));
  return Number.isFinite(n) ? n : null;
}

function crossValidate(qbrData) {
  try {
    if (!qbrData || typeof qbrData !== 'object') {
      return {
        success: false,
        passed: [],
        failed: [],
        summary: { total: 0, passedCount: 0, failedCount: 0 },
        error: 'INVALID_INPUT: qbrData must be an object',
      };
    }

    deepFreeze(qbrData);

    const passed = [];
    const failed = [];

    const recordCheck = (ruleName, severity, expected, actual, passCondition, failureMsg, missingField) => {
      const id = sha1(`RULE|${ruleName}`).slice(0, 16);
      if (missingField) {
        failed.push({
          id,
          rule: ruleName,
          expected,
          actual: null,
          status: 'FAIL',
          severity: 'CRITICAL',
          message: `REQUIRED_INPUT_MISSING: ${missingField}`,
        });
        return;
      }

      if (passCondition) {
        passed.push({
          id,
          rule: ruleName,
          expected,
          actual,
          status: 'PASS',
          severity,
          message: `Rule ${ruleName} passed.`,
        });
      } else {
        failed.push({
          id,
          rule: ruleName,
          expected,
          actual,
          status: 'FAIL',
          severity,
          message: failureMsg || `Rule ${ruleName} failed. Expected ${expected}, got ${actual}.`,
        });
      }
    };

    const exec = qbrData.executiveSummary;
    const siteSummary = Array.isArray(qbrData.siteSummary) ? qbrData.siteSummary : null;
    const rcaAnalytics = qbrData.rcaAnalytics;
    const slaAnalytics = qbrData.slaAnalytics;
    const devices = Array.isArray(qbrData.devices) ? qbrData.devices : null;
    const incidents = Array.isArray(qbrData.incidents) ? qbrData.incidents : null;
    const reportPeriod = qbrData.report_period;

    // R1. TOTAL_DEVICE_COUNT_MATCH
    try {
      if (!exec || siteSummary === null) {
        recordCheck('TOTAL_DEVICE_COUNT_MATCH', 'CRITICAL', 'Sum of site deviceCount equals total + stock devices', null, false, null, !exec ? 'executiveSummary' : 'siteSummary');
      } else {
        const totalDev = safeNum(exec.totalDevices) ?? 0;
        const totalStock = safeNum(exec.totalStockDevices) ?? 0;
        const expected = totalDev + totalStock;
        const actual = siteSummary.reduce((acc, s) => acc + (safeNum(s?.deviceCount) ?? 0), 0);
        recordCheck('TOTAL_DEVICE_COUNT_MATCH', 'HIGH', expected, actual, expected === actual, `Total devices (${expected}) does not match sum of site device counts (${actual}).`);
      }
    } catch (e) {
      recordCheck('TOTAL_DEVICE_COUNT_MATCH', 'CRITICAL', 'No exception', e.message, false, `Rule execution threw: ${e.message}`);
    }

    // R2. TOTAL_SWITCH_COUNT_MATCH
    try {
      if (!exec || siteSummary === null) {
        recordCheck('TOTAL_SWITCH_COUNT_MATCH', 'CRITICAL', 'Sum of site switchCount equals totalSwitches', null, false, null, !exec ? 'executiveSummary' : 'siteSummary');
      } else {
        const expected = safeNum(exec.totalSwitches) ?? 0;
        const actual = siteSummary.reduce((acc, s) => acc + (safeNum(s?.switchCount) ?? 0), 0);
        recordCheck('TOTAL_SWITCH_COUNT_MATCH', 'HIGH', expected, actual, expected === actual, `Total switches (${expected}) does not match sum of site switch counts (${actual}).`);
      }
    } catch (e) {
      recordCheck('TOTAL_SWITCH_COUNT_MATCH', 'CRITICAL', 'No exception', e.message, false, `Rule execution threw: ${e.message}`);
    }

    // R3. TOTAL_AP_COUNT_MATCH
    try {
      if (!exec || siteSummary === null) {
        recordCheck('TOTAL_AP_COUNT_MATCH', 'CRITICAL', 'Sum of site apCount equals totalAPs', null, false, null, !exec ? 'executiveSummary' : 'siteSummary');
      } else {
        const expected = safeNum(exec.totalAPs) ?? 0;
        const actual = siteSummary.reduce((acc, s) => acc + (safeNum(s?.apCount) ?? 0), 0);
        recordCheck('TOTAL_AP_COUNT_MATCH', 'HIGH', expected, actual, expected === actual, `Total APs (${expected}) does not match sum of site AP counts (${actual}).`);
      }
    } catch (e) {
      recordCheck('TOTAL_AP_COUNT_MATCH', 'CRITICAL', 'No exception', e.message, false, `Rule execution threw: ${e.message}`);
    }

    // R4. INCIDENT_COUNT_MATCH
    try {
      if (!exec || !rcaAnalytics || !Array.isArray(rcaAnalytics.breakdown)) {
        recordCheck('INCIDENT_COUNT_MATCH', 'CRITICAL', 'Sum of rcaAnalytics breakdown counts equals totalIncidents', null, false, null, !exec ? 'executiveSummary' : 'rcaAnalytics.breakdown');
      } else {
        const expected = safeNum(exec.totalIncidents) ?? 0;
        const actual = rcaAnalytics.breakdown.reduce((acc, item) => acc + (safeNum(item?.count) ?? 0), 0);
        recordCheck('INCIDENT_COUNT_MATCH', 'HIGH', expected, actual, expected === actual, `Total incidents (${expected}) does not match RCA breakdown sum (${actual}).`);
      }
    } catch (e) {
      recordCheck('INCIDENT_COUNT_MATCH', 'CRITICAL', 'No exception', e.message, false, `Rule execution threw: ${e.message}`);
    }

    // R5. SITE_INCIDENT_SUM_MATCH
    try {
      if (!exec || siteSummary === null) {
        recordCheck('SITE_INCIDENT_SUM_MATCH', 'CRITICAL', 'Sum of site incident counts equals totalIncidents', null, false, null, !exec ? 'executiveSummary' : 'siteSummary');
      } else {
        const expected = safeNum(exec.totalIncidents) ?? 0;
        const actual = siteSummary.reduce((acc, s) => acc + (safeNum(s?.incidentCount) ?? 0), 0);
        recordCheck('SITE_INCIDENT_SUM_MATCH', 'HIGH', expected, actual, expected === actual, `Total incidents (${expected}) does not match site incident count sum (${actual}).`);
      }
    } catch (e) {
      recordCheck('SITE_INCIDENT_SUM_MATCH', 'CRITICAL', 'No exception', e.message, false, `Rule execution threw: ${e.message}`);
    }

    // R6. AP_INCIDENT_UNIQUE_LTE_TOTAL
    try {
      if (siteSummary === null) {
        recordCheck('AP_INCIDENT_UNIQUE_LTE_TOTAL', 'CRITICAL', 'uniqueAPsWithIncidents <= apIncidents for all sites', null, false, null, 'siteSummary');
      } else {
        let allValid = true;
        const failures = [];
        siteSummary.forEach(site => {
          const unique = safeNum(site?.uniqueAPsWithIncidents) ?? 0;
          const totalApInc = safeNum(site?.apIncidents) ?? 0;
          if (unique > totalApInc) {
            allValid = false;
            failures.push(`${site.siteId}: unique (${unique}) > total (${totalApInc})`);
          }
        });
        recordCheck('AP_INCIDENT_UNIQUE_LTE_TOTAL', 'HIGH', 'uniqueAPsWithIncidents <= apIncidents across all sites', failures.length === 0 ? 'All sites compliant' : failures.join(', '), allValid, `Unique AP incidents exceeded total AP incidents: ${failures.join(', ')}`);
      }
    } catch (e) {
      recordCheck('AP_INCIDENT_UNIQUE_LTE_TOTAL', 'CRITICAL', 'No exception', e.message, false, `Rule execution threw: ${e.message}`);
    }

    // R7. SLA_COMPLIANCE_RANGE
    try {
      if (!slaAnalytics) {
        recordCheck('SLA_COMPLIANCE_RANGE', 'CRITICAL', '0 <= overallSLAPercent <= 100', null, false, null, 'slaAnalytics');
      } else {
        const val = safeNum(slaAnalytics.overallSLAPercent);
        const pass = val !== null && val >= 0 && val <= 100;
        recordCheck('SLA_COMPLIANCE_RANGE', 'MEDIUM', '0 to 100', val, pass, `Overall SLA compliance percent (${val}) is out of [0, 100] range.`);
      }
    } catch (e) {
      recordCheck('SLA_COMPLIANCE_RANGE', 'CRITICAL', 'No exception', e.message, false, `Rule execution threw: ${e.message}`);
    }

    // R8. UPTIME_RANGE
    try {
      if (devices === null) {
        recordCheck('UPTIME_RANGE', 'CRITICAL', 'All device uptimes bounded [0, 100]', null, false, null, 'devices');
      } else {
        let invalidCount = 0;
        devices.forEach(d => {
          const pro = safeNum(d?.__proactiveUptime);
          const jfl = safeNum(d?.__jflUptime);
          if ((pro !== null && (pro < 0 || pro > 100)) || (jfl !== null && (jfl < 0 || jfl > 100))) {
            invalidCount++;
          }
        });
        recordCheck('UPTIME_RANGE', 'HIGH', 0, invalidCount, invalidCount === 0, `${invalidCount} device(s) have uptime percentage outside [0, 100].`);
      }
    } catch (e) {
      recordCheck('UPTIME_RANGE', 'CRITICAL', 'No exception', e.message, false, `Rule execution threw: ${e.message}`);
    }

    // R9. RCA_PERCENTAGE_SUM
    try {
      if (!rcaAnalytics || !Array.isArray(rcaAnalytics.breakdown) || rcaAnalytics.breakdown.length === 0) {
        recordCheck('RCA_PERCENTAGE_SUM', 'CRITICAL', 'RCA percentage breakdown sums to 100 +/- 0.5', null, false, null, 'rcaAnalytics.breakdown');
      } else {
        const sumPct = rcaAnalytics.breakdown.reduce((acc, item) => acc + (safeNum(item?.percentage) ?? 0), 0);
        const diff = Math.abs(sumPct - 100);
        const pass = diff <= 0.5;
        recordCheck('RCA_PERCENTAGE_SUM', 'MEDIUM', '100.00% (+/- 0.5%)', `${sumPct.toFixed(2)}%`, pass, `RCA breakdown percentages sum to ${sumPct.toFixed(2)}% (expected ~100%).`);
      }
    } catch (e) {
      recordCheck('RCA_PERCENTAGE_SUM', 'CRITICAL', 'No exception', e.message, false, `Rule execution threw: ${e.message}`);
    }

    // R10. SLA_TARGET_RESOLVED
    try {
      if (!slaAnalytics) {
        recordCheck('SLA_TARGET_RESOLVED', 'CRITICAL', 'slaTarget is numeric > 0', null, false, null, 'slaAnalytics');
      } else {
        const target = safeNum(slaAnalytics.slaTarget);
        const pass = target !== null && target > 0;
        recordCheck('SLA_TARGET_RESOLVED', 'HIGH', '> 0', target, pass, `SLA target (${target}) is invalid or not resolved.`);
      }
    } catch (e) {
      recordCheck('SLA_TARGET_RESOLVED', 'CRITICAL', 'No exception', e.message, false, `Rule execution threw: ${e.message}`);
    }

    // R11. REPLACED_SERIAL_LINKAGE
    try {
      if (devices === null) {
        recordCheck('REPLACED_SERIAL_LINKAGE', 'CRITICAL', 'Replaced serials exist in inventory', null, false, null, 'devices');
      } else {
        const deviceSerialSet = new Set();
        devices.forEach(d => {
          if (d?.DeviceID) deviceSerialSet.add(String(d.DeviceID).trim());
          if (d?.SerialNo) deviceSerialSet.add(String(d.SerialNo).trim());
        });

        let unlinkedCount = 0;
        devices.forEach(d => {
          const replaced = d?.__replacedOldSerial;
          if (replaced && typeof replaced === 'string' && replaced.trim()) {
            if (!deviceSerialSet.has(replaced.trim())) {
              unlinkedCount++;
            }
          }
        });
        recordCheck('REPLACED_SERIAL_LINKAGE', 'MEDIUM', 0, unlinkedCount, unlinkedCount === 0, `${unlinkedCount} replaced serial reference(s) could not be resolved in inventory.`);
      }
    } catch (e) {
      recordCheck('REPLACED_SERIAL_LINKAGE', 'CRITICAL', 'No exception', e.message, false, `Rule execution threw: ${e.message}`);
    }

    // R12. STOCK_DEVICE_NOT_IN_SLA
    try {
      if (devices === null) {
        recordCheck('STOCK_DEVICE_NOT_IN_SLA', 'CRITICAL', 'Stock devices must not be marked as SLA breach', null, false, null, 'devices');
      } else {
        let breachStockCount = 0;
        devices.forEach(d => {
          if (d?.__isStock === true && d?.__slaBreach === true) {
            breachStockCount++;
          }
        });
        recordCheck('STOCK_DEVICE_NOT_IN_SLA', 'HIGH', 0, breachStockCount, breachStockCount === 0, `${breachStockCount} unassigned stock device(s) incorrectly evaluated for SLA breaches.`);
      }
    } catch (e) {
      recordCheck('STOCK_DEVICE_NOT_IN_SLA', 'CRITICAL', 'No exception', e.message, false, `Rule execution threw: ${e.message}`);
    }

    // R13. DISPLAY_REFERENCE_VALIDITY
    try {
      if (incidents === null) {
        recordCheck('DISPLAY_REFERENCE_VALIDITY', 'CRITICAL', 'All incidents have valid display_reference', null, false, null, 'incidents');
      } else {
        let invalidCount = 0;
        incidents.forEach(inc => {
          const ref = inc?.display_reference;
          if (!ref || typeof ref !== 'object') {
            invalidCount++;
          } else {
            const validTypes = ['Ticket', 'Incident ID'];
            const typeValid = validTypes.includes(ref.type);
            const valValid = typeof ref.value === 'string' && ref.value.trim().length > 0;
            if (!typeValid || !valValid) invalidCount++;
          }
        });
        recordCheck('DISPLAY_REFERENCE_VALIDITY', 'HIGH', 0, invalidCount, invalidCount === 0, `${invalidCount} incident(s) missing valid display_reference object.`);
      }
    } catch (e) {
      recordCheck('DISPLAY_REFERENCE_VALIDITY', 'CRITICAL', 'No exception', e.message, false, `Rule execution threw: ${e.message}`);
    }

    // R14. SLA_STATUS_ENUM
    try {
      if (incidents === null) {
        recordCheck('SLA_STATUS_ENUM', 'CRITICAL', 'All incident sla_status belong to allowed enum', null, false, null, 'incidents');
      } else {
        const allowedStatuses = new Set(['SLA Met', 'SLA Breached', 'Open', null, undefined, '']);
        let invalidCount = 0;
        incidents.forEach(inc => {
          const status = inc?.sla_status;
          if (!allowedStatuses.has(status)) {
            invalidCount++;
          }
        });
        recordCheck('SLA_STATUS_ENUM', 'HIGH', 0, invalidCount, invalidCount === 0, `${invalidCount} incident(s) have invalid sla_status string.`);
      }
    } catch (e) {
      recordCheck('SLA_STATUS_ENUM', 'CRITICAL', 'No exception', e.message, false, `Rule execution threw: ${e.message}`);
    }

    // R15. PERIOD_LABEL_PRESENT
    try {
      if (!reportPeriod) {
        recordCheck('PERIOD_LABEL_PRESENT', 'CRITICAL', 'report_period.display_label is non-empty string', null, false, null, 'report_period');
      } else {
        const label = reportPeriod.display_label;
        const pass = typeof label === 'string' && label.trim().length > 0 && label !== 'User Selected Period';
        recordCheck('PERIOD_LABEL_PRESENT', 'HIGH', 'Valid date range string', label, pass, `Reporting period label ("${label}") is missing or dynamic date range unresolved.`);
      }
    } catch (e) {
      recordCheck('PERIOD_LABEL_PRESENT', 'CRITICAL', 'No exception', e.message, false, `Rule execution threw: ${e.message}`);
    }

    const failedCount = failed.length;
    const passedCount = passed.length;
    const total = passedCount + failedCount;

    return {
      success: failedCount === 0,
      passed,
      failed,
      summary: { total, passedCount, failedCount },
      error: null,
    };
  } catch (err) {
    return {
      success: false,
      passed: [],
      failed: [],
      summary: { total: 0, passedCount: 0, failedCount: 0 },
      error: err?.message || 'UNKNOWN_ERROR',
    };
  }
}

module.exports = { crossValidate };
