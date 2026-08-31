// backend/services/pptGenerator.js
// Board-Level Executive QBR PowerPoint Generator
// Produces a ~40-slide Cisco/Deloitte/ServiceNow-quality presentation.
//
// Slide Structure:
//   Slide  1  : Cover Page
//   Slide  2  : Table of Contents
//   Slide  3  : Executive Summary (KPIs + AI Narrative)
//   Slide  4  : Overall Network Health
//   Slide  5  : Infrastructure Summary (per-site breakdown)
//   Slide  6  : Inventory Summary
//   Slide  7  : Incident Overview
//   Slide  8  : RCA Pareto Analysis
//   Slide  9  : RCA Heatmap (Sites × RCA Categories)
//   Slide 10  : SLA Dashboard
//   Slide 11  : Ticket Analytics
//   Slide 12  : Site Health Ranking
//   Slide 13  : Risk Assessment
//   Slides 14–37: 8 Sites × 3 Slides (Overview / Operations / Tickets)
//   Slide 38  : AI Recommendations
//   Slide 39  : Action Plan
//   Slide 40  : Thank You
//
// GOLDEN CODE CONSTRAINT: Only this file is modified.
// processData.js / ruleEngine.js / excelParser.js / rules.yaml untouched.

'use strict';

const fs   = require('fs');
const path = require('path');
const PptxGenJS = require('pptxgenjs');
const { isGenericLocation, normalizeSiteName } = require('./excelParser');
// FINDING-010/012/029 FIX: Import ruleEngine to use canonical health labels and
// period-aware SLA target instead of duplicated local functions.
const ruleEngine = require('./ruleEngine');
const pptDataMapper = require('./pptDataMapper');
const reconciliationEngine = require('./reconciliationEngine');

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

// FINDING-010 FIX: SLA_TARGET is no longer hardcoded here.
// It is read from data.slaAnalytics.slaTarget which is set by processData.js
// using the period-aware ruleEngine.getSLATarget(periodMode).
// A module-level fallback is kept only for backward compatibility with old data.
const SLA_TARGET_FALLBACK = 99.3;
// Mutable: overwritten at start of buildPresentation() from the canonical data value.
let SLA_TARGET = SLA_TARGET_FALLBACK;


const TARGET_SITES = [
  'Bangalore',
  'Greater Noida',
  'Guwahati',
  'Hyderabad',
  'Mohali',
  'Mumbai',
  'Nagpur',
  'Noida',
];

// Corporate colour palette — McKinsey / Bain Executive Standard Palette
const C = {
  NAVY:         '1E293B', // Slate-800 (Softer dark tone)
  NAVY_LIGHT:   '334155',
  NAVY_MID:     '1E293B',
  BLUE:         '2563EB', // Blue-600 (Primary accent & table header)
  BLUE_ACCENT:  '3B82F6',
  BLUE_LIGHT:   'EFF6FF',
  STEEL:        '475569',
  BG_DARK:      '1E293B',
  BG_LIGHT:     'F8FAFC', // Slate-50 Off-White background
  BG_SECTION:   'F1F5F9',
  CARD_BG:      'F1F5F9', // Slate-100 alternate row stripe
  CARD_BORDER:  'CBD5E1',
  TEXT_DARK:    '0F172A',
  TEXT_MID:     '334155',
  TEXT_MUTED:   '64748B',
  TEXT_LIGHT:   'FFFFFF',
  GREEN:        '16A34A',
  GREEN_LIGHT:  'DCFCE7',
  RED:          'DC2626',
  RED_LIGHT:    'FEE2E2',
  AMBER:        'D97706',
  AMBER_LIGHT:  'FEF3C7',
  TEAL:         '0D9488',
  PURPLE:       '7C3AED',
  DIVIDER:      'E2E8F0',
  HEADER_FILL:  '1E293B',
  TABLE_HEADER_FILL: '2563EB',
  FOOTER_LINE:  'CBD5E1',
  ACCENT_GOLD:  'F59E0B',
  FONT_PRIMARY: 'Segoe UI',
};

// Paths resolved relative to this file
const LOGO_PATH  = path.resolve(__dirname, '../../templates/extracted_media/image2.png');
const COVER_PATH = path.resolve(__dirname, '../../templates/extracted_media/image1.jpeg');

let logoBase64  = null;
let coverBase64 = null;

try {
  if (fs.existsSync(LOGO_PATH))  logoBase64  = 'image/png;base64,'  + fs.readFileSync(LOGO_PATH).toString('base64');
} catch (e) {}
try {
  if (fs.existsSync(COVER_PATH)) coverBase64 = 'image/jpeg;base64,' + fs.readFileSync(COVER_PATH).toString('base64');
} catch (e) {}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

