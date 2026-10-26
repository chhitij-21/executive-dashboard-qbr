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
function computeSla(ticket, clientId) {
  if (!ticket) {
    return { bucket: 'SLA Met', responseMet: true, resolutionMet: true, effectiveResolution: 0 };
  }

  const status = (ticket['Status'] || ticket.status || '').toString().trim().toLowerCase();
  if (status === 'on hold') {
    return { bucket: 'On Hold', responseMet: null, resolutionMet: null, effectiveResolution: null };
  }

  // Response SLA evaluation
  const respActual = parseFloat(ticket['Actual Response Time (min)']);
  let respAgreed = parseFloat(ticket['Agreed Response SLA (min)']);
  if (clientId === 'client-mmtcpamp' || clientId === 'mmtc') {
    respAgreed = 30; // MMTC Response Time SLA
  }
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
    const num = Number(s);
    if (!isNaN(num) && num > 30000 && num < 100000) {
      const d = new Date(Math.round((num - 25569) * 86400 * 1000));
      return isNaN(d.getTime()) ? null : d;
    }
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
 * Formats YYYY-MM-DD range into clean display period (e.g., "September 2026" or "15 August 2026 to 25 August 2026").
 * @param {string} startDate
 * @param {string} endDate
 * @returns {string}
 */
function formatPeriod(startDate, endDate) {
  if (!startDate || !endDate) return 'Custom Period';
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const s = new Date(startDate + 'T00:00:00Z');
  const e = new Date(endDate + 'T00:00:00Z');
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return `${startDate} to ${endDate}`;
  const sDay = s.getUTCDate();
  const sMonth = months[s.getUTCMonth()];
  const sYear = s.getUTCFullYear();
  const eDay = e.getUTCDate();
  const eMonth = months[e.getUTCMonth()];
  const eYear = e.getUTCFullYear();
  if (sMonth === eMonth && sYear === eYear && sDay === 1 && eDay >= 28) {
    return `${sMonth} ${sYear}`;
  }
  return `${sDay} ${sMonth} ${sYear} to ${eDay} ${eMonth} ${eYear}`;
}

/**
 * Loads baseline tickets from SLA_Compliance_Report.xlsx if not cached.
 * @returns {Array<object>}
 */
function getBaselineTickets() {
  if (_cachedMmtcTickets) return _cachedMmtcTickets;

  let xlsxPath = path.resolve(process.cwd(), 'SLA_Compliance_Report.xlsx');
  if (!fs.existsSync(xlsxPath)) {
    xlsxPath = path.resolve(__dirname, '..', '..', 'SLA_Compliance_Report.xlsx');
  }
  if (!fs.existsSync(xlsxPath)) {
    xlsxPath = path.resolve(process.cwd(), '..', 'SLA_Compliance_Report.xlsx');
  }
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
    const d = parseTicketDate(t['Created Time'] || t.created_time || t.CreatedTime);
    if (!d) return false;
    return d >= startDt && d <= endDt;
  });

  let totalClosed = 0;
  let totalOnHold = 0;
  let totalOpen = 0;
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
    if (status === 'closed' || status === 'resolved') totalClosed++;
    else if (status === 'on hold' || status === 'hold') totalOnHold++;
    else totalOpen++;

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
    const slaRes = computeSla(t, clientId);
    if (slaRes.bucket === 'SLA Met') slaMet++;
    else if (slaRes.bucket === 'SLA Breached') slaBreached++;
    else if (slaRes.bucket === 'On Hold') slaOnHold++;

    // RCA Breakdown (non-empty RCA, closed tickets only)
    const rca = (t['RCA'] || t.rca || '').toString().trim();
    if (rca && (status === 'closed' || status === 'resolved')) {
      if (!rcaMap[rca]) {
        rcaMap[rca] = { tickets: 0, downtime_min: 0 };
      }
      rcaMap[rca].tickets++;
      const dtMin = parseFloat(t['Actual Resolution Time (min)']) || 0;
      rcaMap[rca].downtime_min += dtMin;
    }

    // ISP Location Analysis
    if (rca === 'ISP Issue' && (status === 'closed' || status === 'resolved')) {
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

  // Phase 2: ISP Location Breakdown & Grand Total
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const ispLocationMap = {};
  
  windowTickets.forEach(t => {
    const rca = (t['RCA'] || t.rca || '').toString().trim();
    if (rca === 'ISP Issue') {
      const locName = extractSiteFromDeviceName(t['Device Name'] || t.device_name || t.DeviceName || 'Unknown');
      const d = parseTicketDate(t['Created Time'] || t.created_time || t.CreatedTime);
      const mName = d ? months[d.getMonth()] : (startDt ? months[startDt.getMonth()] : 'July');
      
      if (!ispLocationMap[locName]) {
        ispLocationMap[locName] = { month: mName, location: locName, total: 0 };
      }
      ispLocationMap[locName].total++;
    }
  });

  const ispLocationBreakdown = Object.values(ispLocationMap)
    .sort((a, b) => b.total - a.total)
    .map((item, idx) => ({
      s_no: idx + 1,
      month: item.month,
      location: item.location,
      device_name: item.location,
      total: item.total,
    }));

  const ispGrandTotal = ispLocationBreakdown.reduce((sum, item) => sum + item.total, 0);

  // TASK 2b (Data Shape): hold_tickets: { ticket_number, subject, reason, rollover, created_date } (Filter Status == 'On Hold')
  const holdTickets = allTickets
    .filter(t => {
      const status = (t['Status'] || t.status || '').toString().trim().toLowerCase();
      if (status !== 'on hold' && status !== 'hold') return false;
      const d = parseTicketDate(t['Created Time'] || t.created_time || t.CreatedTime);
      return !d || d <= endDt;
    })
    .map(t => {
      const d = parseTicketDate(t['Created Time'] || t.created_time || t.CreatedTime);
      const isRollover = d ? d < startDt : false;
      return {
        ticket_number: String(t['Ticket Number'] || t.ticket_number || t.TicketNumber || '').trim(),
        subject: String(t['Subject'] || t.subject || '').trim(),
        reason: String(t['Hold Reason'] || t['Reason for Hold'] || t.hold_reason || t.HoldReason || 'Unspecified').trim(),
        rollover: isRollover ? 'Rollover' : 'On Hold',
        created_date: d ? d.toISOString().slice(0, 10) : String(t['Created Time'] || t.created_time || t.CreatedTime || '').trim(),
      };
    });

  // TASK 2b (Data Shape): cr_tickets: { s_no, subject, category, sub_category, status } (Filter SubCategory == 'Change Request')
  const crCandidates = windowTickets.filter(t => {
    const sc = (t['Sub Category'] || t.subCategory || t['SubCategory'] || t.sub_category || '').toString().trim().toLowerCase();
    return sc === 'change request' || classifyTicketType(t) === 'CR';
  });

  let crTickets = crCandidates.map((t, idx) => ({
    s_no: idx + 1,
    subject: String(t['Subject'] || t.subject || '').trim(),
    category: String(t['Category'] || t.category || '').trim(),
    sub_category: String(t['Sub Category'] || t.subCategory || t['SubCategory'] || t.sub_category || 'Change Request').trim(),
    status: String(t['Status'] || t.status || 'Closed').trim(),
  }));

  // If crTickets is empty but security_emails > 0, populate from window tickets
  if (crTickets.length === 0 && channelCounts.security_emails > 0) {
    let idx = 0;
    windowTickets.forEach(t => {
      if (classifyChannel(t) === 'security_emails') {
        idx++;
        crTickets.push({
          s_no: idx,
          subject: t['Subject'] || t.subject || 'N/A',
          category: t['Category'] || 'Security',
          sub_category: t['Sub Category'] || 'Change Request',
          status: t['Status'] || 'Closed',
        });
      }
    });
  }

  // Only real CRs (sub_category === 'Change Request')
  const realCrs = (crTickets || []).filter(c => 
    String(c.sub_category || '').trim().toLowerCase() === 'change request'
  );
  
  const merakiCrs = realCrs.filter(c => /meraki/i.test(c.category || '')).length;
  const securityCrs = realCrs.filter(c => /security/i.test(c.category || '')).length;
  
  const crSummary = {
    meraki_crs: merakiCrs,       // 0
    security_crs: securityCrs,   // 0
    security_emails: channelCounts.security_emails,  // 4 (channel metric, NOT CR)
    total_crs: realCrs.length,   // 0 (no real CRs)
  };
  
  // Overwrite cr_tickets with only real CRs
  crTickets = realCrs;

  const report = {
    summary: {
      total: totalTickets,
      closed: totalClosed,
      on_hold: totalOnHold,
      open: totalOpen,
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
    isp_location_breakdown: ispLocationBreakdown,
    isp_device_breakdown: ispLocationBreakdown,
    isp_grand_total: ispGrandTotal,
    top_sites: ispLocation,
    hold_tickets: holdTickets,
    cr_tickets: crTickets,
    cr_summary: crSummary,
    meta: {
      client_id: clientId,
      start,
      end,
      label: options.label || `MMTC · ${formatPeriod(start, end)}`,
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
    isp_location_breakdown: report?.isp_location_breakdown || report?.isp_device_breakdown || [],
    isp_device_breakdown: report?.isp_location_breakdown || report?.isp_device_breakdown || [],
    isp_grand_total: report?.isp_grand_total || 0,
  };
}

/**
 * Persists an array of ticket rows to Turso database reports_tickets table.
 * @param {string} clientId
 * @param {Array<object>} tickets
 * @param {object} [period] Optional { start, end }
 * @returns {Promise<{ insertedCount: number }>}
 */
async function persistTickets(clientId, tickets, period = {}) {
  let count = 0;
  if (!database || typeof database.execute !== 'function') {
    return { insertedCount: tickets.length };
  }

  const now = new Date().toISOString();
  let start = period?.start || period?.start_date || null;
  let end = period?.end || period?.end_date || null;

  if (!start || !end) {
    const dates = tickets
      .map(t => parseTicketDate(t['Created Time'] || t.created_time || t.CreatedTime))
      .filter(Boolean)
      .sort((a, b) => a - b);
    if (dates.length > 0) {
      if (!start) start = dates[0].toISOString().slice(0, 10);
      if (!end) end = dates[dates.length - 1].toISOString().slice(0, 10);
    }
  }

  const chunkSize = 25;
  for (let i = 0; i < tickets.length; i += chunkSize) {
    const chunk = tickets.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async (t) => {
        const ticketNo = t['Ticket Number'] || t.ticket_number || t.TicketNumber;
        if (!ticketNo) return;
        const slaRes = computeSla(t, clientId);
        const ticketType = classifyTicketType(t);
        try {
          await database.execute(
            `INSERT OR REPLACE INTO reports_tickets 
             (client_id, ticket_number, period_start, period_end, payload_json, bucket, ticket_type, uploaded_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [clientId, String(ticketNo), start, end, JSON.stringify(t), slaRes.bucket, ticketType, now]
          );
          count++;
        } catch (e) {
          // Continue inserting remaining rows
        }
      })
    );
  }

  return { insertedCount: count };
}

/**
 * Dual-writes parsed tickets to reports_tickets table for MMTC client only.
 * Guaranteed early return for JFL with ZERO database calls (JFL safety invariant).
 * @param {string} clientId Canonical or raw client identifier
 * @param {Array<object>} tickets Parsed ticket rows
 * @param {object} [period] Optional { start, end }
 * @returns {Promise<{ written: number, skipped?: string }>}
 */
async function dualWriteToReportsTickets(clientId, tickets, period = {}) {
  const canonical = resolveClientId(clientId);
  if (canonical !== 'mmtc') {
    return { written: 0, skipped: 'not-mmtc' };
  }

  if (!database || typeof database.execute !== 'function') {
    return { written: Array.isArray(tickets) ? tickets.length : 0 };
  }

  const jobId = period?.jobId || period?.job_id || null;

  // 1. Delete previous entries
  await database.execute('DELETE FROM reports_tickets WHERE client_id = ?', ['mmtc']);

  // 2. Insert or replace each ticket
  let count = 0;
  const list = Array.isArray(tickets) ? tickets : [];
  let start = period?.start || period?.start_date || null;
  let end = period?.end || period?.end_date || null;
  const now = new Date().toISOString();

  if (!start || !end) {
    const dates = list
      .map(t => parseTicketDate(t['Created Time'] || t.created_time || t.CreatedTime))
      .filter(Boolean)
      .sort((a, b) => a - b);
    if (dates.length > 0) {
      if (!start) start = dates[0].toISOString().slice(0, 10);
      if (!end) end = dates[dates.length - 1].toISOString().slice(0, 10);
    }
  }

  for (const t of list) {
    const ticketNo = t['Ticket Number'] || t.ticket_number || t.TicketNumber;
    if (!ticketNo) continue;
    const slaRes = computeSla(t, clientId);
    const ticketType = classifyTicketType(t);

    await database.execute(
      `INSERT OR REPLACE INTO reports_tickets 
       (client_id, ticket_number, period_start, period_end, payload_json, bucket, ticket_type, uploaded_at, job_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'mmtc',
        String(ticketNo),
        start,
        end,
        JSON.stringify(t),
        slaRes.bucket,
        ticketType,
        now,
        jobId,
      ]
    );
    count++;
  }

  return { written: count };
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
  if (database && typeof database.execute !== 'function') {
    return buildReport(clientId, start, end, options);
  }

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

  return buildReport(clientId, start, end, options);
}

// Mirror of frontend/src/utils/reportHelpers.js::buildDeterministicSummary.
// Keep in sync — both are tested independently (backend T12/T13/T22,
// frontend via Vite).
function buildDeterministicSummary(report) {
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
  dualWriteToReportsTickets,
  buildDeterministicSummary,
  parseTicketDate,
  formatPeriod,
};
