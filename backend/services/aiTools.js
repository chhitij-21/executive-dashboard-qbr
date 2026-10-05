// backend/services/aiTools.js
// Enterprise AI Function Calling Tool Registry & Execution Engine for Executive QBR Platform

/**
 * 1. getIncidents(qbrData, filters)
 * Pure filter over qbrData.incidents
 */
function getIncidents(qbrData, filters = {}) {
  if (!qbrData || !Array.isArray(qbrData.incidents)) return [];
  const { site, engineer, holdReason, slaStatus, rca, limit = 20 } = filters || {};
  let list = qbrData.incidents;

  if (site) {
    const sLower = String(site).toLowerCase().trim();
    list = list.filter(i => {
      const st = String(i.SiteID || i.Location || '').toLowerCase();
      return st.includes(sLower);
    });
  }

  if (engineer) {
    const eLower = String(engineer).toLowerCase().trim();
    list = list.filter(i => {
      const eng = String(i.TicketOwner || i.AssignedTo || i.Owner || '').toLowerCase();
      return eng.includes(eLower);
    });
  }

  if (holdReason) {
    const hLower = String(holdReason).toLowerCase().trim();
    list = list.filter(i => {
      const hr = String(i.HoldReason || '').toLowerCase();
      return hr.includes(hLower);
    });
  }

  if (slaStatus) {
    const slaLower = String(slaStatus).toLowerCase().trim();
    list = list.filter(i => {
      const st = String(i.sla_status || i.ResolutionSLAStatusRaw || '').toLowerCase();
      return st.includes(slaLower);
    });
  }

  if (rca) {
    const rLower = String(rca).toLowerCase().trim();
    list = list.filter(i => {
      const r = String(i.RCA || i.PrimaryRCA || i.RootCauseCategory || '').toLowerCase();
      return r.includes(rLower);
    });
  }

  const max = Math.min(Math.max(1, Number(limit) || 20), 100);
  return list.slice(0, max).map(i => ({
    ticket: i.display_reference?.value || i.TicketNumber || i.IncidentID || i.TicketID || 'N/A',
    site: i.SiteID || i.Location || 'Unknown',
    owner: i.TicketOwner || i.AssignedTo || 'Unassigned',
    status: i.RawStatus || i.Status || 'Open',
    slaStatus: i.sla_status || i.ResolutionSLAStatusRaw || 'Unknown',
    rca: i.RCA || i.PrimaryRCA || 'N/A',
    holdReason: i.HoldReason || 'N/A',
    actualResolutionMin: i.ActualResolutionMin ?? i.TotalResolutionMin ?? null
  }));
}

/**
 * 2. getEngineerStats(qbrData, name)
 * Source: qbrData.incidentAnalytics.byEngineer / qbrData.engineerBreakdown
 */
function getEngineerStats(qbrData, name) {
  if (!qbrData || !name) return { error: 'Engineer name is required' };
  const nLower = String(name).toLowerCase().trim();

  const engList = qbrData.incidentAnalytics?.byEngineer || qbrData.engineerBreakdown || [];
  const found = engList.find(e => String(e.name || e.engineer || '').toLowerCase().includes(nLower));

  const incidents = Array.isArray(qbrData.incidents) ? qbrData.incidents : [];
  const engIncidents = incidents.filter(i => String(i.TicketOwner || i.AssignedTo || '').toLowerCase().includes(nLower));

  if (!found && engIncidents.length === 0) {
    return { name, found: false, message: `No data found for engineer "${name}".` };
  }

  const totalTickets = found ? (found.total || found.totalTickets || engIncidents.length) : engIncidents.length;
  const slaMet = found ? (found.slaMet || 0) : engIncidents.filter(i => (i.sla_status || i.ResolutionSLAStatusRaw) === 'SLA Met').length;
  const slaBreached = found ? (found.slaMissed || found.slaBreached || 0) : engIncidents.filter(i => (i.sla_status || i.ResolutionSLAStatusRaw) === 'SLA Breached').length;
  const topHoldReason = found?.topHoldReason || 'N/A';

  const rcaCounts = {};
  for (const inc of engIncidents) {
    const r = inc.RCA || inc.PrimaryRCA;
    if (r && r !== 'Unknown' && r !== 'N/A') {
      rcaCounts[r] = (rcaCounts[r] || 0) + 1;
    }
  }
  const sortedRca = Object.entries(rcaCounts).sort((a, b) => b[1] - a[1]);
  const topRCA = sortedRca.length > 0 ? sortedRca[0][0] : 'Stable Operations (No Incidents)';

  return {
    name: found?.name || name,
    found: true,
    totalTickets,
    slaMet,
    slaBreached,
    topHoldReason,
    topRCA
  };
}

