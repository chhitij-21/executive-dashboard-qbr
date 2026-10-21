/**
 * frontend/src/utils/reportHelpers.js
 * Pure helper utilities for MMTC Reports & Navigation
 * Standard ES Module (frontend/package.json type: module)
 */

export function isTabHiddenForClient(clientId, tabId) {
  if (clientId === 'client-mmtcpamp') {
    return ['sites', 'switches', 'aps'].includes(tabId);
  }
  return false;
}

// Mirror of backend/services/reportService.js::buildDeterministicSummary.
// Keep in sync — both are tested independently.
export function buildDeterministicSummary(report) {
  if (!report || !report.summary || !report.summary.total) {
    const start = report?.meta?.start || '';
    const end = report?.meta?.end || '';
    if (start && end) {
      return `No tickets received between ${start} and ${end}.`;
    }
    return 'No tickets received in this period.';
  }

  const total = report.summary.total;
  const met = report.sla?.met ?? 0;
  const breached = report.sla?.breached ?? 0;
  const onHold = report.sla?.on_hold ?? 0;
  const start = report.meta?.start || '';
  const end = report.meta?.end || '';
  const periodStr = start && end ? ` between ${start} and ${end}` : '';

  const rcaList = Array.isArray(report.rca_breakdown) ? report.rca_breakdown : [];
  const topRca = rcaList[0];
  const topRcaStr = topRca ? `Top driver: ${topRca.rca} (${topRca.tickets} tickets).` : '';

  const ispPctVal = report.isp_pct?.channel_denom ?? report.isp_pct?.rca_denom ?? 0;
  const ispPercent = (typeof ispPctVal === 'number' && !isNaN(ispPctVal)) ? ispPctVal.toFixed(2) : '0.00';
  const ispStr = `Meraki-ISP: ${ispPercent}% of tickets were ISP-related and were closed within the agreed SLA.`;


  const sitesList = Array.isArray(report.top_sites) && report.top_sites.length > 0
    ? report.top_sites
    : (Array.isArray(report.isp_location) ? report.isp_location : []);
  const top3Sites = sitesList.slice(0, 3).map((s) => s.site || s.name || s).filter(Boolean);
  const sitesStr = top3Sites.length > 0 ? ` Most affected sites: ${top3Sites.join(', ')}.` : '';

  return `MMTC received ${total} tickets${periodStr}. ${met} SLA met, ${breached} breached, ${onHold} on hold. ${topRcaStr} ${ispStr}${sitesStr}`.replace(/\s+/g, ' ').trim();
}

export default {
  isTabHiddenForClient,
  buildDeterministicSummary,
};
