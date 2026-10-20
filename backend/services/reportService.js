/**
 * backend/services/reportService.js
 * Business logic, classification, and KPI aggregation for MMTC Reports (Phase 1)
 */

const fs = require('fs');
const path = require('path');

let xlsx;
try {
  xlsx = require('xlsx');
} catch (e) {
  xlsx = require(path.resolve(__dirname, '../../node_modules/xlsx'));
}

let database = null;
try {
  database = require('../config/database');
} catch (e) {
  database = null;
}

// In-memory cache for fallback tickets
let _cachedMmtcTickets = null;

/**
 * Resolves raw client ID or auth ID to internal canonical client key.
 * Only 'mmtc' and 'client-mmtcpamp' are valid for Reports in Phase 1.
 * JFL and all other clients return null.
 * @param {string} input
 * @returns {'mmtc' | null}
 */
function resolveClientId(input) {
  if (!input || typeof input !== 'string') return null;
  const clean = input.trim().toLowerCase();
  if (clean === 'mmtc' || clean === 'client-mmtcpamp') {
    return 'mmtc';
  }
  return null;
}

/**
 * Classifies ticket into one of the 4 locked channel buckets (F2).
 * @param {object} ticket
 * @returns {'meraki_alerts' | 'meraki_emails' | 'security_alerts' | 'security_emails' | 'other'}
 */
function classifyChannel(ticket) {
  if (!ticket) return 'other';
  const ch = (ticket['Channel'] || ticket.channel || '').toString().trim().toLowerCase();
  const cat = (ticket['Category'] || ticket.category || '').toString().trim().toLowerCase();

  const isAlert = ch.includes('alert');
  const isEmail = ch.includes('email');
  const isMeraki = cat.includes('meraki');
  const isSecurity = cat.includes('security');

  if (isMeraki && isAlert) return 'meraki_alerts';
  if (isMeraki && isEmail) return 'meraki_emails';
  if (isSecurity && isAlert) return 'security_alerts';
  if (isSecurity && isEmail) return 'security_emails';

  return 'other';
}

/**
 * Classifies ticket type for SLA sub-line breakdown (F8).
 * @param {object} ticket
 * @returns {'CR' | 'RF' | 'Upgrade' | 'Incident'}
 */
function classifyTicketType(ticket) {
  if (!ticket) return 'Incident';
  const sc = (ticket['Sub Category'] || ticket.subCategory || '').toString().trim().toLowerCase();
  const subj = (ticket['Subject'] || ticket.subject || '').toString().trim().toLowerCase();
  const rca = (ticket['RCA'] || ticket.rca || '').toString().trim().toLowerCase();

  if (sc === 'change request') return 'CR';
  if (sc.includes('request')) return 'RF';
  if (subj.includes('upgrade') || rca.includes('upgrade')) return 'Upgrade';

  return 'Incident';
}

/**
 * Recomputes SLA status per D5 formula (F5).
 * @param {object} ticket
 * @returns {{ bucket: 'SLA Met' | 'SLA Breached' | 'On Hold', responseMet: boolean|null, resolutionMet: boolean|null, effectiveResolution: number|null }}
 */