/**
 * 3. getSiteStats(qbrData, site)
 * Source: qbrData.siteSummary / qbrData.incidentAnalytics.bySite
 */
function getSiteStats(qbrData, site) {
  if (!qbrData || !site) return { error: 'Site name is required' };
  const sLower = String(site).toLowerCase().trim();

  const siteSummaries = Array.isArray(qbrData.siteSummary) ? qbrData.siteSummary : [];
  const siteInfo = siteSummaries.find(s => String(s.siteId || s.site || '').toLowerCase().includes(sLower));

  const incidents = Array.isArray(qbrData.incidents) ? qbrData.incidents : [];
  const siteIncidents = incidents.filter(i => String(i.SiteID || i.Location || '').toLowerCase().includes(sLower));

  if (!siteInfo && siteIncidents.length === 0) {
    return { site, found: false, message: `No data found for site "${site}".` };
  }

  const totalTickets = siteIncidents.length;
  const slaMet = siteIncidents.filter(i => (i.sla_status || i.ResolutionSLAStatusRaw) === 'SLA Met').length;
  const slaBreached = siteIncidents.filter(i => (i.sla_status || i.ResolutionSLAStatusRaw) === 'SLA Breached').length;

  const engCounts = {};
  for (const inc of siteIncidents) {
    const eng = inc.TicketOwner || 'Unassigned';
    engCounts[eng] = (engCounts[eng] || 0) + 1;
  }
  const sortedEng = Object.entries(engCounts).sort((a, b) => b[1] - a[1]);
  const topEngineer = sortedEng.length > 0 ? sortedEng[0][0] : 'N/A';

  const holdCounts = {};
  for (const inc of siteIncidents) {
    if (inc.HoldReason) {
      holdCounts[inc.HoldReason] = (holdCounts[inc.HoldReason] || 0) + 1;
    }
  }
  const sortedHold = Object.entries(holdCounts).sort((a, b) => b[1] - a[1]);
  const topHoldReason = sortedHold.length > 0 ? sortedHold[0][0] : 'N/A';

  return {
    site: siteInfo?.siteId || site,
    found: true,
    totalDevices: siteInfo?.deviceCount || 0,
    jflSwitchUptime: siteInfo?.jflSwitchUptime || '100.00',
    proactiveSwitchUptime: siteInfo?.proactiveSwitchUptime || '100.00',
    totalTickets,
    slaMet,
    slaBreached,
    topHoldReason,
    topEngineer,
    primaryRcaSwitches: siteInfo?.primaryRcaSwitches || 'Stable Operations (No Incidents)',
    primaryRcaAPs: siteInfo?.primaryRcaAPs || 'Stable Operations (No Incidents)'
  };
}

/**
 * 4. getHoldReasonBreakdown(qbrData, filters)
 * Source: qbrData.incidentAnalytics.holdReasons
 */
function getHoldReasonBreakdown(qbrData, filters = {}) {
  if (!qbrData) return [];
  const { site, engineer } = filters || {};
  let holdReasons = qbrData.incidentAnalytics?.holdReasons || [];

  if (!site && !engineer) {
    return holdReasons.map(h => ({
      holdReason: h.reason || h.holdReason,
      count: h.count,
      sites: h.sites || []
    }));
  }

  const incidents = Array.isArray(qbrData.incidents) ? qbrData.incidents : [];
  const filtered = incidents.filter(i => {
    if (site && !String(i.SiteID || i.Location || '').toLowerCase().includes(String(site).toLowerCase().trim())) return false;
    if (engineer && !String(i.TicketOwner || i.AssignedTo || '').toLowerCase().includes(String(engineer).toLowerCase().trim())) return false;
    return true;
  });

  const map = new Map();
  for (const inc of filtered) {
    if (inc.HoldReason) {
      const hr = inc.HoldReason;
      if (!map.has(hr)) map.set(hr, { holdReason: hr, count: 0, sites: new Set() });
      const entry = map.get(hr);
      entry.count++;
      if (inc.SiteID || inc.Location) entry.sites.add(inc.SiteID || inc.Location);
    }
  }

  return Array.from(map.values()).map(e => ({
    holdReason: e.holdReason,
    count: e.count,
    sites: Array.from(e.sites)
  })).sort((a, b) => b.count - a.count);
}

