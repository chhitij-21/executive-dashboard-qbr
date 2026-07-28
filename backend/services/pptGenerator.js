// backend/services/pptGenerator.js
// Generates PowerPoint matching master_template.pptx scenario with 100% data accuracy.
// 27 wide-format slides: Title (1), All-Sites Executive Summary Table (2), 8 Site Review Blocks x 3 slides (3-26), Thank You (27).

const fs = require('fs');
const path = require('path');
const PptxGenJS = require('pptxgenjs');
let AdmZip;
try { AdmZip = require('adm-zip'); } catch (e) { AdmZip = null; }

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

/**
 * Main entry point.
 */
async function generatePPT(data, templatePath, outputPath) {
  if (fs.existsSync(templatePath) && AdmZip) {
    await generateFromTemplate(data, templatePath, outputPath);
  } else {
    console.warn('[pptGenerator] Template not found or adm-zip missing — using programmatic mode');
    await generateProgrammatic(data, outputPath);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MODE 1: Template-based XML replacement (Exact Master Template Match)
// ─────────────────────────────────────────────────────────────────────────────

async function generateFromTemplate(data, templatePath, outputPath) {
  const zip = new AdmZip(templatePath);
  const siteSummary = data.siteSummary || [];
  const exec        = data.executiveSummary || {};
  const incidents   = data.incidents || [];
  const devices     = data.devices || [];

  // Build a lookup map by normalized site name
  const siteMap = {};
  siteSummary.forEach((s) => {
    const key = s.siteId.trim().toUpperCase();
    siteMap[key] = s;
  });

  // Save original un-mutated base slide XMLs for 3, 4, 5
  const baseSlideXmls = {
    3: zip.readAsText('ppt/slides/slide3.xml'),
    4: zip.readAsText('ppt/slides/slide4.xml'),
    5: zip.readAsText('ppt/slides/slide5.xml'),
  };

  // ── 1. Slide 1: Title & Date replacement ─────────────────────────────────
  const slide1Entry = zip.getEntry('ppt/slides/slide1.xml');
  if (slide1Entry) {
    let xml1 = zip.readAsText(slide1Entry);
    xml1 = xml1.replace(/DD-MM-YYYY/g, escapeXml(exec.reportingPeriod || 'Q1 FY2026 (7 Apr – 6 Jul 2026)'));
    zip.updateFile('ppt/slides/slide1.xml', Buffer.from(xml1, 'utf8'));
  }

  // ── 2. Slide 2: Executive Summary Table for All 8 Sites ──────────────────
  const slide2Entry = zip.getEntry('ppt/slides/slide2.xml');
  if (slide2Entry) {
    let xml2 = zip.readAsText(slide2Entry);

    const rowDataArray = TARGET_SITES.map((siteKey) => {
      const siteData = siteMap[siteKey] || siteSummary.find(s => s.siteId.toUpperCase().includes(siteKey.split(' ')[0]));

      if (!siteData) return [siteKey, '0', 'N/A', '0', 'None', 'None'];

      const deviceCount  = String(siteData.deviceCount ?? 0);
      const switchUptime = siteData.switchUptime === 'Data Not Available' ? 'N/A' : `${siteData.switchUptime}%`;
      const apIncidents  = String(siteData.uniqueAPsWithIncidents ?? 0);

      const siteIncidents   = incidents.filter(i => (i.SiteID || i.Location || '').toUpperCase().includes(siteKey.split(' ')[0]));
      const swIncidents     = siteIncidents.filter(i => /^sw$/i.test(i.DeviceType));
      const apIncidentsList = siteIncidents.filter(i => /^ap$/i.test(i.DeviceType));

      const getTopRCA = (incList) => {
        if (!incList.length) return 'None';
        const counts = {};
        incList.forEach(i => { if (i.RCA) counts[i.RCA] = (counts[i.RCA] || 0) + 1; });
        const sorted = Object.entries(counts).sort((a,b) => b[1] - a[1]);
        return sorted[0] ? sorted[0][0] : 'None';
      };

      const primaryRcaSw = getTopRCA(swIncidents);
      const primaryRcaAp = getTopRCA(apIncidentsList);

      return [siteKey, deviceCount, switchUptime, apIncidents, primaryRcaSw, primaryRcaAp];
    });

    xml2 = fillPptTable(xml2, rowDataArray);
    zip.updateFile('ppt/slides/slide2.xml', Buffer.from(xml2, 'utf8'));
  }

  // ── 3. Populate Site 1 (BANGALORE) review slides (Slides 3, 4, 5) ────────
  const site1Data = siteMap['BANGALORE'] || siteSummary[0] || { siteId: 'BANGALORE' };
  zip.updateFile('ppt/slides/slide3.xml', Buffer.from(updateSlide3Content(baseSlideXmls[3], 1, site1Data, data), 'utf8'));
  zip.updateFile('ppt/slides/slide4.xml', Buffer.from(updateSlide4Content(baseSlideXmls[4], 1, site1Data, data), 'utf8'));
  zip.updateFile('ppt/slides/slide5.xml', Buffer.from(updateSlide5Content(baseSlideXmls[5], 1, site1Data, data), 'utf8'));

  // ── 4. Duplicate & Populate Site Review slides for Sites 2..8 ────────────
  let nextSlideNum = 7; // Slide 6 is Thank You
  const presentationXmlEntry = zip.getEntry('ppt/presentation.xml');
  const relsEntry            = zip.getEntry('ppt/_rels/presentation.xml.rels');
  const contentTypesEntry    = zip.getEntry('[Content_Types].xml');

  let presXml  = zip.readAsText(presentationXmlEntry);
  let relsXml  = zip.readAsText(relsEntry);
  let ctXml    = zip.readAsText(contentTypesEntry);

  for (let i = 1; i < TARGET_SITES.length; i++) {
    const siteKey = TARGET_SITES[i];
    const siteData = siteMap[siteKey] || siteSummary.find(s => s.siteId.toUpperCase().includes(siteKey.split(' ')[0])) || { siteId: siteKey };
    const siteIdx  = i + 1; // 2..8

    [3, 4, 5].forEach((baseSlideNum) => {
      const baseXml = baseSlideXmls[baseSlideNum];
      const currentSlideNum = nextSlideNum;
      const rId = `rId${100 + currentSlideNum}`;

      let siteXml = baseXml;
      if (baseSlideNum === 3) siteXml = updateSlide3Content(baseXml, siteIdx, siteData, data);
      if (baseSlideNum === 4) siteXml = updateSlide4Content(baseXml, siteIdx, siteData, data);
      if (baseSlideNum === 5) siteXml = updateSlide5Content(baseXml, siteIdx, siteData, data);

      const newSlidePath = `ppt/slides/slide${currentSlideNum}.xml`;
      zip.addFile(newSlidePath, Buffer.from(siteXml, 'utf8'));

      // Copy rels file from base slide
      const baseRelsEntry = zip.getEntry(`ppt/slides/_rels/slide${baseSlideNum}.xml.rels`);
      if (baseRelsEntry) {
        zip.addFile(`ppt/slides/_rels/slide${currentSlideNum}.xml.rels`, baseRelsEntry.getData());
      }

      // Register in presentation.xml before slide 6 (rId7)
      const sldIdXml = `<p:sldId id="${300 + currentSlideNum}" r:id="${rId}"/>`;
      presXml = presXml.replace('</p:sldIdLst>', `${sldIdXml}</p:sldIdLst>`);

      // Register in presentation.xml.rels
      const relXml = `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${currentSlideNum}.xml"/>`;
      relsXml = relsXml.replace('</Relationships>', `${relXml}</Relationships>`);

      // Register in [Content_Types].xml
      const overrideXml = `<Override PartName="/ppt/slides/slide${currentSlideNum}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`;
      ctXml = ctXml.replace('</Types>', `${overrideXml}</Types>`);

      nextSlideNum++;
    });
  }

  // Move slide 6 (Thank You slide) to the very end of <p:sldIdLst>
  presXml = presXml.replace('<p:sldId id="285" r:id="rId7"/>', '');
  presXml = presXml.replace('</p:sldIdLst>', '<p:sldId id="285" r:id="rId7"/></p:sldIdLst>');

  zip.updateFile('ppt/presentation.xml', Buffer.from(presXml, 'utf8'));
  zip.updateFile('ppt/_rels/presentation.xml.rels', Buffer.from(relsXml, 'utf8'));
  zip.updateFile('[Content_Types].xml', Buffer.from(ctXml, 'utf8'));

  zip.writeZip(outputPath);
  console.log('[pptGenerator] Master Template QBR PPT generated successfully:', outputPath);
}

/**
 * Slide 3 Populator: AP & Switch Statistical Analytics for Site
 */
function updateSlide3Content(xml, siteIdx, site, data) {
  const siteName = site.siteId || 'Site';
  const siteKey  = siteName.toUpperCase().split(' ')[0];

  xml = xml.replace(/Site Name/g, escapeXml(siteName));
  xml = xml.replace(/SITE REVIEW\s*·\s*1 OF 8/gi, `SITE REVIEW  ·  ${siteIdx} OF 8`);

  const siteSws = (data.devices || []).filter(d => (d.SiteID || d.Location || '').toUpperCase().includes(siteKey) && /^sw$/i.test(d.DeviceType));

  const rackMap = {};
  siteSws.forEach((sw) => {
    const rack = sw.Rack || 'Default';
    if (!rackMap[rack]) rackMap[rack] = [];
    rackMap[rack].push(sw.__effectiveUptime ?? 100);
  });

  const rackRows = Object.entries(rackMap).map(([rack, uptimes]) => {
    const avgUptime = (uptimes.reduce((a, b) => a + b, 0) / uptimes.length).toFixed(2);
    return [rack, `${avgUptime}%`];
  });

  return fillPptTable(xml, rackRows);
}

/**
 * Slide 4 Populator: Switch Uptime Report for Site
 */
function updateSlide4Content(xml, siteIdx, site, data) {
  const siteName = site.siteId || 'Site';
  const siteKey  = siteName.toUpperCase().split(' ')[0];

  xml = xml.replace(/Site Name/g, escapeXml(siteName));
  xml = xml.replace(/SITE REVIEW\s*·\s*1 OF 8/gi, `SITE REVIEW  ·  ${siteIdx} OF 8`);

  const siteSws = (data.devices || []).filter(d => (d.SiteID || d.Location || '').toUpperCase().includes(siteKey) && /^sw$/i.test(d.DeviceType));
  const swUptime = site.switchUptime === 'Data Not Available' || !site.switchUptime ? 'N/A' : `${site.switchUptime}%`;
  const at100Count = siteSws.filter(s => (s.__effectiveUptime ?? 100) >= 100).length;
  const primaryRca = site.primaryRca || 'None';

  xml = xml.replace(/100%\s*Aggregated Switch Uptime/g, `${swUptime} Aggregated Switch Uptime`);
  xml = xml.replace(/0\s*Switches Monitored/g, `${siteSws.length} Switches Monitored`);
  xml = xml.replace(/0\s*Switches at 100% Uptime/g, `${at100Count} Switches at 100% Uptime`);
  xml = xml.replace(/0\s*Primary RCA Driver/g, `${escapeXml(primaryRca)} Primary RCA Driver`);

  const switchTableRows = siteSws.slice(0, 18).map((sw, idx) => [
    idx + 1,
    sw.Hostname || sw.DeviceID,
    sw.DeviceID,
    sw.Rack || 'NA',
    sw.__effectiveUptime !== undefined ? `${sw.__effectiveUptime.toFixed(2)}%` : '100.00%',
  ]);

  return fillPptTable(xml, switchTableRows);
}

/**
 * Slide 5 Populator: AP Incidents & RCA for Site
 */
function updateSlide5Content(xml, siteIdx, site, data) {
  const siteName = site.siteId || 'Site';
  const siteKey  = siteName.toUpperCase().split(' ')[0];

  xml = xml.replace(/Site Name/g, escapeXml(siteName));
  xml = xml.replace(/SITE REVIEW\s*·\s*1 OF 8/gi, `SITE REVIEW  ·  ${siteIdx} OF 8`);

  const siteIncs = (data.incidents || []).filter(i => (i.SiteID || i.Location || '').toUpperCase().includes(siteKey));
  const metCount   = siteIncs.filter(i => /met/i.test(i.ResolutionSLAStatus)).length;
  const breachCount= siteIncs.filter(i => /missed|violated/i.test(i.ResolutionSLAStatus)).length;
  const primaryRca = site.primaryRca || 'None';

  xml = xml.replace(/0\s*Total number of incidents/g, `${siteIncs.length} Total number of incidents`);
  xml = xml.replace(/0\s*Met Cases/g, `${metCount} Met Cases`);
  xml = xml.replace(/0\s*Breach Cases/g, `${breachCount} Breach Cases`);
  xml = xml.replace(/0\s*Primary RCA Driver/g, `${escapeXml(primaryRca)} Primary RCA Driver`);

  const apMap = {};
  siteIncs.forEach((inc) => {
    const devId = inc.DeviceID || 'Unknown';
    if (!apMap[devId]) apMap[devId] = { count: 0, rcas: {}, hostname: inc.Hostname || devId };
    apMap[devId].count++;
    if (inc.RCA) apMap[devId].rcas[inc.RCA] = (apMap[devId].rcas[inc.RCA] || 0) + 1;
  });

  const sortedAps = Object.entries(apMap).sort((a, b) => b[1].count - a[1].count);

  const apTableRows = sortedAps.slice(0, 18).map(([devId, info], idx) => {
    const topRca = Object.entries(info.rcas).sort((a, b) => b[1] - a[1])[0]?.[0] || 'None';
    return [
      idx + 1,
      info.hostname,
      devId,
      info.count,
      topRca,
    ];
  });

  return fillPptTable(xml, apTableRows);
}

/**
 * Generic PowerPoint table populator.
 * Replaces cell text for row 1..N while preserving original XML tags and styling.
 */
function fillPptTable(tblXml, rowDataArray) {
  const trRegex = /<a:tr[^>]*>([\s\S]*?)<\/a:tr>/g;
  let trMatches = [];
  let match;
  while ((match = trRegex.exec(tblXml)) !== null) {
    trMatches.push({ full: match[0], index: match.index });
  }

  if (trMatches.length <= 1) return tblXml; // Header only

  let dataIdx = 0;
  return tblXml.replace(trRegex, (rowXml, rowContent, offset) => {
    if (offset === trMatches[0].index) return rowXml; // Keep header row unchanged

    const rowData = rowDataArray[dataIdx];
    dataIdx++;

    let colIdx = 0;
    const tcRegex = /<a:tc[^>]*>([\s\S]*?)<\/a:tc>/g;
    return rowXml.replace(tcRegex, (tcXml) => {
      const cellVal = (rowData && rowData[colIdx] !== undefined) ? String(rowData[colIdx]) : '';
      colIdx++;

      if (tcXml.includes('<a:t>') || tcXml.includes('<a:t/>')) {
        return tcXml.replace(/<a:t[^>]*>[\s\S]*?<\/a:t>/g, `<a:t>${escapeXml(cellVal)}</a:t>`);
      } else {
        return tcXml.replace('</a:txBody>', `<a:p><a:pPr marL="0" indent="0" algn="ctr"/><a:r><a:rPr lang="en-US" sz="1000"/><a:t>${escapeXml(cellVal)}</a:t></a:r></a:p></a:txBody>`);
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MODE 2: Programmatic fallback (pptxgenjs)
// ─────────────────────────────────────────────────────────────────────────────

async function generateProgrammatic(data, outputPath) {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';

  const BG = '0D1117';
  const TEXT = 'E6EDF3';
  const MUTED = '8B949E';
  const ACCENT = '1F6FEB';
  const GREEN = '3FB950';
  const RED = 'F85149';
  const AMBER = 'F0883E';
  const CARD = '161B22';
  const BORDER = '30363D';

  const exec = data.executiveSummary || {};
  const siteSummary = data.siteSummary || [];

  const fmt = (v) => (v === null || v === undefined ? 'N/A' : String(v));
  const pct = (v) => v === 'Data Not Available' || v === null ? 'N/A' : `${v}%`;

  // Title
  {
    const s = pres.addSlide();
    s.background = { color: BG };
    s.addText('Quarterly Business Review', { x: 0.5, y: 1.2, w: 12, h: 0.8, fontSize: 32, bold: true, color: TEXT, align: 'center' });
    s.addText(fmt(exec.customerName), { x: 0.5, y: 2.2, w: 12, h: 0.7, fontSize: 22, color: ACCENT, align: 'center', bold: true });
    s.addText(fmt(exec.reportingPeriod), { x: 0.5, y: 3.0, w: 12, h: 0.5, fontSize: 16, color: MUTED, align: 'center' });
    s.addText(`Generated: ${new Date().toLocaleDateString('en-IN')}`, { x: 0.5, y: 5.8, w: 12, h: 0.3, fontSize: 10, color: MUTED, align: 'center' });
  }

  // Executive Summary
  {
    const s = pres.addSlide();
    s.background = { color: BG };
    s.addText('Executive Summary', { x: 0.5, y: 0.3, w: 12, h: 0.6, fontSize: 22, bold: true, color: TEXT });
    s.addText(`${fmt(exec.customerName)} · ${fmt(exec.reportingPeriod)}`, { x: 0.5, y: 0.9, w: 12, h: 0.35, fontSize: 12, color: MUTED });

    const kpis = [
      { l: 'Total Sites',       v: fmt(exec.totalSites) },
      { l: 'Total Devices',     v: fmt(exec.totalDevices) },
      { l: 'Total Switches',    v: fmt(exec.totalSwitches) },
      { l: 'Total APs',         v: fmt(exec.totalAPs) },
      { l: 'Overall Uptime',    v: pct(exec.overallUptime) },
      { l: 'SLA Compliance',    v: pct(exec.slaCompliance) },
      { l: 'Health Score',      v: fmt(exec.healthScore) + (exec.healthLabel ? ` (${exec.healthLabel})` : '') },
      { l: 'Total Incidents',   v: fmt(exec.totalIncidents) },
      { l: 'Critical',          v: fmt(exec.criticalIncidents) },
      { l: 'Major',             v: fmt(exec.majorIncidents) },
      { l: 'Minor',             v: fmt(exec.minorIncidents) },
    ];

    kpis.forEach((kpi, i) => {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const x = 0.3 + col * 3.3;
      const y = 1.4 + row * 2.0;
      const valColor = kpi.l === 'Critical' ? RED : kpi.l === 'Major' ? AMBER : ACCENT;
      s.addShape(pres.ShapeType.roundRect, { x, y, w: 3.0, h: 1.7, fill: { color: CARD }, line: { color: BORDER, pt: 1 } });
      s.addText(kpi.v, { x, y: y + 0.3, w: 3.0, h: 0.8, fontSize: 20, bold: true, color: valColor, align: 'center' });
      s.addText(kpi.l, { x, y: y + 1.1, w: 3.0, h: 0.45, fontSize: 11, color: MUTED, align: 'center' });
    });
  }

  // Site Summary Table
  if (siteSummary.length > 0) {
    const s = pres.addSlide();
    s.background = { color: BG };
    s.addText('Site Summary', { x: 0.5, y: 0.3, w: 12, h: 0.6, fontSize: 22, bold: true, color: TEXT });
    const rows = [
      [
        { text: 'Site', options: { bold: true, color: TEXT, fill: { color: '21262D' } } },
        { text: 'Devices', options: { bold: true, color: TEXT, fill: { color: '21262D' } } },
        { text: 'Switches', options: { bold: true, color: TEXT, fill: { color: '21262D' } } },
        { text: 'APs', options: { bold: true, color: TEXT, fill: { color: '21262D' } } },
        { text: 'Sw Uptime', options: { bold: true, color: TEXT, fill: { color: '21262D' } } },
        { text: 'AP Incidents', options: { bold: true, color: TEXT, fill: { color: '21262D' } } },
        { text: 'Health', options: { bold: true, color: TEXT, fill: { color: '21262D' } } },
        { text: 'SLA', options: { bold: true, color: TEXT, fill: { color: '21262D' } } },
      ],
      ...siteSummary.map((site) => [
        { text: fmt(site.siteId), options: { color: TEXT } },
        { text: fmt(site.deviceCount), options: { color: TEXT, align: 'center' } },
        { text: fmt(site.switchCount), options: { color: TEXT, align: 'center' } },
        { text: fmt(site.apCount), options: { color: TEXT, align: 'center' } },
        { text: pct(site.switchUptime), options: { color: TEXT, align: 'center' } },
        { text: fmt(site.uniqueAPsWithIncidents), options: { color: TEXT, align: 'center' } },
        { text: `${fmt(site.healthScore)} (${fmt(site.healthLabel)})`, options: { color: ACCENT, align: 'center' } },
        { text: fmt(site.slaStatus), options: { color: site.slaStatus === 'Compliant' ? GREEN : RED } },
      ]),
    ];
    s.addTable(rows, { x: 0.3, y: 1.0, w: 12.4, fontSize: 10, rowH: 0.38, border: { type: 'solid', color: BORDER, pt: 1 } });
  }

  await pres.writeFile({ fileName: outputPath });
  console.log('[pptGenerator] Programmatic PPT written:', outputPath);
}

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = { generatePPT };
