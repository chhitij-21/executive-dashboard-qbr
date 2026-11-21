// backend/services/dataHealthService.js
// ─────────────────────────────────────────────────────────────────────────────
// Enterprise Data Health & Invariant Telemetry Engine (Item #12)
// Evaluates mathematical conservation laws, data hygiene, completeness,
// and lineage metadata against the Single Source of Truth (qbrData).
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

// Note: Immutability is contractually guaranteed.
// dataHealthService operates strictly as a read-only scanner over qbrData and never mutates caller input.

/**
 * Evaluates core mathematical invariants against qbrData.
 */
function evaluateInvariants(qbrData) {
  const exec = qbrData?.executiveSummary || {};
  const devices = Array.isArray(qbrData?.devices) ? qbrData.devices : [];
  const incidents = Array.isArray(qbrData?.incidents) ? qbrData.incidents : [];
  const siteSummary = Array.isArray(qbrData?.siteSummary) ? qbrData.siteSummary : [];
  const rcaBreakdown = Array.isArray(qbrData?.incidentAnalytics?.rcaBreakdown)
    ? qbrData.incidentAnalytics.rcaBreakdown
    : [];
  const slaCompliance = qbrData?.slaCompliance || {};

  const totalDevices = Number(exec.totalDevices ?? devices.length);
  const totalSwitches = Number(exec.totalSwitches ?? devices.filter((d) => /switch/i.test(d.Type || d.DeviceType || '')).length);
  const totalAPs = Number(exec.totalAPs ?? devices.filter((d) => /ap|access point/i.test(d.Type || d.DeviceType || '')).length);
  const stockDevices = Number(exec.stockDevices ?? devices.filter((d) => d.__isStock).length);
  const totalIncidents = Number(exec.totalIncidents ?? incidents.length);

  // R1: Inventory Conservation (Active Switches + Active APs + Stock === Total Devices)
  const actualR1Devices = totalSwitches + totalAPs + stockDevices;
  const r1Passed = actualR1Devices === totalDevices;

  // R2: RCA Summation (Sum of RCA breakdown counts === total incidents)
  const rcaCountSum = rcaBreakdown.reduce((sum, item) => sum + (Number(item.count) || 0), 0);
  const r2Passed = totalIncidents === 0 ? true : rcaCountSum === totalIncidents;

  // R3: SLA Status Partition (Met + Breached + Open === Total Incidents)
  const metCount = Number(slaCompliance.met ?? 0);
  const breachedCount = Number(slaCompliance.breached ?? 0);
  const openCount = Number(slaCompliance.open ?? 0);
  const slaStatusSum = metCount + breachedCount + openCount;
  const r3Passed = totalIncidents === 0 ? true : (slaStatusSum === totalIncidents || slaStatusSum === 0);

  // R4: Uptime Boundedness (Every device uptime is between 0.00% and 100.00%)
  let r4Passed = true;
  let r4Detail = 'All devices within [0.00%, 100.00%]';
  for (const d of devices) {
    const jfl = d.__jflUptime ?? d['JFL Uptime %'] ?? d.uptime;
    const pro = d.__proactiveUptime ?? d['Proactive Uptime %'];
    if (jfl !== undefined && jfl !== null) {
      const num = Number(jfl);
      if (isNaN(num) || num < 0 || num > 100) {
        r4Passed = false;
        r4Detail = `Device ${d.DeviceID || d.Hostname} has invalid uptime: ${jfl}`;
        break;
      }
    }
    if (pro !== undefined && pro !== null) {
      const num = Number(pro);
      if (isNaN(num) || num < 0 || num > 100) {
        r4Passed = false;
        r4Detail = `Device ${d.DeviceID || d.Hostname} has invalid proactive uptime: ${pro}`;
        break;
      }
    }
  }

  // R5: Site Device Allocation (Sum of deviceCount across sites === Total Active Devices, excluding Stock)
  const totalActiveDevices = Math.max(0, totalDevices - stockDevices);
  const siteDevicesSum = siteSummary.reduce((sum, s) => sum + (Number(s.deviceCount) || 0), 0);
  const r5Passed = totalActiveDevices === 0 ? (siteDevicesSum === 0) : (siteDevicesSum === totalActiveDevices);

  const checks = [
    {
      id: 'R1_INVENTORY_CONSERVATION',
      name: 'Physical Inventory Conservation',
      formula: 'Active Switches + Active APs + Stock Devices = Total Devices',
      expected: totalDevices,
      actual: actualR1Devices,
      passed: r1Passed,
      detail: r1Passed
        ? `Conserved: ${totalSwitches} SW + ${totalAPs} AP + ${stockDevices} Stock = ${totalDevices} Total`
        : `Discrepancy: ${totalSwitches} SW + ${totalAPs} AP + ${stockDevices} Stock = ${actualR1Devices} (Expected ${totalDevices})`,
    },
    {
      id: 'R2_RCA_SUMMATION',
      name: 'RCA Driver Summation',
      formula: 'Sum of RCA Breakdown Counts = Total Incidents',
      expected: totalIncidents,
      actual: rcaCountSum,
      passed: r2Passed,
      detail: r2Passed
        ? `Conserved: Sum of RCA categories = ${totalIncidents}`
        : `Discrepancy: RCA counts sum to ${rcaCountSum} but total incidents is ${totalIncidents}`,
    },
    {
      id: 'R3_SLA_STATUS_PARTITION',
      name: 'SLA Status Conservation',
      formula: 'SLA Met + SLA Breached + Open Incidents = Total Incidents',
      expected: totalIncidents,
      actual: slaStatusSum,
      passed: r3Passed,
      detail: r3Passed
        ? `Conserved: ${metCount} Met + ${breachedCount} Breached + ${openCount} Open = ${totalIncidents}`
        : `Discrepancy: ${metCount} Met + ${breachedCount} Breached + ${openCount} Open = ${slaStatusSum} (Expected ${totalIncidents})`,
    },
    {
      id: 'R4_UPTIME_BOUNDEDNESS',
      name: 'Uptime Percentage Boundedness',
      formula: 'For all devices: 0.00% <= Uptime <= 100.00%',
      expected: '100% Valid Range',
      actual: r4Passed ? '100% Valid' : 'Out of Bounds',
      passed: r4Passed,
      detail: r4Detail,
    },
    {
      id: 'R5_SITE_DEVICE_ALLOCATION',
      name: 'Site Device Allocation Consistency',
      formula: 'Sum of Site Device Counts = Total Active Devices (Total Devices - Stock Devices)',
      expected: totalActiveDevices,
      actual: siteDevicesSum,
      passed: r5Passed,
      detail: r5Passed
        ? `Conserved: Sum across ${siteSummary.length} sites = ${siteDevicesSum} Active Devices (excluding ${stockDevices} Stock)`
        : `Discrepancy: Sum across sites is ${siteDevicesSum} but total active devices (Total ${totalDevices} - Stock ${stockDevices}) is ${totalActiveDevices}`,
    },
  ];

  const total = checks.length;
  const passed = checks.filter((c) => c.passed).length;
  const failed = total - passed;

  return { total, passed, failed, checks };
}

