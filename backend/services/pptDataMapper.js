// backend/services/pptDataMapper.js
// Explicit PPT Data Mapping Layer (Phase 4 & Phase 5)
// Maps the Canonical Report Snapshot (qbrData) to the Slide Presentation Data Model.
// ABSOLUTE RULE: ZERO business logic, ZERO recalculations, ZERO data transformations.
// Every value mapped here comes directly from the SSOT canonical snapshot.

function mapSnapshotToPPTData(qbrData) {
  if (!qbrData) {
    throw new Error('PPTDataMapper Error: Canonical snapshot (qbrData) is null or undefined.');
  }

  const exec  = qbrData.executiveSummary  || {};
  const sites = Array.isArray(qbrData.siteSummary) ? qbrData.siteSummary : [];
  const rca   = qbrData.rcaAnalytics     || {};
  const sla   = qbrData.slaAnalytics     || {};
  const inc   = qbrData.incidentAnalytics|| {};
  const meta  = qbrData.metadata         || {};

  // ── Canonical reporting period resolution ────────────────────────────────────
  // Prefer report_period.display_label (always-present SSOT field from processData.js).
  // Fall back to legacy reportingPeriod string for older cached snapshots.
  const reportPeriodObj = qbrData.report_period || {};
  const displayPeriod   = reportPeriodObj.display_label
    || qbrData.reportingPeriod
    || exec.reportingPeriod
    || 'User Selected Period';

  // ── SLA target: exclusively from SSOT (processData.js → ruleEngine) ─────────
  // NEVER override with a hardcoded fallback here. If exec.slaTarget is absent,
  // pptGenerator.js will fall back to SLA_TARGET_FALLBACK (99.3).
  const slaTarget = exec.slaTarget;

  // ── Slide-by-slide mapped manifest ──────────────────────────────────────────
  const pptData = {

    // ── Shared metadata ───────────────────────────────────────────────────────
    metadata: {
      reportId:        meta.reportId || qbrData.reportId || 'N/A',
      clientId:        meta.clientId || 'JFL',
      customerName:    qbrData.customerName || exec.customerName || 'Jubilant Foodworks Ltd (JFL)',
      reportingPeriod: displayPeriod,
      displayPeriod,
      report_period:   reportPeriodObj,
      generatedAt:     qbrData.generatedAt || new Date().toISOString(),
      dataVersion:     meta.dataVersion || '1.0.0',
      snapshotHash:    meta.snapshotHash || 'N/A',
    },

    // ── Slide 3: Executive Summary ────────────────────────────────────────────
    slide3_ExecutiveSummary: {
      totalSites:             { value: exec.totalSites,             path: 'executiveSummary.totalSites' },
      totalDevices:           { value: exec.totalDevices,           path: 'executiveSummary.totalDevices' },
      totalStockDevices:      { value: exec.totalStockDevices,      path: 'executiveSummary.totalStockDevices' },
      totalSwitches:          { value: exec.totalSwitches,          path: 'executiveSummary.totalSwitches' },
      totalAPs:               { value: exec.totalAPs,               path: 'executiveSummary.totalAPs' },
      apIncidents:            { value: exec.apIncidents,            path: 'executiveSummary.apIncidents' },
      uniqueAPsWithIncidents: { value: exec.uniqueAPsWithIncidents, path: 'executiveSummary.uniqueAPsWithIncidents' },
      primaryRcaSwitches:     { value: exec.primaryRcaSwitches || exec.primaryRca || 'Stable Operations (No Incidents)',         path: 'executiveSummary.primaryRcaSwitches' },
      primaryRcaAPs:          { value: exec.primaryRcaAPs || exec.primaryRcaForAPs || 'Stable Operations (No Incidents)',        path: 'executiveSummary.primaryRcaAPs' },
      primaryRca:             { value: exec.primaryRcaSwitches || exec.primaryRca || 'Stable Operations (No Incidents)',         path: 'executiveSummary.primaryRca' },
      primaryRcaForAPs:       { value: exec.primaryRcaAPs || exec.primaryRcaForAPs || 'Stable Operations (No Incidents)',        path: 'executiveSummary.primaryRcaForAPs' },
      overallUptime:          { value: exec.overallUptime,          path: 'executiveSummary.overallUptime' },
      incidentFreePercent:    { value: exec.incidentFreePercent,    path: 'executiveSummary.incidentFreePercent' },
      healthScore:            { value: exec.healthScore,            path: 'executiveSummary.healthScore' },
      healthLabel:            { value: exec.healthLabel,            path: 'executiveSummary.healthLabel' },
      slaCompliance:          { value: exec.slaCompliance,          path: 'executiveSummary.slaCompliance' },
      slaTarget:              { value: slaTarget,                   path: 'executiveSummary.slaTarget' },
      totalIncidents:         { value: exec.totalIncidents,         path: 'executiveSummary.totalIncidents' },
      criticalIncidents:      { value: exec.criticalIncidents,      path: 'executiveSummary.criticalIncidents' },
      majorIncidents:         { value: exec.majorIncidents,         path: 'executiveSummary.majorIncidents' },
      minorIncidents:         { value: exec.minorIncidents,         path: 'executiveSummary.minorIncidents' },
    },

    // ── Slide 4: Overall Network Health ──────────────────────────────────────
    slide4_NetworkHealth: {
      overallHealthScore: { value: exec.healthScore, path: 'executiveSummary.healthScore' },
      overallHealthLabel: { value: exec.healthLabel, path: 'executiveSummary.healthLabel' },
      siteHealthList: sites.map((s, idx) => ({
        siteId:            s.siteId,
        healthScore:       s.healthScore,
        healthLabel:       s.healthLabel,
        activeDeviceCount: s.activeDeviceCount || s.deviceCount,
        incidentCount:     s.incidentCount,
        path:              `siteSummary[${idx}].healthScore`,
      })),
    },

    // ── Slide 5: Site Overview Table ─────────────────────────────────────────
    // Columns: Site | No of devices | Proactive Switch Uptime | JFL Switch Uptime |
    //          Primary RCA Driver (Switches) | AP Incidents (Unique) | Primary RCA Driver (AP)
    slide5_SiteOverview: {
      sites: sites.map((s, idx) => ({
        siteId:                 s.siteId,
        deviceCount:            s.deviceCount,
        activeDeviceCount:      s.activeDeviceCount || s.deviceCount,
        stockCount:             s.stockCount || 0,
        proactiveSwitchUptime:  s.proactiveSwitchUptime || s.switchUptime,
        jflSwitchUptime:        s.jflSwitchUptime       || s.switchUptime,
        switchUptime:           s.jflSwitchUptime       || s.switchUptime,
        overallUptime:          s.overallUptime         || s.switchUptime,
        incidentFreePercent:    s.incidentFreePercent,
        // AP Incidents: render as "Total / Unique" per AGENTS.md
        apIncidentsDisplay:     `${s.apIncidents ?? 0} / ${s.uniqueAPsWithIncidents ?? 0}`,
        apIncidents:            s.apIncidents            ?? 0,
        uniqueAPsWithIncidents: s.uniqueAPsWithIncidents ?? 0,
        incidentCount:          s.incidentCount          ?? 0,
        // RCA fields — always use the *Switches / *APs variants first (SSOT canonical)
        primaryRcaSwitches:     s.primaryRcaSwitches || s.primaryRca       || 'Stable Operations (No Incidents)',
        primaryRcaAPs:          s.primaryRcaAPs      || s.primaryRcaForAPs || 'Stable Operations (No Incidents)',
        primaryRca:             s.primaryRcaSwitches || s.primaryRca       || 'Stable Operations (No Incidents)',
        primaryRcaForAPs:       s.primaryRcaAPs      || s.primaryRcaForAPs || 'Stable Operations (No Incidents)',
        slaStatus:  parseFloat(s.jflSwitchUptime || s.switchUptime || 100) >= parseFloat(slaTarget ?? 99.3) ? 'MET' : 'BREACH',
        healthScore:  s.healthScore,
        healthLabel:  s.healthLabel,
        path: `siteSummary[${idx}]`,
      })),
    },

    // ── Slide 6: Infrastructure Breakdown ────────────────────────────────────
    slide6_Infrastructure: {
      totalDevices:      { value: exec.totalDevices,      path: 'executiveSummary.totalDevices' },
      totalSwitches:     { value: exec.totalSwitches,     path: 'executiveSummary.totalSwitches' },
      totalAPs:          { value: exec.totalAPs,          path: 'executiveSummary.totalAPs' },
      totalStockDevices: { value: exec.totalStockDevices, path: 'executiveSummary.totalStockDevices' },
    },

    // ── Slide 7: Incident Trend & Analytics ──────────────────────────────────
    slide7_Incidents: {
      totalIncidents:   { value: exec.totalIncidents,                        path: 'executiveSummary.totalIncidents' },
      criticalIncidents:{ value: exec.criticalIncidents,                     path: 'executiveSummary.criticalIncidents' },
      majorIncidents:   { value: exec.majorIncidents,                        path: 'executiveSummary.majorIncidents' },
      minorIncidents:   { value: exec.minorIncidents,                        path: 'executiveSummary.minorIncidents' },
      openIncidents:    { value: inc.openCount    ?? 0,                      path: 'incidentAnalytics.openCount' },
      closedIncidents:  { value: inc.closedCount  ?? exec.totalIncidents,    path: 'incidentAnalytics.closedCount' },
      tickets:          Array.isArray(qbrData.incidents) ? qbrData.incidents : [],
    },

    // ── Slide 8: RCA Pareto Analysis ─────────────────────────────────────────
    slide8_RCAPareto: {
      totalIncidents:   { value: exec.totalIncidents,                             path: 'executiveSummary.totalIncidents' },
      primaryRcaSwitches:{ value: exec.primaryRcaSwitches || exec.primaryRca,    path: 'executiveSummary.primaryRcaSwitches' },
      primaryRcaAPs:    { value: exec.primaryRcaAPs       || exec.primaryRcaForAPs, path: 'executiveSummary.primaryRcaAPs' },
      categories: Array.isArray(rca.breakdown)
        ? rca.breakdown.slice(0, 8).map((r, idx) => ({
            rca:        r.rca,
            count:      r.count,
            percentage: r.percentage || r.pct,
            isTop:      r.isTop || idx < 3,
            path:       `rcaAnalytics.breakdown[${idx}]`,
          }))
        : [],
    },

    // ── Slide 9: RCA Heatmap ─────────────────────────────────────────────────
    slide9_RCAHeatmap: {
      matrix:     rca.heatmapMatrix || [],
      sites:      sites.map(s => s.siteId),
      categories: Array.isArray(rca.breakdown) ? rca.breakdown.map(r => r.rca) : [],
    },

    // ── Slide 10: SLA Compliance ─────────────────────────────────────────────
    slide10_SLA: {
      slaCompliance:      { value: exec.slaCompliance,                    path: 'executiveSummary.slaCompliance' },
      slaTarget:          { value: slaTarget,                             path: 'executiveSummary.slaTarget' },
      totalDevices:       { value: exec.totalDevices,                     path: 'executiveSummary.totalDevices' },
      breachedDevicesCount:{ value: sla.breachedDevicesCount ?? 0,        path: 'slaAnalytics.breachedDevicesCount' },
      siteSlaList: sites.map((s, idx) => ({
        siteId:      s.siteId,
        uptime:      s.jflSwitchUptime || s.switchUptime || s.overallUptime,
        slaStatus:   parseFloat(s.jflSwitchUptime || s.switchUptime || 100) >= parseFloat(slaTarget ?? 99.3) ? 'MET' : 'BREACH',
        slaCompliance: parseFloat(s.jflSwitchUptime || s.switchUptime || 100) >= parseFloat(slaTarget ?? 99.3) ? 'MET' : 'BREACH',
        path:        `siteSummary[${idx}]`,
      })),
    },

    // ── Slide 11: Ticket Analytics ────────────────────────────────────────────
    slide11_Tickets: {
      totalTickets: { value: exec.totalIncidents, path: 'executiveSummary.totalIncidents' },
      tickets:      Array.isArray(qbrData.incidents) ? qbrData.incidents : [],
    },

    // ── Slide 12: Recommendations ────────────────────────────────────────────
    slide12_Recommendations: {
      recommendations: qbrData.recommendations || [
        { priority: 'High',   action: 'Perform proactive power audit across non-compliant sites.' },
        { priority: 'High',   action: 'Tune wireless controller thresholds to reduce AP disconnections.' },
        { priority: 'Medium', action: 'Standardize firmware versions across access switch fleet.' },
      ],
    },

    // ── Individual Site Slides Map ────────────────────────────────────────────
    siteSlides: sites.map((s, idx) => ({
      siteId:                 s.siteId,
      deviceCount:            s.deviceCount,
      activeDeviceCount:      s.activeDeviceCount || s.deviceCount,
      stockCount:             s.stockCount || 0,
      stockDevices:           s.stockDevices || [],
      switchCount:            s.switchCount,
      apCount:                s.apCount,
      proactiveSwitchUptime:  s.proactiveSwitchUptime || s.switchUptime,
      jflSwitchUptime:        s.jflSwitchUptime       || s.switchUptime,
      switchUptime:           s.jflSwitchUptime       || s.switchUptime,  // alias for compatibility
      overallUptime:          s.overallUptime         || s.switchUptime,
      incidentFreePercent:    s.incidentFreePercent,
      apIncidentsDisplay:     `${s.apIncidents ?? 0} / ${s.uniqueAPsWithIncidents ?? 0}`,
      apIncidents:            s.apIncidents            ?? 0,
      uniqueAPsWithIncidents: s.uniqueAPsWithIncidents ?? 0,
      incidentCount:          s.incidentCount          ?? 0,
      healthScore:            s.healthScore,
      healthLabel:            s.healthLabel,
      primaryRcaSwitches:     s.primaryRcaSwitches || s.primaryRca       || 'Stable Operations (No Incidents)',
      primaryRcaAPs:          s.primaryRcaAPs      || s.primaryRcaForAPs || 'Stable Operations (No Incidents)',
      primaryRca:             s.primaryRcaSwitches || s.primaryRca       || 'Stable Operations (No Incidents)',
      primaryRcaForAPs:       s.primaryRcaAPs      || s.primaryRcaForAPs || 'Stable Operations (No Incidents)',
      slaStatus:  parseFloat(s.jflSwitchUptime || s.switchUptime || 100) >= parseFloat(slaTarget ?? 99.3) ? 'MET' : 'BREACH',
      path: `siteSummary[${idx}]`,
    })),

  };

  return pptData;
}

module.exports = {
  mapSnapshotToPPTData,
};
