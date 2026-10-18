// frontend/src/utils/filterDashboardBySite.js
import { normalizeSiteName, isGenericLocation } from './siteUtils';

/**
 * Filters dashboard data model dynamically by a selected site name.
 * Recalculates KPIs, devices, incidents, analytics, and summaries.
 *
 * @param {Object} data - Complete canonical dashboard data object (SSOT)
 * @param {string} siteFilter - Target site ID/name (e.g. 'Bangalore', 'ALL')
 * @returns {Object} Filtered or original dashboard data object
 */
export function filterDashboardBySite(data, siteFilter) {
  if (!data || !siteFilter || siteFilter === 'ALL' || siteFilter === 'All Locations') {
    return data;
  }

  const normTarget = normalizeSiteName(siteFilter).toLowerCase();
  const matchSite = (rawSite) => {
    if (!rawSite || isGenericLocation(rawSite)) return false;
    return normalizeSiteName(rawSite).toLowerCase() === normTarget;
  };

  // Filter devices belonging to target site
  const rawDevices = data.devices || [];
  const filteredDevices = rawDevices.filter((d) => matchSite(d.SiteID || d.Location || ''));

  // Filter incidents belonging to target site
  const rawIncidents = data.incidents || data.incidentDetails || [];
  const filteredIncidents = rawIncidents.filter((i) => matchSite(i.SiteID || i.Location || ''));

  // Separate active and stock devices
  const activeDevices = filteredDevices.filter((d) => !d.__isStock);
  const stockDevices = filteredDevices.filter((d) => d.__isStock);

  const switches = activeDevices.filter((d) => {
    const t = String(d.DeviceType || '').toLowerCase();
    return /^sw$/i.test(t) || t.includes('switch') || (!t.includes('ap') && !t.includes('access'));
  });

  const aps = activeDevices.filter((d) => /ap|access.?point|wireless/i.test(String(d.DeviceType || '')));

  // Find pre-aggregated target site summary object if present
  const targetSiteSummary = (data.siteSummary || []).find(
    (s) => normalizeSiteName(s.siteId || s.name || '').toLowerCase() === normTarget
  );

  // Compute AP incidents and unique affected APs
  const apIncidentsList = filteredIncidents.filter((i) => {
    const dType = String(i.DeviceType || i.device_type || i.Device_Type || '').toLowerCase();
    const dId = String(i.DeviceID || i.device_id || i.Device_ID || '').toLowerCase();
    return /ap|access.?point|wireless/i.test(dType) || /ap/i.test(dId);
  });
  const apIncidentCount = apIncidentsList.length;
  const uniqueAps = new Set(apIncidentsList.map((i) => i.DeviceID || i.device_id).filter(Boolean));

  // Compute RCA driver for switches and APs
  const switchIncidents = filteredIncidents.filter((i) => {
    const dType = String(i.DeviceType || i.device_type || '').toLowerCase();
    return !/ap|access.?point|wireless/i.test(dType);
  });

  const getTopRCA = (incs, fallback) => {
    if (!incs.length) return fallback;
    const counts = {};
    for (const inc of incs) {
      const rca = inc.RCA || inc.Category || 'Other';
      counts[rca] = (counts[rca] || 0) + 1;
    }
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return sorted[0] ? sorted[0][0] : fallback;
  };

  const getRcaBreakdown = (incs) => {
    if (!incs.length) return [];
    const counts = {};
    for (const inc of incs) {
      const rca = inc.RCA || inc.Category || 'Other';
      counts[rca] = (counts[rca] || 0) + 1;
    }
    const total = incs.length;
    return Object.entries(counts)
      .map(([rca, count]) => ({
        rca,
        category: rca,
        count,
        percentage: `${((count / total) * 100).toFixed(1)}%`
      }))
      .sort((a, b) => b.count - a.count);
  };

  const primaryRcaSwitches = targetSiteSummary?.primaryRcaSwitches ||
    getTopRCA(switchIncidents, 'Stable Operations (No Incidents)');
  const primaryRcaAPs = targetSiteSummary?.primaryRcaAPs ||
    getTopRCA(apIncidentsList, 'Stable Operations (No Incidents)');

  // Calculate SLA compliance for this site
  const resolvedWithSLA = filteredIncidents.filter((i) => i.sla_status === 'SLA Met' || i.sla_status === 'SLA Breached');
  const slaMetCount = resolvedWithSLA.filter((i) => i.sla_status === 'SLA Met').length;
  const slaCompliance = resolvedWithSLA.length > 0
    ? Number(((slaMetCount / resolvedWithSLA.length) * 100).toFixed(2))
    : (targetSiteSummary?.slaCompliance ?? data.executiveSummary?.slaCompliance ?? 100);

  // Calculate incident-free percentage
  const totalDevs = activeDevices.length || targetSiteSummary?.deviceCount || 1;
  const incFreeDevs = activeDevices.filter((d) => (d.__incidentCount || 0) === 0).length;
  const incidentFreePercent = activeDevices.length > 0
    ? Number(((incFreeDevs / totalDevs) * 100).toFixed(2))
    : (targetSiteSummary?.incidentFreePercent ?? 100);

  // Health score calculation
  const siteUptime = targetSiteSummary?.uptimePercent ?? targetSiteSummary?.jflSwitchUptime ?? 100;
  const healthScore = targetSiteSummary?.healthScore ?? data.executiveSummary?.healthScore ?? 100;
  const healthLabel = targetSiteSummary?.healthLabel ?? (healthScore >= 90 ? 'Excellent' : (healthScore >= 75 ? 'Good' : 'Fair'));

  // Severity counts
  const critical = filteredIncidents.filter((i) => /p1|critical/i.test(i.Priority || i.Severity || '')).length;
  const major = filteredIncidents.filter((i) => /p2|major/i.test(i.Priority || i.Severity || '')).length;
  const minor = filteredIncidents.length - critical - major;

  // Build filtered executiveSummary
  const exec = {
    ...(data.executiveSummary || {}),
    totalSites: 1,
    siteFilterApplied: siteFilter,
    totalDevices: activeDevices.length || targetSiteSummary?.deviceCount || 0,
    totalSwitches: switches.length || targetSiteSummary?.switchCount || 0,
    totalAPs: aps.length || targetSiteSummary?.apCount || 0,
    totalStockDevices: stockDevices.length || targetSiteSummary?.stockCount || 0,
    apIncidents: apIncidentCount,
    uniqueAPsWithIncidents: uniqueAps.size || targetSiteSummary?.uniqueAPsWithIncidents || 0,
    primaryRcaSwitches,
    primaryRcaAPs,
    jflSwitchUptime: targetSiteSummary?.jflSwitchUptime ?? targetSiteSummary?.uptimePercent ?? data.executiveSummary?.jflSwitchUptime,
    proactiveSwitchUptime: targetSiteSummary?.proactiveSwitchUptime ?? data.executiveSummary?.proactiveSwitchUptime,
    overallUptime: siteUptime,
    slaCompliance,
    incidentFreePercent,
    healthScore,
    healthLabel,
    totalIncidents: filteredIncidents.length,
    criticalIncidents: critical,
    majorIncidents: major,
  };

  // Build filtered siteSummary (keep target site or full list with active flag)
  const filteredSiteSummary = (data.siteSummary || []).filter((s) => matchSite(s.siteId || s.name || ''));

  // Filter Switch Analytics
  const coreSwitches = switches.filter(d => /core/i.test(d.CoreNonCore || '') && !/non/i.test(d.CoreNonCore || ''));
  const nonCoreSwitches = switches.filter(d => /non/i.test(d.CoreNonCore || '') || !/core/i.test(d.CoreNonCore || ''));
  const avgUptime = (arr) => arr.length ? (arr.reduce((acc, d) => acc + (d.__effectiveUptime ?? 100), 0) / arr.length).toFixed(2) : '100.00';

  const switchIncidentSLADetails = (data.switchAnalytics?.incidentSLADetails || []).filter(r => matchSite(r.Location));
  const swMet = switchIncidentSLADetails.filter(r => r.sla_status === 'SLA Met').length;
  const swBreached = switchIncidentSLADetails.filter(r => r.sla_status === 'SLA Breached').length;
  const swUnknown = switchIncidentSLADetails.filter(r => !r.sla_status || r.sla_status === 'No Timing Data').length;
  const swSlaPercent = (swMet + swBreached) > 0 ? ((swMet / (swMet + swBreached)) * 100).toFixed(2) : '100.00';

  const switchAnalytics = {
    ...(data.switchAnalytics || {}),
    totalSwitches: switches.length,
    coreSwitches: coreSwitches.length,
    nonCoreSwitches: nonCoreSwitches.length,
    coreUptime: avgUptime(coreSwitches),
    nonCoreUptime: avgUptime(nonCoreSwitches),
    overallUptime: avgUptime(switches),
    switchIncidents: switchIncidents.length,
    totalSwitchIncidents: switchIncidents.length,
    rcaBreakdown: getRcaBreakdown(switchIncidents),
    incidentSLADetails: switchIncidentSLADetails,
    slaSummary: {
      total: switchIncidentSLADetails.length,
      met: swMet,
      breached: swBreached,
      unknown: swUnknown,
      percentMet: swSlaPercent,
    },
    top10SwitchOutages: (data.switchAnalytics?.top10SwitchOutages || []).filter(r => matchSite(r.Location)),
    rackwiseUptime: (data.switchAnalytics?.rackwiseUptime || []).filter(r => matchSite(r.site || r.Location)),
    expandedRackwiseUptime: (data.switchAnalytics?.expandedRackwiseUptime || []).filter(r => matchSite(r.site || r.Location)),
  };

  // Filter AP Analytics
  const apIncidentSLADetails = (data.apAnalytics?.incidentSLADetails || []).filter(r => matchSite(r.Location));
  const apMet = apIncidentSLADetails.filter(r => r.sla_status === 'SLA Met').length;
  const apBreached = apIncidentSLADetails.filter(r => r.sla_status === 'SLA Breached').length;
  const apUnknown = apIncidentSLADetails.filter(r => !r.sla_status || r.sla_status === 'No Timing Data').length;
  const apSlaPercent = (apMet + apBreached) > 0 ? ((apMet / (apMet + apBreached)) * 100).toFixed(2) : '100.00';

  const apAnalytics = {
    ...(data.apAnalytics || {}),
    totalAPs: aps.length,
    apIncidents: apIncidentCount,
    totalAPIncidentRows: apIncidentCount,
    uniqueAPsWithIncidents: uniqueAps.size,
    rcaBreakdown: getRcaBreakdown(apIncidentsList),
    incidentSLADetails: apIncidentSLADetails,
    slaSummary: {
      total: apIncidentSLADetails.length,
      met: apMet,
      breached: apBreached,
      unknown: apUnknown,
      percentMet: apSlaPercent,
    },
    top10APOutages: (data.apAnalytics?.top10APOutages || []).filter(r => matchSite(r.Location)),
  };

  // Filter Incident Analytics
  const incidentAnalytics = {
    ...(data.incidentAnalytics || {}),
    totalIncidents: filteredIncidents.length,
    criticalIncidents: critical,
    majorIncidents: major,
    minorIncidents: minor > 0 ? minor : 0,
    siteWiseIncidents: [{ siteId: siteFilter, count: filteredIncidents.length }],
    deviceWiseIncidents: (data.incidentAnalytics?.deviceWiseIncidents || []).filter(r => matchSite(r.Location)),
  };

  // Filter RCA Analytics
  const rcaAnalytics = {
    ...(data.rcaAnalytics || {}),
    totalIncidents: filteredIncidents.length,
    topRca: primaryRcaSwitches,
    standardBreakdown: getRcaBreakdown(filteredIncidents),
    rawBreakdown: getRcaBreakdown(filteredIncidents),
  };

  // Filter SLA Analytics
  const slaTarget = data.slaAnalytics?.slaTarget ?? 99.3;
  const compliantDevs = activeDevices.filter(d => (d.__effectiveUptime ?? 100) >= slaTarget).length;
  const breachingDevs = activeDevices.filter(d => (d.__effectiveUptime ?? 100) < slaTarget).length;

  const slaAnalytics = {
    ...(data.slaAnalytics || {}),
    overallSLAPercent: slaCompliance.toFixed(2),
    slaTarget,
    compliantDevices: compliantDevs,
    breachingDevices: breachingDevs,
    deviceSLA: (data.slaAnalytics?.deviceSLA || []).filter(r => matchSite(r.Location)),
  };

  return {
    ...data,
    devices: filteredDevices,
    incidents: filteredIncidents,
    incidentDetails: filteredIncidents,
    executiveSummary: exec,
    siteSummary: filteredSiteSummary.length > 0 ? filteredSiteSummary : data.siteSummary,
    allSitesSummary: data.siteSummary, // preserve full list for navigation
    selectedSite: siteFilter,
    switchAnalytics,
    apAnalytics,
    incidentAnalytics,
    rcaAnalytics,
    slaAnalytics,
  };
}
