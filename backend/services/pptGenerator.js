// backend/services/pptGenerator.js
// Concrete QBR PPT Generator — master template theme, 27 slides, zero XML mutation.
//
// Slide structure (matches master_template.pptx exactly):
//   Slide  1  : Title
//   Slide  2  : Executive Summary — all-sites table
//   Slides 3–26: 8 sites × 3 slides
//                 [A] AP & Switch Statistical Overview + Rack Uptime table
//                 [B] Switch Uptime Report (KPI cards + switch table)
//                 [C] AP Incidents & RCA Breakdown (KPI cards + AP table)
//   Slide 27  : Thank You
//
// Fatal errors fixed vs previous version:
//   #1–6  : Entire XML/zip mutation path (generateFromTemplate) removed.
//   #7    : Screenshot slide removed — slide count is now always exactly 27.
//   #8    : All colW arrays verified to sum to declared w.
//   #9    : Safe breach colour helper — parseFloat guard prevents NaN misclassification.
//   #10   : Logo/cover paths use __dirname, not process.cwd().
//   #11   : Single module-level TARGET_SITES constant; no duplicate declarations.
//   #12   : pct() uses parseFloat + isNaN guard; no string-equality comparison.
//   #13   : Card grid capped so bottom edge + footer never overlap.

'use strict';

const fs   = require('fs');
const path = require('path');
const PptxGenJS = require('pptxgenjs');

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const SLA_TARGET = 99.3; // must match processData.js

const TARGET_SITES = [
  'BANGALORE',
  'GUWAHATI',
  'GREATER NOIDA',
  'NOIDA',
  'MUMBAI',
  'HYDERABAD',
  'MOHALI',
  'NAGPUR',
];

// Master-template colour palette (Corporate Navy & Clean White)
const C = {
  NAVY:        '0B2440',
  NAVY_LIGHT:  '1C3B60',
  BLUE:        '0056B3',
  BLUE_LIGHT:  'EBF3FA',
  BG_DARK:     '0B2440',
  BG_LIGHT:    'FFFFFF',
  CARD_BG:     'F4F7FA',
  CARD_BORDER: 'DDE3E9',
  TEXT_DARK:   '1A2530',
  TEXT_MUTED:  '5B6B7C',
  TEXT_LIGHT:  'FFFFFF',
  GREEN:       '28A745',
  RED:         'DC3545',
  AMBER:       'D97706',
  HEADER_FILL: '0B2440',
};

// Paths resolved relative to this file (Fix #10)
const LOGO_PATH  = path.resolve(__dirname, '../../templates/extracted_media/image2.png');
const COVER_PATH = path.resolve(__dirname, '../../templates/extracted_media/image1.jpeg');

// Pre-cache Base64 image buffers at module initialization for ultra-fast slide generation
let logoBase64 = null;
let coverBase64 = null;

try {
  if (fs.existsSync(LOGO_PATH)) {
    logoBase64 = 'image/png;base64,' + fs.readFileSync(LOGO_PATH).toString('base64');
  }
} catch (e) {}

try {
  if (fs.existsSync(COVER_PATH)) {
    coverBase64 = 'image/jpeg;base64,' + fs.readFileSync(COVER_PATH).toString('base64');
  }
} catch (e) {}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