async function generatePPT(data, _templatePath, outputPath, options = {}) {
  console.log('[pptGenerator] Mapping canonical snapshot to PPT presentation model...');
  const pptData = pptDataMapper.mapSnapshotToPPTData(data);

  console.log('[pptGenerator] Running pre-generation automated data reconciliation...');
  const outputDir = path.dirname(outputPath);
  reconciliationEngine.reconcileDashboardAndPPT(data, pptData, outputDir);

  console.log('[pptGenerator] Generating Board-Level Executive QBR PPT...');
  await buildPresentation(data, outputPath, options);
  console.log('[pptGenerator] PPT written to:', outputPath);
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmt(v) {
  return (v === null || v === undefined || v === '') ? 'N/A' : String(v);
}

function pct(v) {
  const n = parseFloat(String(v ?? ''));
  if (isNaN(n)) return 'N/A';
  return `${n.toFixed(2)}%`;
}

function uptimeColor(rawValue, slaTarget) {
  const n = parseFloat(String(rawValue ?? ''));
  if (isNaN(n)) return C.TEXT_MUTED;
  // FINDING-010 FIX: Use the passed slaTarget from data, not a hardcoded constant.
  return n < (slaTarget ?? SLA_TARGET_FALLBACK) ? C.RED : C.GREEN;
}

function rowFill(idx) {
  return idx % 2 === 0 ? 'FFFFFF' : C.CARD_BG;
}

function findSite(siteSummary, siteKey) {
  const normKey = normalizeSiteName(siteKey);
  return (
    siteSummary.find(s => normalizeSiteName(s.siteId) === normKey) ||
    { siteId: siteKey }
  );
}

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// FINDING-012/029 FIX: Removed duplicate healthLabel() and healthColor() functions.
// Now uses ruleEngine.getHealthLabel() which reads from rules.yaml.
// healthColor maps the canonical label to a colour — no separate threshold logic.
function healthLabel(score) {
  return ruleEngine.getHealthLabel(score);
}

function healthColor(score) {
  const label = ruleEngine.getHealthLabel(score);
  if (label === 'Excellent') return C.GREEN;
  if (label === 'Good')      return C.BLUE;
  if (label === 'Fair')      return C.AMBER;
  if (label === 'Poor')      return C.RED;
  return C.TEXT_MUTED;
}

function riskLevel(score) {
  const n = parseFloat(score);
  if (isNaN(n)) return { label: 'UNKNOWN', color: C.TEXT_MUTED, bg: C.CARD_BG };
  if (n >= 95)  return { label: 'LOW',      color: C.GREEN,      bg: C.GREEN_LIGHT };
  if (n >= 85)  return { label: 'MODERATE', color: C.BLUE,       bg: C.BLUE_LIGHT };
  if (n >= 70)  return { label: 'ELEVATED', color: C.AMBER,      bg: C.AMBER_LIGHT };
  return            { label: 'HIGH',     color: C.RED,        bg: C.RED_LIGHT };
}

function normSite(loc) {
  if (!loc || isGenericLocation(loc)) return '';
  const norm = normalizeSiteName(loc);
  if (isGenericLocation(norm)) return '';
  return norm;
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Narrative Engine — pure JS, no external APIs
// ─────────────────────────────────────────────────────────────────────────────

function generateExecNarrative(exec, siteSummary, incidents) {
  const uptime = parseFloat(exec.overallUptime) || 100;
  const slaComp = parseFloat(exec.slaCompliance) || 100;
  const totalInc = exec.totalIncidents || incidents.length || 0;
  const topRca = exec.primaryRca || 'Unknown';
  const incFreePct = parseFloat(exec.incidentFreePercent) || 100;

  const sorted = [...siteSummary].sort((a, b) => parseFloat(b.healthScore || 0) - parseFloat(a.healthScore || 0));
  const bestSite  = sorted[0]?.siteId || 'N/A';
  const worstSite = sorted[sorted.length - 1]?.siteId || 'N/A';
  const worstScore = sorted[sorted.length - 1]?.healthScore || 'N/A';

  const siteIncCounts = {};
  incidents.forEach(i => {
    const site = normSite(i.SiteID || i.Location || '');
    if (site) siteIncCounts[site] = (siteIncCounts[site] || 0) + 1;
  });
  const highestIncSite = Object.entries(siteIncCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || worstSite;
  const highestIncCount = siteIncCounts[highestIncSite] || 0;

  const uptimeSentence = uptime >= SLA_TARGET
    ? `Overall network uptime remained at ${uptime.toFixed(2)}%, exceeding the ${SLA_TARGET}% SLA target.`
    : `Overall network uptime was ${uptime.toFixed(2)}%, marginally below the ${SLA_TARGET}% SLA target, requiring corrective action.`;

  const incidentSentence = totalInc > 0
    ? `A total of ${totalInc} incidents were recorded, with ${highestIncSite} contributing the highest volume (${highestIncCount} incidents), primarily driven by ${topRca}.`
    : `No incidents were recorded during this reporting period across all monitored sites.`;

  const siteSentence = `${bestSite} achieved the strongest health score while ${worstSite} reported the lowest at ${fmt(worstScore)}.`;
  const slaSentence  = slaComp >= 99.0
    ? `SLA compliance was maintained at ${slaComp.toFixed(2)}%, reflecting robust operational performance.`
    : `SLA compliance stood at ${slaComp.toFixed(2)}%; targeted remediation is recommended to meet contractual obligations.`;
  const incFreeSentence = `${incFreePct.toFixed(1)}% of all monitored devices remained incident-free throughout the reporting period.`;

  return [uptimeSentence, incidentSentence, siteSentence, slaSentence, incFreeSentence];
}

function generateSiteInsights(siteKey, siteData, siteIncs) {
  const health = parseFloat(siteData.healthScore) || 100;
  // Use canonical SSOT fields: jflSwitchUptime first, fall back to switchUptime
  const uptime  = parseFloat(siteData.jflSwitchUptime || siteData.switchUptime) || 100;
  const incFree = parseFloat(siteData.incidentFreePercent) || 100;
  // Use canonical SSOT field: primaryRcaSwitches first, fall back to primaryRca
  const topRca   = siteData.primaryRcaSwitches || siteData.primaryRca || 'None';
  const devCount = siteData.deviceCount || 0;
  const incCount = siteIncs.length;

  const highlights = [];
  const risks      = [];

  if (uptime >= 99.5) highlights.push(`Switch uptime at ${pct(uptime)} — exceeding SLA threshold of ${SLA_TARGET}%.`);
  else                risks.push(`Switch uptime at ${pct(uptime)} — below SLA target of ${SLA_TARGET}%.`);

  if (incFree >= 90)  highlights.push(`${incFree.toFixed(1)}% of devices remained incident-free.`);
  else                risks.push(`Only ${incFree.toFixed(1)}% of devices are incident-free — investigate recurring failures.`);

  if (health >= 90)   highlights.push(`Site health score of ${health.toFixed(2)} indicates strong operational stability.`);
  else if (health >= 75) risks.push(`Health score of ${health.toFixed(2)} indicates moderate risk requiring attention.`);
  else                   risks.push(`Critical health score of ${health.toFixed(2)} — immediate intervention recommended.`);

  if (incCount === 0) {
    highlights.push('Zero incidents recorded — full SLA compliance maintained.');
  } else {
    highlights.push(`${incCount} total incidents logged; primary driver: ${topRca}.`);
    if (topRca && topRca !== 'None' && topRca !== 'N/A') {
      risks.push(`Recurring ${topRca} incidents require infrastructure investigation.`);
    }
  }

  if (highlights.length === 0) highlights.push('Operational metrics within acceptable bounds for the reporting period.');
  if (risks.length === 0)      risks.push('No critical risks identified. Continue standard monitoring protocols.');

  return { highlights, risks };
}

function generateRCARecommendations(rcaBreakdown) {
  const recommendations = [];
  rcaBreakdown.slice(0, 5).forEach(rca => {
    const name = rca.rca || rca.category || 'Unknown';
    const pctVal = rca.pct || rca.percentage || 0;
    const nameLower = name.toLowerCase();

    let priority = 'Medium';
    let action = `Investigate and mitigate ${name} failures.`;
    let timeline = 'Q2 FY2026';

    if (nameLower.includes('power') || nameLower.includes('ups')) {
      priority = 'High';
      action   = `Inspect and replace faulty UPS/power infrastructure. Schedule preventive power audits.`;
      timeline = '30 days';
    } else if (nameLower.includes('isp') || nameLower.includes('wan') || nameLower.includes('link')) {
      priority = 'High';
      action   = `Escalate with ISP for SLA review. Implement redundant WAN failover links.`;
      timeline = '45 days';
    } else if (nameLower.includes('hardware') || nameLower.includes('device') || nameLower.includes('nic')) {
      priority = 'Medium';
      action   = `Schedule hardware audit. Identify end-of-life devices for replacement.`;
      timeline = '60 days';
    } else if (nameLower.includes('config') || nameLower.includes('firmware') || nameLower.includes('software')) {
      priority = 'Medium';
      action   = `Deploy firmware updates. Enforce change management for configuration changes.`;
      timeline = '30 days';
    } else if (parseFloat(pctVal) >= 30) {
      priority = 'High';
      action   = `High-frequency RCA (${pctVal}%). Conduct root cause workshop with operations team.`;
      timeline = '14 days';
    }

    recommendations.push({ rca: name, pct: pctVal, priority, action, timeline });
  });

  if (recommendations.length === 0) {
    recommendations.push({ rca: 'General', pct: 0, priority: 'Low', action: 'Continue standard monitoring. No immediate action required.', timeline: 'Ongoing' });
  }

  return recommendations;
}

function generateActionPlan(exec, siteSummary, incidents) {
  const actions = [];
  const sorted = [...siteSummary].sort((a, b) => parseFloat(a.healthScore || 0) - parseFloat(b.healthScore || 0));

  // High-risk site actions
  sorted.slice(0, 3).forEach(site => {
    const score = parseFloat(site.healthScore || 100);
    if (score < 90) {
      actions.push({
        priority: score < 75 ? 'Critical' : 'High',
        action: `Remediate health degradation at ${site.siteId} (Score: ${site.healthScore})`,
        owner: 'Network Operations',
        timeline: score < 75 ? '7 days' : '30 days',
        status: 'Open',
      });
    }
  });

  // RCA-based actions from top incidents
  const rcaCounts = {};
  incidents.forEach(i => { if (i.RCA) rcaCounts[i.RCA] = (rcaCounts[i.RCA] || 0) + 1; });
  const topRcas = Object.entries(rcaCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
  topRcas.forEach(([rca, count]) => {
    actions.push({
      priority: 'High',
      action: `Root cause elimination for "${rca}" (${count} occurrences across all sites)`,
      owner: 'Infrastructure Team',
      timeline: '45 days',
      status: 'In Progress',
    });
  });

  // Standard actions
  actions.push({ priority: 'Medium', action: 'Quarterly firmware update across all network switches', owner: 'Network Ops', timeline: 'Q2 FY2026', status: 'Planned' });
  actions.push({ priority: 'Medium', action: 'AP placement review at sites with >30% AP incident rate', owner: 'Wireless Team', timeline: '60 days', status: 'Planned' });
  actions.push({ priority: 'Low',    action: 'Documentation update — network topology diagrams for all 8 sites', owner: 'Documentation', timeline: '90 days', status: 'Planned' });
  actions.push({ priority: 'Low',    action: 'Monthly proactive health check cadence review with JFL stakeholders', owner: 'Account Manager', timeline: 'Ongoing', status: 'Active' });

  return actions.slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared Slide Components
// ─────────────────────────────────────────────────────────────────────────────

let _slideNum = 0;

function addHeader(pres, slide, title, subtitle, slideNumber) {
  // Full-width navy header bar
  slide.addShape(pres.ShapeType.rect, {
    x: 0, y: 0, w: 13.33, h: 0.9,
    fill: { color: C.NAVY },
  });

  // Accent left strip
  slide.addShape(pres.ShapeType.rect, {
    x: 0, y: 0, w: 0.06, h: 0.9,
    fill: { color: C.ACCENT_GOLD },
  });

  slide.addText(title, {
    x: 0.35, y: 0.06, w: 9.5, h: 0.44,
    fontSize: 28, bold: true, color: C.TEXT_LIGHT,
    fontFace: C.FONT_PRIMARY, charSpacing: 0.5,
  });

  slide.addText(subtitle, {
    x: 0.35, y: 0.52, w: 9.5, h: 0.28,
    fontSize: 14, color: 'A8C4DC',
    fontFace: C.FONT_PRIMARY,
  });

  // Logo top-right
  if (logoBase64) {
    slide.addImage({ data: logoBase64, x: 10.8, y: 0.1, w: 2.0, h: 0.65 });
  } else if (fs.existsSync(LOGO_PATH)) {
    slide.addImage({ path: LOGO_PATH, x: 10.8, y: 0.1, w: 2.0, h: 0.65 });
  }

  // Footer
  slide.addShape(pres.ShapeType.line, {
    x: 0.35, y: 7.1, w: 12.63, h: 0,
    line: { color: C.FOOTER_LINE, pt: 0.75 },
  });
  slide.addText('CONFIDENTIAL — Proactive Data Systems Pvt. Ltd.', {
    x: 0.35, y: 7.15, w: 7.5, h: 0.22,
    fontSize: 8.5, color: C.TEXT_MUTED, fontFace: C.FONT_PRIMARY,
  });
  if (slideNumber) {
    slide.addText(`Slide ${slideNumber}`, {
      x: 10.0, y: 7.15, w: 2.98, h: 0.22,
      fontSize: 8.5, color: C.TEXT_MUTED, align: 'right', fontFace: C.FONT_PRIMARY,
    });
  }
  slide.addText(new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'short' }), {
    x: 7.85, y: 7.15, w: 2.0, h: 0.22,
    fontSize: 8.5, color: C.TEXT_MUTED, align: 'center', fontFace: C.FONT_PRIMARY,
  });
}

function addKpiCard(slide, x, y, w, h, label, value, color, bgColor) {
  slide.addShape('roundRect', {
    x, y, w, h,
    fill: { color: bgColor || C.CARD_BG },
    line: { color: C.CARD_BORDER, pt: 1 },
    rectRadius: 0.08,
  });
  slide.addText(String(value), {
    x: x + 0.05, y: y + 0.12, w: w - 0.1, h: h * 0.55,
    fontSize: h > 1.1 ? 20 : 16, bold: true,
    color: color || C.BLUE, align: 'center', fontFace: 'Calibri',
  });
  slide.addText(label, {
    x: x + 0.05, y: y + h * 0.62, w: w - 0.1, h: h * 0.32,
    fontSize: 8.5, color: C.TEXT_MUTED, align: 'center', fontFace: 'Calibri',
    wrap: true,
  });
}

function addSectionDivider(slide, y, label) {
  slide.addShape('rect', {
    x: 0.35, y, w: 12.63, h: 0.32,
    fill: { color: C.NAVY_MID },
  });
  slide.addText(label.toUpperCase(), {
    x: 0.55, y: y + 0.04, w: 12.0, h: 0.24,
    fontSize: 9, bold: true, color: C.TEXT_LIGHT,
    fontFace: 'Calibri', charSpacing: 1.2,
  });
}

function addNarrativeBox(slide, y, bullets, title) {
  const boxH = 0.22 * bullets.length + 0.52;
  slide.addShape('roundRect', {
    x: 0.35, y, w: 12.63, h: boxH,
    fill: { color: C.BLUE_LIGHT },
    line: { color: C.BLUE, pt: 1 },
    rectRadius: 0.06,
  });
  slide.addShape('rect', {
    x: 0.35, y, w: 0.08, h: boxH,
    fill: { color: C.BLUE_ACCENT },
  });
  slide.addText(title || 'AI Executive Insight', {
    x: 0.55, y: y + 0.06, w: 12.0, h: 0.28,
    fontSize: 9, bold: true, color: C.NAVY, fontFace: 'Calibri',
  });
  bullets.forEach((b, i) => {
    slide.addText(`• ${b}`, {
      x: 0.55, y: y + 0.36 + i * 0.22, w: 12.0, h: 0.22,
      fontSize: 8.5, color: C.TEXT_MID, fontFace: 'Calibri', wrap: true,
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Presentation Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

async function buildPresentation(data, outputPath, options = {}) {
  _slideNum = 0;
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE'; // 13.33 × 7.5 inches

  const exec        = data.executiveSummary || {};
  const siteSummary = data.siteSummary      || [];
  const incidents   = data.incidents        || [];
  const devices     = data.devices          || [];
  const rcaAn       = data.rcaAnalytics     || {};
  const slaAn       = data.slaAnalytics     || {};
  const switchAn    = data.switchAnalytics  || {};
  const apAn        = data.apAnalytics      || {};

  // Resolve canonical reporting period: prefer report_period.display_label (SSOT),
  // fall back to legacy reportingPeriod string for backward compatibility.
  const reportPeriodObj = data.report_period || {};
  const displayPeriod   = reportPeriodObj.display_label
    || data.reportingPeriod
    || exec.reportingPeriod
    || 'User Selected Period';

  // FINDING-010 FIX: Resolve SLA_TARGET from the processed data (set by processData.js).
  // This guarantees the PPT uses the same threshold that was used to determine breaches.
  // eslint-disable-next-line no-global-assign
  SLA_TARGET = parseFloat(slaAn.slaTarget || exec.slaTarget) || SLA_TARGET_FALLBACK;

  // Pre-build site-level index maps
  const siteSwsMap  = {};
  const siteIncsMap = {};
  const siteApsMap  = {};

  TARGET_SITES.forEach((siteKey) => {
    const keyNorm = normalizeSiteName(siteKey);
    siteSwsMap[siteKey] = devices.filter(d =>
      !d.__isStock &&
      !isGenericLocation(d.SiteID || d.Location) &&
      (normalizeSiteName(d.SiteID || d.Location) === keyNorm) &&
      (/^sw$/i.test(d.DeviceType || '') || /switch/i.test(d.DeviceType || ''))
    );
    siteApsMap[siteKey] = devices.filter(d =>
      !d.__isStock &&
      !isGenericLocation(d.SiteID || d.Location) &&
      (normalizeSiteName(d.SiteID || d.Location) === keyNorm) &&
      (/^ap$/i.test(d.DeviceType || '') || /access/i.test(d.DeviceType || ''))
    );
    siteIncsMap[siteKey] = incidents.filter(i => {
      const rawLoc = i.SiteID || i.Location;
      if (isGenericLocation(rawLoc)) return false;
      return normalizeSiteName(rawLoc) === keyNorm;
    });
  });

  // RCA breakdown helper
  const rcaBreakdown = buildRCABreakdown(incidents);

  // Slide 1: Cover
  buildCoverSlide(pres, exec, displayPeriod);

  // Slide 2: Table of Contents
  buildTOCSlide(pres, exec, displayPeriod);

  // Slide 3: Executive Summary
  buildExecSummarySlide(pres, exec, siteSummary, incidents, rcaBreakdown);

  // Slide 4: Overall Network Health
  buildNetworkHealthSlide(pres, exec, siteSummary, incidents);

  // Slide 5: Infrastructure Summary
  buildInfrastructureSlide(pres, exec, siteSummary, displayPeriod);

  // Slide 6: Inventory Summary
  buildInventorySlide(pres, exec, siteSummary, devices);

  // Slide 7: Incident Overview
  buildIncidentOverviewSlide(pres, incidents, siteSummary, exec);

  // Slide 8: RCA Pareto Analysis
  buildRCASlide(pres, rcaBreakdown, incidents, exec);

  // Slide 9: RCA Heatmap
  buildRCAHeatmapSlide(pres, siteSummary, incidents, rcaBreakdown);

  // Slide 10: SLA Dashboard
  buildSLASlide(pres, exec, siteSummary, slaAn);

  // Slide 11: Ticket Analytics
  buildTicketAnalyticsSlide(pres, incidents, siteSummary, exec);

  // Slide 12: Site Health Ranking
  buildSiteRankingSlide(pres, siteSummary, incidents);

  // Slide 13: Risk Assessment
  buildRiskAssessmentSlide(pres, siteSummary, incidents, rcaBreakdown);

  // Dynamic Report Generation based on site operational health (Master Prompt Standard)
  TARGET_SITES.forEach((siteKey, siteIdx) => {
    const siteData = findSite(siteSummary, siteKey);
    const siteSws  = siteSwsMap[siteKey]  || [];
    const siteIncs = siteIncsMap[siteKey] || [];
    const siteAps  = siteApsMap[siteKey]  || [];
    const hScore   = parseFloat(siteData?.healthScore || 100);

    if (options.dynamicSiteSlides !== false) {
      if (hScore >= 95 || siteIncs.length === 0) {
        // Healthy Site (Score >= 95): 1 concise slide
        buildHealthySiteSlide(pres, siteKey, siteData, siteSws, siteAps, siteIdx + 1);
      } else if (hScore >= 85) {
        // Medium Risk Site (85 <= Score < 95): 2 slides
        buildSiteOverviewSlide(pres, siteKey, siteData, siteIncs, siteIdx + 1);
        buildSiteOperationsSlide(pres, siteKey, siteData, siteSws, siteIncs, siteAps, siteIdx + 1);
      } else if (hScore >= 70) {
        // High Risk Site (70 <= Score < 85): 3 slides
        buildSiteOverviewSlide(pres, siteKey, siteData, siteIncs, siteIdx + 1);
        buildSiteOperationsSlide(pres, siteKey, siteData, siteSws, siteIncs, siteAps, siteIdx + 1);
        buildSiteTicketSlide(pres, siteKey, siteData, siteIncs, rcaBreakdown, siteIdx + 1);
      } else {
        // Critical Site (Score < 70): 4 slides
        buildSiteOverviewSlide(pres, siteKey, siteData, siteIncs, siteIdx + 1);
        buildSiteOperationsSlide(pres, siteKey, siteData, siteSws, siteIncs, siteAps, siteIdx + 1);
        buildSiteTicketSlide(pres, siteKey, siteData, siteIncs, rcaBreakdown, siteIdx + 1);
        buildCriticalSiteDeepDiveSlide(pres, siteKey, siteData, siteIncs, rcaBreakdown, siteIdx + 1);
      }
    } else {
      // Fixed 3-slide mode per site
      buildSiteOverviewSlide(pres, siteKey, siteData, siteIncs, siteIdx + 1);
      buildSiteOperationsSlide(pres, siteKey, siteData, siteSws, siteIncs, siteAps, siteIdx + 1);
      buildSiteTicketSlide(pres, siteKey, siteData, siteIncs, rcaBreakdown, siteIdx + 1);
    }
  });

  // Slide 38: AI Recommendations
  buildRecommendationsSlide(pres, exec, siteSummary, incidents, rcaBreakdown);

  // Slide 39: Action Plan
  buildActionPlanSlide(pres, exec, siteSummary, incidents);

  // Appendix Section (Slides 40-44)
  buildAppendixCoverSlide(pres, exec);
  buildAppendixDeviceInventorySlide(pres, devices);
  buildAppendixSwitchInventorySlide(pres, devices);
  buildAppendixAPInventorySlide(pres, devices);
  buildAppendixIncidentRecordsSlide(pres, incidents);

  // Slide 45: Thank You
  buildThankYouSlide(pres, exec);

  await pres.writeFile({ fileName: outputPath });
}

// ─────────────────────────────────────────────────────────────────────────────
// Data Helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildRCABreakdown(incidents) {
  const counts = {};
  incidents.forEach(i => {
    const rca = (i.RCA || 'Unclassified').trim();
    counts[rca] = (counts[rca] || 0) + 1;
  });
  const total = incidents.length || 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([rca, count]) => ({
      rca,
      count,
      pct: ((count / total) * 100).toFixed(1),
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Slide Builders
// ─────────────────────────────────────────────────────────────────────────────

// ── Slide 1: Cover Page ────────────────────────────────────────────────────
// displayPeriod: canonical period string from report_period.display_label (SSOT)
function buildCoverSlide(pres, exec, displayPeriod) {
  _slideNum++;
  const s = pres.addSlide();
  s.background = { color: C.BG_DARK };

  // Gold accent bar top
  s.addShape('rect', { x: 0, y: 0, w: 13.33, h: 0.15, fill: { color: C.ACCENT_GOLD } });

  // Logo
  if (logoBase64) {
    s.addImage({ data: logoBase64, x: 0.65, y: 0.45, w: 2.6, h: 0.82 });
  } else if (fs.existsSync(LOGO_PATH)) {
    s.addImage({ path: LOGO_PATH, x: 0.65, y: 0.45, w: 2.6, h: 0.82 });
  }

  // Left panel
  const panelW = (coverBase64 || fs.existsSync(COVER_PATH)) ? 6.6 : 12.63;
  s.addShape('roundRect', {
    x: 0.65, y: 1.6, w: panelW, h: 4.9,
    fill: { color: C.NAVY_LIGHT }, line: { color: C.BLUE_ACCENT, pt: 1.5 },
    rectRadius: 0.1,
  });

  // Report type: determined by the canonical period string
  const periodForCheck = displayPeriod || exec.reportingPeriod || '';
  const isMonthly = /july|august|september|october|november|december|january|february|march|april|may|june|month/i.test(periodForCheck);
  const reportTitle = isMonthly ? 'Proactive Monthly Business Review' : 'Proactive Quarterly Business Review';

  s.addText(fmt(exec.customerName || 'Jubilant FoodWorks Limited'), {
    x: 0.95, y: 2.0, w: panelW - 0.5, h: 0.75,
    fontSize: 24, bold: true, color: C.TEXT_LIGHT, fontFace: 'Calibri',
  });
  s.addText(reportTitle, {
    x: 0.95, y: 2.85, w: panelW - 0.5, h: 0.55,
    fontSize: 18, bold: true, color: '82B1FF', fontFace: 'Calibri',
  });

  // Divider line
  s.addShape('line', {
    x: 0.95, y: 3.5, w: panelW - 0.6, h: 0,
    line: { color: C.ACCENT_GOLD, pt: 1.5 },
  });

  // Use canonical displayPeriod (report_period.display_label from SSOT)
  s.addText(`Reporting Period: ${fmt(displayPeriod || exec.reportingPeriod || 'User Selected Period')}`, {
    x: 0.95, y: 3.65, w: panelW - 0.5, h: 0.35,
    fontSize: 12, color: 'D0E8FF', fontFace: 'Calibri',
  });
  s.addText('Prepared by: Proactive Data Systems Pvt. Ltd.', {
    x: 0.95, y: 4.1, w: panelW - 0.5, h: 0.3,
    fontSize: 11, color: 'B0BEC5', fontFace: 'Calibri',
  });
  s.addText(`Classification: CONFIDENTIAL`, {
    x: 0.95, y: 4.5, w: panelW - 0.5, h: 0.28,
    fontSize: 10, color: C.AMBER, fontFace: 'Calibri',
  });
  s.addText(`Generated: ${new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}`, {
    x: 0.95, y: 4.9, w: panelW - 0.5, h: 0.28,
    fontSize: 10, color: '78909C', fontFace: 'Calibri',
  });

  // Cover image
  if (coverBase64) {
    s.addImage({ data: coverBase64, x: 7.55, y: 1.6, w: 5.13, h: 4.9 });
  } else if (fs.existsSync(COVER_PATH)) {
    s.addImage({ path: COVER_PATH, x: 7.55, y: 1.6, w: 5.13, h: 4.9 });
  }

  // Gold bottom bar
  s.addShape('rect', { x: 0, y: 7.28, w: 13.33, h: 0.22, fill: { color: C.NAVY_LIGHT } });
  s.addText('www.proactive.co.in  |  Proactive Data Systems Pvt. Ltd.', {
    x: 0, y: 7.3, w: 13.33, h: 0.2,
    fontSize: 8, color: '90A4AE', align: 'center', fontFace: 'Calibri',
  });
}

// ── Slide 2: Table of Contents ─────────────────────────────────────────────
function buildTOCSlide(pres, exec, displayPeriod) {
  _slideNum++;
  const s = pres.addSlide();
  s.background = { color: C.BG_LIGHT };
  addHeader(pres, s, 'TABLE OF CONTENTS', `${exec.customerName || 'JFL'} QBR Report  ·  ${displayPeriod || exec.reportingPeriod || 'Q1 FY2026'}`, _slideNum);

  const sections = [
    { num: '01', title: 'Executive Summary', desc: 'KPIs, overall health, and AI-generated executive narrative', slide: '3' },
    { num: '02', title: 'Infrastructure Overview', desc: 'Network health, device inventory, and per-site infrastructure breakdown', slide: '4–6' },
    { num: '03', title: 'Incident & RCA Analysis', desc: 'Incident trends, root cause Pareto analysis, and site-RCA heatmap', slide: '7–9' },
    { num: '04', title: 'SLA & Ticket Analytics', desc: 'SLA compliance and ticket management summary', slide: '10–11' },
    { num: '05', title: 'Site Health & Risk Assessment', desc: 'Site health ranking and traffic-light risk assessment', slide: '12–13' },
    { num: '06', title: 'Site Reviews (8 Sites)', desc: 'Detailed per-site operational review, analytics, and incident tickets', slide: '14–37' },
    { num: '07', title: 'Recommendations & Action Plan', desc: 'AI-generated recommendations and prioritized action tracker', slide: '38–39' },
    { num: '08', title: 'Appendix & Raw Data Logs', desc: 'Complete device inventories, switch/AP logs, and master incident audit trail', slide: '40–44' },
  ];

  sections.forEach((sec, i) => {
    const y = 1.1 + i * 0.82;
    const bg = i % 2 === 0 ? C.CARD_BG : 'FFFFFF';
    s.addShape('roundRect', {
      x: 0.45, y, w: 12.43, h: 0.72,
      fill: { color: bg }, line: { color: C.CARD_BORDER, pt: 0.75 }, rectRadius: 0.06,
    });
    s.addShape('rect', {
      x: 0.45, y, w: 0.72, h: 0.72,
      fill: { color: C.NAVY },
    });
    s.addText(sec.num, {
      x: 0.45, y: y + 0.18, w: 0.72, h: 0.36,
      fontSize: 14, bold: true, color: C.TEXT_LIGHT, align: 'center', fontFace: 'Calibri',
    });
    s.addText(sec.title, {
      x: 1.3, y: y + 0.08, w: 8.5, h: 0.32,
      fontSize: 12, bold: true, color: C.NAVY, fontFace: 'Calibri',
    });
    s.addText(sec.desc, {
      x: 1.3, y: y + 0.4, w: 8.5, h: 0.24,
      fontSize: 9, color: C.TEXT_MUTED, fontFace: 'Calibri',
    });
    s.addText(`Slide ${sec.slide}`, {
      x: 11.0, y: y + 0.22, w: 1.73, h: 0.28,
      fontSize: 10, bold: true, color: C.BLUE, align: 'right', fontFace: 'Calibri',
    });
  });
}

// ── Slide 3: Executive Summary ─────────────────────────────────────────────
function buildExecSummarySlide(pres, exec, siteSummary, incidents, rcaBreakdown) {
  _slideNum++;
  const s = pres.addSlide();
  s.background = { color: C.BG_LIGHT };
  // Use SLA_TARGET (resolved from SSOT in buildPresentation) — not hardcoded
  addHeader(pres, s, 'EXECUTIVE SUMMARY', `${exec.customerName || 'JFL'}  ·  ${exec.reportingPeriod || 'Q1 FY2026'}  ·  Quarterly Business Review`, _slideNum);

  // 8 KPI cards in 2 rows of 4
  const kpis = [
    { label: 'Total Sites',        value: fmt(exec.totalSites),         color: C.NAVY  },
    { label: 'Active Devices',     value: fmt(exec.totalDevices),        color: C.BLUE  },
    { label: 'Total Switches',     value: fmt(exec.totalSwitches),       color: C.STEEL },
    { label: 'Access Points',      value: fmt(exec.totalAPs),            color: C.TEAL  },
    { label: 'Overall Uptime',     value: pct(exec.overallUptime),       color: parseFloat(exec.overallUptime) >= SLA_TARGET ? C.GREEN : C.RED },
    { label: 'Total Incidents',    value: fmt(exec.totalIncidents || incidents.length), color: C.AMBER },
    { label: 'Incident-Free %',    value: pct(exec.incidentFreePercent), color: C.GREEN },
    { label: 'SLA Compliance',     value: pct(exec.slaCompliance),       color: parseFloat(exec.slaCompliance) >= 99.0 ? C.GREEN : C.RED },
  ];

  const cW = 2.95, cH = 1.2, startX = 0.45, row1Y = 1.05, row2Y = 2.4;
  kpis.forEach((k, i) => {
    const row = i < 4 ? 0 : 1;
    const col = i % 4;
    addKpiCard(s, startX + col * (cW + 0.08), row === 0 ? row1Y : row2Y, cW, cH, k.label, k.value, k.color);
  });

  // AI Narrative
  const narrative = generateExecNarrative(exec, siteSummary, incidents);
  addNarrativeBox(s, 3.7, narrative, 'AI Executive Summary — ' + (exec.reportingPeriod || 'Q1 FY2026'));

  // Top RCA summary bar (right of narrative)
  addSectionDivider(s, 5.35, 'Top Root Cause Analysis Drivers');
  rcaBreakdown.slice(0, 4).forEach((rca, i) => {
    const barW = (parseFloat(rca.pct) / 100) * 8.0;
    const y = 5.78 + i * 0.32;
    s.addText(`${rca.rca}`, {
      x: 0.45, y, w: 3.8, h: 0.28,
      fontSize: 9, color: C.TEXT_DARK, fontFace: 'Calibri',
    });
    s.addShape('rect', { x: 4.35, y: y + 0.04, w: 8.0, h: 0.2, fill: { color: C.DIVIDER } });
    s.addShape('rect', { x: 4.35, y: y + 0.04, w: Math.max(0.1, barW), h: 0.2, fill: { color: C.BLUE_ACCENT } });
    s.addText(`${rca.pct}% (${rca.count})`, {
      x: 12.4, y, w: 0.9, h: 0.28,
      fontSize: 8.5, bold: true, color: C.NAVY, align: 'right', fontFace: 'Calibri',
    });
  });
}

// ── Slide 4: Network Health Overview ──────────────────────────────────────
function buildNetworkHealthSlide(pres, exec, siteSummary, incidents) {
  _slideNum++;
  const s = pres.addSlide();
  s.background = { color: C.BG_LIGHT };
  addHeader(pres, s, 'OVERALL NETWORK HEALTH', 'Infrastructure Health Assessment Across All Monitored Sites', _slideNum);

  // Large health score display
  const healthNum = parseFloat(exec.healthScore) || 100;
  const hColor    = healthColor(healthNum);
  const hLabel    = healthLabel(healthNum);

  s.addShape('roundRect', {
    x: 0.45, y: 1.05, w: 3.5, h: 2.8,
    fill: { color: C.CARD_BG }, line: { color: hColor, pt: 2 }, rectRadius: 0.12,
  });
  s.addText('OVERALL', { x: 0.55, y: 1.2, w: 3.3, h: 0.3, fontSize: 9.5, bold: true, color: C.TEXT_MUTED, align: 'center', fontFace: 'Calibri', charSpacing: 1.5 });
  s.addText('HEALTH SCORE', { x: 0.55, y: 1.52, w: 3.3, h: 0.3, fontSize: 9.5, bold: true, color: C.TEXT_MUTED, align: 'center', fontFace: 'Calibri', charSpacing: 1.5 });
  s.addText(healthNum.toFixed(1), { x: 0.55, y: 1.85, w: 3.3, h: 0.85, fontSize: 46, bold: true, color: hColor, align: 'center', fontFace: 'Calibri' });
  s.addText(hLabel.toUpperCase(), { x: 0.55, y: 2.72, w: 3.3, h: 0.4, fontSize: 14, bold: true, color: hColor, align: 'center', fontFace: 'Calibri', charSpacing: 2 });

  // Per-site health bars
  const validSites = siteSummary.filter(s => {
    const n = String(s.siteId || '').toLowerCase();
    return !['unknown', 'raw', 'sheet1', 'jfl', 'sla_compliance_report'].includes(n) && !n.includes('sla_compliance');
  });

  addSectionDivider(s, 4.0, 'Site Health Scores');
  validSites.slice(0, 8).forEach((site, i) => {
    const score = parseFloat(site.healthScore) || 100;
    const barW  = (score / 100) * 8.5;
    const y     = 4.42 + i * 0.34;
    const col   = healthColor(score);
    s.addText(String(site.siteId).substring(0, 16), { x: 0.45, y, w: 2.5, h: 0.28, fontSize: 9, color: C.TEXT_DARK, fontFace: 'Calibri' });
    s.addShape('rect', { x: 3.05, y: y + 0.04, w: 8.5, h: 0.2, fill: { color: C.DIVIDER } });
    s.addShape('rect', { x: 3.05, y: y + 0.04, w: Math.max(0.1, barW), h: 0.2, fill: { color: col } });
    s.addText(`${score.toFixed(1)}`, { x: 11.65, y, w: 0.8, h: 0.28, fontSize: 8.5, bold: true, color: col, align: 'right', fontFace: 'Calibri' });
    s.addText(healthLabel(score), { x: 12.5, y, w: 0.8, h: 0.28, fontSize: 8.5, color: col, align: 'right', fontFace: 'Calibri' });
  });

  // KPI strip
  const kpis = [
    { label: 'Switch Uptime',    value: pct(exec.overallUptime),         color: C.GREEN },
    { label: 'Incident-Free %',  value: pct(exec.incidentFreePercent),   color: C.GREEN },
    { label: 'SLA Compliance',   value: pct(exec.slaCompliance),         color: parseFloat(exec.slaCompliance) >= 99 ? C.GREEN : C.RED },
    { label: 'Total Incidents',  value: fmt(exec.totalIncidents || incidents.length), color: C.AMBER },
  ];
  kpis.forEach((k, i) => {
    addKpiCard(s, 0.45 + i * 3.25, 1.05 + 3.0, 3.0, 0.9, k.label, k.value, k.color);
  });
}

// ── Slide 5: Infrastructure Summary & Executive Overview ───────────────────
// displayPeriod: canonical period string from report_period.display_label (passed from buildPresentation)
function buildInfrastructureSlide(pres, exec, siteSummary, displayPeriod) {
  _slideNum++;
  const s = pres.addSlide();
  s.background = { color: C.BG_LIGHT };
  addHeader(pres, s, 'EXECUTIVE SUMMARY — ALL SITES', 'Consolidated SLA Performance & RCA Driver Summary Across Monitored Sites', _slideNum);

  const validSites = siteSummary.filter(st => {
    const n = String(st.siteId || '').toLowerCase();
    return !['unknown', 'raw', 'sheet1', 'jfl'].includes(n) && !n.includes('sla_compliance');
  });

  const COL_W = [1.7, 1.3, 1.8, 1.8, 2.2, 1.6, 2.03];
  const W_TOTAL = COL_W.reduce((a, b) => a + b, 0);

  const headers = [
    th('Site', 'left'),
    th('No of devices', 'center'),
    th('Proactive Switch Uptime', 'center'),
    th('JFL Switch Uptime', 'center'),
    th('Primary RCA Driver (Switches)', 'left'),
    th('AP Incidents (Unique)', 'center'),
    th('Primary RCA Driver (AP)', 'left'),
  ];

  const rows = validSites.slice(0, 9).map((site, idx) => {
    const fill   = rowFill(idx);
    // Always use the canonical SSOT fields for uptime (proactiveSwitchUptime / jflSwitchUptime)
    const proUp  = site.proactiveSwitchUptime ? `${site.proactiveSwitchUptime}` : `${site.switchUptime || '100.00'}`;
    const jflUp  = site.jflSwitchUptime       ? `${site.jflSwitchUptime}`       : `${site.switchUptime || '100.00'}`;
    // Use primaryRcaSwitches (canonical) first; fall back to primaryRca for legacy snapshots.
    // 'Stable Operations (No Incidents)' replaces any empty/None/N/A fallback.
    const noIncidentStr = 'Stable Operations (No Incidents)';
    const badVals = ['None', 'Not case received', 'N/A', '', 'Unknown'];
    const swRcaRaw = site.primaryRcaSwitches || site.primaryRca || '';
    const apRcaRaw = site.primaryRcaAPs      || site.primaryRcaForAPs || '';
    const swRca = swRcaRaw && !badVals.includes(swRcaRaw) ? swRcaRaw : noIncidentStr;
    const apRca = apRcaRaw && !badVals.includes(apRcaRaw) ? apRcaRaw : noIncidentStr;
    const apIncStr = `${site.apIncidents ?? 0} / ${site.uniqueAPsWithIncidents ?? 0}`;

    return [
      td(String(site.siteId), fill, { bold: true, color: C.NAVY, align: 'left' }),
      td(fmt(site.deviceCount), fill, { align: 'center', color: C.TEXT_DARK }),
      td(proUp, fill, { align: 'center', bold: true, color: C.BLUE }),
      td(jflUp, fill, { align: 'center', bold: true, color: C.GREEN }),
      td(swRca, fill, { align: 'left', color: C.TEXT_DARK, fontSize: 8.5 }),
      td(apIncStr, fill, { align: 'center', color: C.AMBER, bold: true }),
      td(apRca, fill, { align: 'left', color: C.TEXT_DARK, fontSize: 8.5 }),
    ];
  });

  s.addTable([headers, ...rows], {
    x: 0.45, y: 1.35, w: W_TOTAL,
    colW: COL_W, fontSize: 9, rowH: 0.52,
    border: { type: 'solid', color: C.CARD_BORDER, pt: 0.75 }, fontFace: 'Calibri',
  });

  // Use canonical displayPeriod (report_period.display_label from SSOT)
  // Never use exec.reportingPeriod here — it may contain a stale/hardcoded date string.
  const periodStr = displayPeriod || exec.reportingPeriod || 'User Selected Period';
  s.addText(`This review consolidates SLA performance, rack and switch uptime, and access-point incident RCA for all ${validSites.length} monitored JFL sites for the period ${periodStr}.`, {
    x: 0.45, y: 6.6, w: 12.43, h: 0.4,
    fontSize: 9, italic: true, color: C.TEXT_MUTED, fontFace: 'Calibri',
  });
}

// ── Slide 6: Inventory Summary ─────────────────────────────────────────────
function buildInventorySlide(pres, exec, siteSummary, devices) {
  _slideNum++;
  const s = pres.addSlide();
  s.background = { color: C.BG_LIGHT };
  addHeader(pres, s, 'INVENTORY SUMMARY', 'Active Production Devices vs. Stock Inventory — SLA Exclusion Analysis', _slideNum);

  const activeDevices = devices.filter(d => !d.__isStock);
  const stockDevices  = devices.filter(d => d.__isStock);
  const stockBySite   = {};
  stockDevices.forEach(d => {
    const site = d.SiteID || d.Location || 'Unknown';
    stockBySite[site] = (stockBySite[site] || 0) + 1;
  });

  const kpis = [
    { label: 'Total Devices',     value: fmt(devices.length),       color: C.NAVY  },
    { label: 'Active (In-SLA)',    value: fmt(activeDevices.length), color: C.GREEN },
    { label: 'Stock (Excl. SLA)', value: fmt(stockDevices.length),  color: C.AMBER },
    { label: 'SLA Coverage',      value: `${((activeDevices.length / Math.max(1, devices.length)) * 100).toFixed(1)}%`, color: C.BLUE },
  ];
  kpis.forEach((k, i) => addKpiCard(s, 0.45 + i * 3.22, 1.05, 3.05, 1.15, k.label, k.value, k.color));

  addSectionDivider(s, 2.38, 'Stock Inventory by Site — Excluded from SLA Calculations');

  if (stockDevices.length > 0) {
    const stockEntries = Object.entries(stockBySite).sort((a, b) => b[1] - a[1]);
    const COL_W = [4.5, 2.5, 5.43];
    const headers = [th('Site', 'left'), th('Stock Devices', 'center'), th('Note', 'left')];
    const rows = stockEntries.slice(0, 10).map(([site, count], idx) => {
      const fill = rowFill(idx);
      return [
        td(site, fill, { bold: true, color: C.NAVY, align: 'left' }),
        td(String(count), fill, { align: 'center', bold: true, color: C.AMBER }),
        td('Excluded from SLA calculations per business specification', fill, { color: C.TEXT_MUTED, fontSize: 9 }),
      ];
    });
    s.addTable([headers, ...rows], {
      x: 0.45, y: 2.78, w: 12.43, colW: COL_W,
      fontSize: 9.5, rowH: 0.4, border: { type: 'solid', color: C.CARD_BORDER, pt: 0.75 }, fontFace: 'Calibri',
    });
  } else {
    s.addText('No stock inventory devices registered in this reporting period.', {
      x: 0.45, y: 2.9, w: 12.43, h: 0.4,
      fontSize: 11, color: C.TEXT_MUTED, align: 'center', fontFace: 'Calibri',
    });
  }

  const narrative = [
    `Total monitored device estate: ${devices.length} devices across ${exec.totalSites || 8} sites.`,
    `${activeDevices.length} devices (${((activeDevices.length / Math.max(1, devices.length)) * 100).toFixed(1)}%) are production-active and subject to SLA accountability.`,
    `${stockDevices.length} stock/spare devices are excluded from SLA penalty calculations per operational specification.`,
    stockDevices.length > 0
      ? `Stock devices represent spare/replacement capacity. Utilization should be reviewed quarterly.`
      : `Zero stock device inventory indicates full deployment — procure buffer stock for rapid incident recovery.`,
  ];
  addNarrativeBox(s, 6.6, narrative, 'Inventory Insight');
}

// ── Slide 7: Incident Overview ─────────────────────────────────────────────
function buildIncidentOverviewSlide(pres, incidents, siteSummary, exec) {
  _slideNum++;
  const s = pres.addSlide();
  s.background = { color: C.BG_LIGHT };
  addHeader(pres, s, 'INCIDENT OVERVIEW', 'Total Incident Volume, Site Distribution & Category Breakdown', _slideNum);

  const totalInc = incidents.length;
  const openInc  = incidents.filter(i => !/closed|resolved/i.test(i.Status || '')).length;
  const closedInc = totalInc - openInc;
  const criticalInc = incidents.filter(i => /p1|critical/i.test(i.Priority || '')).length;

  const kpis = [
    { label: 'Total Incidents', value: fmt(totalInc),    color: C.NAVY  },
    { label: 'Open',            value: fmt(openInc),     color: openInc > 0 ? C.AMBER : C.GREEN },
    { label: 'Closed/Resolved', value: fmt(closedInc),   color: C.GREEN },
    { label: 'Critical (P1)',   value: fmt(criticalInc), color: criticalInc > 0 ? C.RED : C.GREEN },
  ];
  kpis.forEach((k, i) => addKpiCard(s, 0.45 + i * 3.22, 1.05, 3.05, 1.05, k.label, k.value, k.color));

  // Incidents by site bar chart
  const incBySite = {};
  TARGET_SITES.forEach(key => { incBySite[key] = 0; });
  incidents.forEach(i => {
    const rawLoc = String(i.SiteID || i.Location || '').trim();
    const isGeneric = !rawLoc || rawLoc.toLowerCase().includes('sla_compliance') || ['raw', 'sheet1', 'jfl', 'unknown'].includes(rawLoc.toLowerCase());
    const site = isGeneric ? null : normSite(rawLoc);
    if (site && incBySite.hasOwnProperty(site)) incBySite[site]++;
  });

  const siteLabels = TARGET_SITES.map(s => s.substring(0, 10));
  const siteVals   = TARGET_SITES.map(s => incBySite[s] || 0);

  addSectionDivider(s, 2.22, 'Incidents by Site');

  s.addChart('bar', [{ name: 'Incidents', labels: siteLabels, values: siteVals }], {
    x: 0.45, y: 2.6, w: 7.5, h: 3.4,
    barDir: 'col',
    chartColors: [C.BLUE_ACCENT],
    dataLabelFontSize: 9,
    dataLabelColor: C.TEXT_DARK,
    showValue: true,
    catAxisLabelFontSize: 9,
    valAxisLabelFontSize: 9,
    valAxisLabelColor: C.TEXT_MUTED,
    catAxisLabelColor: C.TEXT_DARK,
    showLegend: false,
    valGridLine: { style: 'solid', color: C.DIVIDER },
  });

  // Priority breakdown table (right side)
  addSectionDivider(s, 2.22 + 3.59, 'Incidents by Priority');
  const prioCounts = {};
  incidents.forEach(i => {
    const p = (i.Priority || 'Unknown').trim();
    prioCounts[p] = (prioCounts[p] || 0) + 1;
  });
  const prioEntries = Object.entries(prioCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);

  prioEntries.forEach(([prio, count], idx) => {
    const pctVal = ((count / Math.max(1, totalInc)) * 100).toFixed(1);
    const barW   = (count / Math.max(1, totalInc)) * 4.5;
    const y = 6.22 + idx * 0.32;
    s.addText(prio.substring(0, 20), { x: 8.1, y, w: 2.2, h: 0.28, fontSize: 9, color: C.TEXT_DARK, fontFace: 'Calibri' });
    s.addShape('rect', { x: 10.35, y: y + 0.04, w: 4.5, h: 0.2, fill: { color: C.DIVIDER } });
    s.addShape('rect', { x: 10.35, y: y + 0.04, w: Math.max(0.05, barW), h: 0.2, fill: { color: C.AMBER } });
    s.addText(`${pctVal}%`, { x: 12.9, y, w: 0.7, h: 0.28, fontSize: 8.5, bold: true, color: C.AMBER, align: 'right', fontFace: 'Calibri' });
  });

  const maxSite  = Object.entries(incBySite).sort((a, b) => b[1] - a[1])[0];
  const narrative = [
    `${totalInc} total incidents were recorded during the reporting period.`,
    maxSite ? `${maxSite[0]} contributed the highest incident volume with ${maxSite[1]} incidents.` : 'Incident distribution is balanced across all sites.',
    `${closedInc} incidents (${totalInc > 0 ? ((closedInc / totalInc) * 100).toFixed(1) : 100}%) were resolved and closed.`,
    criticalInc > 0 ? `${criticalInc} critical (P1) incidents require executive attention and root cause review.` : 'No critical P1 incidents were recorded — commendable operational performance.',
  ];
  addNarrativeBox(s, 6.08, narrative, 'Incident Overview — Key Findings');
}

// ── Slide 8: RCA Pareto Analysis ───────────────────────────────────────────
function buildRCASlide(pres, rcaBreakdown, incidents, exec) {
  _slideNum++;
  const s = pres.addSlide();
  s.background = { color: C.BG_LIGHT };
  addHeader(pres, s, 'ROOT CAUSE ANALYSIS — PARETO', 'Top Incident Drivers by Frequency & Cumulative Percentage', _slideNum);

  const top8 = rcaBreakdown.slice(0, 8);

  // Horizontal bar chart for RCA
  const rcaLabels = top8.map(r => r.rca.substring(0, 22));
  const rcaVals   = top8.map(r => r.count);

  s.addChart('barH', [{ name: 'Incidents', labels: rcaLabels, values: rcaVals }], {
    x: 0.45, y: 1.05, w: 7.8, h: 4.0,
    barDir: 'bar',
    chartColors: [C.BLUE_ACCENT],
    showValue: true,
    dataLabelFontSize: 9,
    dataLabelColor: C.TEXT_LIGHT,
    catAxisLabelFontSize: 9,
    valAxisLabelFontSize: 9,
    valAxisLabelColor: C.TEXT_MUTED,
    catAxisLabelColor: C.TEXT_DARK,
    showLegend: false,
    valGridLine: { style: 'solid', color: C.DIVIDER },
  });

  // RCA detail table (right)
  addSectionDivider(s, 1.05, 'RCA Frequency Table');
  const COL_W = [3.1, 1.0, 0.85];
  const headers = [th('Root Cause', 'left'), th('Count', 'center'), th('%', 'center')];
  const rows = top8.map((rca, idx) => {
    const fill = rowFill(idx);
    return [
      td(rca.rca.substring(0, 28), fill, { color: C.TEXT_DARK, align: 'left', fontSize: 9 }),
      td(String(rca.count), fill, { align: 'center', bold: true, color: C.BLUE }),
      td(`${rca.pct}%`, fill, { align: 'center', bold: true, color: rca.count === rcaBreakdown[0]?.count ? C.RED : C.TEXT_DARK }),
    ];
  });
  s.addTable([headers, ...rows], {
    x: 8.4, y: 1.45, w: 4.88, colW: COL_W,
    fontSize: 9.5, rowH: 0.38, border: { type: 'solid', color: C.CARD_BORDER, pt: 0.75 }, fontFace: 'Calibri',
  });

  const recs = generateRCARecommendations(rcaBreakdown);
  addSectionDivider(s, 5.22, 'Remediation Recommendations');
  recs.slice(0, 3).forEach((rec, i) => {
    const y = 5.62 + i * 0.42;
    const pColor = rec.priority === 'High' ? C.RED : rec.priority === 'Medium' ? C.AMBER : C.GREEN;
    s.addShape('roundRect', { x: 0.45, y, w: 12.43, h: 0.36, fill: { color: rowFill(i) }, line: { color: C.CARD_BORDER, pt: 0.5 }, rectRadius: 0.04 });
    s.addShape('rect', { x: 0.45, y, w: 0.75, h: 0.36, fill: { color: pColor } });
    s.addText(rec.priority, { x: 0.45, y: y + 0.06, w: 0.75, h: 0.24, fontSize: 8, bold: true, color: 'FFFFFF', align: 'center', fontFace: 'Calibri' });
    s.addText(`${rec.rca}: ${rec.action}`, { x: 1.3, y: y + 0.06, w: 10.1, h: 0.24, fontSize: 8.5, color: C.TEXT_DARK, fontFace: 'Calibri' });
    s.addText(rec.timeline, { x: 11.5, y: y + 0.06, w: 1.33, h: 0.24, fontSize: 8.5, color: C.TEXT_MUTED, align: 'right', fontFace: 'Calibri' });
  });
}

// ── Slide 9: RCA Heatmap ───────────────────────────────────────────────────
function buildRCAHeatmapSlide(pres, siteSummary, incidents, rcaBreakdown) {
  _slideNum++;
  const s = pres.addSlide();
  s.background = { color: C.BG_LIGHT };
  addHeader(pres, s, 'RCA INCIDENT HEATMAP', 'Site vs. Root Cause Category — Incident Frequency Matrix', _slideNum);

  const validSites = siteSummary.filter(st => !isGenericLocation(st.siteId)).slice(0, 8);

  const topRCAs = rcaBreakdown.slice(0, 6).map(r => r.rca);

  // Build heatmap matrix
  const matrix = {};
  validSites.forEach(st => { matrix[st.siteId] = {}; topRCAs.forEach(r => { matrix[st.siteId][r] = 0; }); });
  incidents.forEach(i => {
    const rawLoc = i.SiteID || i.Location;
    if (isGenericLocation(rawLoc)) return;
    const normLoc = normalizeSiteName(rawLoc);
    const matchedSite = validSites.find(st => normalizeSiteName(st.siteId) === normLoc)?.siteId;
    if (matchedSite && matrix[matchedSite] && i.RCA && matrix[matchedSite][i.RCA] !== undefined) {
      matrix[matchedSite][i.RCA]++;
    }
  });

  const maxVal = Math.max(1, ...Object.values(matrix).flatMap(r => Object.values(r)));

  // Draw heatmap grid
  const cellW = 1.85, cellH = 0.52;
  const startX = 2.3, startY = 1.1;

  // RCA column headers
  topRCAs.forEach((rca, ci) => {
    s.addShape('rect', {
      x: startX + ci * cellW, y: startY, w: cellW - 0.05, h: 0.42,
      fill: { color: C.NAVY },
    });
    s.addText(rca.substring(0, 18), {
      x: startX + ci * cellW + 0.05, y: startY + 0.06, w: cellW - 0.12, h: 0.3,
      fontSize: 7.5, bold: true, color: C.TEXT_LIGHT, align: 'center', fontFace: 'Calibri', wrap: true,
    });
  });

  // Site rows + cells
  validSites.forEach((site, ri) => {
    const ry = startY + 0.47 + ri * cellH;

    s.addShape('rect', {
      x: 0.3, y: ry, w: 1.95, h: cellH - 0.04,
      fill: { color: ri % 2 === 0 ? C.CARD_BG : 'FFFFFF' }, line: { color: C.CARD_BORDER, pt: 0.5 },
    });
    s.addText(String(site.siteId).substring(0, 14), {
      x: 0.35, y: ry + 0.12, w: 1.9, h: 0.28,
      fontSize: 9, bold: true, color: C.NAVY, fontFace: 'Calibri',
    });

    topRCAs.forEach((rca, ci) => {
      const count = matrix[site.siteId]?.[rca] || 0;
      const intensity = count / maxVal;
      const cellBg = count === 0 ? 'F5F7FA' :
                     intensity >= 0.8 ? 'B91C1C' :
                     intensity >= 0.5 ? 'DC2626' :
                     intensity >= 0.3 ? 'F59E0B' :
                     intensity >= 0.1 ? 'FDE68A' : 'D1FAE5';
      const textCol = intensity >= 0.5 ? 'FFFFFF' : C.TEXT_DARK;

      s.addShape('rect', {
        x: startX + ci * cellW, y: ry, w: cellW - 0.05, h: cellH - 0.04,
        fill: { color: cellBg }, line: { color: C.CARD_BORDER, pt: 0.5 },
      });
      if (count > 0) {
        s.addText(String(count), {
          x: startX + ci * cellW + 0.05, y: ry + 0.12, w: cellW - 0.12, h: 0.28,
          fontSize: 11, bold: true, color: textCol, align: 'center', fontFace: 'Calibri',
        });
      }
    });
  });

  // Legend
  const legendY = startY + 0.47 + validSites.length * cellH + 0.15;
  s.addText('Intensity:', { x: 0.3, y: legendY, w: 0.9, h: 0.26, fontSize: 8.5, color: C.TEXT_MUTED, fontFace: 'Calibri' });
  const legend = [
    { color: 'D1FAE5', label: 'Low (1-2)' },
    { color: 'FDE68A', label: 'Low-Med' },
    { color: 'F59E0B', label: 'Medium' },
    { color: 'DC2626', label: 'High' },
    { color: 'B91C1C', label: 'Critical' },
  ];
  legend.forEach((l, li) => {
    s.addShape('rect', { x: 1.25 + li * 2.1, y: legendY + 0.03, w: 0.22, h: 0.18, fill: { color: l.color }, line: { color: C.CARD_BORDER, pt: 0.5 } });
    s.addText(l.label, { x: 1.5 + li * 2.1, y: legendY, w: 1.6, h: 0.26, fontSize: 8.5, color: C.TEXT_MUTED, fontFace: 'Calibri' });
  });
}

// ── Slide 10: SLA Dashboard ────────────────────────────────────────────────
function buildSLASlide(pres, exec, siteSummary, slaAn) {
  _slideNum++;
  const s = pres.addSlide();
  s.background = { color: C.BG_LIGHT };
  addHeader(pres, s, 'SLA PERFORMANCE DASHBOARD', `SLA Target: ${SLA_TARGET}%  ·  ${exec.reportingPeriod || 'Q1 FY2026'}`, _slideNum);

  const slaComp = parseFloat(exec.slaCompliance) || 100;
  const slaColor = slaComp >= 99.5 ? C.GREEN : slaComp >= 99.0 ? C.AMBER : C.RED;

  // Large SLA gauge simulation
  s.addShape('roundRect', { x: 0.45, y: 1.05, w: 3.2, h: 2.9, fill: { color: C.CARD_BG }, line: { color: slaColor, pt: 2 }, rectRadius: 0.12 });
  s.addText('SLA COMPLIANCE', { x: 0.55, y: 1.2, w: 3.0, h: 0.3, fontSize: 9, bold: true, color: C.TEXT_MUTED, align: 'center', fontFace: 'Calibri', charSpacing: 1 });
  s.addText(`${slaComp.toFixed(2)}%`, { x: 0.55, y: 1.6, w: 3.0, h: 0.85, fontSize: 38, bold: true, color: slaColor, align: 'center', fontFace: 'Calibri' });
  s.addText(`Target: ${SLA_TARGET}%`, { x: 0.55, y: 2.5, w: 3.0, h: 0.3, fontSize: 10, color: C.TEXT_MUTED, align: 'center', fontFace: 'Calibri' });
  s.addText(slaComp >= SLA_TARGET ? 'SLA MET' : 'SLA BREACH', { x: 0.55, y: 2.85, w: 3.0, h: 0.3, fontSize: 11, bold: true, color: slaColor, align: 'center', fontFace: 'Calibri', charSpacing: 1 });

  // SLA metrics row
  const slaKpis = [
    { label: 'Overall Uptime',    value: pct(exec.overallUptime),       color: C.GREEN },
    { label: 'Incident-Free %',   value: pct(exec.incidentFreePercent), color: C.GREEN },
    { label: 'SLA Target',        value: `${SLA_TARGET}%`,              color: C.NAVY  },
  ];
  slaKpis.forEach((k, i) => addKpiCard(s, 3.85 + i * 3.1, 1.05, 2.95, 1.35, k.label, k.value, k.color));

  // Per-site SLA table
  addSectionDivider(s, 2.55, 'Site-wise SLA Compliance Overview');

  const validSites = siteSummary.filter(st => {
    const n = String(st.siteId || '').toLowerCase();
    return !['unknown', 'raw', 'sheet1', 'jfl'].includes(n) && !n.includes('sla_compliance');
  });

  const COL_W = [2.3, 1.7, 1.9, 1.9, 2.6, 2.03];
  const headers = [
    th('Site', 'left'), th('Devices', 'center'), th('Switch Uptime', 'center'),
    th('Incident-Free %', 'center'), th('Health Score', 'center'), th('SLA Status', 'center'),
  ];
  const rows = validSites.slice(0, 8).map((site, idx) => {
    const fill    = rowFill(idx);
    // Use jflSwitchUptime (canonical JFL uptime metric) for SLA compliance check
    const uptime  = parseFloat(site.jflSwitchUptime || site.switchUptime) || 100;
    const slaOk   = uptime >= SLA_TARGET;
    const incFree = parseFloat(site.incidentFreePercent) || 100;
    const hScore  = parseFloat(site.healthScore) || 100;
    return [
      td(String(site.siteId), fill, { bold: true, color: C.NAVY, align: 'left' }),
      td(fmt(site.deviceCount), fill, { align: 'center' }),
      td(pct(site.jflSwitchUptime || site.switchUptime), fill, { align: 'center', bold: true, color: slaOk ? C.GREEN : C.RED }),
      td(pct(site.incidentFreePercent), fill, { align: 'center', bold: true, color: incFree >= 90 ? C.GREEN : C.AMBER }),
      td(`${hScore.toFixed(1)} (${healthLabel(hScore)})`, fill, { align: 'center', bold: true, color: healthColor(hScore) }),
      td(slaOk ? 'MET' : 'BREACH', fill, { align: 'center', bold: true, color: slaOk ? C.GREEN : C.RED }),
    ];
  });

  s.addTable([headers, ...rows], {
    x: 0.45, y: 2.95, w: 12.43, colW: COL_W,
    fontSize: 9.5, rowH: 0.42, border: { type: 'solid', color: C.CARD_BORDER, pt: 0.75 }, fontFace: 'Calibri',
  });

  const narrative = [
    `Overall SLA compliance: ${slaComp.toFixed(2)}% against a ${SLA_TARGET}% target.`,
    slaComp >= SLA_TARGET ? `All sites are operating within contractual SLA thresholds for the reporting period.` : `SLA compliance is below target. Immediate remediation is recommended.`,
    `Network uptime averaged ${pct(exec.overallUptime)} across all monitored infrastructure.`,
  ];
  addNarrativeBox(s, 6.78, narrative, 'SLA Performance Insight');
}

// ── Slide 11: Ticket Analytics ─────────────────────────────────────────────
function buildTicketAnalyticsSlide(pres, incidents, siteSummary, exec) {
  _slideNum++;
  const s = pres.addSlide();
  s.background = { color: C.BG_LIGHT };
  addHeader(pres, s, 'TICKET ANALYTICS', 'Incident Ticket Volume, Priority Distribution & Resolution Performance', _slideNum);

  const totalTkts  = incidents.length;
  const openTkts   = incidents.filter(i => !/closed|resolved/i.test(i.Status || '')).length;
  const closedTkts = totalTkts - openTkts;
  const p1Tkts     = incidents.filter(i => /p1|critical/i.test(i.Priority || '')).length;
  const p2Tkts     = incidents.filter(i => /p2|major/i.test(i.Priority || '')).length;

  const kpis = [
    { label: 'Total Tickets',   value: fmt(totalTkts),  color: C.NAVY  },
    { label: 'Open',            value: fmt(openTkts),   color: openTkts > 0 ? C.AMBER : C.GREEN },
    { label: 'Closed',          value: fmt(closedTkts), color: C.GREEN },
    { label: 'Critical (P1)',   value: fmt(p1Tkts),     color: p1Tkts > 0 ? C.RED : C.GREEN },
  ];
  kpis.forEach((k, i) => addKpiCard(s, 0.45 + i * 3.22, 1.05, 3.05, 1.05, k.label, k.value, k.color));

  // Top 10 ticket table
  addSectionDivider(s, 2.22, 'Top 10 Incident Tickets by Priority');

  const sortedTickets = [...incidents].sort((a, b) => {
    const pa = String(a.Priority || 'Z').toLowerCase();
    const pb = String(b.Priority || 'Z').toLowerCase();
    if (pa.includes('p1') || pa.includes('critical')) return -1;
    if (pb.includes('p1') || pb.includes('critical')) return 1;
    if (pa.includes('p2')) return -1;
    if (pb.includes('p2')) return 1;
    return 0;
  }).slice(0, 10);

  const COL_W = [2.0, 2.5, 1.8, 1.5, 1.3, 3.33];
  const headers = [
    th('Ticket #', 'left'), th('Device / Host', 'left'), th('Category', 'center'),
    th('Priority', 'center'), th('Status', 'center'), th('Primary RCA', 'left'),
  ];
  const rows = sortedTickets.map((t, idx) => {
    const fill  = rowFill(idx);
    const prio  = String(t.Priority || 'N/A').toUpperCase();
    const isClosed = /closed|resolved/i.test(t.Status || '');
    const prioColor = prio.includes('P1') || prio.includes('CRITICAL') ? C.RED :
                      prio.includes('P2') || prio.includes('MAJOR') ? C.AMBER : C.BLUE;
    return [
      td(t.TicketNumber || t.IncidentNumber || `INC-${idx + 1}`, fill, { color: C.NAVY, fontSize: 8.5, align: 'left' }),
      td(String(t.Hostname || t.DeviceID || 'N/A').substring(0, 22), fill, { color: C.TEXT_DARK, fontSize: 8.5 }),
      td(String(t.Category || 'Operational').substring(0, 18), fill, { align: 'center', color: C.TEXT_MUTED, fontSize: 8.5 }),
      td(prio.substring(0, 12), fill, { align: 'center', bold: true, color: prioColor, fontSize: 8.5 }),
      td(isClosed ? 'Closed' : 'Open', fill, { align: 'center', bold: true, color: isClosed ? C.GREEN : C.AMBER, fontSize: 8.5 }),
      td(String(t.RCA || 'Unknown').substring(0, 32), fill, { color: C.TEXT_MUTED, fontSize: 8.5 }),
    ];
  });

  s.addTable([headers, ...rows], {
    x: 0.45, y: 2.62, w: 12.43, colW: COL_W,
    fontSize: 9, rowH: 0.38, border: { type: 'solid', color: C.CARD_BORDER, pt: 0.75 }, fontFace: 'Calibri',
  });

  const narrative = [
    `${totalTkts} incident tickets were processed during the reporting period.`,
    `Resolution rate: ${totalTkts > 0 ? ((closedTkts / totalTkts) * 100).toFixed(1) : 100}% — ${closedTkts} tickets resolved, ${openTkts} pending closure.`,
    p1Tkts > 0 ? `${p1Tkts} critical priority (P1) tickets require escalated follow-up and executive awareness.` : 'No critical (P1) tickets recorded — excellent incident prioritization.',
  ];
  addNarrativeBox(s, 6.72, narrative, 'Ticket Analytics Insight');
}

// ── Slide 12: Site Health Ranking ─────────────────────────────────────────
function buildSiteRankingSlide(pres, siteSummary, incidents) {
  _slideNum++;
  const s = pres.addSlide();
  s.background = { color: C.BG_LIGHT };
  addHeader(pres, s, 'SITE HEALTH RANKING', 'All Sites Ranked from Healthiest to Most Critical', _slideNum);

  const validSites = siteSummary
    .filter(st => !isGenericLocation(st.siteId))
    .sort((a, b) => parseFloat(b.healthScore || 0) - parseFloat(a.healthScore || 0));

  // Count incidents by site
  const incBySite = {};
  incidents.forEach(i => {
    const rawLoc = i.SiteID || i.Location;
    if (isGenericLocation(rawLoc)) return;
    const site = normalizeSiteName(rawLoc);
    incBySite[site] = (incBySite[site] || 0) + 1;
  });

  const medals = ['1st', '2nd', '3rd'];
  const COL_W = [0.65, 2.2, 1.7, 1.7, 1.7, 2.2, 2.28];
  const headers = [
    th('Rank', 'center'), th('Site', 'left'), th('Health Score', 'center'),
    th('Switch Uptime', 'center'), th('Incident-Free %', 'center'),
    th('Incident Count', 'center'), th('Status', 'center'),
  ];

  const rows = validSites.slice(0, 9).map((site, idx) => {
    const fill     = rowFill(idx);
    const hScore   = parseFloat(site.healthScore) || 100;
    const risk     = riskLevel(hScore);
    const incCount = incBySite[site.siteId] || 0;
    // Use jflSwitchUptime (canonical JFL uptime metric) for SLA threshold comparison
    const siteUptime = parseFloat(site.jflSwitchUptime || site.switchUptime) || 100;
    return [
      td(medals[idx] || `${idx + 1}`, fill, { align: 'center', bold: true, color: idx < 3 ? C.ACCENT_GOLD : C.TEXT_MUTED }),
      td(String(site.siteId), fill, { bold: true, color: C.NAVY, align: 'left' }),
      td(`${hScore.toFixed(1)} / 100`, fill, { align: 'center', bold: true, color: healthColor(hScore) }),
      td(pct(site.jflSwitchUptime || site.switchUptime), fill, { align: 'center', color: siteUptime >= SLA_TARGET ? C.GREEN : C.RED }),
      td(pct(site.incidentFreePercent), fill, { align: 'center', color: parseFloat(site.incidentFreePercent) >= 90 ? C.GREEN : C.AMBER }),
      td(String(incCount), fill, { align: 'center', color: incCount > 50 ? C.RED : incCount > 20 ? C.AMBER : C.TEXT_DARK }),
      td(`${risk.label}  (${healthLabel(hScore)})`, fill, { align: 'center', bold: true, color: risk.color }),
    ];
  });

  s.addTable([headers, ...rows], {
    x: 0.45, y: 1.1, w: 12.43, colW: COL_W,
    fontSize: 9.5, rowH: 0.5, border: { type: 'solid', color: C.CARD_BORDER, pt: 0.75 }, fontFace: 'Calibri',
  });

  const best  = validSites[0];
  const worst = validSites[validSites.length - 1];
  const narrative = [
    best  ? `${best.siteId} leads the network with the highest health score of ${best.healthScore} — strong operational performance.` : '',
    worst ? `${worst.siteId} reported the lowest health score of ${worst.healthScore} and requires priority intervention.` : '',
    `${validSites.filter(s => parseFloat(s.healthScore) >= 90).length} out of ${validSites.length} sites are in excellent or good health.`,
  ].filter(Boolean);
  addNarrativeBox(s, 6.2, narrative, 'Site Health Ranking — Key Findings');
}

// ── Slide 13: Risk Assessment ─────────────────────────────────────────────
function buildRiskAssessmentSlide(pres, siteSummary, incidents, rcaBreakdown) {
  _slideNum++;
  const s = pres.addSlide();
  s.background = { color: C.BG_LIGHT };
  addHeader(pres, s, 'RISK ASSESSMENT', 'Site-Level Risk Classification with Prioritized Remediation Recommendations', _slideNum);

  const topRca = rcaBreakdown[0]?.rca || 'N/A';

  const validSites = siteSummary
    .filter(st => !isGenericLocation(st.siteId))
    .sort((a, b) => parseFloat(a.healthScore || 100) - parseFloat(b.healthScore || 100));

  const incBySiteRca = {};
  incidents.forEach(i => {
    const rawLoc = i.SiteID || i.Location;
    if (isGenericLocation(rawLoc)) return;
    const site = normalizeSiteName(rawLoc);
    const rca  = i.RCA || 'Unknown';
    if (!incBySiteRca[site]) incBySiteRca[site] = {};
    incBySiteRca[site][rca] = (incBySiteRca[site][rca] || 0) + 1;
  });

  const COL_W = [2.0, 1.5, 1.4, 2.5, 5.03];
  const headers = [
    th('Site', 'left'), th('Health Score', 'center'),
    th('Risk Level', 'center'), th('Top RCA', 'left'), th('Recommendation', 'left'),
  ];

  const rows = validSites.slice(0, 8).map((site, idx) => {
    const fill   = rowFill(idx);
    const hScore = parseFloat(site.healthScore) || 100;
    const risk   = riskLevel(hScore);
    const siteRcas = incBySiteRca[site.siteId] || {};
    const siteTopRca = Object.entries(siteRcas).sort((a, b) => b[1] - a[1])[0]?.[0] || site.primaryRca || 'None';

    let rec = 'Continue standard monitoring. No immediate action required.';
    if (risk.label === 'HIGH')     rec = `URGENT: Escalate ${siteTopRca} failures. Deploy incident response team within 48 hours.`;
    else if (risk.label === 'ELEVATED') rec = `PRIORITY: Investigate ${siteTopRca} incidents. Schedule site visit within 2 weeks.`;
    else if (risk.label === 'MODERATE') rec = `MONITOR: Review ${siteTopRca} trends. Consider preventive maintenance scheduling.`;

    return [
      td(String(site.siteId), fill, { bold: true, color: C.NAVY, align: 'left' }),
      td(`${hScore.toFixed(1)} / 100`, fill, { align: 'center', bold: true, color: healthColor(hScore) }),
      td(risk.label, fill, { align: 'center', bold: true, color: risk.color }),
      td(String(siteTopRca).substring(0, 22), fill, { color: C.TEXT_MUTED, fontSize: 9 }),
      td(rec.substring(0, 72), fill, { color: C.TEXT_DARK, fontSize: 8.5 }),
    ];
  });

  s.addTable([headers, ...rows], {
    x: 0.45, y: 1.1, w: 12.43, colW: COL_W,
    fontSize: 9.5, rowH: 0.52, border: { type: 'solid', color: C.CARD_BORDER, pt: 0.75 }, fontFace: 'Calibri',
  });

  // Risk legend
  const legendItems = [
    { label: 'LOW (Score >= 95)',      color: C.GREEN },
    { label: 'MODERATE (85-94)',       color: C.BLUE  },
    { label: 'ELEVATED (70-84)',       color: C.AMBER },
    { label: 'HIGH (Score < 70)',      color: C.RED   },
  ];
  legendItems.forEach((l, li) => {
    s.addShape('rect', { x: 0.45 + li * 3.2, y: 6.25, w: 0.22, h: 0.18, fill: { color: l.color } });
    s.addText(l.label, { x: 0.72 + li * 3.2, y: 6.22, w: 2.85, h: 0.25, fontSize: 8.5, color: C.TEXT_MUTED, fontFace: 'Calibri' });
  });

  const highRisk = validSites.filter(st => parseFloat(st.healthScore) < 70).length;
  const narrative = [
    `${highRisk > 0 ? highRisk + ' site(s) require immediate high-risk remediation.' : 'No sites are currently in high-risk condition — commendable network stability.'}`,
    `Primary systemic risk driver across the estate: ${topRca}.`,
    'Proactive intervention at elevated-risk sites will prevent escalation to high-risk status.',
  ];
  addNarrativeBox(s, 6.5, narrative, 'Risk Assessment — Executive Summary');
}

// ── Site Slides A, B, C ────────────────────────────────────────────────────

function buildSiteOverviewSlide(pres, siteKey, site, siteIncs, siteNum) {
  _slideNum++;
  const s = pres.addSlide();
  s.background = { color: C.BG_LIGHT };
  addHeader(pres, s,
    `${site.siteId || siteKey}  —  SITE OVERVIEW`,
    `Site Review ${siteNum} of 8  ·  Operational KPIs, Health Assessment & AI Insights`,
    _slideNum
  );

  // Use jflSwitchUptime (canonical SSOT field) for SLA compliance comparisons
  const siteJflUptime = parseFloat(site.jflSwitchUptime || site.switchUptime) || 100;
  const kpis = [
    { label: 'Active Devices', value: fmt(site.deviceCount),                                         color: C.NAVY  },
    { label: 'Switches',       value: fmt(site.switchCount),                                          color: C.BLUE  },
    { label: 'Access Points',  value: fmt(site.apCount),                                              color: C.STEEL },
    { label: 'JFL Uptime',     value: pct(site.jflSwitchUptime || site.switchUptime),                 color: siteJflUptime >= SLA_TARGET ? C.GREEN : C.RED },
    { label: 'Incident-Free %',value: pct(site.incidentFreePercent),                                  color: parseFloat(site.incidentFreePercent) >= 90 ? C.GREEN : C.AMBER },
    { label: 'Health Score',   value: `${fmt(site.healthScore)} (${healthLabel(site.healthScore)})`, color: healthColor(site.healthScore) },
    { label: 'SLA Status',     value: siteJflUptime >= SLA_TARGET ? 'MET' : 'BREACH',                 color: siteJflUptime >= SLA_TARGET ? C.GREEN : C.RED },
    { label: 'Total Incidents',value: fmt(siteIncs.length),                                           color: siteIncs.length > 0 ? C.AMBER : C.GREEN },
  ];

  kpis.forEach((k, i) => {
    const row = i < 4 ? 0 : 1;
    const col = i % 4;
    addKpiCard(s, 0.45 + col * 3.22, row === 0 ? 1.05 : 2.32, 3.05, 1.1, k.label, k.value, k.color);
  });

  const { highlights, risks } = generateSiteInsights(siteKey, site, siteIncs);

  // Highlights (Left 45% column)
  addSectionDivider(s, 3.55, 'Key Highlights');
  highlights.slice(0, 3).forEach((h, i) => {
    s.addShape('roundRect', { x: 0.45, y: 3.95 + i * 0.44, w: 5.6, h: 0.38, fill: { color: C.GREEN_LIGHT }, line: { color: C.GREEN, pt: 0.5 }, rectRadius: 0.05 });
    s.addShape('rect', { x: 0.45, y: 3.95 + i * 0.44, w: 0.08, h: 0.38, fill: { color: C.GREEN } });
    s.addText(h, { x: 0.65, y: 3.98 + i * 0.44, w: 5.3, h: 0.32, fontSize: 10, color: '14532D', fontFace: C.FONT_PRIMARY, margin: [5, 5, 5, 5] });
  });

  // Risks (Right 55% column)
  addSectionDivider(s, 3.55, '');
  s.addShape('rect', { x: 6.35, y: 3.55, w: 6.53, h: 0.32, fill: { color: C.RED } });
  s.addText('KEY RISKS', { x: 6.45, y: 3.59, w: 6.3, h: 0.24, fontSize: 18, bold: true, color: C.TEXT_LIGHT, fontFace: C.FONT_PRIMARY, charSpacing: 1.2 });

  risks.slice(0, 3).forEach((r, i) => {
    s.addShape('roundRect', { x: 6.35, y: 3.95 + i * 0.44, w: 6.53, h: 0.38, fill: { color: C.RED_LIGHT }, line: { color: C.RED, pt: 0.5 }, rectRadius: 0.05 });
    s.addShape('rect', { x: 6.35, y: 3.95 + i * 0.44, w: 0.08, h: 0.38, fill: { color: C.RED } });
    s.addText(r, { x: 6.55, y: 3.98 + i * 0.44, w: 6.25, h: 0.32, fontSize: 10, color: '7F1D1D', fontFace: C.FONT_PRIMARY, margin: [5, 5, 5, 5] });
  });

  // AI Site Summary — use primaryRcaSwitches (SSOT canonical) first
  const topRca = site.primaryRcaSwitches || site.primaryRca || 'None';
  const aiSummary = [
    `${site.siteId || siteKey} operates ${fmt(site.deviceCount)} active devices (${fmt(site.switchCount)} switches, ${fmt(site.apCount)} APs) in the current reporting period.`,
    `JFL Switch Uptime: ${pct(site.jflSwitchUptime || site.switchUptime)} — ${siteJflUptime >= SLA_TARGET ? 'within' : 'below'} the ${SLA_TARGET}% SLA threshold.`,
    siteIncs.length > 0 ? `${siteIncs.length} incidents recorded; primary root cause: ${topRca}.` : `Zero incidents recorded — full operational SLA compliance maintained.`,
  ];
  addNarrativeBox(s, 5.2, aiSummary, `AI Site Summary — ${site.siteId || siteKey}`);
}

function buildSiteOperationsSlide(pres, siteKey, site, siteSws, siteIncs, siteAps, siteNum) {
  _slideNum++;
  const s = pres.addSlide();
  s.background = { color: C.BG_LIGHT };
  addHeader(pres, s,
    `${site.siteId || siteKey}  —  OPERATIONAL ANALYTICS`,
    `Site Review ${siteNum} of 8  ·  Switch Uptime, AP Distribution & Incident Analysis`,
    _slideNum
  );

  const at100 = siteSws.filter(sw => (sw.__effectiveUptime ?? 100) >= 100).length;
  const swUp  = parseFloat(site.jflSwitchUptime || site.switchUptime || site.overallUptime || '100.00');

  const kpis = [
    { label: 'Avg Switch Uptime', value: `${swUp.toFixed(2)}%`, color: swUp >= SLA_TARGET ? C.GREEN : C.RED },
    { label: 'Switches @ 100%',   value: fmt(at100),             color: C.TEAL  },
    { label: 'Total APs',         value: fmt(siteAps.length),    color: C.STEEL },
    { label: 'Total Incidents',   value: fmt(siteIncs.length),   color: siteIncs.length > 0 ? C.AMBER : C.GREEN },
  ];
  kpis.forEach((k, i) => addKpiCard(s, 0.45 + i * 3.22, 1.05, 3.05, 1.0, k.label, k.value, k.color));

  // Switch uptime table (top 12)
  addSectionDivider(s, 2.18, 'Switch Uptime Report (Top 12)');
  const SW_COL_W = [0.8, 3.3, 2.8, 1.6, 2.45, 1.48];
  const swHeaders = [
    th('#', 'center'), th('Hostname', 'left'), th('Serial No.', 'left'),
    th('Rack', 'center'), th('Uptime %', 'center'), th('Status', 'center'),
  ];
  const swRows = siteSws.slice(0, 12).map((sw, rIdx) => {
    const rawUp  = sw.__effectiveUptime !== undefined ? sw.__effectiveUptime : 100;
    const upStr  = `${parseFloat(rawUp).toFixed(2)}%`;
    const fill   = rowFill(rIdx);
    const slaOk  = parseFloat(rawUp) >= SLA_TARGET;
    return [
      td(String(rIdx + 1), fill, { align: 'center', color: C.TEXT_MUTED }),
      td(sw.Hostname || sw.DeviceID || 'N/A', fill, { bold: true, color: C.TEXT_DARK }),
      td(sw.DeviceID || sw.SerialNo || 'N/A', fill, { color: C.TEXT_MUTED, fontSize: 9 }),
      td(sw.Rack || 'N/A', fill, { align: 'center', color: C.TEXT_DARK }),
      td(upStr, fill, { bold: true, color: uptimeColor(rawUp), align: 'center' }),
      td(slaOk ? 'OK' : 'BREACH', fill, { bold: true, align: 'center', color: slaOk ? C.GREEN : C.RED }),
    ];
  });
  const fallbackSw = [[
    td('—', 'FFFFFF', { align: 'center' }), td('No switches registered', 'FFFFFF', {}),
    td('N/A', 'FFFFFF', {}), td('N/A', 'FFFFFF', { align: 'center' }),
    td('100.00%', 'FFFFFF', { align: 'center', color: C.GREEN }), td('OK', 'FFFFFF', { align: 'center', color: C.GREEN }),
  ]];
  s.addTable([swHeaders, ...(swRows.length > 0 ? swRows : fallbackSw)], {
    x: 0.45, y: 2.58, w: 12.43, colW: SW_COL_W,
    fontSize: 9, rowH: 0.36, border: { type: 'solid', color: C.CARD_BORDER, pt: 0.75 }, fontFace: 'Calibri',
  });

  // RCA breakdown at bottom
  const rcaCounts = {};
  siteIncs.forEach(i => { const r = i.RCA || 'Unknown'; rcaCounts[r] = (rcaCounts[r] || 0) + 1; });
  const siteRcas = Object.entries(rcaCounts).sort((a, b) => b[1] - a[1]).slice(0, 4);

  addSectionDivider(s, 6.8, 'Site RCA Distribution');
  siteRcas.forEach((rca, i) => {
    const pctVal = siteIncs.length > 0 ? ((rca[1] / siteIncs.length) * 100).toFixed(1) : '0';
    const barW   = (rca[1] / Math.max(1, siteIncs.length)) * 4.5;
    const y = 7.15;
    if (i < 4) {
      s.addText(`${rca[0].substring(0, 18)}: ${rca[1]} (${pctVal}%)`, {
        x: 0.45 + i * 3.22, y: 7.16, w: 3.05, h: 0.22,
        fontSize: 8, color: C.TEXT_DARK, fontFace: 'Calibri',
      });
    }
  });
}

function buildSiteTicketSlide(pres, siteKey, site, siteIncs, rcaBreakdown, siteNum) {
  _slideNum++;
  const s = pres.addSlide();
  s.background = { color: C.BG_LIGHT };
  addHeader(pres, s,
    `${site.siteId || siteKey}  —  INCIDENT & TICKET REVIEW`,
    `Site Review ${siteNum} of 8  ·  Top 10 Tickets, RCA Summary & Recommended Actions`,
    _slideNum
  );

  const totalTkts  = siteIncs.length;
  const openTkts   = siteIncs.filter(i => !/closed|resolved/i.test(i.Status || '')).length;
  const closedTkts = totalTkts - openTkts;
  const p1Tkts     = siteIncs.filter(i => /p1|critical/i.test(i.Priority || '')).length;

  // KPI row
  const kpis = [
    { label: 'Total Tickets',  value: fmt(totalTkts),  color: C.NAVY  },
    { label: 'Open',           value: fmt(openTkts),   color: openTkts > 0 ? C.AMBER : C.GREEN },
    { label: 'Closed',         value: fmt(closedTkts), color: C.GREEN },
    { label: 'Critical (P1)',  value: fmt(p1Tkts),     color: p1Tkts > 0 ? C.RED : C.GREEN },
  ];
  kpis.forEach((k, i) => addKpiCard(s, 0.45 + i * 3.22, 1.05, 3.05, 1.0, k.label, k.value, k.color));

  if (totalTkts === 0) {
    s.addShape('roundRect', {
      x: 0.45, y: 2.2, w: 12.43, h: 1.2,
      fill: { color: C.GREEN_LIGHT }, line: { color: C.GREEN, pt: 1.5 }, rectRadius: 0.1,
    });
    s.addText('ZERO INCIDENTS RECORDED', { x: 0.55, y: 2.35, w: 12.23, h: 0.5, fontSize: 20, bold: true, color: C.GREEN, align: 'center', fontFace: 'Calibri' });
    s.addText(`${site.siteId || siteKey} achieved 100% SLA compliance with no incidents during this reporting period.`, {
      x: 0.55, y: 2.88, w: 12.23, h: 0.4, fontSize: 11, color: '14532D', align: 'center', fontFace: 'Calibri',
    });
    return;
  }

  // Top 10 tickets table
  addSectionDivider(s, 2.18, `Top 10 Incident Tickets — ${site.siteId || siteKey}`);

  const sortedTickets = [...siteIncs].sort((a, b) => {
    const pa = String(a.Priority || 'Z').toLowerCase();
    const pb = String(b.Priority || 'Z').toLowerCase();
    if (pa.includes('p1') || pa.includes('critical')) return -1;
    if (pb.includes('p1') || pb.includes('critical')) return 1;
    return 0;
  }).slice(0, 10);

  const COL_W = [1.8, 2.8, 1.6, 1.2, 1.2, 3.83];
  const headers = [
    th('Ticket #', 'left'), th('Device / Host', 'left'), th('Category', 'center'),
    th('Priority', 'center'), th('Status', 'center'), th('Primary RCA', 'left'),
  ];
  const rows = sortedTickets.map((t, idx) => {
    const fill     = rowFill(idx);
    const prio     = String(t.Priority || 'N/A').toUpperCase();
    const isClosed = /closed|resolved/i.test(t.Status || '');
    const prioColor = prio.includes('P1') || prio.includes('CRITICAL') ? C.RED :
                      prio.includes('P2') || prio.includes('MAJOR') ? C.AMBER : C.BLUE;
    return [
      td(t.TicketNumber || t.IncidentNumber || `INC-${idx + 1}`, fill, { color: C.NAVY, fontSize: 8.5 }),
      td(String(t.Hostname || t.DeviceID || 'N/A').substring(0, 24), fill, { color: C.TEXT_DARK, fontSize: 8.5 }),
      td(String(t.Category || 'Operational').substring(0, 16), fill, { align: 'center', color: C.TEXT_MUTED, fontSize: 8.5 }),
      td(prio.substring(0, 10), fill, { align: 'center', bold: true, color: prioColor, fontSize: 8.5 }),
      td(isClosed ? 'Closed' : 'Open', fill, { align: 'center', bold: true, color: isClosed ? C.GREEN : C.AMBER, fontSize: 8.5 }),
      td(String(t.RCA || 'Unknown').substring(0, 35), fill, { color: C.TEXT_MUTED, fontSize: 8.5 }),
    ];
  });

  s.addTable([headers, ...rows], {
    x: 0.45, y: 2.58, w: 12.43, colW: COL_W,
    fontSize: 9, rowH: 0.36, border: { type: 'solid', color: C.CARD_BORDER, pt: 0.75 }, fontFace: 'Calibri',
  });

  // Recommended actions
  const siteRecs = generateRCARecommendations(buildRCABreakdown(siteIncs));
  addSectionDivider(s, 6.3, 'Recommended Actions');
  siteRecs.slice(0, 2).forEach((rec, i) => {
    const y = 6.68 + i * 0.34;
    const pColor = rec.priority === 'High' ? C.RED : rec.priority === 'Medium' ? C.AMBER : C.GREEN;
    s.addShape('roundRect', { x: 0.45, y, w: 12.43, h: 0.28, fill: { color: rowFill(i) }, line: { color: C.CARD_BORDER, pt: 0.5 }, rectRadius: 0.04 });
    s.addShape('rect', { x: 0.45, y, w: 0.65, h: 0.28, fill: { color: pColor } });
    s.addText(rec.priority, { x: 0.45, y: y + 0.04, w: 0.65, h: 0.2, fontSize: 7.5, bold: true, color: 'FFFFFF', align: 'center', fontFace: 'Calibri' });
    s.addText(`${rec.action}  [Timeline: ${rec.timeline}]`, { x: 1.2, y: y + 0.04, w: 11.6, h: 0.2, fontSize: 8.5, color: C.TEXT_DARK, fontFace: 'Calibri' });
  });
}

function buildHealthySiteSlide(pres, siteKey, site, siteSws, siteAps, siteNum) {
  _slideNum++;
  const s = pres.addSlide();
  s.background = { color: C.BG_LIGHT };
  addHeader(pres, s,
    `${site.siteId || siteKey}  —  HEALTHY SITE REVIEW`,
    `Site Review ${siteNum} of 8  ·  Operational Excellence & 100% SLA Compliance`,
    _slideNum
  );

  const kpis = [
    { label: 'Active Devices', value: fmt(site.deviceCount),            color: C.NAVY  },
    { label: 'Switches / APs', value: `${fmt(site.switchCount)} / ${fmt(site.apCount)}`, color: C.BLUE },
    { label: 'Switch Uptime',  value: pct(site.switchUptime),           color: C.GREEN },
    { label: 'Incident-Free %',value: pct(site.incidentFreePercent),    color: C.GREEN },
    { label: 'Health Score',   value: `${fmt(site.healthScore)} (Excellent)`, color: C.GREEN },
    { label: 'SLA Compliance', value: '100.00%',                        color: C.GREEN },
  ];
  kpis.forEach((k, i) => {
    const row = i < 3 ? 0 : 1;
    const col = i % 3;
    addKpiCard(s, 0.45 + col * 4.28, row === 0 ? 1.05 : 2.32, 4.05, 1.1, k.label, k.value, k.color);
  });

  addSectionDivider(s, 3.55, 'Operational Excellence Highlights');
  const highlights = [
    `Maintained 100.00% operational SLA compliance throughout the reporting period.`,
    `Zero high-priority incident tickets recorded for active production infrastructure.`,
    `All ${fmt(site.switchCount)} switches and ${fmt(site.apCount)} access points operated without SLA breaches.`,
  ];
  highlights.forEach((h, i) => {
    s.addShape('roundRect', { x: 0.45, y: 3.95 + i * 0.45, w: 12.43, h: 0.38, fill: { color: C.GREEN_LIGHT }, line: { color: C.GREEN, pt: 0.5 }, rectRadius: 0.04 });
    s.addShape('rect', { x: 0.45, y: 3.95 + i * 0.45, w: 0.08, h: 0.38, fill: { color: C.GREEN } });
    s.addText(h, { x: 0.65, y: 3.98 + i * 0.45, w: 12.0, h: 0.3, fontSize: 9, color: '14532D', fontFace: 'Calibri' });
  });

  const aiSummary = [
    `${site.siteId || siteKey} is a top-performing healthy site with an operational health score of ${fmt(site.healthScore)}.`,
    `Infrastructure stability is high across all registered devices. No remediation action required for the upcoming reporting cycle.`,
  ];
  addNarrativeBox(s, 5.5, aiSummary, `Executive Summary — ${site.siteId || siteKey}`);
}

function buildCriticalSiteDeepDiveSlide(pres, siteKey, site, siteIncs, rcaBreakdown, siteNum) {
  _slideNum++;
  const s = pres.addSlide();
  s.background = { color: C.BG_LIGHT };
  addHeader(pres, s,
    `${site.siteId || siteKey}  —  CRITICAL SITE DEEP DIVE`,
    `Site Review ${siteNum} of 8  ·  Root Cause Timeline & Escalation Remediation Plan`,
    _slideNum
  );

  const totalIncs = siteIncs.length;
  const p1Incs    = siteIncs.filter(i => /p1|critical/i.test(i.Priority || '')).length;
  const openIncs  = siteIncs.filter(i => !/closed|resolved/i.test(i.Status || '')).length;

  const kpis = [
    { label: 'Health Score',   value: `${fmt(site.healthScore)} (Critical)`, color: C.RED },
    { label: 'Critical (P1)',  value: fmt(p1Incs),                           color: p1Incs > 0 ? C.RED : C.AMBER },
    { label: 'Open Incidents', value: fmt(openIncs),                         color: openIncs > 0 ? C.RED : C.GREEN },
    { label: 'Primary RCA',    value: String(site.primaryRca || 'Multiple Drivers').substring(0, 20), color: C.RED },
  ];
  kpis.forEach((k, i) => addKpiCard(s, 0.45 + i * 3.22, 1.05, 3.05, 1.0, k.label, k.value, k.color));

  addSectionDivider(s, 2.2, 'Systemic Root Cause Analysis & Operational Impact');
  const criticalInsights = [
    `Health Score degraded to ${fmt(site.healthScore)} due to repeated incident occurrences.`,
    `Primary failure driver: ${site.primaryRca || 'Infrastructure Power / Hardware Outages'}.`,
    `Requires immediate technical escalation and on-site engineering dispatch within 24 hours.`,
  ];
  criticalInsights.forEach((insight, i) => {
    s.addShape('roundRect', { x: 0.45, y: 2.6 + i * 0.45, w: 12.43, h: 0.38, fill: { color: C.RED_LIGHT }, line: { color: C.RED, pt: 0.75 }, rectRadius: 0.04 });
    s.addShape('rect', { x: 0.45, y: 2.6 + i * 0.45, w: 0.08, h: 0.38, fill: { color: C.RED } });
    s.addText(insight, { x: 0.65, y: 2.63 + i * 0.45, w: 12.0, h: 0.3, fontSize: 9, color: '7F1D1D', fontFace: 'Calibri' });
  });

  const deepActionPlan = [
    `1. Dispatch Senior Network Field Engineer to ${site.siteId || siteKey} for physical infrastructure audit.`,
    `2. Perform comprehensive power stability & UPS check to mitigate recurring power outage risks.`,
    `3. Replace faulty core/access switches showing repeated SLA breaches and log RMA ticket.`,
  ];
  addNarrativeBox(s, 4.2, deepActionPlan, `Emergency Action Plan — ${site.siteId || siteKey}`);
}

// ── Slide 38: Recommendations ─────────────────────────────────────────────
function buildRecommendationsSlide(pres, exec, siteSummary, incidents, rcaBreakdown) {
  _slideNum++;
  const s = pres.addSlide();
  s.background = { color: C.BG_LIGHT };
  addHeader(pres, s, 'AI-GENERATED RECOMMENDATIONS', 'Priority-Based Remediation Plan Generated from Incident & Health Analytics', _slideNum);

  const recs = generateRCARecommendations(rcaBreakdown);
  const sorted = [...siteSummary].sort((a, b) => parseFloat(a.healthScore || 100) - parseFloat(b.healthScore || 100));
  const worstSites = sorted.slice(0, 3).filter(st => parseFloat(st.healthScore) < 92);

  // High priority section
  addSectionDivider(s, 1.05, 'High Priority — Immediate Action Required (0-30 Days)');
  const highRecs = [
    ...worstSites.map(st => ({
      priority: 'High',
      action: `Address health degradation at ${st.siteId} (Score: ${st.healthScore}). Conduct on-site audit and deploy rapid response team.`,
    })),
    ...recs.filter(r => r.priority === 'High').slice(0, 2 - Math.min(2, worstSites.length)).map(r => ({ priority: 'High', action: r.action })),
  ].slice(0, 3);

  highRecs.forEach((r, i) => {
    const y = 1.42 + i * 0.48;
    s.addShape('roundRect', { x: 0.45, y, w: 12.43, h: 0.42, fill: { color: C.RED_LIGHT }, line: { color: C.RED, pt: 0.75 }, rectRadius: 0.05 });
    s.addShape('rect', { x: 0.45, y, w: 0.6, h: 0.42, fill: { color: C.RED } });
    s.addText('HIGH', { x: 0.45, y: y + 0.1, w: 0.6, h: 0.22, fontSize: 7, bold: true, color: 'FFFFFF', align: 'center', fontFace: 'Calibri' });
    s.addText(r.action.substring(0, 100), { x: 1.15, y: y + 0.08, w: 11.6, h: 0.28, fontSize: 8.5, color: '7F1D1D', fontFace: 'Calibri' });
  });

  addSectionDivider(s, 3.0, 'Medium Priority — Action Required (30-60 Days)');
  const medRecs = recs.filter(r => r.priority === 'Medium').slice(0, 3);
  if (medRecs.length === 0) {
    medRecs.push({ action: 'Quarterly firmware update across all network switches and access points.' });
    medRecs.push({ action: 'Review AP placement at sites with elevated incident rates.' });
  }
  medRecs.slice(0, 3).forEach((r, i) => {
    const y = 3.38 + i * 0.44;
    s.addShape('roundRect', { x: 0.45, y, w: 12.43, h: 0.38, fill: { color: C.AMBER_LIGHT }, line: { color: C.AMBER, pt: 0.75 }, rectRadius: 0.05 });
    s.addShape('rect', { x: 0.45, y, w: 0.65, h: 0.38, fill: { color: C.AMBER } });
    s.addText('MED', { x: 0.45, y: y + 0.08, w: 0.65, h: 0.22, fontSize: 7, bold: true, color: 'FFFFFF', align: 'center', fontFace: 'Calibri' });
    s.addText((r.action || '').substring(0, 105), { x: 1.2, y: y + 0.06, w: 11.6, h: 0.28, fontSize: 8.5, color: '92400E', fontFace: 'Calibri' });
  });

  addSectionDivider(s, 4.75, 'Low Priority — Standard Practice (60-90 Days)');
  const lowRecs = [
    { action: 'Update network topology documentation for all 8 sites including current device serial inventories.' },
    { action: 'Conduct quarterly stakeholder review meetings with JFL IT leadership to align on operational priorities.' },
    { action: 'Evaluate proactive monitoring alert threshold tuning to reduce noise and improve incident detection accuracy.' },
  ];
  lowRecs.forEach((r, i) => {
    const y = 5.12 + i * 0.4;
    s.addShape('roundRect', { x: 0.45, y, w: 12.43, h: 0.34, fill: { color: C.BLUE_LIGHT }, line: { color: C.BLUE, pt: 0.5 }, rectRadius: 0.04 });
    s.addShape('rect', { x: 0.45, y, w: 0.6, h: 0.34, fill: { color: C.BLUE } });
    s.addText('LOW', { x: 0.45, y: y + 0.06, w: 0.6, h: 0.22, fontSize: 7, bold: true, color: 'FFFFFF', align: 'center', fontFace: 'Calibri' });
    s.addText(r.action.substring(0, 105), { x: 1.15, y: y + 0.05, w: 11.6, h: 0.24, fontSize: 8.5, color: C.TEXT_MID, fontFace: 'Calibri' });
  });
}

// ── Slide 39: Action Plan ─────────────────────────────────────────────────
function buildActionPlanSlide(pres, exec, siteSummary, incidents) {
  _slideNum++;
  const s = pres.addSlide();
  s.background = { color: C.BG_LIGHT };
  addHeader(pres, s, 'ACTION PLAN TRACKER', 'Prioritized Action Items with Ownership, Timeline & Status', _slideNum);

  const actions = generateActionPlan(exec, siteSummary, incidents);

  const COL_W = [1.2, 3.8, 2.2, 1.5, 1.6, 2.13];
  const headers = [
    th('Priority', 'center'), th('Action', 'left'), th('Owner', 'center'),
    th('Timeline', 'center'), th('Impact', 'center'), th('Status', 'center'),
  ];

  const impacts = { Critical: 'Very High', High: 'High', Medium: 'Medium', Low: 'Low' };

  const rows = actions.map((a, idx) => {
    const fill     = rowFill(idx);
    const prioColor = a.priority === 'Critical' || a.priority === 'High' ? C.RED :
                      a.priority === 'Medium' ? C.AMBER : C.BLUE;
    const stColor   = a.status === 'Open' ? C.RED : a.status === 'In Progress' ? C.AMBER : a.status === 'Active' ? C.GREEN : C.TEAL;
    return [
      td(a.priority, fill, { align: 'center', bold: true, color: prioColor }),
      td((a.action || '').substring(0, 55), fill, { color: C.TEXT_DARK, fontSize: 9 }),
      td(a.owner || 'Network Ops', fill, { align: 'center', color: C.TEXT_MUTED, fontSize: 9 }),
      td(a.timeline || 'TBD', fill, { align: 'center', color: C.TEXT_MUTED, fontSize: 9 }),
      td(impacts[a.priority] || 'Medium', fill, { align: 'center', bold: true, color: prioColor, fontSize: 9 }),
      td(a.status || 'Open', fill, { align: 'center', bold: true, color: stColor, fontSize: 9 }),
    ];
  });

  s.addTable([headers, ...rows], {
    x: 0.45, y: 1.1, w: 12.43, colW: COL_W,
    fontSize: 9.5, rowH: 0.46, border: { type: 'solid', color: C.CARD_BORDER, pt: 0.75 }, fontFace: 'Calibri',
  });

  const narrative = [
    `${actions.filter(a => a.priority === 'High' || a.priority === 'Critical').length} high-priority actions require completion within 30-45 days to prevent SLA degradation.`,
    `Action ownership has been assigned to respective operational teams. Regular follow-up recommended.`,
    `This action plan should be reviewed and updated monthly with JFL IT leadership.`,
  ];
  addNarrativeBox(s, 6.45, narrative, 'Action Plan — Executive Note');
}

// ── Slide 40: Appendix Section Divider ────────────────────────────────────
function buildAppendixCoverSlide(pres, exec) {
  _slideNum++;
  const s = pres.addSlide();
  s.background = { color: C.BG_DARK };

  s.addShape('rect', { x: 0, y: 0, w: 13.33, h: 0.15, fill: { color: C.ACCENT_GOLD } });

  s.addText('APPENDIX', {
    x: 0.75, y: 2.2, w: 11.83, h: 0.8,
    fontSize: 38, bold: true, color: C.TEXT_LIGHT, fontFace: 'Calibri',
  });
  s.addText('Detailed Inventory Logs & Raw Incident Records', {
    x: 0.75, y: 3.1, w: 11.83, h: 0.5,
    fontSize: 18, color: '82B1FF', fontFace: 'Calibri',
  });

  s.addShape('line', {
    x: 0.75, y: 3.8, w: 6.0, h: 0,
    line: { color: C.ACCENT_GOLD, pt: 1.5 },
  });

  s.addText('Reference materials supporting Executive QBR analysis.', {
    x: 0.75, y: 4.1, w: 11.83, h: 0.4,
    fontSize: 12, color: 'B0BEC5', fontFace: 'Calibri',
  });
}

// ── Slide 41: Appendix — Complete Device Inventory ───────────────────────
function buildAppendixDeviceInventorySlide(pres, devices) {
  const pageSize = 30;
  const totalPages = Math.max(1, Math.ceil(devices.length / pageSize));
  const COL_W = [0.8, 2.8, 2.5, 2.5, 2.0, 1.83];
  const headers = [
    th('#', 'center'), th('Device ID / Serial', 'left'), th('Device Type', 'left'),
    th('Location / Site', 'left'), th('Rack', 'center'), th('Status', 'center'),
  ];

  for (let page = 0; page < Math.min(totalPages, 10); page++) {
    _slideNum++;
    const s = pres.addSlide();
    s.background = { color: C.BG_LIGHT };
    const pageSubtitle = totalPages > 1
      ? `Full Monitored Active & Stock Device List (Page ${page + 1} of ${totalPages})`
      : 'Full Monitored Active & Stock Device List';
    addHeader(pres, s, 'APPENDIX — COMPLETE DEVICE INVENTORY', pageSubtitle, _slideNum);

    const chunk = devices.slice(page * pageSize, (page + 1) * pageSize);
    const rows = chunk.map((d, idx) => {
      const globalIdx = page * pageSize + idx + 1;
      const fill = rowFill(idx);
      return [
        td(String(globalIdx), fill, { align: 'center', color: C.TEXT_MUTED }),
        td(d.DeviceID || d.SerialNo || 'N/A', fill, { bold: true, color: C.TEXT_DARK, fontSize: 8.5 }),
        td(d.DeviceType || 'Network Device', fill, { color: C.TEXT_MID, fontSize: 8.5 }),
        td(d.SiteID || d.Location || 'N/A', fill, { color: C.TEXT_DARK, fontSize: 8.5 }),
        td(d.Rack || 'N/A', fill, { align: 'center', color: C.TEXT_MUTED, fontSize: 8.5 }),
        td(d.__isStock ? 'Stock Inventory' : 'Active Production', fill, { align: 'center', bold: true, color: d.__isStock ? C.AMBER : C.GREEN, fontSize: 8.5 }),
      ];
    });

    s.addTable([headers, ...rows], {
      x: 0.45, y: 1.1, w: 12.43, colW: COL_W,
      fontSize: 9, rowH: 0.44, border: { type: 'solid', color: C.CARD_BORDER, pt: 0.75 }, fontFace: 'Calibri',
    });

    s.addText(`Showing items ${page * pageSize + 1}–${Math.min((page + 1) * pageSize, devices.length)} of ${devices.length} total monitored devices across all sites.`, {
      x: 0.45, y: 6.75, w: 12.43, h: 0.3,
      fontSize: 8.5, color: C.TEXT_MUTED, fontFace: 'Calibri',
    });
  }
}

// ── Slide 42: Appendix — Complete Switch Inventory ───────────────────────
function buildAppendixSwitchInventorySlide(pres, devices) {
  const switches = devices.filter(d => !d.__isStock && (/^sw$/i.test(d.DeviceType || '') || /switch/i.test(d.DeviceType || '')));
  const pageSize = 30;
  const totalPages = Math.max(1, Math.ceil(switches.length / pageSize));
  const COL_W = [0.8, 3.2, 2.5, 2.3, 1.8, 1.83];
  const headers = [
    th('#', 'center'), th('Hostname / Device ID', 'left'), th('Location', 'left'),
    th('Rack', 'center'), th('Uptime %', 'center'), th('SLA Status', 'center'),
  ];

  for (let page = 0; page < Math.min(totalPages, 10); page++) {
    _slideNum++;
    const s = pres.addSlide();
    s.background = { color: C.BG_LIGHT };
    const pageSubtitle = totalPages > 1
      ? `Network Switch Inventory & Effective Uptime Log (Page ${page + 1} of ${totalPages})`
      : 'Network Switch Inventory & Effective Uptime Log';
    addHeader(pres, s, 'APPENDIX — COMPLETE SWITCH INVENTORY', pageSubtitle, _slideNum);

    const chunk = switches.slice(page * pageSize, (page + 1) * pageSize);
    const rows = chunk.map((sw, idx) => {
      const globalIdx = page * pageSize + idx + 1;
      const fill = rowFill(idx);
      const rawUp = sw.__effectiveUptime !== undefined ? sw.__effectiveUptime : 100;
      const slaOk = parseFloat(rawUp) >= SLA_TARGET;
      return [
        td(String(globalIdx), fill, { align: 'center', color: C.TEXT_MUTED }),
        td(sw.Hostname || sw.DeviceID || 'N/A', fill, { bold: true, color: C.TEXT_DARK, fontSize: 8.5 }),
        td(sw.SiteID || sw.Location || 'N/A', fill, { color: C.TEXT_DARK, fontSize: 8.5 }),
        td(sw.Rack || 'N/A', fill, { align: 'center', color: C.TEXT_MUTED, fontSize: 8.5 }),
        td(`${parseFloat(rawUp).toFixed(2)}%`, fill, { align: 'center', bold: true, color: uptimeColor(rawUp), fontSize: 8.5 }),
        td(slaOk ? 'MET' : 'BREACH', fill, { align: 'center', bold: true, color: slaOk ? C.GREEN : C.RED, fontSize: 8.5 }),
      ];
    });

    s.addTable([headers, ...rows], {
      x: 0.45, y: 1.1, w: 12.43, colW: COL_W,
      fontSize: 9, rowH: 0.44, border: { type: 'solid', color: C.CARD_BORDER, pt: 0.75 }, fontFace: 'Calibri',
    });

    s.addText(`Showing items ${page * pageSize + 1}–${Math.min((page + 1) * pageSize, switches.length)} of ${switches.length} total active switches monitored across all 8 sites.`, {
      x: 0.45, y: 6.75, w: 12.43, h: 0.3,
      fontSize: 8.5, color: C.TEXT_MUTED, fontFace: 'Calibri',
    });
  }
}

// ── Slide 43: Appendix — Complete AP Inventory ───────────────────────────
function buildAppendixAPInventorySlide(pres, devices) {
  const aps = devices.filter(d => !d.__isStock && (/^ap$/i.test(d.DeviceType || '') || /access/i.test(d.DeviceType || '')));
  const pageSize = 30;
  const totalPages = Math.max(1, Math.ceil(aps.length / pageSize));
  const COL_W = [0.8, 3.5, 2.5, 2.5, 3.13];
  const headers = [
    th('#', 'center'), th('Access Point ID / Serial', 'left'), th('Location / Site', 'left'),
    th('Rack / Controller', 'center'), th('Operational Status', 'center'),
  ];

  for (let page = 0; page < Math.min(totalPages, 10); page++) {
    _slideNum++;
    const s = pres.addSlide();
    s.background = { color: C.BG_LIGHT };
    const pageSubtitle = totalPages > 1
      ? `Wireless Access Point Estate Breakdown (Page ${page + 1} of ${totalPages})`
      : 'Wireless Access Point Estate Breakdown';
    addHeader(pres, s, 'APPENDIX — COMPLETE ACCESS POINT (AP) INVENTORY', pageSubtitle, _slideNum);

    const chunk = aps.slice(page * pageSize, (page + 1) * pageSize);
    const rows = chunk.map((ap, idx) => {
      const globalIdx = page * pageSize + idx + 1;
      const fill = rowFill(idx);
      return [
        td(String(globalIdx), fill, { align: 'center', color: C.TEXT_MUTED }),
        td(ap.DeviceID || ap.SerialNo || 'N/A', fill, { bold: true, color: C.TEXT_DARK, fontSize: 8.5 }),
        td(ap.SiteID || ap.Location || 'N/A', fill, { color: C.TEXT_DARK, fontSize: 8.5 }),
        td(ap.Rack || 'WLC Controller', fill, { align: 'center', color: C.TEXT_MUTED, fontSize: 8.5 }),
        td('Monitored Active', fill, { align: 'center', bold: true, color: C.GREEN, fontSize: 8.5 }),
      ];
    });

    s.addTable([headers, ...rows], {
      x: 0.45, y: 1.1, w: 12.43, colW: COL_W,
      fontSize: 9, rowH: 0.44, border: { type: 'solid', color: C.CARD_BORDER, pt: 0.75 }, fontFace: 'Calibri',
    });

    s.addText(`Showing items ${page * pageSize + 1}–${Math.min((page + 1) * pageSize, aps.length)} of ${aps.length} total wireless access points monitored across all 8 sites.`, {
      x: 0.45, y: 6.75, w: 12.43, h: 0.3,
      fontSize: 8.5, color: C.TEXT_MUTED, fontFace: 'Calibri',
    });
  }
}

// ── Slide 44: Appendix — Raw Incident Records Log ────────────────────────
function buildAppendixIncidentRecordsSlide(pres, incidents) {
  const pageSize = 30;
  const totalPages = Math.max(1, Math.ceil(incidents.length / pageSize));
  const COL_W = [1.8, 2.2, 1.8, 1.5, 1.5, 3.63];
  const headers = [
    th('Ticket #', 'left'), th('Device / Host', 'left'), th('Location', 'left'),
    th('Priority', 'center'), th('Status', 'center'), th('Root Cause Analysis (RCA)', 'left'),
  ];

  for (let page = 0; page < Math.min(totalPages, 10); page++) {
    _slideNum++;
    const s = pres.addSlide();
    s.background = { color: C.BG_LIGHT };
    const pageSubtitle = totalPages > 1
      ? `Detailed Master Incident Ticket Audit Log (Page ${page + 1} of ${totalPages})`
      : 'Detailed Master Incident Ticket Audit Log';
    addHeader(pres, s, 'APPENDIX — RAW INCIDENT RECORDS LOG', pageSubtitle, _slideNum);

    const chunk = incidents.slice(page * pageSize, (page + 1) * pageSize);
    const rows = chunk.map((inc, idx) => {
      const globalIdx = page * pageSize + idx + 1;
      const fill = rowFill(idx);
      const prio = String(inc.Priority || 'N/A').toUpperCase();
      const isClosed = /closed|resolved/i.test(inc.Status || '');
      return [
        td(inc.TicketNumber || inc.IncidentNumber || `INC-${globalIdx}`, fill, { color: C.NAVY, fontSize: 8.5 }),
        td(String(inc.Hostname || inc.DeviceID || 'N/A').substring(0, 20), fill, { color: C.TEXT_DARK, fontSize: 8.5 }),
        td(String(inc.SiteID || inc.Location || 'N/A').substring(0, 18), fill, { color: C.TEXT_MID, fontSize: 8.5 }),
        td(prio.substring(0, 10), fill, { align: 'center', bold: true, color: prio.includes('P1') ? C.RED : C.AMBER, fontSize: 8.5 }),
        td(isClosed ? 'Closed' : 'Open', fill, { align: 'center', bold: true, color: isClosed ? C.GREEN : C.AMBER, fontSize: 8.5 }),
        td(String(inc.RCA || 'Unknown').substring(0, 35), fill, { color: C.TEXT_MUTED, fontSize: 8.5 }),
      ];
    });

    s.addTable([headers, ...rows], {
      x: 0.45, y: 1.1, w: 12.43, colW: COL_W,
      fontSize: 9, rowH: 0.44, border: { type: 'solid', color: C.CARD_BORDER, pt: 0.75 }, fontFace: 'Calibri',
    });

    s.addText(`Showing items ${page * pageSize + 1}–${Math.min((page + 1) * pageSize, incidents.length)} of ${incidents.length} raw incident records logged during the reporting period.`, {
      x: 0.45, y: 6.75, w: 12.43, h: 0.3,
      fontSize: 8.5, color: C.TEXT_MUTED, fontFace: 'Calibri',
    });
  }
}

// ── Slide 40: Thank You ───────────────────────────────────────────────────
function buildThankYouSlide(pres, exec) {
  _slideNum++;
  const s = pres.addSlide();
  s.background = { color: C.BG_DARK };

  s.addShape('rect', { x: 0, y: 0, w: 13.33, h: 0.15, fill: { color: C.ACCENT_GOLD } });
  s.addShape('rect', { x: 0, y: 7.35, w: 13.33, h: 0.15, fill: { color: C.ACCENT_GOLD } });

  if (logoBase64) {
    s.addImage({ data: logoBase64, x: 5.16, y: 1.2, w: 3.0, h: 0.95 });
  } else if (fs.existsSync(LOGO_PATH)) {
    s.addImage({ path: LOGO_PATH, x: 5.16, y: 1.2, w: 3.0, h: 0.95 });
  }

  s.addText('Thank You', { x: 0.5, y: 2.4, w: 12.33, h: 1.0, fontSize: 44, bold: true, color: C.TEXT_LIGHT, align: 'center', fontFace: 'Calibri' });
  s.addText('Proactive Data Systems   ·   www.proactive.co.in', { x: 0.5, y: 3.55, w: 12.33, h: 0.45, fontSize: 14, color: '82B1FF', align: 'center', fontFace: 'Calibri' });

  s.addShape('line', { x: 3.5, y: 4.25, w: 6.33, h: 0, line: { color: C.ACCENT_GOLD, pt: 1.5 } });

  s.addText(`Reporting Period: ${exec.reportingPeriod || 'Q1 FY2026'}`, { x: 0.5, y: 4.5, w: 12.33, h: 0.32, fontSize: 11, color: '90A4AE', align: 'center', fontFace: 'Calibri' });
  s.addText(`Customer: ${exec.customerName || 'Jubilant FoodWorks Limited'}`, { x: 0.5, y: 4.88, w: 12.33, h: 0.32, fontSize: 11, color: '78909C', align: 'center', fontFace: 'Calibri' });
  s.addText(`Generated: ${new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}`, { x: 0.5, y: 5.26, w: 12.33, h: 0.28, fontSize: 10, color: '607D8B', align: 'center', fontFace: 'Calibri' });
  s.addText('CONFIDENTIAL — This document is intended for authorized recipients only.', { x: 0.5, y: 6.6, w: 12.33, h: 0.28, fontSize: 9, color: '455A64', align: 'center', fontFace: 'Calibri' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Table Cell Helpers (preserved from original)
// ─────────────────────────────────────────────────────────────────────────────

function th(text, align = 'center') {
  return {
    text,
    options: {
      bold: true, color: C.TEXT_LIGHT,
      fill: { color: C.TABLE_HEADER_FILL || C.HEADER_FILL },
      align, valign: 'middle',
      fontFace: C.FONT_PRIMARY, fontSize: 12,
      margin: [6, 6, 6, 6],
    },
  };
}

function td(text, fill, opts = {}) {
  return {
    // PptxGenJS will auto-detect URLs/hyperlinks in plain text strings and underline them.
    // Using an array of run objects with hyperlink: false prevents this behavior for all cell text.
    text: [{ text: String(text), options: { hyperlink: false } }],
    options: {
      fill: { color: fill },
      fontFace: C.FONT_PRIMARY, valign: 'middle',
      fontSize: 12,
      margin: [6, 6, 6, 6],
      ...opts,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = { generatePPT };
