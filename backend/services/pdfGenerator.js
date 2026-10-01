// backend/services/pdfGenerator.js
// Executive PDF Generator: Renders QBR Data Model (SSOT) to print-ready Executive Report (Binary PDF / Print HTML).

const fs = require('fs');
const path = require('path');
const os = require('os');

let puppeteer;
try {
  puppeteer = require('puppeteer');
} catch (e) {
  puppeteer = null;
}

/**
 * Locates Chrome executable if default Puppeteer shell is not available.
 */
function findChromeExecutable() {
  const candidatePaths = [
    path.join(os.homedir(), '.cache', 'puppeteer', 'chrome', 'win64-151.0.7922.47', 'chrome-win64', 'chrome.exe'),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium'
  ];
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Attempts to render HTML string into a binary PDF using Puppeteer.
 */
async function tryRenderPuppeteerPDF(htmlContent, outputPath) {
  if (!puppeteer) return false;
  let browser = null;
  try {
    try {
      browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    } catch (e1) {
      const execPath = findChromeExecutable();
      if (execPath) {
        browser = await puppeteer.launch({ headless: true, executablePath: execPath, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
      }
    }

    if (!browser) return false;

    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'domcontentloaded' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' }
    });
    await browser.close();

    if (pdfBuffer && pdfBuffer.length > 0) {
      fs.writeFileSync(outputPath, pdfBuffer);
      console.log(`[pdfGenerator] Real Binary PDF successfully generated via Puppeteer: ${outputPath} (${pdfBuffer.length} bytes)`);
      return true;
    }
  } catch (err) {
    console.warn(`[pdfGenerator] Puppeteer PDF notice: ${err.message}. Falling back to HTML format.`);
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
  }
  return false;
}

/**
 * Generates an executive QBR report directly from the SSOT qbrData model.
 * Attempts binary PDF generation via Puppeteer first; falls back to print-optimized HTML.
 *
 * @param {Object} qbrData - Processed dashboard data model (SSOT)
 * @param {string} templatePath - Optional template path (unused)
 * @param {string} outputPath - Target file path (.pdf extension)
 */
async function generatePDF(qbrData, templatePath, outputPath) {
  const targetPath = outputPath || path.join(process.env.VERCEL ? os.tmpdir() : 'reports', `JFL_QBR_${Date.now()}.pdf`);
  const targetDir = path.dirname(targetPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const htmlContent = buildHTMLReport(qbrData);

  // 1. Try rendering true binary PDF with Puppeteer
  const pdfSuccess = await tryRenderPuppeteerPDF(htmlContent, targetPath);
  if (pdfSuccess) {
    return targetPath;
  }

  // 2. Fallback: Write print-ready self-contained HTML report to target path
  fs.writeFileSync(targetPath, htmlContent, 'utf8');
  console.log(`[pdfGenerator] Executive QBR HTML Report generated (Fallback): ${targetPath}`);
  return targetPath;
}

function buildHTMLReport(data) {
  const exec = data.executiveSummary || {};
  const siteSummary = data.siteSummary || [];
  const switchAn = data.switchAnalytics || {};
  const apAn = data.apAnalytics || {};
  const rcaAn = data.rcaAnalytics || {};
  const customerName = data.customerName || exec.customerName || 'Jubilant Foodworks Ltd (JFL)';
  const reportingPeriod = data.reportingPeriod || data.report_period?.display_label || exec.reportingPeriod || 'User Selected Period';

  const fmtNum = (val, def = '0') => (val !== undefined && val !== null ? String(val) : def);
  const fmtPct = (val, def = '100.00%') => {
    if (val === undefined || val === null) return def;
    const s = String(val).replace('%', '');
    const n = parseFloat(s);
    return isNaN(n) ? def : `${n.toFixed(2)}%`;
  };

  const getSlaClass = (val, target = 99.3) => {
    const n = parseFloat(String(val).replace('%', ''));
    if (isNaN(n)) return 'badge-success';
    return n >= target ? 'badge-success' : 'badge-danger';
  };

  // 1. All Site Summary Rows
  const siteRowsHtml = siteSummary.map((s, idx) => `
    <tr class="${idx % 2 === 0 ? 'even' : 'odd'}">
      <td class="bold">${s.siteId}</td>
      <td class="center">${s.deviceCount || (s.switchCount + s.apCount) || 0}</td>
      <td class="center ${getSlaClass(s.proactiveSwitchUptime)}">${fmtPct(s.proactiveSwitchUptime)}</td>
      <td class="center ${getSlaClass(s.jflSwitchUptime)}">${fmtPct(s.jflSwitchUptime)}</td>
      <td>${s.primaryRcaSwitches || 'Stable Operations (No Incidents)'}</td>
      <td class="center">${s.apIncidents || 0} / ${s.uniqueAPsWithIncidents || 0}</td>
      <td>${s.primaryRcaAPs || 'Stable Operations (No Incidents)'}</td>
    </tr>
  `).join('');

  // 2. All Switch Devices (UNTRUNCATED)
  let rackSwitches = switchAn.expandedRackwiseUptime || switchAn.rackwiseUptime || [];
  if (!rackSwitches || rackSwitches.length === 0) {
    const devices = data.devices || [];
    rackSwitches = devices.filter(d => (d.DeviceType === 'SW' || (d.DeviceID && d.DeviceID.includes('-SW-'))) && !d.__isStock);
  }

  const rackRowsHtml = rackSwitches.map((r, idx) => `
    <tr class="${idx % 2 === 0 ? 'even' : 'odd'}">
      <td class="bold">${r.site || r.Location || r.SiteID || 'N/A'}</td>
      <td>${r.rack || r.Rack || 'Main Rack'}</td>
      <td>${r.serialNumber || r.SerialNo || 'N/A'}</td>
      <td class="bold">${r.hostname || r.Hostname || r.DeviceID || 'N/A'}</td>
      <td class="center ${getSlaClass(r.proactiveUptime || r.__proactiveUptime || r.monthlyUptime || r.periodUptime)}">${fmtPct(r.proactiveUptime || r.__proactiveUptime || r.monthlyUptime || r.periodUptime)}</td>
      <td class="center ${getSlaClass(r.jflUptime || r.monthlyUptime || r.__jflUptime || r.periodUptime)}">${fmtPct(r.jflUptime || r.monthlyUptime || r.__jflUptime || r.periodUptime)}</td>
      <td class="center">${r.operatingStatus || r.status || (r.__slaBreach ? '<span class="badge-danger">Breached</span>' : '<span class="badge-success">Operational</span>')}</td>
    </tr>
  `).join('');

  // 3. All AP Devices / Outages (UNTRUNCATED)
  let apOutages = apAn.allAPOutages || apAn.top10APOutages || [];
  if (!apOutages || apOutages.length === 0) {
    const incidents = data.incidents || data.incidentDetails || [];
    const apIncidents = incidents.filter(i => i.DeviceType === 'AP' || (i.DeviceID && i.DeviceID.includes('-AP-')));
    const apMap = {};
    apIncidents.forEach(inc => {
      const id = inc.DeviceID || inc.SerialNo || 'Unknown-AP';
      if (!apMap[id]) {
        apMap[id] = {
          DeviceID: id,
          SerialNo: inc.SerialNo || id,
          Location: inc.Location || inc.SiteID || 'N/A',
          incCount: 0,
          uptime: inc.__effectiveUptime || inc.uptime || '98.50%',
          rca: inc.RCA || inc.Category || 'Device Power Issues'
        };
      }
      apMap[id].incCount++;
    });
    apOutages = Object.values(apMap);
  }

  const apOutageRowsHtml = apOutages.map((a, idx) => `
    <tr class="${idx % 2 === 0 ? 'even' : 'odd'}">
      <td class="bold">${a.DeviceID || a.Hostname || 'N/A'}</td>
      <td>${a.SerialNo || 'N/A'}</td>
      <td>${a.Location || a.SiteID || 'N/A'}</td>
      <td class="center bold text-primary">${a.incCount || 1}</td>
      <td class="center ${getSlaClass(a.uptime)}">${fmtPct(a.uptime)}</td>
      <td>${a.rca || a.RCA || a.primaryRca || 'Device Power Issues'}</td>
    </tr>
  `).join('');

  // 4. All Incident Audit Trail Records (UNTRUNCATED)
  const allIncidents = data.incidents || data.incidentDetails || data.incidentList || [];
  const incidentRowsHtml = allIncidents.map((inc, idx) => {
    const ref = inc.display_reference ? `${inc.display_reference.type}: ${inc.display_reference.value}` : (inc.TicketNumber || inc.IncidentNumber || inc.IncidentID || `INC-${idx+1}`);
    const slaBadge = inc.sla_status === 'SLA Breached' 
      ? '<span class="badge-danger">SLA Breached</span>'
      : '<span class="badge-success">SLA Met</span>';

    return `
      <tr class="${idx % 2 === 0 ? 'even' : 'odd'}">
        <td class="bold">${ref}</td>
        <td>${inc.Location || inc.SiteID || inc.Site || 'N/A'}</td>
        <td>${inc.DeviceID || inc.SerialNo || 'N/A'}</td>
        <td class="center">${inc.DeviceType || (inc.DeviceID?.includes('-AP-') ? 'AP' : 'Switch')}</td>
        <td class="center">${inc.HoldTimeMin !== undefined ? inc.HoldTimeMin : (inc.HoldDurationMin || 0)} min</td>
        <td class="center">${inc.ActualResolutionMin !== undefined ? inc.ActualResolutionMin : (inc.ResolutionMin || 0)} min</td>
        <td>${inc.RCA || inc.Category || 'Operational Fault'}</td>
        <td class="center">${slaBadge}</td>
      </tr>
    `;
  }).join('');

  // 5. RCA Breakdown Rows
  const rcaBreakdownList = rcaAn.breakdown || rcaAn.rawBreakdown || switchAn.rcaBreakdown || [];
  const rcaRowsHtml = Array.isArray(rcaBreakdownList) ? rcaBreakdownList.map((r, idx) => `
    <tr class="${idx % 2 === 0 ? 'even' : 'odd'}">
      <td class="bold">${r.category || r.rca || r.name || 'Other'}</td>
      <td class="center">${r.count || r.incidents || 0}</td>
      <td class="center">${fmtPct(r.percentage || r.share)}</td>
    </tr>
  `).join('') : '';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Executive QBR Summary Report - ${customerName}</title>
  <style>
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    body { margin: 0; padding: 0; background: #ffffff; color: #1e293b; font-size: 11px; line-height: 1.4; }
    
    @page {
      size: A4 landscape;
      margin: 10mm;
    }

    .page {
      page-break-after: always;
      padding: 10px;
    }
    .page:last-child { page-break-after: avoid; }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 3px solid #0284c7;
      padding-bottom: 8px;
      margin-bottom: 12px;
    }
    .header h1 { margin: 0; font-size: 20px; color: #0f172a; font-weight: 700; }
    .header .subtitle { font-size: 11px; color: #64748b; margin-top: 2px; }
    .header .period-badge { background: #e0f2fe; color: #0369a1; font-weight: 600; padding: 4px 10px; border-radius: 20px; font-size: 11px; }

    .footer {
      border-top: 1px solid #e2e8f0;
      padding-top: 6px;
      margin-top: 16px;
      display: flex;
      justify-content: space-between;
      font-size: 9px;
      color: #94a3b8;
    }

    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 14px;
    }
    .kpi-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 10px 12px;
    }
    .kpi-title { font-size: 10px; text-transform: uppercase; color: #64748b; font-weight: 600; letter-spacing: 0.5px; }
    .kpi-value { font-size: 20px; font-weight: 800; color: #0f172a; margin: 4px 0 2px 0; }
    .kpi-sub { font-size: 9px; color: #64748b; }

    .badge-success { background: #dcfce7; color: #15803d; font-weight: 700; padding: 2px 6px; border-radius: 4px; display: inline-block; }
    .badge-danger { background: #fee2e2; color: #b91c1c; font-weight: 700; padding: 2px 6px; border-radius: 4px; display: inline-block; }

    table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 10px; }
    th { background: #0f172a; color: #ffffff; text-align: left; padding: 6px 8px; font-weight: 600; font-size: 10px; }
    td { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; }
    tr { page-break-inside: avoid; }
    tr.even { background: #f8fafc; }
    tr.odd { background: #ffffff; }
    .bold { font-weight: 600; }
    .center { text-align: center; }
    .text-primary { color: #0284c7; }

    .section-title {
      font-size: 13px;
      font-weight: 700;
      color: #0f172a;
      margin: 12px 0 6px 0;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .section-title::before {
      content: '';
      display: inline-block;
      width: 4px;
      height: 14px;
      background: #0284c7;
      border-radius: 2px;
    }

    @media print {
      .no-print { display: none !important; }
      body { background: #fff; }
      .page { page-break-after: always; }
    }
    @media screen {
      body { background: #f1f5f9; padding: 20px; }
      .page {
        background: #ffffff;
        border-radius: 12px;
        box-shadow: 0 4px 24px rgba(0,0,0,0.10);
        margin-bottom: 32px;
        padding: 28px 32px;
        max-width: 1200px;
        margin-left: auto;
        margin-right: auto;
      }
      .print-hint {
        background: linear-gradient(135deg, #0f172a, #1e3a5f);
        color: #e0f2fe;
        padding: 14px 28px;
        text-align: center;
        font-size: 13px;
        font-weight: 500;
        border-radius: 10px;
        margin-bottom: 28px;
        max-width: 1200px;
        margin-left: auto;
        margin-right: auto;
        box-shadow: 0 2px 8px rgba(2,132,199,0.3);
      }
      .print-hint strong { color: #38bdf8; }
      .print-hint kbd { background: rgba(255,255,255,0.15); padding: 2px 8px; border-radius: 4px; font-family: monospace; }
    }
  </style>
</head>
<body>

  <!-- SCREEN-ONLY PRINT HINT BANNER -->
  <div class="print-hint no-print">
    📄 <strong>Executive QBR Report</strong> &nbsp;|&nbsp;
    To save as PDF: Press <kbd>Ctrl+P</kbd> (Windows) or <kbd>⌘+P</kbd> (Mac) &nbsp;→&nbsp; Destination: <strong>Save as PDF</strong> &nbsp;→&nbsp; Layout: <strong>Landscape</strong> &nbsp;→&nbsp; Save
  </div>

  <!-- SECTION 1: EXECUTIVE OVERVIEW -->
  <div class="page">
    <div class="header">
      <div>
        <h1>Executive QBR Summary Report</h1>
        <div class="subtitle">${customerName}</div>
      </div>
      <div class="period-badge">📅 ${reportingPeriod}</div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-title">Total Infrastructure</div>
        <div class="kpi-value">${fmtNum(exec.totalDevices)} Devices</div>
        <div class="kpi-sub">${fmtNum(exec.totalSites)} Sites (${fmtNum(exec.totalSwitches)} Switches / ${fmtNum(exec.totalAPs)} APs / ${fmtNum(exec.totalStockDevices || exec.stockDevices)} Stock)</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">JFL Switch Uptime %</div>
        <div class="kpi-value ${getSlaClass(exec.jflSwitchUptime)}">${fmtPct(exec.jflSwitchUptime)}</div>
        <div class="kpi-sub">Target SLA: ${fmtNum(exec.slaTarget, '99.3')}%</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Proactive Switch Uptime %</div>
        <div class="kpi-value ${getSlaClass(exec.proactiveSwitchUptime)}">${fmtPct(exec.proactiveSwitchUptime)}</div>
        <div class="kpi-sub">Net Resolution Deducted</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Infrastructure Health Score</div>
        <div class="kpi-value text-primary">${fmtNum(exec.healthScore, '100')}/100</div>
        <div class="kpi-sub">${exec.healthLabel || 'Optimal Operations'} (${fmtPct(exec.incidentFreePercent)} Incident-Free)</div>
      </div>
    </div>

    <div class="section-title">Primary Executive Findings</div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
      <div class="kpi-card">
        <div class="kpi-title">Primary RCA Driver (Switches)</div>
        <div style="font-size: 14px; font-weight: 700; color: #0284c7; margin-top: 6px;">${exec.primaryRcaSwitches || 'Stable Operations (No Incidents)'}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Primary RCA Driver (APs)</div>
        <div style="font-size: 14px; font-weight: 700; color: #0284c7; margin-top: 6px;">${exec.primaryRcaAPs || 'Stable Operations (No Incidents)'}</div>
      </div>
    </div>

    <div class="footer">
      <div>Confidential — ${customerName} Executive Dashboard Report</div>
      <div>Generated on SSOT Engine: ${new Date().toISOString().slice(0,10)}</div>
    </div>
  </div>

  <!-- SECTION 2: SITE EXECUTIVE SUMMARY -->
  <div class="page">
    <div class="header">
      <div>
        <h1>Site Executive Performance Summary</h1>
        <div class="subtitle">Site-by-Site Device Uptime, Incident Totals & Primary Root Cause Analysis</div>
      </div>
      <div class="period-badge">${reportingPeriod}</div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Site Location</th>
          <th style="text-align:center;">No of Devices</th>
          <th style="text-align:center;">Proactive Switch Uptime</th>
          <th style="text-align:center;">JFL Switch Uptime</th>
          <th>Primary RCA Driver (Switches)</th>
          <th style="text-align:center;">AP Incidents (Unique)</th>
          <th>Primary RCA Driver (APs)</th>
        </tr>
      </thead>
      <tbody>
        ${siteRowsHtml.length > 0 ? siteRowsHtml : '<tr><td colspan="7" class="center">No site data available.</td></tr>'}
      </tbody>
    </table>

    <div class="section-title" style="margin-top: 14px;">External Site Dependencies & Client-Side Activity</div>
    <div style="background: #f8fafc; border: 1px solid #cbd5e1; padding: 10px 14px; border-radius: 6px; font-size: 10px; color: #334155; margin-top: 4px;">
      <strong>Note:</strong> Utility power cuts, store-side cabling activities, and third-party ISP outages are tracked transparently as local site dependencies and isolated from operational MSP SLA penalties.
      <div style="display: flex; gap: 16px; margin-top: 8px;">
        <div><strong>Contractual SLA Target:</strong> <span style="color: #15803d; font-weight: 700;">${fmtNum(exec.slaTarget, '99.3')}%</span></div>
        <div><strong>Overall SLA Compliance:</strong> <span style="color: #0284c7; font-weight: 700;">${fmtPct(exec.slaCompliance)}</span></div>
        <div><strong>Total Incident Records:</strong> <span style="color: #0f172a; font-weight: 700;">${fmtNum(exec.totalIncidents || allIncidents.length)}</span></div>
      </div>
    </div>

    <div class="footer">
      <div>Slide 5 Compliance Table — SSOT Synchronized</div>
      <div>Page 2</div>
    </div>
  </div>

  <!-- SECTION 3: SWITCH INFRASTRUCTURE UPTIME -->
  <div class="page">
    <div class="header">
      <div>
        <h1>Switch Infrastructure & Rack Performance (${rackSwitches.length} Devices)</h1>
        <div class="subtitle">Complete Rack-wise Operational Uptime & Device Status</div>
      </div>
      <div class="period-badge">${reportingPeriod}</div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Site Location</th>
          <th>Rack Location</th>
          <th>Serial Number</th>
          <th>Hostname / Device ID</th>
          <th style="text-align:center;">Proactive Uptime %</th>
          <th style="text-align:center;">JFL Uptime %</th>
          <th style="text-align:center;">Operating Status</th>
        </tr>
      </thead>
      <tbody>
        ${rackRowsHtml.length > 0 ? rackRowsHtml : '<tr><td colspan="7" class="center">No switch rack data available.</td></tr>'}
      </tbody>
    </table>

    <div class="footer">
      <div>Switch Analytics — SSOT Engine (Complete ${rackSwitches.length} Switches)</div>
      <div>Page 3</div>
    </div>
  </div>

  <!-- SECTION 4: ACCESS POINT (AP) OUTAGES -->
  <div class="page">
    <div class="header">
      <div>
        <h1>Access Point (AP) Analytics (${apOutages.length} Outage Records)</h1>
        <div class="subtitle">Complete AP Device Incident Distribution & Uptime Impact</div>
      </div>
      <div class="period-badge">${reportingPeriod}</div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Device Hostname / ID</th>
          <th>Serial Number</th>
          <th>Site Location</th>
          <th style="text-align:center;">Incident Count</th>
          <th style="text-align:center;">Effective Uptime %</th>
          <th>Primary RCA Driver</th>
        </tr>
      </thead>
      <tbody>
        ${apOutageRowsHtml.length > 0 ? apOutageRowsHtml : '<tr><td colspan="6" class="center">No AP outages recorded during period. Operations Stable.</td></tr>'}
      </tbody>
    </table>

    <div class="footer">
      <div>AP Analytics — SSOT Engine (Complete ${apOutages.length} AP Records)</div>
      <div>Page 4</div>
    </div>
  </div>

  ${rcaRowsHtml.length > 0 ? `
  <!-- SECTION 5: ROOT CAUSE ANALYSIS (RCA) BREAKDOWN -->
  <div class="page">
    <div class="header">
      <div>
        <h1>Root Cause Analysis (RCA) Distribution</h1>
        <div class="subtitle">Categorized Downtime Drivers & Technical Breakdown</div>
      </div>
      <div class="period-badge">${reportingPeriod}</div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Root Cause Category</th>
          <th style="text-align:center;">Incident Count</th>
          <th style="text-align:center;">Percentage Share (%)</th>
        </tr>
      </thead>
      <tbody>
        ${rcaRowsHtml}
      </tbody>
    </table>

    <div class="footer">
      <div>RCA Analytics — SSOT Engine</div>
      <div>Page 5</div>
    </div>
  </div>
  ` : ''}

  <!-- SECTION 6: INCIDENTS & SLA COMPLIANCE AUDIT TRAIL -->
  <div class="page">
    <div class="header">
      <div>
        <h1>Incidents & SLA Compliance Audit Trail (${allIncidents.length} Tickets)</h1>
        <div class="subtitle">Complete Ticket Log with Hold Time, Actual Resolution & SLA Breach Status</div>
      </div>
      <div class="period-badge">${reportingPeriod}</div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Reference (Ticket / Incident ID)</th>
          <th>Location</th>
          <th>Device ID / Serial</th>
          <th style="text-align:center;">Type</th>
          <th style="text-align:center;">Hold Time</th>
          <th style="text-align:center;">Fix Time</th>
          <th>RCA Driver</th>
          <th style="text-align:center;">SLA Status</th>
        </tr>
      </thead>
      <tbody>
        ${incidentRowsHtml.length > 0 ? incidentRowsHtml : '<tr><td colspan="8" class="center">No incident records found. Operations 100% Stable.</td></tr>'}
      </tbody>
    </table>

    <div class="footer">
      <div>Incidents Audit Trail — SSOT Engine (Complete ${allIncidents.length} Tickets)</div>
      <div>Page Audit</div>
    </div>
  </div>

</body>
</html>
  `;
}

module.exports = { generatePDF };