/**
 * Audits devices and incidents for missing telemetry and data hygiene gaps.
 */
function auditDataHygiene(qbrData) {
  const devices = Array.isArray(qbrData?.devices) ? qbrData.devices : [];
  const incidents = Array.isArray(qbrData?.incidents) ? qbrData.incidents : [];
  const reportPeriod = qbrData?.report_period || {};
  const periodStart = reportPeriod.start_date ? new Date(reportPeriod.start_date) : null;

  const issues = [];
  let completeDevicesCount = 0;
  let compliantIncidentsCount = 0;
  let anomaliesCount = 0;

  // ── 1. Device Hygiene ─────────────────────────────────────────────
  devices.forEach((d, idx) => {
    const rowNumber = Number(d.__rowNum) || idx + 2;
    const sheetName = d.__sheet || 'Device Inventory';
    const hostname = d.Hostname || d.DeviceID || `Device_${idx + 1}`;
    let isComplete = true;

    // Check Serial Number
    const serial = d.SerialNo || d.serial_number || d.Serial;
    if (!serial || String(serial).trim() === '' || String(serial).toUpperCase() === 'MISSING') {
      isComplete = false;
      issues.push({
        id: `dev_${idx}_serial`,
        entityId: d.DeviceID || hostname,
        entityType: 'device',
        type: 'DEVICE_MISSING_SERIAL',
        severity: 'HIGH',
        sheetName,
        rowNumber,
        fieldName: 'SerialNo',
        rawValue: serial || null,
        message: `Device "${hostname}" is missing hardware Serial Number.`,
        recommendation: 'Update CMDB or inventory spreadsheet with physical serial number.',
      });
    }

    // Check IP Address
    const ip = d.IP || d.ip_address || d.IPAddress;
    if (!ip || String(ip).trim() === '') {
      isComplete = false;
      issues.push({
        id: `dev_${idx}_ip`,
        entityId: d.DeviceID || hostname,
        entityType: 'device',
        type: 'DEVICE_MISSING_IP',
        severity: 'MEDIUM',
        sheetName,
        rowNumber,
        fieldName: 'IP',
        rawValue: ip || null,
        message: `Device "${hostname}" has no management IP Address assigned.`,
        recommendation: 'Ensure management IP is documented for proactive ping/polling monitoring.',
      });
    }

    // Check Model
    const model = d.Model || d.model || d.DeviceModel;
    if (!model || String(model).trim() === '') {
      issues.push({
        id: `dev_${idx}_model`,
        entityId: d.DeviceID || hostname,
        entityType: 'device',
        type: 'DEVICE_MISSING_MODEL',
        severity: 'LOW',
        sheetName,
        rowNumber,
        fieldName: 'Model',
        rawValue: model || null,
        message: `Device "${hostname}" is missing hardware Model designation.`,
        recommendation: 'Add hardware model (e.g. Cisco Catalyst 9300, Meraki MR46) for lifecycle tracking.',
      });
    }

    if (isComplete) completeDevicesCount++;
  });

  // ── 2. Incident Hygiene ───────────────────────────────────────────
  incidents.forEach((inc, idx) => {
    const rowNumber = Number(inc.__rowNum) || idx + 2;
    const sheetName = inc.__sheet || 'Incident Details';
    const ticketId = inc.TicketNumber || inc.IncidentID || inc.ticket_id || `Ticket_${idx + 1}`;
    let isCompliant = true;

    // Check Root Cause Analysis (RCA)
    const rca = inc.RCA || inc['Root Cause'] || inc['RCA 2'];
    if (!rca || String(rca).trim() === '' || String(rca).toLowerCase() === 'unknown') {
      isCompliant = false;
      issues.push({
        id: `inc_${idx}_rca`,
        entityId: ticketId,
        entityType: 'incident',
        type: 'INCIDENT_MISSING_RCA',
        severity: 'HIGH',
        sheetName,
        rowNumber,
        fieldName: 'RCA',
        rawValue: rca || 'Unknown',
        message: `Incident #${ticketId} is missing root cause categorization (marked "Unknown").`,
        recommendation: 'Conduct post-incident review and classify under valid RCA category.',
      });
    }

    // Check Duration Consistency
    const holdTime = inc.HoldTimeMinutes !== undefined ? Number(inc.HoldTimeMinutes) : null;
    const resTime = inc.ResolutionTimeMinutes !== undefined ? Number(inc.ResolutionTimeMinutes) : null;
    if (holdTime !== null && holdTime < 0) {
      isCompliant = false;
      anomaliesCount++;
      issues.push({
        id: `inc_${idx}_hold`,
        entityId: ticketId,
        entityType: 'incident',
        type: 'INCIDENT_INVALID_DURATION',
        severity: 'CRITICAL',
        sheetName,
        rowNumber,
        fieldName: 'HoldTimeMinutes',
        rawValue: holdTime,
        message: `Incident #${ticketId} has negative hold duration (${holdTime} mins).`,
        recommendation: 'Correct ticket timestamps to prevent skewed uptime calculations.',
      });
    }

    // Check Rollover Tickets (Created prior to reporting period)
    if (periodStart && inc.CreatedTime) {
      const created = new Date(inc.CreatedTime);
      if (!isNaN(created.getTime()) && created < periodStart) {
        anomaliesCount++;
        issues.push({
          id: `inc_${idx}_rollover`,
          entityId: ticketId,
          entityType: 'incident',
          type: 'INCIDENT_ROLLOVER_PERIOD',
          severity: 'MEDIUM',
          sheetName,
          rowNumber,
          fieldName: 'CreatedTime',
          rawValue: inc.CreatedTime,
          message: `Ticket #${ticketId} opened before report start date (${inc.CreatedTime}). Hold minutes capped to period.`,
          recommendation: 'Verify rollover hold minutes are properly bounded within period start.',
        });
      }
    }

    if (isCompliant) compliantIncidentsCount++;
  });

  const totalDev = devices.length || 1;
  const totalInc = incidents.length || 1;
  const inventoryCompleteness = Math.round((completeDevicesCount / totalDev) * 100);
  const incidentHygiene = Math.round((compliantIncidentsCount / totalInc) * 100);

  return {
    issues,
    metrics: {
      totalDevices: devices.length,
      completeDevices: completeDevicesCount,
      inventoryCompleteness,
      totalIncidents: incidents.length,
      compliantIncidents: compliantIncidentsCount,
      incidentHygiene,
      anomaliesCount,
    },
  };
}