function computeSla(ticket) {
  if (!ticket) {
    return { bucket: 'SLA Met', responseMet: true, resolutionMet: true, effectiveResolution: 0 };
  }

  const status = (ticket['Status'] || ticket.status || '').toString().trim().toLowerCase();
  if (status === 'on hold') {
    return { bucket: 'On Hold', responseMet: null, resolutionMet: null, effectiveResolution: null };
  }

  // Response SLA evaluation
  const respActual = parseFloat(ticket['Actual Response Time (min)']);
  const respAgreed = parseFloat(ticket['Agreed Response SLA (min)']);
  const respStatusCol = (ticket['Response SLA Status'] || '').toString().trim().toLowerCase();

  let respMet = true;
  if (!isNaN(respActual) && !isNaN(respAgreed)) {
    respMet = respActual <= respAgreed;
  } else if (respStatusCol) {
    respMet = !respStatusCol.includes('breach');
  }

  // Resolution SLA evaluation
  const resActual = parseFloat(ticket['Actual Resolution Time (min)']);
  const resTotal = parseFloat(ticket['Total Resolution Time (min)']);
  const holdTime = parseFloat(ticket['Time on Hold (min)']);
  const resAgreed = parseFloat(ticket['Agreed Resolution SLA (min)']);
  const resStatusCol = (ticket['Resolution SLA Status'] || '').toString().trim().toLowerCase();

  let effRes = NaN;
  if (!isNaN(resActual) && resActual !== null && ticket['Actual Resolution Time (min)'] !== '') {
    effRes = resActual;
  } else if (!isNaN(resTotal) && !isNaN(holdTime)) {
    effRes = Math.max(0, resTotal - holdTime);
  } else if (!isNaN(resTotal)) {
    effRes = resTotal;
  } else if (!isNaN(holdTime)) {
    effRes = holdTime;
  }

  let resolutionMet = true;
  if (!isNaN(effRes) && !isNaN(resAgreed)) {
    resolutionMet = effRes <= resAgreed;
  } else if (resStatusCol) {
    resolutionMet = !resStatusCol.includes('breach');
  }

  const bucket = (respMet && resolutionMet) ? 'SLA Met' : 'SLA Breached';
  return {
    bucket,
    responseMet: respMet,
    resolutionMet,
    effectiveResolution: isNaN(effRes) ? null : effRes,
  };
}

/**
 * Extracts site name from device name per F9.
 * @param {string} deviceName
 * @returns {string} Clean site name or 'Unknown'
 */
function extractSiteFromDeviceName(deviceName) {
  if (!deviceName || typeof deviceName !== 'string' || !deviceName.trim()) {
    return 'Unknown';
  }
  const clean = deviceName.trim();

  // Prefix matching e.g. IND-PVC-CHENNAI-MX01 or INDIA-PVC-MADURAI - MX01
  const pvcMatch = clean.match(/^(?:IND|INDIA)-PVC-([A-Za-z0-9]+)/i);
  if (pvcMatch) {
    return pvcMatch[1].trim().toUpperCase();
  }

  // Prefix matching e.g. IND-GGN-PLANT-IT-AP23
  const indMatch = clean.match(/^(?:IND|INDIA)-([A-Za-z0-9]+)/i);
  if (indMatch) {
    return indMatch[1].trim().toUpperCase();
  }

  // Fallback split by dash
  const parts = clean.split('-').map(s => s.trim()).filter(Boolean);
  if (parts.length > 2) return parts[1].toUpperCase();
  if (parts.length > 0) return parts[0].toUpperCase();

  return 'Unknown';
}

/**
 * Helper to parse various ticket date formats into a Date object.
 * @param {any} val
 * @returns {Date|null}
 */
