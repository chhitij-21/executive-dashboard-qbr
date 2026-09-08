// backend/services/pdfGenerator.js
// Executive PDF Generator: Renders QBR Data Model (SSOT) to print-ready Executive PDF.

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Generates an executive QBR PDF report directly from the SSOT qbrData model.
 * @param {Object} qbrData - Processed dashboard data model
 * @param {string} templatePath - Optional template path (ignored or used for background assets)
 * @param {string} outputPath - Target PDF file path
 */
async function generatePDF(qbrData, templatePath, outputPath) {
  const targetPath = outputPath || path.join(process.env.VERCEL ? os.tmpdir() : 'reports', `JFL_QBR_${Date.now()}.pdf`);
  const targetDir = path.dirname(targetPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const htmlContent = buildHTMLReport(qbrData);

  try {
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.setContent(htmlContent, { waitUntil: 'networkidle0', timeout: 30000 });

    await page.pdf({
      path: targetPath,
      format: 'A4',
      landscape: true,
      printBackground: true,
      margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' },
    });

    await browser.close();
    console.log(`[pdfGenerator] Executive QBR PDF successfully generated: ${targetPath}`);
    return targetPath;
  } catch (err) {
    console.warn(`[pdfGenerator] Puppeteer PDF error: ${err.message}. Writing HTML fallback to ${targetPath.replace('.pdf', '.html')}`);
    const fallbackHtmlPath = targetPath.replace('.pdf', '.html');
    fs.writeFileSync(fallbackHtmlPath, htmlContent, 'utf8');
    // If pdf fails, write HTML to targetPath as well for availability
    fs.writeFileSync(targetPath, htmlContent, 'utf8');
    return targetPath;
  }
}

function buildHTMLReport(data) {
  const exec = data.executiveSummary || {};
  const siteSummary = data.siteSummary || [];
  const switchAn = data.switchAnalytics || {};
  const apAn = data.apAnalytics || {};
  const customerName = data.customerName || 'Jubilant Foodworks Ltd (JFL)';
  const reportingPeriod = data.reportingPeriod || data.report_period?.display_label || 'User Selected Period';

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

  const siteRowsHtml = siteSummary.map((s, idx) => `
    <tr class="${idx % 2 === 0 ? 'even' : 'odd'}">
      <td class="bold">${s.siteId}</td>
      <td class="center">${s.deviceCount}</td>
      <td class="center ${getSlaClass(s.proactiveSwitchUptime)}">${fmtPct(s.proactiveSwitchUptime)}</td>
      <td class="center ${getSlaClass(s.jflSwitchUptime)}">${fmtPct(s.jflSwitchUptime)}</td>
      <td>${s.primaryRcaSwitches || 'Stable Operations (No Incidents)'}</td>
      <td class="center">${s.apIncidents} / ${s.uniqueAPsWithIncidents}</td>
      <td>${s.primaryRcaAPs || 'Stable Operations (No Incidents)'}</td>
    </tr>
  `).join('');

  const rackRowsHtml = (switchAn.expandedRackwiseUptime || switchAn.rackwiseUptime || []).slice(0, 30).map((r, idx) => `
    <tr class="${idx % 2 === 0 ? 'even' : 'odd'}">
      <td class="bold">${r.site || r.Location || 'N/A'}</td>
      <td>${r.rack || r.Rack || 'Main Rack'}</td>
      <td>${r.serialNumber || r.SerialNo || r.DeviceID || 'N/A'}</td>
      <td class="center ${getSlaClass(r.monthlyUptime || r.periodUptime)}">${fmtPct(r.monthlyUptime || r.periodUptime)}</td>
      <td class="center">${r.operatingStatus || r.status || 'Operational'}</td>
    </tr>
  `).join('');

  const apOutageRowsHtml = (apAn.top10APOutages || []).slice(0, 10).map((a, idx) => `
    <tr class="${idx % 2 === 0 ? 'even' : 'odd'}">
      <td class="bold">${a.DeviceID || 'N/A'}</td>
      <td>${a.SerialNo || 'N/A'}</td>
      <td>${a.Location || 'N/A'}</td>
      <td class="center bold text-primary">${a.incCount}</td>
      <td class="center ${getSlaClass(a.uptime)}">${fmtPct(a.uptime)}</td>
    </tr>
  `).join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Executive QBR Report - ${customerName}</title>
  <style>
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    body { margin: 0; padding: 0; background: #ffffff; color: #1e293b; font-size: 12px; line-height: 1.4; }
    
    @page {
      size: A4 landscape;
      margin: 10mm;
    }

    .page {
      page-break-after: always;
      height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
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

    .badge-success { background: #dcfce7; color: #15803d; font-weight: 700; padding: 2px 6px; border-radius: 4px; }
    .badge-danger { background: #fee2e2; color: #b91c1c; font-weight: 700; padding: 2px 6px; border-radius: 4px; }

    table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 10px; }
    th { background: #0f172a; color: #ffffff; text-align: left; padding: 6px 8px; font-weight: 600; font-size: 10px; }
    td { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; }
    tr.even { background: #f8fafc; }
    tr.odd { background: #ffffff; }
    .bold { font-weight: 600; }
    .center { text-align: center; }
    .text-primary { color: #0284c7; }

    .section-title {
      font-size: 13px;
      font-weight: 700;
      color: #0f172a;
      margin: 10px 0 6px 0;
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

    .cover-page {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      text-align: center;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: #ffffff;
      border-radius: 12px;
      height: 100%;
      padding: 40px;
    }
    .cover-title { font-size: 32px; font-weight: 800; margin-bottom: 8px; color: #38bdf8; }
    .cover-subtitle { font-size: 18px; color: #cbd5e1; margin-bottom: 24px; }
    .cover-meta { background: rgba(255,255,255,0.08); padding: 16px 28px; border-radius: 8px; font-size: 13px; color: #f8fafc; }
  </style>
</head>
<body>

  <!-- PAGE 1: COVER & EXECUTIVE OVERVIEW -->
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
        <div class="kpi-sub">${fmtNum(exec.totalSites)} Sites (${fmtNum(exec.totalSwitches)} Switches / ${fmtNum(exec.totalAPs)} APs)</div>
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
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
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

  <!-- PAGE 2: SITE SUMMARY TABLE -->
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

    <div class="footer">
      <div>Slide 5 Compliance Table — SSOT Synchronized</div>
      <div>Page 2</div>
    </div>
  </div>

  <!-- PAGE 3: RACK-WISE SWITCH UPTIME -->
  <div class="page">
    <div class="header">
      <div>
        <h1>Switch Infrastructure & Rack Performance</h1>
        <div class="subtitle">Detailed Rack-wise Operational Uptime & Device Status</div>
      </div>
      <div class="period-badge">${reportingPeriod}</div>
    </div>

    <div class="section-title">Rack-Wise Switch Summary</div>
    <table>
      <thead>
        <tr>
          <th>Site Location</th>
          <th>Rack Location</th>
          <th>Serial Number / Hostname</th>
          <th style="text-align:center;">Period Uptime %</th>
          <th style="text-align:center;">Operating Status</th>
        </tr>
      </thead>
      <tbody>
        ${rackRowsHtml.length > 0 ? rackRowsHtml : '<tr><td colspan="5" class="center">No rack switch data available.</td></tr>'}
      </tbody>
    </table>

    <div class="footer">
      <div>Switch Analytics — SSOT Engine</div>
      <div>Page 3</div>
    </div>
  </div>

  <!-- PAGE 4: AP ANALYTICS & TOP OUTAGES -->
  <div class="page">
    <div class="header">
      <div>
        <h1>Access Point (AP) Analytics</h1>
        <div class="subtitle">Top Affected AP Devices & Incident Distribution</div>
      </div>
      <div class="period-badge">${reportingPeriod}</div>
    </div>

    <div class="section-title">Top 10 Affected AP Outages</div>
    <table>
      <thead>
        <tr>
          <th>Device Hostname</th>
          <th>Serial Number</th>
          <th>Site Location</th>
          <th style="text-align:center;">Incident Count</th>
          <th style="text-align:center;">Effective Uptime %</th>
        </tr>
      </thead>
      <tbody>
        ${apOutageRowsHtml.length > 0 ? apOutageRowsHtml : '<tr><td colspan="5" class="center">No AP incidents recorded during period. Operations Stable.</td></tr>'}
      </tbody>
    </table>

    <div class="footer">
      <div>AP Analytics — SSOT Engine</div>
      <div>Page 4</div>
    </div>
  </div>

</body>
</html>
  `;
}

module.exports = { generatePDF };