/**
 * 5. getSLABreached(qbrData, filters)
 * Source: filter qbrData.incidents where sla_status === 'SLA Breached'
 */
function getSLABreached(qbrData, filters = {}) {
  if (!qbrData || !Array.isArray(qbrData.incidents)) return [];
  const { site, engineer, limit = 20 } = filters || {};
  let list = qbrData.incidents.filter(i => (i.sla_status || i.ResolutionSLAStatusRaw) === 'SLA Breached');

  if (site) {
    const sLower = String(site).toLowerCase().trim();
    list = list.filter(i => String(i.SiteID || i.Location || '').toLowerCase().includes(sLower));
  }

  if (engineer) {
    const eLower = String(engineer).toLowerCase().trim();
    list = list.filter(i => String(i.TicketOwner || i.AssignedTo || '').toLowerCase().includes(eLower));
  }

  const max = Math.min(Math.max(1, Number(limit) || 20), 100);
  return list.slice(0, max).map(i => ({
    ticket: i.display_reference?.value || i.TicketNumber || i.IncidentID || 'N/A',
    owner: i.TicketOwner || i.AssignedTo || 'Unassigned',
    site: i.SiteID || i.Location || 'Unknown',
    minutes: i.ActualResolutionMin ?? i.TotalResolutionMin ?? null,
    rca: i.RCA || i.PrimaryRCA || 'N/A',
    openTime: i.OpenTime || i.CreatedDate || 'N/A'
  }));
}

/**
 * 6. getRCABreakdown(qbrData, filters)
 * Source: qbrData.rcaAnalytics.breakdown
 */
function getRCABreakdown(qbrData, filters = {}) {
  if (!qbrData) return {};
  const { site, engineer } = filters || {};

  if (!site && !engineer && qbrData.rcaAnalytics?.breakdown) {
    const breakdown = {};
    for (const b of qbrData.rcaAnalytics.breakdown) {
      breakdown[b.rca] = b.count;
    }
    return breakdown;
  }

  const incidents = Array.isArray(qbrData.incidents) ? qbrData.incidents : [];
  const filtered = incidents.filter(i => {
    if (site && !String(i.SiteID || i.Location || '').toLowerCase().includes(String(site).toLowerCase().trim())) return false;
    if (engineer && !String(i.TicketOwner || i.AssignedTo || '').toLowerCase().includes(String(engineer).toLowerCase().trim())) return false;
    return true;
  });

  const breakdown = {};
  for (const inc of filtered) {
    const rca = inc.RCA || inc.PrimaryRCA || 'Unknown';
    breakdown[rca] = (breakdown[rca] || 0) + 1;
  }
  return breakdown;
}

/**
 * 7. getTopEngineers(qbrData, limit = 5)
 * Source: qbrData.incidentAnalytics.byEngineer sorted slice
 */