function parseTicketDate(val) {
  if (val === undefined || val === null || val === '') return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === 'number') {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof val === 'string') {
    const s = val.trim();
    if (!s) return null;
    if (/^\d{2}-\d{2}-\d{4}/.test(s)) {
      const parts = s.split(' ');
      const [day, mon, yr] = parts[0].split('-');
      const timePart = parts[1] || '00:00:00';
      const d = new Date(`${yr}-${mon}-${day}T${timePart.length === 5 ? timePart + ':00' : timePart}`);
      return isNaN(d.getTime()) ? null : d;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      const parts = s.split(' ');
      const timePart = parts[1] || '00:00:00';
      const d = new Date(`${parts[0]}T${timePart.length === 5 ? timePart + ':00' : timePart}`);
      return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Loads baseline tickets from SLA_Compliance_Report.xlsx if not cached.
 * @returns {Array<object>}
 */
function getBaselineTickets() {
  if (_cachedMmtcTickets) return _cachedMmtcTickets;

  const xlsxPath = path.resolve(process.cwd(), 'SLA_Compliance_Report.xlsx');
  if (fs.existsSync(xlsxPath)) {
    try {
      const wb = xlsx.readFile(xlsxPath);
      const sheetName = wb.SheetNames.includes('SLA_Compliance_Report')
        ? 'SLA_Compliance_Report'
        : wb.SheetNames[0];
      const rows = xlsx.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
      _cachedMmtcTickets = rows.filter(r => {
        const acc = (r['Account Name'] || '').toString().toLowerCase();
        return acc.includes('mmtc');
      });
      return _cachedMmtcTickets;
    } catch (e) {
      _cachedMmtcTickets = [];
    }
  }
  return [];
}

/**
 * Builds the complete minimal 8-block MMTC report data structure.
 * @param {string} clientId Canonical or raw client identifier
 * @param {string} start YYYY-MM-DD
 * @param {string} end YYYY-MM-DD
 * @param {object} [options]
 * @param {Array<object>} [options.tickets] Explicit tickets to process
 * @param {string} [options.label] Custom display label
 * @returns {object} Formatted report object
 */
function buildReport(clientId, start, end, options = {}) {
  let allTickets = [];
  if (options && Array.isArray(options.tickets)) {
    allTickets = options.tickets;
  } else {
    allTickets = getBaselineTickets();
  }

  const startDt = new Date(`${start}T00:00:00`);
  const endDt = new Date(`${end}T23:59:59.999`);

  const windowTickets = allTickets.filter(t => {
    const d = parseTicketDate(t['Created Time']);
    if (!d) return false;
    return d >= startDt && d <= endDt;
  });

  let totalClosed = 0;
  let totalOnHold = 0;
  let slaMet = 0;
  let slaBreached = 0;
  let slaOnHold = 0;

  const byType = { Incident: 0, CR: 0, RF: 0, Upgrade: 0 };
  const channelCounts = {
    meraki_alerts: 0,
    meraki_emails: 0,
    security_alerts: 0,
    security_emails: 0,
  };

  const rcaMap = {};
  let ispCount = 0;
  const siteMap = {};

  windowTickets.forEach(t => {
    const status = (t['Status'] || t.status || '').toString().trim().toLowerCase();
    if (status === 'closed') totalClosed++;
    if (status === 'on hold') totalOnHold++;

    // Channel
    const chType = classifyChannel(t);
    if (channelCounts[chType] !== undefined) {
      channelCounts[chType]++;
    }

    // Ticket Type
    const tType = classifyTicketType(t);
    if (byType[tType] !== undefined) {
      byType[tType]++;
    }

    // SLA
    const slaRes = computeSla(t);
    if (slaRes.bucket === 'SLA Met') slaMet++;
    else if (slaRes.bucket === 'SLA Breached') slaBreached++;
    else if (slaRes.bucket === 'On Hold') slaOnHold++;

    // RCA Breakdown (closed tickets with non-empty RCA)
    const rca = (t['RCA'] || t.rca || '').toString().trim();
    if (rca && status === 'closed') {
      if (!rcaMap[rca]) {
        rcaMap[rca] = { tickets: 0, downtime_min: 0 };
      }
      rcaMap[rca].tickets++;
      const dtMin = parseFloat(t['Actual Resolution Time (min)']) || 0;
      rcaMap[rca].downtime_min += dtMin;
    }

    // ISP Location Analysis
    if (rca === 'ISP Issue') {
      ispCount++;
      const site = extractSiteFromDeviceName(t['Device Name']);
      siteMap[site] = (siteMap[site] || 0) + 1;
    }
  });

  const totalTickets = windowTickets.length;

  // Format RCA Breakdown table
  const rcaBreakdown = Object.entries(rcaMap).map(([rcaName, val]) => {
    const dtMin = Number(val.downtime_min.toFixed(2));
    const dtDays = Number((dtMin / 1440).toFixed(2));
    return {
      rca: rcaName,
      tickets: val.tickets,
      downtime_min: dtMin,
      downtime_days: dtDays,
    };
  });
  rcaBreakdown.sort((a, b) => b.tickets - a.tickets);

  const rcaTotal = rcaBreakdown.reduce((s, r) => s + r.tickets, 0);

  // ISP% with two denominators (F6)
  const isClosedRatio = rcaTotal > 0 ? Number(((ispCount / rcaTotal) * 100).toFixed(2)) : 0;
  const isAllRatio = totalTickets > 0 ? Number(((ispCount / totalTickets) * 100).toFixed(2)) : 0;

  // ISP Location Table (Top 15 + Others if > 15)
  const sortedSites = Object.entries(siteMap)
    .map(([site, count]) => ({ site, count }))
    .sort((a, b) => b.count - a.count);

  let ispLocation = [];
  if (sortedSites.length <= 15) {
    ispLocation = sortedSites;
  } else {
    const top15 = sortedSites.slice(0, 15);
    const rest = sortedSites.slice(15);
    const restTotal = rest.reduce((s, x) => s + x.count, 0);
    top15.push({
      site: `Others (${rest.length} sites)`,
      count: restTotal,
    });
    ispLocation = top15;
  }

  const report = {
    summary: {
      total: totalTickets,
      closed: totalClosed,
      on_hold: totalOnHold,
    },
    sla: {
      met: slaMet,
      breached: slaBreached,
      on_hold: slaOnHold,
      by_type: byType,
    },
    channel: channelCounts,
    rca_breakdown: rcaBreakdown,
    isp_pct: {
      rca_denom: isClosedRatio,
      channel_denom: isAllRatio,
    },
    isp_location: ispLocation,
    top_sites: ispLocation,
    meta: {
      client_id: clientId,
      start,
      end,
      label: options.label || `${start} to ${end}`,
    },
  };

  return report;
}

/**
 * Prepares payload subset for Virtual CTO AI /api/ai/insights call (F10).
 * @param {object} report
 * @returns {object}
 */
function toAiPayload(report) {
  return {
    total: report?.summary?.total || 0,
    closed: report?.summary?.closed || 0,
    on_hold: report?.summary?.on_hold || 0,
    sla_met: report?.sla?.met || 0,
    sla_breached: report?.sla?.breached || 0,
    channel: report?.channel || {},
    rca_breakdown: report?.rca_breakdown || [],
    isp_pct: report?.isp_pct || {},
    top_sites: report?.isp_location || report?.top_sites || [],
  };
}

/**
 * Persists an array of ticket rows to Turso database reports_tickets table.
 * @param {string} clientId
 * @param {Array<object>} tickets
 * @returns {Promise<{ insertedCount: number }>}
 */
async function persistTickets(clientId, tickets) {
  let count = 0;
  if (!database || typeof database.execute !== 'function') {
    return { insertedCount: tickets.length };
  }

  for (const t of tickets) {
    const ticketNo = t['Ticket Number'] || t.ticket_number;
    if (!ticketNo) continue;
    const slaRes = computeSla(t);
    const ticketType = classifyTicketType(t);
    const now = new Date().toISOString();

    try {
      await database.execute(
        `INSERT OR REPLACE INTO reports_tickets 
         (client_id, ticket_number, payload_json, bucket, ticket_type, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [clientId, String(ticketNo), JSON.stringify(t), slaRes.bucket, ticketType, now]
      );
      count++;
    } catch (e) {
      // Continue inserting remaining rows
    }
  }

  return { insertedCount: count };
}

/**
 * Asynchronously builds report from Turso DB or falls back to in-memory/excel baseline.
 * @param {string} clientId
 * @param {string} start
 * @param {string} end
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function buildReportAsync(clientId, start, end, options = {}) {
  if (options && Array.isArray(options.tickets)) {
    return buildReport(clientId, start, end, options);
  }

  // Attempt reading from DB first
  if (database && typeof database.execute === 'function') {
    try {
      const res = await database.execute(
        'SELECT payload_json FROM reports_tickets WHERE client_id = ?',
        [clientId]
      );
      if (res && res.rows && res.rows.length > 0) {
        const dbTickets = res.rows.map(r => {
          const raw = r.payload_json || r[0];
          return typeof raw === 'string' ? JSON.parse(raw) : raw;
        });
        return buildReport(clientId, start, end, { ...options, tickets: dbTickets });
      }
    } catch (e) {
      // Fall through to baseline
    }
  }

  return buildReport(clientId, start, end, options);
}

module.exports = {
  resolveClientId,
  classifyChannel,
  classifyTicketType,
  computeSla,
  extractSiteFromDeviceName,
  buildReport,
  buildReportAsync,
  toAiPayload,
  persistTickets,
};