/**
 * Calculates overall Data Health composite score and classifications.
 */
function calculateDataHealth(qbrData) {
  const devices = Array.isArray(qbrData?.devices) ? qbrData.devices : [];
  const incidents = Array.isArray(qbrData?.incidents) ? qbrData.incidents : [];

  // Empty / minimal dataset safeguard: return INSUFFICIENT_DATA and score null
  if (devices.length === 0 && incidents.length === 0) {
    return {
      status: 'INSUFFICIENT_DATA',
      score: null, // UI renders as N/A
      evaluatedAt: new Date().toISOString(),
      invariants: {
        total: 5,
        passed: 0,
        failed: 0,
        checks: [
          { id: 'R1_INVENTORY_CONSERVATION', name: 'Physical Inventory Conservation', formula: 'Switches + APs + Stock = Total', expected: 0, actual: 0, passed: true, detail: 'No data to evaluate' },
          { id: 'R2_RCA_SUMMATION', name: 'RCA Driver Summation', formula: 'Sum of RCAs = Total Incidents', expected: 0, actual: 0, passed: true, detail: 'No data to evaluate' },
          { id: 'R3_SLA_STATUS_PARTITION', name: 'SLA Status Conservation', formula: 'Met + Breached + Open = Total', expected: 0, actual: 0, passed: true, detail: 'No data to evaluate' },
          { id: 'R4_UPTIME_BOUNDEDNESS', name: 'Uptime Percentage Boundedness', formula: '0.00% <= Uptime <= 100.00%', expected: 'N/A', actual: 'N/A', passed: true, detail: 'No data to evaluate' },
          { id: 'R5_SITE_DEVICE_ALLOCATION', name: 'Site Device Allocation Consistency', formula: 'Site Devices = Total Active Devices', expected: 0, actual: 0, passed: true, detail: 'No data to evaluate' },
        ],
      },
      metrics: {
        totalDevices: 0,
        completeDevices: 0,
        inventoryCompleteness: 0,
        totalIncidents: 0,
        compliantIncidents: 0,
        incidentHygiene: 0,
        anomaliesCount: 0,
      },
      issues: [],
      recommendations: [
        {
          priority: 'P2',
          title: 'Upload Inventory and Incident Workbooks',
          description: 'Dataset contains zero devices and zero incidents. Upload source data to generate QBR health analytics.',
        },
      ],
    };
  }

  const invariants = evaluateInvariants(qbrData);
  const hygiene = auditDataHygiene(qbrData);

  // If any core invariant failed, inject CRITICAL issues for them
  invariants.checks.forEach((c) => {
    if (!c.passed) {
      hygiene.issues.unshift({
        id: `inv_${c.id}`,
        entityId: c.id,
        entityType: 'invariant',
        type: 'INVARIANT_FAILURE',
        severity: 'CRITICAL',
        sheetName: 'All Sheets (SSOT)',
        rowNumber: 1,
        fieldName: c.name,
        rawValue: `Actual: ${c.actual} vs Expected: ${c.expected}`,
        message: `Mathematical Invariant Violation: ${c.name}. ${c.detail}`,
        recommendation: 'Review pipeline calculations. All mathematical conservation laws must hold.',
      });
    }
  });

  // Calculate weighted composite score (0-100%)
  const invariantRatio = invariants.total > 0 ? invariants.passed / invariants.total : 1.0;
  const inventoryRatio = (hygiene.metrics.inventoryCompleteness || 100) / 100;
  const incidentRatio = (hygiene.metrics.incidentHygiene || 100) / 100;
  const anomalyPenalty = Math.min(1.0, (hygiene.metrics.anomaliesCount || 0) * 0.05);
  const anomalyRatio = Math.max(0, 1.0 - anomalyPenalty);

  let rawScore = (
    0.35 * invariantRatio +
    0.25 * inventoryRatio +
    0.25 * incidentRatio +
    0.15 * anomalyRatio
  ) * 100;

  // If any invariant failed, health score cannot exceed 69% (Critical)
  if (invariants.failed > 0) {
    rawScore = Math.min(rawScore, 68);
  }

  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  let status = 'HEALTHY';
  if (score < 70 || invariants.failed > 0) {
    status = 'CRITICAL';
  } else if (score < 90) {
    status = 'WARNING';
  }

  // Generate actionable recommendations
  const recommendations = [];
  const missingSerials = hygiene.issues.filter((i) => i.type === 'DEVICE_MISSING_SERIAL').length;
  if (missingSerials > 0) {
    recommendations.push({
      priority: 'P1',
      title: `Update ${missingSerials} Missing Hardware Serial Numbers`,
      description: `Discovered ${missingSerials} devices lacking serial numbers in asset inventory.`,
    });
  }

  const missingRcas = hygiene.issues.filter((i) => i.type === 'INCIDENT_MISSING_RCA').length;
  if (missingRcas > 0) {
    recommendations.push({
      priority: 'P1',
      title: `Classify ${missingRcas} Unassigned Incident Root Causes`,
      description: `${missingRcas} tickets currently have "Unknown" RCA. Assign valid root causes for executive reporting.`,
    });
  }

  if (invariants.failed > 0) {
    recommendations.unshift({
      priority: 'P0',
      title: `Resolve ${invariants.failed} Mathematical Invariant Failures`,
      description: 'Physical inventory arithmetic or incident category counts have broken conservation laws.',
    });
  }

  return {
    status,
    score,
    evaluatedAt: new Date().toISOString(),
    invariants,
    metrics: hygiene.metrics,
    issues: hygiene.issues,
    recommendations,
  };
}