function getTopEngineers(qbrData, limit = 5) {
  if (!qbrData) return [];
  const engList = qbrData.incidentAnalytics?.byEngineer || qbrData.engineerBreakdown || [];

  if (engList.length > 0) {
    const sorted = [...engList].sort((a, b) => (b.total || b.totalTickets || 0) - (a.total || a.totalTickets || 0));
    const max = Math.min(Math.max(1, Number(limit) || 5), 50);
    return sorted.slice(0, max).map(e => ({
      name: e.name || e.engineer,
      totalTickets: e.total || e.totalTickets,
      slaMet: e.slaMet || 0,
      slaBreached: e.slaMissed || e.slaBreached || 0,
      topHoldReason: e.topHoldReason || 'N/A'
    }));
  }

  const incidents = Array.isArray(qbrData.incidents) ? qbrData.incidents : [];
  const counts = {};
  for (const inc of incidents) {
    const eng = inc.TicketOwner || 'Unassigned';
    counts[eng] = (counts[eng] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = Math.min(Math.max(1, Number(limit) || 5), 50);
  return sorted.slice(0, max).map(([name, totalTickets]) => ({
    name,
    totalTickets
  }));
}

/**
 * Tool Schema definitions for Groq / OpenAI compatible API calls
 */
function getToolSchemas() {
  return [
    {
      type: 'function',
      function: {
        name: 'getIncidents',
        description: 'Fetch filtered incidents list from dataset. Use when user asks about specific tickets, incidents, or wants a filtered incident list.',
        parameters: {
          type: 'object',
          properties: {
            site: { type: 'string', description: 'Filter by site name (e.g. Nagpur, Greater Noida, Guwahati)' },
            engineer: { type: 'string', description: 'Filter by engineer / owner name (e.g. Kartik Choudhary)' },
            holdReason: { type: 'string', description: 'Filter by hold reason (e.g. Power Issue at Site)' },
            slaStatus: { type: 'string', description: 'Filter by SLA status (SLA Met or SLA Breached)' },
            rca: { type: 'string', description: 'Filter by Root Cause Analysis category' },
            limit: { type: 'number', description: 'Max number of incidents to return (default 20)' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'getEngineerStats',
        description: 'Get performance statistics for a specific engineer. Use when user asks about an engineer\'s tickets, SLA performance, or top hold reasons.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Full or partial name of the engineer' }
          },
          required: ['name']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'getSiteStats',
        description: 'Get performance statistics and metrics for a specific site. Use when user asks about site performance, ticket counts, or site-level RCA.',
        parameters: {
          type: 'object',
          properties: {
            site: { type: 'string', description: 'Name of the site (e.g. Nagpur, Greater Noida)' }
          },
          required: ['site']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'getHoldReasonBreakdown',
        description: 'Get hold reason breakdown and statistics. Use when user asks about why tickets are on hold or hold reason breakdown.',
        parameters: {
          type: 'object',
          properties: {
            site: { type: 'string', description: 'Optional filter by site' },
            engineer: { type: 'string', description: 'Optional filter by engineer' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'getSLABreached',
        description: 'Get list of incidents that breached SLA. Use when user asks for breached tickets, SLA violations, or delayed resolutions.',
        parameters: {
          type: 'object',
          properties: {
            site: { type: 'string', description: 'Optional filter by site' },
            engineer: { type: 'string', description: 'Optional filter by engineer' },
            limit: { type: 'number', description: 'Max number of incidents to return (default 20)' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'getRCABreakdown',
        description: 'Get Root Cause Analysis (RCA) category breakdown. Use when user asks for RCA breakdown, root cause drivers, or category distribution.',
        parameters: {
          type: 'object',
          properties: {
            site: { type: 'string', description: 'Optional filter by site' },
            engineer: { type: 'string', description: 'Optional filter by engineer' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'getTopEngineers',
        description: 'Get top engineers ranked by ticket volume. Use when user asks who the top engineer is, or asks for ranking of engineers.',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Number of top engineers to return (default 5)' }
          }
        }
      }
    }
  ];
}

/**
 * Tool Executor
 * Dispatcher function for running requested tool calls against qbrData.
 */
function executeTool(toolName, args, qbrData) {
  try {
    switch (toolName) {
      case 'getIncidents':
        return getIncidents(qbrData, args);
      case 'getEngineerStats':
        return getEngineerStats(qbrData, args?.name);
      case 'getSiteStats':
        return getSiteStats(qbrData, args?.site);
      case 'getHoldReasonBreakdown':
        return getHoldReasonBreakdown(qbrData, args);
      case 'getSLABreached':
        return getSLABreached(qbrData, args);
      case 'getRCABreakdown':
        return getRCABreakdown(qbrData, args);
      case 'getTopEngineers':
        return getTopEngineers(qbrData, args?.limit);
      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    return { error: `Tool execution failed: ${err.message}` };
  }
}

module.exports = {
  getIncidents,
  getEngineerStats,
  getSiteStats,
  getHoldReasonBreakdown,
  getSLABreached,
  getRCABreakdown,
  getTopEngineers,
  getToolSchemas,
  executeTool
};
