// backend/services/reconciliationEngine.js
// Automated Pre & Post Generation Reconciliation & Machine Validation Engine
// Enforces ZERO TOLERANCE for data mismatches between Dashboard SSOT and PPT output.
// FAILS CLOSED if any metric fails reconciliation.

const fs = require('fs');
const path = require('path');

function reconcileDashboardAndPPT(qbrData, pptData, outputDir = null) {
  const auditTrail = [];
  const mismatches = [];

  function recordCheck(metricName, slideName, expected, actual, path) {
    const expStr = String(expected ?? '').trim();
    const actStr = String(actual ?? '').trim();
    const isMatch = expStr === actStr;

    const entry = {
      slide: slideName,
      metric: metricName,
      expected: expected,
      actual: actual,
      path: path,
      status: isMatch ? 'PASS' : 'FAIL',
    };

    auditTrail.push(entry);

    if (!isMatch) {
      mismatches.push(entry);
    }
  }

  const exec = qbrData.executiveSummary || {};
  const s3 = pptData.slide3_ExecutiveSummary || {};

  // 1. Executive Summary Reconciliation (Slide 3)
  recordCheck('totalSites', 'Slide 3', exec.totalSites, s3.totalSites?.value, 'executiveSummary.totalSites');
  recordCheck('totalDevices', 'Slide 3', exec.totalDevices, s3.totalDevices?.value, 'executiveSummary.totalDevices');
  recordCheck('totalStockDevices', 'Slide 3', exec.totalStockDevices, s3.totalStockDevices?.value, 'executiveSummary.totalStockDevices');
  recordCheck('totalSwitches', 'Slide 3', exec.totalSwitches, s3.totalSwitches?.value, 'executiveSummary.totalSwitches');
  recordCheck('totalAPs', 'Slide 3', exec.totalAPs, s3.totalAPs?.value, 'executiveSummary.totalAPs');
  recordCheck('apIncidents', 'Slide 3', exec.apIncidents, s3.apIncidents?.value, 'executiveSummary.apIncidents');
  recordCheck('uniqueAPsWithIncidents', 'Slide 3', exec.uniqueAPsWithIncidents, s3.uniqueAPsWithIncidents?.value, 'executiveSummary.uniqueAPsWithIncidents');
  recordCheck('primaryRca', 'Slide 3', exec.primaryRca, s3.primaryRca?.value, 'executiveSummary.primaryRca');
  recordCheck('primaryRcaForAPs', 'Slide 3', exec.primaryRcaForAPs, s3.primaryRcaForAPs?.value, 'executiveSummary.primaryRcaForAPs');
  recordCheck('overallUptime', 'Slide 3', exec.overallUptime, s3.overallUptime?.value, 'executiveSummary.overallUptime');
  recordCheck('incidentFreePercent', 'Slide 3', exec.incidentFreePercent, s3.incidentFreePercent?.value, 'executiveSummary.incidentFreePercent');
  recordCheck('healthScore', 'Slide 3', exec.healthScore, s3.healthScore?.value, 'executiveSummary.healthScore');
  recordCheck('slaCompliance', 'Slide 3', exec.slaCompliance, s3.slaCompliance?.value, 'executiveSummary.slaCompliance');
  recordCheck('totalIncidents', 'Slide 3', exec.totalIncidents, s3.totalIncidents?.value, 'executiveSummary.totalIncidents');
  recordCheck('criticalIncidents', 'Slide 3', exec.criticalIncidents, s3.criticalIncidents?.value, 'executiveSummary.criticalIncidents');
  recordCheck('majorIncidents', 'Slide 3', exec.majorIncidents, s3.majorIncidents?.value, 'executiveSummary.majorIncidents');
  recordCheck('minorIncidents', 'Slide 3', exec.minorIncidents, s3.minorIncidents?.value, 'executiveSummary.minorIncidents');

  // 2. Site Overview Table Reconciliation (Slide 5)
  const qSites = qbrData.siteSummary || [];
  const pptSites = pptData.slide5_SiteOverview?.sites || [];

  recordCheck('siteCount', 'Slide 5', qSites.length, pptSites.length, 'siteSummary.length');

  qSites.forEach((qSite, idx) => {
    const pSite = pptSites.find(s => s.siteId === qSite.siteId) || {};
    recordCheck(`site_${qSite.siteId}_deviceCount`, 'Slide 5', qSite.deviceCount, pSite.deviceCount, `siteSummary[${qSite.siteId}].deviceCount`);
    recordCheck(`site_${qSite.siteId}_activeDeviceCount`, 'Slide 5', qSite.activeDeviceCount ?? qSite.deviceCount, pSite.activeDeviceCount, `siteSummary[${qSite.siteId}].activeDeviceCount`);
    recordCheck(`site_${qSite.siteId}_stockCount`, 'Slide 5', qSite.stockCount ?? 0, pSite.stockCount, `siteSummary[${qSite.siteId}].stockCount`);
    recordCheck(`site_${qSite.siteId}_proactiveSwitchUptime`, 'Slide 5', qSite.proactiveSwitchUptime, pSite.proactiveSwitchUptime, `siteSummary[${qSite.siteId}].proactiveSwitchUptime`);
    recordCheck(`site_${qSite.siteId}_jflSwitchUptime`, 'Slide 5', qSite.jflSwitchUptime, pSite.jflSwitchUptime, `siteSummary[${qSite.siteId}].jflSwitchUptime`);
    recordCheck(`site_${qSite.siteId}_incidentCount`, 'Slide 5', qSite.incidentCount, pSite.incidentCount, `siteSummary[${qSite.siteId}].incidentCount`);
    recordCheck(`site_${qSite.siteId}_apIncidents`, 'Slide 5', qSite.apIncidents, pSite.apIncidents, `siteSummary[${qSite.siteId}].apIncidents`);
    recordCheck(`site_${qSite.siteId}_uniqueAPs`, 'Slide 5', qSite.uniqueAPsWithIncidents, pSite.uniqueAPsWithIncidents, `siteSummary[${qSite.siteId}].uniqueAPsWithIncidents`);
    recordCheck(`site_${qSite.siteId}_healthScore`, 'Slide 5', qSite.healthScore, pSite.healthScore, `siteSummary[${qSite.siteId}].healthScore`);
  });

  // 3. RCA Reconciliation (Slide 8 & Phase 10)
  const rcaBrk = qbrData.rcaAnalytics?.breakdown || [];
  const sumRcaCounts = rcaBrk.reduce((acc, r) => acc + (r.count || 0), 0);
  const sumSiteIncidents = qSites.reduce((acc, s) => acc + (s.incidentCount || 0), 0);

  recordCheck('RCA_Total_Equals_TotalIncidents', 'Phase 10 Identity', exec.totalIncidents, sumRcaCounts, 'rcaAnalytics.sumRcaCounts');
  recordCheck('Site_Incidents_Total_Equals_TotalIncidents', 'Phase 10 Identity', exec.totalIncidents, sumSiteIncidents, 'siteSummary.sumSiteIncidents');

  const overallStatus = mismatches.length === 0 ? 'PASS' : 'FAIL';

  const report = {
    reportId: pptData.metadata?.reportId || 'N/A',
    generatedAt: new Date().toISOString(),
    overallStatus: overallStatus,
    metricsChecked: auditTrail.length,
    mismatchesCount: mismatches.length,
    mismatches: mismatches,
    auditTrail: auditTrail,
  };

  if (outputDir) {
    const reportPath = path.join(outputDir, 'ppt_validation_report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  }

  if (overallStatus === 'FAIL') {
    const firstErr = mismatches[0];
    throw new Error(`PPT GENERATION FAILED — DATA RECONCILIATION ERROR: Metric "${firstErr.metric}" on ${firstErr.slide} failed reconciliation. Expected: ${firstErr.expected}, Actual: ${firstErr.actual} (Path: ${firstErr.path})`);
  }

  return report;
}

module.exports = {
  reconcileDashboardAndPPT,
};