async function generatePPT(data, _templatePath, outputPath) {
  console.log('[pptGenerator] Generating 27-slide QBR PPT...');
  await buildPresentation(data, outputPath);
  console.log('[pptGenerator] PPT written to:', outputPath);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Safe display of any value; returns 'N/A' for null / undefined / empty. */
function fmt(v) {
  return (v === null || v === undefined || v === '') ? 'N/A' : String(v);
}

/**
 * Safe percentage formatter.
 * Fix #12: uses parseFloat + isNaN guard — never does string equality like
 *          switchUptime === 'Data Not Available'.
 */
function pct(v) {
  const n = parseFloat(String(v ?? ''));
  if (isNaN(n)) return 'N/A';
  return `${n.toFixed(2)}%`;
}

/**
 * Fix #9: safe SLA-breach colour — parseFloat guard prevents NaN false-negative.
 * Returns RED if device is breaching SLA, GREEN otherwise.
 */
function uptimeColor(rawValue) {
  const n = parseFloat(String(rawValue ?? ''));
  if (isNaN(n)) return C.TEXT_MUTED;
  return n < SLA_TARGET ? C.RED : C.GREEN;
}

/** Alternate row fill for zebra-striped tables. */
function rowFill(idx) {
  return idx % 2 === 0 ? 'FFFFFF' : C.CARD_BG;
}

/**
 * Find site data from siteSummary by matching TARGET_SITES key.
 * Case-insensitive prefix match (e.g. 'GREATER NOIDA' → match on 'GREATER NOIDA' or 'Greater Noida').
 */
function findSite(siteSummary, siteKey) {
  return (
    siteSummary.find(s => s.siteId.toUpperCase() === siteKey) ||
    siteSummary.find(s => s.siteId.toUpperCase().startsWith(siteKey.split(' ')[0])) ||
    { siteId: siteKey }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared Slide Components
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Adds the standard header bar (navy background, title, subtitle, logo)
 * and a footer divider line on every content slide.
 */
function addHeader(pres, slide, title, subtitle) {
  // Navy header bar
  slide.addShape(pres.ShapeType.rect, {
    x: 0, y: 0, w: 13.33, h: 0.95,
    fill: { color: C.NAVY },
  });

  slide.addText(title, {
    x: 0.45, y: 0.1, w: 9.5, h: 0.42,
    fontSize: 17, bold: true, color: C.TEXT_LIGHT,
    fontFace: 'Calibri',
  });

  slide.addText(subtitle, {
    x: 0.45, y: 0.52, w: 9.5, h: 0.3,
    fontSize: 10, color: 'B0C4DE',
    fontFace: 'Calibri',
  });

  // Logo (top-right)
  if (logoBase64) {
    slide.addImage({ data: logoBase64, x: 10.75, y: 0.12, w: 2.1, h: 0.68 });
  } else if (fs.existsSync(LOGO_PATH)) {
    slide.addImage({ path: LOGO_PATH, x: 10.75, y: 0.12, w: 2.1, h: 0.68 });
  }

  // Footer divider
  slide.addShape(pres.ShapeType.line, {
    x: 0.45, y: 6.95, w: 12.43, h: 0,
    line: { color: C.CARD_BORDER, pt: 1 },
  });
  slide.addText('JFL – Proactive Quarterly Business Review', {
    x: 0.45, y: 7.0, w: 6.5, h: 0.28,
    fontSize: 8.5, color: C.TEXT_MUTED, fontFace: 'Calibri',
  });
  slide.addText('Proactive Data Systems Pvt. Ltd.', {
    x: 7.0, y: 7.0, w: 5.88, h: 0.28,
    fontSize: 8.5, color: C.TEXT_MUTED, align: 'right', fontFace: 'Calibri',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Presentation Builder
// ─────────────────────────────────────────────────────────────────────────────

async function buildPresentation(data, outputPath) {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE'; // 13.33 × 7.5 inches

  const exec        = data.executiveSummary || {};
  const siteSummary = data.siteSummary      || [];
  const incidents   = data.incidents        || [];
  const devices     = data.devices          || [];

  // ── SLIDE 1: Title ─────────────────────────────────────────────────────────
  buildTitleSlide(pres, exec);

  // ── SLIDE 2: Executive Summary — All-Sites Table ───────────────────────────
  buildExecSummarySlide(pres, exec, siteSummary, incidents);

  // Pre-index site switches and site incidents in O(1) Hash Maps for max speed
  const siteSwsMap = {};
  const siteIncsMap = {};
  TARGET_SITES.forEach((siteKey) => {
    const prefix = siteKey.split(' ')[0];
    siteSwsMap[siteKey] = devices.filter(d =>
      (d.SiteID || d.Location || '').toUpperCase().includes(prefix) &&
      /^sw$/i.test(d.DeviceType)
    );
    siteIncsMap[siteKey] = incidents.filter(i =>
      (i.SiteID || i.Location || '').toUpperCase().includes(prefix)
    );
  });

  // ── SLIDES 3–26: 8 × 3 Site Review Slides ─────────────────────────────────
  TARGET_SITES.forEach((siteKey, siteIdx) => {
    const siteData = findSite(siteSummary, siteKey);
    const siteSws  = siteSwsMap[siteKey] || [];
    const siteIncs = siteIncsMap[siteKey] || [];

    buildSiteOverviewSlide(pres, siteKey, siteData, siteSws, siteIdx + 1);
    buildSiteSwitchSlide(pres, siteKey, siteData, siteSws, siteIdx + 1);
    buildSiteAPSlide(pres, siteKey, siteData, siteIncs, siteIdx + 1);
  });

  // ── SLIDE 27: Thank You ────────────────────────────────────────────────────
  buildThankYouSlide(pres, exec);

  await pres.writeFile({ fileName: outputPath });
}

// ─────────────────────────────────────────────────────────────────────────────
// Slide Builders
// ─────────────────────────────────────────────────────────────────────────────

// ── Slide 1: Title ────────────────────────────────────────────────────────────
function buildTitleSlide(pres, exec) {
  const s = pres.addSlide();
  s.background = { color: C.BG_DARK };

  // Logo top-left
  if (logoBase64) {
    s.addImage({ data: logoBase64, x: 0.75, y: 0.45, w: 2.6, h: 0.82 });
  } else if (fs.existsSync(LOGO_PATH)) {
    s.addImage({ path: LOGO_PATH, x: 0.75, y: 0.45, w: 2.6, h: 0.82 });
  }

  // Left info card
  const cardW = (coverBase64 || fs.existsSync(COVER_PATH)) ? 6.3 : 12.33;
  s.addShape(pres.ShapeType.rect, {
    x: 0.75, y: 1.55, w: cardW, h: 5.0,
    fill: { color: C.NAVY_LIGHT },
    line: { color: '2A4D77', pt: 1 },
  });

  s.addText(fmt(exec.customerName || 'Jubilant FoodWorks Limited'), {
    x: 1.05, y: 1.95, w: cardW - 0.6, h: 0.85,
    fontSize: 26, bold: true, color: C.TEXT_LIGHT, fontFace: 'Calibri',
  });
  s.addText('Proactive Quarterly Business Review', {
    x: 1.05, y: 2.9, w: cardW - 0.6, h: 0.6,
    fontSize: 20, bold: true, color: '82B1FF', fontFace: 'Calibri',
  });
  s.addText(`Reporting Period: ${fmt(exec.reportingPeriod || 'Q1 FY2026')}`, {
    x: 1.05, y: 3.65, w: cardW - 0.6, h: 0.4,
    fontSize: 13, color: 'E0E0E0', fontFace: 'Calibri',
  });
  s.addText('Prepared by: Proactive Data Systems Pvt. Ltd.', {
    x: 1.05, y: 4.3, w: cardW - 0.6, h: 0.4,
    fontSize: 12, color: 'B0BEC5', fontFace: 'Calibri',
  });

  // Cover image (right panel)
  if (coverBase64) {
    s.addImage({ data: coverBase64, x: 7.3, y: 1.55, w: 5.28, h: 5.0 });
  } else if (fs.existsSync(COVER_PATH)) {
    s.addImage({ path: COVER_PATH, x: 7.3, y: 1.55, w: 5.28, h: 5.0 });
  }

  s.addText(`Generated: ${new Date().toLocaleDateString('en-IN')}`, {
    x: 0.75, y: 6.85, w: 12.33, h: 0.28,
    fontSize: 9.5, color: '90A4AE', align: 'center', fontFace: 'Calibri',
  });
}

// ── Slide 2: Executive Summary — All-Sites Table ──────────────────────────────
function buildExecSummarySlide(pres, exec, siteSummary, incidents) {
  const s = pres.addSlide();
  s.background = { color: C.BG_LIGHT };
  addHeader(pres, s,
    'EXECUTIVE SUMMARY  ·  ALL SITES',
    'Infrastructure Uptime & Primary RCA Drivers Across Key Sites'
  );

  // Column widths sum = 12.43 = w  (Fix #8)
  const COL_W = [2.05, 1.8, 2.5, 1.55, 2.28, 2.25];
  const W_TOTAL = COL_W.reduce((a, b) => a + b, 0); // 12.43

  const headers = [
    th('Site',                         'left'),
    th('Monitored Devices',            'center'),
    th('Aggregated Switch Uptime %',   'center'),
    th('AP Incidents',                 'center'),
    th('Primary RCA – Switches',       'center'),
    th('Primary RCA – APs',            'center'),
  ];

  const tableRows = TARGET_SITES.map((siteKey, idx) => {
    const site  = findSite(siteSummary, siteKey);
    const fill  = rowFill(idx);
    const swUp  = pct(site.switchUptime);
    const rcaSw = fmt(site.primaryRca);
    const rcaAp = fmt(site.primaryRcaForAPs);

    return [
      td(siteKey,                     fill, { bold: true, color: C.TEXT_DARK, align: 'left' }),
      td(fmt(site.deviceCount),       fill, { color: C.TEXT_DARK,  align: 'center' }),
      td(swUp,                        fill, { bold: true, color: C.BLUE, align: 'center' }),
      td(fmt(site.uniqueAPsWithIncidents), fill, { color: C.TEXT_DARK, align: 'center' }),
      td(rcaSw,                       fill, { color: C.TEXT_MUTED, align: 'center', fontSize: 9 }),
      td(rcaAp,                       fill, { color: C.TEXT_MUTED, align: 'center', fontSize: 9 }),
    ];
  });

  s.addTable([headers, ...tableRows], {
    x: 0.45, y: 1.1, w: W_TOTAL,
    colW: COL_W,
    fontSize: 10, rowH: 0.52,
    border: { type: 'solid', color: C.CARD_BORDER, pt: 1 },
    fontFace: 'Calibri',
  });
}

// ── Site Slide A: Overview + Rack Uptime ──────────────────────────────────────
function buildSiteOverviewSlide(pres, siteKey, site, siteSws, siteNum) {
  const s = pres.addSlide();
  s.background = { color: C.BG_LIGHT };
  const siteName = site.siteId || siteKey;

  addHeader(pres, s,
    siteName.toUpperCase(),
    `SITE REVIEW  ·  ${siteNum} OF 8  ·  AP & Switch Statistical Analytics`
  );

  // ── Left: KPI summary card ────────────────────────────────────────────────
  s.addShape(pres.ShapeType.roundRect, {
    x: 0.45, y: 1.1, w: 4.6, h: 5.65,
    fill: { color: C.CARD_BG }, line: { color: C.CARD_BORDER, pt: 1 },
  });
  s.addText('Site Infrastructure Summary', {
    x: 0.65, y: 1.25, w: 4.2, h: 0.38,
    fontSize: 13, bold: true, color: C.NAVY, fontFace: 'Calibri',
  });

  const kpis = [
    { l: 'Monitored Devices',   v: fmt(site.deviceCount) },
    { l: 'Switches Monitored',  v: fmt(site.switchCount) },
    { l: 'Access Points',       v: fmt(site.apCount) },
    { l: 'Switch Uptime %',     v: pct(site.switchUptime) },
    { l: 'Overall Site Uptime', v: pct(site.overallUptime) },
    { l: 'Primary RCA',         v: fmt(site.primaryRca) },
  ];

  kpis.forEach((kpi, idx) => {
    const yPos = 1.75 + idx * 0.8;
    s.addText(kpi.l, {
      x: 0.65, y: yPos, w: 4.2, h: 0.26,
      fontSize: 9.5, color: C.TEXT_MUTED, fontFace: 'Calibri',
    });
    s.addText(kpi.v, {
      x: 0.65, y: yPos + 0.26, w: 4.2, h: 0.42,
      fontSize: 13, bold: true, color: C.BLUE, fontFace: 'Calibri',
    });
  });

  // ── Right: Rack-wise Uptime Table ─────────────────────────────────────────
  // Col widths: [4.55, 3.23] = 7.78 = w  (Fix #8)
  const RACK_COL_W = [4.55, 3.23];
  const RACK_W     = RACK_COL_W.reduce((a, b) => a + b, 0);

  const rackMap = {};
  siteSws.forEach(sw => {
    const rack = sw.Rack || 'Default Rack';
    if (!rackMap[rack]) rackMap[rack] = [];
    rackMap[rack].push(sw.__effectiveUptime ?? 100);
  });

  const rackHeaders = [
    th('Rack No.',        'left'),
    th('Avg Uptime %',    'center'),
  ];

  const rackRows = Object.entries(rackMap).map(([rack, vals], rIdx) => {
    const avg    = (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2);
    const fill   = rowFill(rIdx);
    return [
      td(rack,      fill, { color: C.TEXT_DARK }),
      td(`${avg}%`, fill, { bold: true, color: uptimeColor(avg), align: 'center' }),
    ];
  });

  const fallbackRackRow = [[
    td('No switches mapped', 'FFFFFF', { color: C.TEXT_MUTED, align: 'center' }),
    td('—',                  'FFFFFF', { color: C.TEXT_MUTED, align: 'center' }),
  ]];

  s.addTable([rackHeaders, ...(rackRows.length > 0 ? rackRows : fallbackRackRow)], {
    x: 5.28, y: 1.1, w: RACK_W,
    colW: RACK_COL_W,
    fontSize: 10, rowH: 0.42,
    border: { type: 'solid', color: C.CARD_BORDER, pt: 1 },
    fontFace: 'Calibri',
  });
}

// ── Site Slide B: Switch Uptime Report ────────────────────────────────────────
function buildSiteSwitchSlide(pres, siteKey, site, siteSws, siteNum) {
  const s = pres.addSlide();
  s.background = { color: C.BG_LIGHT };
  const siteName = site.siteId || siteKey;

  addHeader(pres, s,
    siteName.toUpperCase(),
    `SITE REVIEW  ·  ${siteNum} OF 8  ·  Switch Uptime Report`
  );

  const swUp       = pct(site.switchUptime);
  const at100      = siteSws.filter(sw => (sw.__effectiveUptime ?? 100) >= 100).length;
  const primaryRca = fmt(site.primaryRca);

  // ── 4 KPI Cards (Fix #13: h=1.6, yPos=1.1 → bottom 2.7, footer at 6.95) ──
  const kpiCards = [
    { l: 'Aggregated Switch Uptime', v: swUp,                  c: C.BLUE  },
    { l: 'Switches Monitored',       v: fmt(siteSws.length),   c: C.NAVY  },
    { l: 'Switches @ 100% Uptime',   v: fmt(at100),            c: C.GREEN },
    { l: 'Primary RCA Driver',       v: primaryRca,            c: C.AMBER },
  ];

  // 4 cards across 12.43" → each card w=2.9, gap=0.14
  const CARD_W = 2.9;
  kpiCards.forEach((card, idx) => {
    const xPos = 0.45 + idx * (CARD_W + 0.18); // 0.45, 3.53, 6.61, 9.69 → last right edge 12.59 ✓
    s.addShape(pres.ShapeType.roundRect, {
      x: xPos, y: 1.1, w: CARD_W, h: 1.6,
      fill: { color: C.CARD_BG }, line: { color: C.CARD_BORDER, pt: 1 },
    });
    s.addText(card.v, {
      x: xPos, y: 1.2, w: CARD_W, h: 0.65,
      fontSize: 18, bold: true, color: card.c, align: 'center', fontFace: 'Calibri',
    });
    s.addText(card.l, {
      x: xPos, y: 1.88, w: CARD_W, h: 0.35,
      fontSize: 9.5, color: C.TEXT_MUTED, align: 'center', fontFace: 'Calibri',
    });
  });

  // ── Switch Table ──────────────────────────────────────────────────────────
  // colW [1.0, 3.38, 3.38, 2.0, 2.27] = 12.03 … w = 12.43 — adjust:
  // colW [1.0, 3.58, 3.58, 1.9, 2.37] = 12.43  (Fix #8)
  const SW_COL_W = [1.0, 3.58, 3.58, 1.9, 2.37];
  const SW_W     = SW_COL_W.reduce((a, b) => a + b, 0); // 12.43

  const swHeaders = [
    th('S.No',      'center'),
    th('Host Name', 'left'),
    th('Serial No', 'left'),
    th('Rack No',   'center'),
    th('Uptime %',  'center'),
  ];

  const swRows = siteSws.slice(0, 12).map((sw, rIdx) => {
    const rawUp  = sw.__effectiveUptime !== undefined ? sw.__effectiveUptime : 100;
    const upStr  = `${parseFloat(rawUp).toFixed(2)}%`;
    const fill   = rowFill(rIdx);
    return [
      td(String(rIdx + 1),          fill, { color: C.TEXT_DARK,  align: 'center' }),
      td(sw.Hostname || sw.DeviceID, fill, { bold: true, color: C.TEXT_DARK }),
      td(sw.DeviceID,               fill, { color: C.TEXT_MUTED }),
      td(sw.Rack || 'NA',           fill, { color: C.TEXT_DARK,  align: 'center' }),
      td(upStr,                     fill, { bold: true, color: uptimeColor(rawUp), align: 'center' }),
    ];
  });

  const fallbackSwRow = [[
    td('1',   'FFFFFF', { align: 'center' }),
    td('N/A', 'FFFFFF', {}),
    td('N/A', 'FFFFFF', {}),
    td('NA',  'FFFFFF', { align: 'center' }),
    td('100.00%', 'FFFFFF', { align: 'center', color: C.GREEN }),
  ]];

  s.addTable([swHeaders, ...(swRows.length > 0 ? swRows : fallbackSwRow)], {
    x: 0.45, y: 2.85, w: SW_W,
    colW: SW_COL_W,
    fontSize: 9.5, rowH: 0.38,
    border: { type: 'solid', color: C.CARD_BORDER, pt: 1 },
    fontFace: 'Calibri',
  });
}

// ── Site Slide C: AP Incidents & RCA Breakdown ────────────────────────────────
function buildSiteAPSlide(pres, siteKey, site, siteIncs, siteNum) {
  const s = pres.addSlide();
  s.background = { color: C.BG_LIGHT };
  const siteName = site.siteId || siteKey;

  addHeader(pres, s,
    siteName.toUpperCase(),
    `SITE REVIEW  ·  ${siteNum} OF 8  ·  AP Incidents & RCA Breakdown`
  );

  const metCount    = siteIncs.filter(i => /met/i.test(i.ResolutionSLAStatus || '')).length;
  const breachCount = siteIncs.filter(i => /missed|violated/i.test(i.ResolutionSLAStatus || '')).length;
  const primaryRca  = fmt(site.primaryRcaForAPs);

  // ── 4 KPI Cards (same safe layout as switch slide) ────────────────────────
  const apCards = [
    { l: 'Total Incidents',    v: fmt(siteIncs.length), c: C.NAVY  },
    { l: 'Met Cases',          v: fmt(metCount),         c: C.GREEN },
    { l: 'Breach Cases',       v: fmt(breachCount),      c: C.RED   },
    { l: 'Primary RCA Driver', v: primaryRca,            c: C.AMBER },
  ];

  const CARD_W = 2.9;
  apCards.forEach((card, idx) => {
    const xPos = 0.45 + idx * (CARD_W + 0.18);
    s.addShape(pres.ShapeType.roundRect, {
      x: xPos, y: 1.1, w: CARD_W, h: 1.6,
      fill: { color: C.CARD_BG }, line: { color: C.CARD_BORDER, pt: 1 },
    });
    s.addText(card.v, {
      x: xPos, y: 1.2, w: CARD_W, h: 0.65,
      fontSize: 18, bold: true, color: card.c, align: 'center', fontFace: 'Calibri',
    });
    s.addText(card.l, {
      x: xPos, y: 1.88, w: CARD_W, h: 0.35,
      fontSize: 9.5, color: C.TEXT_MUTED, align: 'center', fontFace: 'Calibri',
    });
  });

  // ── AP Incidents Table ────────────────────────────────────────────────────
  // colW [1.0, 3.58, 3.43, 1.65, 2.77] = 12.43  (Fix #8)
  const AP_COL_W = [1.0, 3.58, 3.43, 1.65, 2.77];
  const AP_W     = AP_COL_W.reduce((a, b) => a + b, 0); // 12.43

  const apHeaders = [
    th('S.No',          'center'),
    th('AP Host Name',  'left'),
    th('Serial No',     'left'),
    th('Incidents',     'center'),
    th('Primary RCA',   'left'),
  ];

  // Aggregate incidents per AP device
  const apMap = {};
  siteIncs.forEach(inc => {
    const devId = inc.DeviceID || 'Unknown';
    if (!apMap[devId]) apMap[devId] = { count: 0, rcas: {}, hostname: inc.Hostname || devId };
    apMap[devId].count++;
    if (inc.RCA) apMap[devId].rcas[inc.RCA] = (apMap[devId].rcas[inc.RCA] || 0) + 1;
  });

  const sortedAPs = Object.entries(apMap).sort((a, b) => b[1].count - a[1].count);

  const apRows = sortedAPs.slice(0, 12).map(([devId, info], rIdx) => {
    const topRca = Object.entries(info.rcas).sort((a, b) => b[1] - a[1])[0]?.[0] || 'None';
    const fill   = rowFill(rIdx);
    return [
      td(String(rIdx + 1),  fill, { color: C.TEXT_DARK, align: 'center' }),
      td(info.hostname,     fill, { bold: true, color: C.TEXT_DARK }),
      td(devId,             fill, { color: C.TEXT_MUTED }),
      td(fmt(info.count),   fill, { bold: true, color: C.BLUE, align: 'center' }),
      td(topRca,            fill, { color: C.TEXT_MUTED, fontSize: 9 }),
    ];
  });

  const fallbackAPRow = [[
    td('—',    'FFFFFF', { align: 'center' }),
    td('N/A',  'FFFFFF', {}),
    td('N/A',  'FFFFFF', {}),
    td('0',    'FFFFFF', { align: 'center' }),
    td('None', 'FFFFFF', {}),
  ]];

  s.addTable([apHeaders, ...(apRows.length > 0 ? apRows : fallbackAPRow)], {
    x: 0.45, y: 2.85, w: AP_W,
    colW: AP_COL_W,
    fontSize: 9.5, rowH: 0.38,
    border: { type: 'solid', color: C.CARD_BORDER, pt: 1 },
    fontFace: 'Calibri',
  });
}

// ── Slide 27: Thank You ───────────────────────────────────────────────────────
function buildThankYouSlide(pres, exec) {
  const s = pres.addSlide();
  s.background = { color: C.BG_DARK };

  if (fs.existsSync(LOGO_PATH)) {
    s.addImage({ path: LOGO_PATH, x: 5.16, y: 1.4, w: 3.0, h: 0.95 });
  }

  s.addText('Thank You', {
    x: 0.5, y: 2.65, w: 12.33, h: 1.0,
    fontSize: 40, bold: true, color: C.TEXT_LIGHT, align: 'center',
    fontFace: 'Calibri',
  });

  s.addText('Proactive Data Systems   ·   www.proactive.co.in', {
    x: 0.5, y: 3.85, w: 12.33, h: 0.5,
    fontSize: 16, color: '82B1FF', align: 'center', fontFace: 'Calibri',
  });

  if (exec.reportingPeriod) {
    s.addText(`Reporting Period: ${exec.reportingPeriod}`, {
      x: 0.5, y: 5.5, w: 12.33, h: 0.35,
      fontSize: 11, color: '78909C', align: 'center', fontFace: 'Calibri',
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Table Cell Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a header cell with navy fill and white bold text.
 * @param {string} text
 * @param {'left'|'center'|'right'} align
 */
function th(text, align = 'center') {
  return {
    text,
    options: {
      bold: true,
      color: C.TEXT_LIGHT,
      fill: { color: C.HEADER_FILL },
      align,
      fontFace: 'Calibri',
    },
  };
}

/**
 * Build a data cell with given fill colour and additional options.
 * @param {string} text
 * @param {string} fill  hex colour string
 * @param {object} opts  additional PptxGenJS cell options
 */
function td(text, fill, opts = {}) {
  return {
    text: String(text),
    options: {
      fill: { color: fill },
      fontFace: 'Calibri',
      ...opts,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = { generatePPT };