/**
 * Lazy loads full rowSnapshot dictionary for a single issue on-demand.
 */
function getIssueRowSnapshot(qbrData, issueId) {
  if (!qbrData || !issueId) return null;

  const devices = Array.isArray(qbrData.devices) ? qbrData.devices : [];
  const incidents = Array.isArray(qbrData.incidents) ? qbrData.incidents : [];

  // Parse ID pattern: e.g. dev_0_serial or inc_1_rca
  const devMatch = issueId.match(/^dev_(\d+)_/);
  if (devMatch) {
    const idx = parseInt(devMatch[1], 10);
    const d = devices[idx];
    if (d) {
      return {
        success: true,
        issueId,
        sheetName: d.__sheet || 'Device Inventory',
        rowNumber: Number(d.__rowNum) || idx + 2,
        fieldName: issueId.includes('serial') ? 'SerialNo' : issueId.includes('ip') ? 'IP' : 'Model',
        rawValue: d.SerialNo || d.IP || d.Model || null,
        rowSnapshot: {
          DeviceID: d.DeviceID || 'N/A',
          Hostname: d.Hostname || d.DeviceID || 'N/A',
          IP: d.IP || d.IPAddress || 'MISSING',
          SerialNo: d.SerialNo || 'MISSING',
          Location: d.Location || d.Site || 'N/A',
          DeviceType: d.DeviceType || d.Type || 'Switch',
          Model: d.Model || 'N/A',
          Uptime: `${d.__jflUptime ?? d.uptime ?? 100}%`,
        },
      };
    }
  }

  const incMatch = issueId.match(/^inc_(\d+)_/);
  if (incMatch) {
    const idx = parseInt(incMatch[1], 10);
    const inc = incidents[idx];
    if (inc) {
      return {
        success: true,
        issueId,
        sheetName: inc.__sheet || 'Incident Details',
        rowNumber: Number(inc.__rowNum) || idx + 2,
        fieldName: issueId.includes('rca') ? 'RCA' : issueId.includes('hold') ? 'HoldTimeMinutes' : 'CreatedTime',
        rawValue: inc.RCA || inc.HoldTimeMinutes || inc.CreatedTime || null,
        rowSnapshot: {
          TicketNumber: inc.TicketNumber || inc.IncidentID || 'N/A',
          DeviceID: inc.DeviceID || 'N/A',
          Site: inc.Site || inc.SiteID || 'N/A',
          RCA: inc.RCA || 'Unknown',
          SLA_Status: inc.sla_status || 'Open',
          HoldTimeMinutes: inc.HoldTimeMinutes ?? 0,
          ResolutionTimeMinutes: inc.ResolutionTimeMinutes ?? 0,
          CreatedTime: inc.CreatedTime || 'N/A',
        },
      };
    }
  }

  // Fallback for invariant issues
  return {
    success: true,
    issueId,
    sheetName: 'All Sheets (SSOT)',
    rowNumber: 1,
    fieldName: 'Invariant Rule',
    rawValue: 'Invariant Assertion',
    rowSnapshot: {
      IssueID: issueId,
      Type: 'Invariant Violation',
      Status: 'Requires Engineering Review',
    },
  };
}

module.exports = {
  calculateDataHealth,
  getIssueRowSnapshot,
  evaluateInvariants,
  auditDataHygiene,
};

