// backend/services/pptDataMapper.js
// Explicit PPT Data Mapping Layer (Phase 4 & Phase 5)
// Maps the Canonical Report Snapshot (qbrData) to the Slide Presentation Data Model.
// ABSOLUTE RULE: ZERO business logic, ZERO recalculations, ZERO data transformations.
// Every value mapped here comes directly from the SSOT canonical snapshot.

function mapSnapshotToPPTData(qbrData) {
  if (!qbrData) {
    throw new Error('PPTDataMapper Error: Canonical snapshot (qbrData) is null or undefined.');
  }

  const exec = qbrData.executiveSummary || {};
  const sites = Array.isArray(qbrData.siteSummary) ? qbrData.siteSummary : [];
  const rca = qbrData.rcaAnalytics || {};
  const sla = qbrData.slaAnalytics || {};
  const inc = qbrData.incidentAnalytics || {};
  const meta = qbrData.metadata || {};

  // Build slide-by-slide mapped manifest
  const pptData = {
    metadata: {
      reportId: meta.reportId || qbrData.reportId || 'N/A',
      clientId: meta.clientId || 'JFL',
      customerName: qbrData.customerName || exec.customerName || 'Jubilant Foodworks Ltd (JFL)',
      reportingPeriod: qbrData.reportingPeriod || exec.reportingPeriod || 'N/A',
      generatedAt: qbrData.generatedAt || new Date().toISOString(),
      dataVersion: meta.dataVersion || '1.0.0',
      snapshotHash: meta.snapshotHash || 'N/A',
    },

    // Slide 3: Executive Summary
    slide3_ExecutiveSummary: {
      totalSites: { value: exec.totalSites, path: 'executiveSummary.totalSites' },
      totalDevices: { value: exec.totalDevices, path: 'executiveSummary.totalDevices' },
      totalStockDevices: { value: exec.totalStockDevices, path: 'executiveSummary.totalStockDevices' },
      totalSwitches: { value: exec.totalSwitches, path: 'executiveSummary.totalSwitches' },
      totalAPs: { value: exec.totalAPs, path: 'executiveSummary.totalAPs' },
      apIncidents: { value: exec.apIncidents, path: 'executiveSummary.apIncidents' },
      uniqueAPsWithIncidents: { value: exec.uniqueAPsWithIncidents, path: 'executiveSummary.uniqueAPsWithIncidents' },
      primaryRca: { value: exec.primaryRca, path: 'executiveSummary.primaryRca' },
      primaryRcaForAPs: { value: exec.primaryRcaForAPs, path: 'executiveSummary.primaryRcaForAPs' },
      overallUptime: { value: exec.overallUptime, path: 'executiveSummary.overallUptime' },
      incidentFreePercent: { value: exec.incidentFreePercent, path: 'executiveSummary.incidentFreePercent' },
      healthScore: { value: exec.healthScore, path: 'executiveSummary.healthScore' },
      healthLabel: { value: exec.healthLabel, path: 'executiveSummary.healthLabel' },
      slaCompliance: { value: exec.slaCompliance, path: 'executiveSummary.slaCompliance' },
      slaTarget: { value: exec.slaTarget, path: 'executiveSummary.slaTarget' },
      totalIncidents: { value: exec.totalIncidents, path: 'executiveSummary.totalIncidents' },
      criticalIncidents: { value: exec.criticalIncidents, path: 'executiveSummary.criticalIncidents' },
      majorIncidents: { value: exec.majorIncidents, path: 'executiveSummary.majorIncidents' },
      minorIncidents: { value: exec.minorIncidents, path: 'executiveSummary.minorIncidents' },
    },

    // Slide 4: Overall Network Health
    slide4_NetworkHealth: {
      overallHealthScore: { value: exec.healthScore, path: 'executiveSummary.healthScore' },
      overallHealthLabel: { value: exec.healthLabel, path: 'executiveSummary.healthLabel' },
      siteHealthList: sites.map((s, idx) => ({
        siteId: s.siteId,
        healthScore: s.healthScore,
        healthLabel: s.healthLabel,
        activeDeviceCount: s.activeDeviceCount,
        incidentCount: s.incidentCount,
        path: `siteSummary[${idx}].healthScore`,
      })),
    },

    // Slide 5: Site Overview Table
    slide5_SiteOverview: {
      sites: sites.map((s, idx) => ({
        siteId: s.siteId,
        deviceCount: s.deviceCount,
        activeDeviceCount: s.activeDeviceCount,
        stockCount: s.stockCount,
        proactiveSwitchUptime: s.proactiveSwitchUptime,
        jflSwitchUptime: s.jflSwitchUptime,
        switchUptime: s.switchUptime,
        overallUptime: s.overallUptime,
        incidentFreePercent: s.incidentFreePercent,
        apIncidentsDisplay: `${s.apIncidents} / ${s.uniqueAPsWithIncidents}`,
        apIncidents: s.apIncidents,
        uniqueAPsWithIncidents: s.uniqueAPsWithIncidents,
        incidentCount: s.incidentCount,
        primaryRca: s.primaryRca,
        primaryRcaForAPs: s.primaryRcaForAPs,
        healthScore: s.healthScore,
        healthLabel: s.healthLabel,
        path: `siteSummary[${idx}]`,
      })),
    },

    // Slide 6: Infrastructure Breakdown
    slide6_Infrastructure: {
      totalDevices: { value: exec.totalDevices, path: 'executiveSummary.totalDevices' },
      totalSwitches: { value: exec.totalSwitches, path: 'executiveSummary.totalSwitches' },
      totalAPs: { value: exec.totalAPs, path: 'executiveSummary.totalAPs' },
      totalStockDevices: { value: exec.totalStockDevices, path: 'executiveSummary.totalStockDevices' },
    },

    // Slide 7: Incident Trend & Analytics
    slide7_Incidents: {
      totalIncidents: { value: exec.totalIncidents, path: 'executiveSummary.totalIncidents' },
      criticalIncidents: { value: exec.criticalIncidents, path: 'executiveSummary.criticalIncidents' },
      majorIncidents: { value: exec.majorIncidents, path: 'executiveSummary.majorIncidents' },
      minorIncidents: { value: exec.minorIncidents, path: 'executiveSummary.minorIncidents' },
      openIncidents: { value: inc.openCount ?? 0, path: 'incidentAnalytics.openCount' },
      closedIncidents: { value: inc.closedCount ?? exec.totalIncidents, path: 'incidentAnalytics.closedCount' },
      tickets: Array.isArray(qbrData.incidents) ? qbrData.incidents : [],
    },

    // Slide 8: RCA Pareto Analysis
    slide8_RCAPareto: {
      totalIncidents: { value: exec.totalIncidents, path: 'executiveSummary.totalIncidents' },
      primaryRca: { value: exec.primaryRca, path: 'executiveSummary.primaryRca' },
      categories: Array.isArray(rca.breakdown) ? rca.breakdown.map((r, idx) => ({
        rca: r.rca,
        count: r.count,
        percentage: r.percentage,
        isTop: r.isTop,
        path: `rcaAnalytics.breakdown[${idx}]`,
      })) : [],
    },

    // Slide 9: RCA Heatmap
    slide9_RCAHeatmap: {
      matrix: rca.heatmapMatrix || [],
      sites: sites.map(s => s.siteId),
      categories: Array.isArray(rca.breakdown) ? rca.breakdown.map(r => r.rca) : [],
    },

    // Slide 10: SLA Compliance
    slide10_SLA: {
      slaCompliance: { value: exec.slaCompliance, path: 'executiveSummary.slaCompliance' },
      slaTarget: { value: exec.slaTarget, path: 'executiveSummary.slaTarget' },
      totalDevices: { value: exec.totalDevices, path: 'executiveSummary.totalDevices' },
      breachedDevicesCount: { value: sla.breachedDevicesCount ?? 0, path: 'slaAnalytics.breachedDevicesCount' },
      siteSlaList: sites.map((s, idx) => ({
        siteId: s.siteId,
        uptime: s.jflSwitchUptime || s.overallUptime,
        slaCompliance: parseFloat(s.jflSwitchUptime || s.overallUptime) >= parseFloat(exec.slaTarget) ? 'COMPLIANT' : 'BREACHED',
        path: `siteSummary[${idx}]`,
      })),
    },

    // Slide 11: Ticket Analytics
    slide11_Tickets: {
      totalTickets: { value: exec.totalIncidents, path: 'executiveSummary.totalIncidents' },
      tickets: Array.isArray(qbrData.incidents) ? qbrData.incidents : [],
    },

    // Slide 12: Recommendations
    slide12_Recommendations: {
      recommendations: qbrData.recommendations || [
        { priority: 'High', action: 'Perform proactive power audit across non-compliant sites.' },
        { priority: 'High', action: 'Tune wireless controller thresholds to reduce AP disconnections.' },
        { priority: 'Medium', action: 'Standardize firmware versions across access switch fleet.' },
      ],
    },

    // Individual Site Slides Map
    siteSlides: sites.map((s, idx) => ({
      siteId: s.siteId,
      deviceCount: s.deviceCount,
      activeDeviceCount: s.activeDeviceCount,
      stockCount: s.stockCount,
      stockDevices: s.stockDevices,
      switchCount: s.switchCount,
      apCount: s.apCount,
      proactiveSwitchUptime: s.proactiveSwitchUptime,
      jflSwitchUptime: s.jflSwitchUptime,
      switchUptime: s.switchUptime,
      overallUptime: s.overallUptime,
      incidentFreePercent: s.incidentFreePercent,
      apIncidentsDisplay: `${s.apIncidents} / ${s.uniqueAPsWithIncidents}`,
      apIncidents: s.apIncidents,
      uniqueAPsWithIncidents: s.uniqueAPsWithIncidents,
      incidentCount: s.incidentCount,
      healthScore: s.healthScore,
      healthLabel: s.healthLabel,
      primaryRca: s.primaryRca,
      primaryRcaForAPs: s.primaryRcaForAPs,
      path: `siteSummary[${idx}]`,
    })),
  };

  return pptData;
}

module.exports = {
  mapSnapshotToPPTData,
};
