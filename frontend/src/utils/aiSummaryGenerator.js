// frontend/src/utils/aiSummaryGenerator.js

/**
 * Generates or extracts AI section summary for a specific dashboard tab.
 * 
 * @param {string} tabName - Name of the tab (e.g. 'switches', 'aps', 'incidents', 'sla', 'rca', 'overview', 'executive', 'sites', 'other')
 * @param {Object} filteredData - Processed dashboard data object
 * @param {string} [siteFilter] - Active site filter if applicable
 * @returns {string} AI summary narrative
 */
export function generateAISummary(tabName, filteredData, siteFilter) {
  if (!filteredData) {
    return 'AI summary will be generated in the next report cycle.';
  }

  const site = siteFilter || filteredData.selectedSite || 'ALL';
  const prefix = (site && site !== 'ALL' && site !== 'All Locations') ? `For ${site}, ` : '';

  // 1. Check if backend AI section summary is populated
  const aiSummaries = filteredData.aiSectionSummaries || {};
  if (aiSummaries[tabName] && String(aiSummaries[tabName]).trim()) {
    return prefix ? `${prefix}${aiSummaries[tabName]}` : aiSummaries[tabName];
  }

  // Check alternative keys (e.g. 'overview' vs 'executive')
  if (tabName === 'overview' && aiSummaries.executive) {
    return prefix ? `${prefix}${aiSummaries.executive}` : aiSummaries.executive;
  }

  const exec = filteredData.executiveSummary || {};
  const slaTarget = filteredData.slaAnalytics?.slaTarget ?? exec.slaTarget ?? 99.3;
  const switchUptime = exec.jflSwitchUptime ?? exec.overallUptime ?? 100;
  const critical = exec.criticalIncidents ?? (filteredData.incidents || []).filter(i => /p1|critical/i.test(i.Priority || i.Severity || '')).length;
  const major = exec.majorIncidents ?? (filteredData.incidents || []).filter(i => /p2|major/i.test(i.Priority || i.Severity || '')).length;

  // 2. Dynamic high-fidelity fallbacks based on numbers (per requirement)
  switch (tabName) {
    case 'switches':
      return `${prefix}Switch network operating at ${switchUptime}% uptime across ${exec.totalSwitches ?? 0} devices.`;

    case 'aps':
      return `${prefix}AP infrastructure shows ${exec.totalAPs ?? 0} active devices with ${exec.apIncidents ?? 0} incidents logged.`;

    case 'incidents':
      return `${prefix}Total ${exec.totalIncidents ?? 0} incidents. Critical: ${critical}, Major: ${major}.`;

    case 'sla':
      return `${prefix}SLA Compliance is ${exec.slaCompliance ?? 100}% against a ${slaTarget}% target.`;

    case 'rca':
      return `${prefix}Root Cause Analysis indicates primary switch driver is "${exec.primaryRcaSwitches || 'Stable Operations (No Incidents)'}" and AP driver is "${exec.primaryRcaAPs || 'Stable Operations (No Incidents)'}".`;

    case 'sites':
      return `${prefix}Site infrastructure spans ${exec.totalSites || (filteredData.siteSummary || []).length} monitored locations supporting ${exec.totalDevices || 0} active operational assets.`;

    case 'other':
      return `${prefix}Client-side activities and planned maintenance windows maintained ${exec.incidentFreePercent ?? 100}% incident-free operational stability.`;

    case 'executive':
    case 'overview':
    default:
      return `${prefix}Network operations achieved an Executive Health Score of ${exec.healthScore || 100}/100 (${exec.healthLabel || 'Excellent'}) with ${switchUptime}% switch uptime across ${exec.totalDevices || 0} monitored assets.`;
  }
}
