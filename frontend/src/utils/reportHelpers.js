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
  const met = report?.sla?.met ?? 0;
  const breached = report?.sla?.breached ?? 0;
  const onHold = report?.sla?.on_hold ?? 0;

  const totalSla = met + breached;
  const slaPercentage = totalSla > 0 ? ((met / totalSla) * 100).toFixed(2) : '100.00';

  let breakdown = `${met} met SLA, ${breached} breached`;
  if (onHold > 0) breakdown += `, ${onHold} on hold`;

  if (onHold === 0 && breached === 0) {
    breakdown = `${met} met the SLA and ${breached} were breached`;
  }

  const rcaList = Array.isArray(report.rca_breakdown) ? report.rca_breakdown : [];
  const topRca = rcaList[0]?.rca || 'None';
  const topRcaCount = rcaList[0]?.tickets ?? 0;

  const ispList = Array.isArray(report.isp_device_breakdown) ? report.isp_device_breakdown : [];
  const topIspDevice = ispList[0]?.device_name || 'None';
  const topIspCount = ispList[0]?.total ?? 0;

  let rcaIspPart = '';
  if (topRca !== 'None' || topIspDevice !== 'None') {
    rcaIspPart = ` The primary RCA driver was ${topRca} (${topRcaCount} tickets). The top ISP-affected device was ${topIspDevice} with ${topIspCount} tickets.`;
  }

  return `MMTC received a total of ${total} tickets. Out of these, ${breakdown}.${rcaIspPart} Overall Ticket SLA Compliance stands at ${slaPercentage}%.`;
}

export default {
  isTabHiddenForClient,
  buildDeterministicSummary,
};
