// backend/services/pdfGenerator.js
// Executive PDF Generator: Renders QBR Data Model (SSOT) to print-ready Executive Report (Binary PDF / Print HTML).
// 100% PPT Data Coverage with Superior Formatting, Board-Level Representation & Print-Ready A4 Landscape PDF Output.

const fs = require('fs');
const path = require('path');
const os = require('os');
const ruleEngine = require('./ruleEngine');

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
      margin: { top: '6mm', bottom: '6mm', left: '6mm', right: '6mm' }
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

/**
 * Helper to split an array into chunks for multi-page pagination.
 */
function chunkArray(arr, chunkSize) {
  if (!arr || !arr.length) return [];
  const results = [];
  for (let i = 0; i < arr.length; i += chunkSize) {
    results.push(arr.slice(i, i + chunkSize));
  }
  return results;
}

function buildHTMLReport(data) {
  const exec = data.executiveSummary || {};
  const siteSummary = data.siteSummary || [];
  const switchAn = data.switchAnalytics || {};
  const apAn = data.apAnalytics || {};
  const rcaAn = data.rcaAnalytics || {};
  const pro = data.proactiveTicketAnalytics || {};
  const customerName = data.customerName || exec.customerName || 'Jubilant Foodworks Ltd (JFL)';
  const reportingPeriod = data.reportingPeriod || data.report_period?.display_label || exec.reportingPeriod || 'User Selected Period';
  
  // Contractual SLA Uptime Target is 99.30%
  const slaTargetNum = 99.30;
  let pageCounter = 1;

  const fmtNum = (val, def = '0') => (val !== undefined && val !== null ? String(val) : def);
  const fmtPct = (val, def = '100.00%') => {
    if (val === undefined || val === null) return def;
    const s = String(val).replace('%', '');
    const n = parseFloat(s);
    return isNaN(n) ? def : `${n.toFixed(2)}%`;
  };

  const getSlaClass = (val, target = slaTargetNum) => {
    if (val === undefined || val === null) return 'badge-success';
    const n = parseFloat(String(val).replace('%', ''));
    if (isNaN(n)) return 'badge-success';
    return n >= target ? 'badge-success' : 'badge-danger';
  };

  // 1. Executive Site Summary Table Rows (Slide 5 / Page 3 Format)
  const siteRowsHtml = siteSummary.map((s, idx) => {
    const proVal = s.proactiveTicketAvg ?? s.proactiveSwitchUptime;
    const jflVal = s.jflTicketAvg ?? s.jflSwitchUptime;
    const swRca = s.primaryRcaSwitches || s.primaryRca || 'Stable Operations (No Incidents)';
    const apRca = s.primaryRcaAPs || s.primaryRcaForAPs || 'Stable Operations (No Incidents)';
    return `
    <tr class="${idx % 2 === 0 ? 'even' : 'odd'}">
      <td class="bold text-left">${s.siteId}</td>
      <td class="center bold">${s.deviceCount || (s.switchCount + s.apCount) || 0}</td>
      <td class="center"><span class="${getSlaClass(proVal)}">${fmtPct(proVal)}</span></td>
      <td class="center"><span class="${getSlaClass(jflVal)}">${fmtPct(jflVal)}</span></td>
      <td class="text-left">${swRca}</td>
      <td class="center bold text-primary">${s.apIncidents || 0} / ${s.uniqueAPsWithIncidents || 0}</td>
      <td class="text-left">${apRca}</td>
    </tr>
  `;
  }).join('');

  // 1b. Site Inspector Summary Cards (Slide 4 Overview Cards)
  const siteInspectorCardsHtml = siteSummary.map((s) => {
    const proVal = s.proactiveTicketAvg ?? s.proactiveSwitchUptime ?? 100;
    const jflVal = s.jflTicketAvg ?? s.jflSwitchUptime ?? 100;
    const swRca = s.primaryRcaSwitches || s.primaryRca || 'Stable Operations (No Incidents)';
    const apRca = s.primaryRcaAPs || s.primaryRcaForAPs || 'Stable Operations (No Incidents)';
    const totalDevs = s.deviceCount || (s.switchCount + s.apCount) || 0;
    const stockDevs = s.stockCount !== undefined ? s.stockCount : Math.max(0, totalDevs - ((s.switchCount || 0) + (s.apCount || 0)));

    return `
      <div class="site-inspector-card">
        <div class="site-card-header">
          <div>
            <span class="site-card-title">${s.siteId}</span>
            <span class="site-card-sub">${totalDevs} Monitored Assets (${s.switchCount || 0} SW / ${s.apCount || 0} AP / ${stockDevs} Stock)</span>
          </div>
          <span class="${getSlaClass(proVal)}">${fmtPct(proVal)}</span>
        </div>
        <div class="site-card-body">
          <div class="site-stat-col">
            <div class="stat-label">JFL Switch Uptime</div>
            <div class="stat-val"><span class="${getSlaClass(jflVal)}">${fmtPct(jflVal)}</span></div>
          </div>
          <div class="site-stat-col">
            <div class="stat-label">AP Incidents (Unique)</div>
            <div class="stat-val text-primary">${s.apIncidents || 0} / ${s.uniqueAPsWithIncidents || 0}</div>
          </div>
          <div class="site-stat-col" style="grid-column: span 2;">
            <div class="stat-label">Primary RCA (Switches)</div>
            <div class="stat-val text-blue" style="font-size: 10px; font-weight: 600;">${swRca}</div>
          </div>
          <div class="site-stat-col" style="grid-column: span 2;">
            <div class="stat-label">Primary RCA (APs)</div>
            <div class="stat-val text-purple" style="font-size: 10px; font-weight: 600;">${apRca}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // 2. Per-Site Reviews (8 Monitored Sites with Paginated Tables)
  const TARGET_SITES = [
    'Bangalore', 'Greater Noida', 'Noida', 'Mohali',
    'Hyderabad', 'Nagpur', 'Mumbai-DC', 'Guwahati'
  ];
  const devicesList = data.devices || [];
  const incidentsList = data.incidents || data.incidentDetails || [];

  let perSiteSuitesHtml = '';

  TARGET_SITES.forEach((siteName, siteIdx) => {
    const sData = siteSummary.find(s => s.siteId === siteName) || {};
    const proVal = sData.proactiveTicketAvg ?? sData.proactiveSwitchUptime ?? '100.00';
    const jflVal = sData.jflTicketAvg ?? sData.jflSwitchUptime ?? '100.00';
    const swRca = sData.primaryRcaSwitches || sData.primaryRca || 'Stable Operations (No Incidents)';
    const apRca = sData.primaryRcaAPs || sData.primaryRcaForAPs || 'Stable Operations (No Incidents)';

    const siteDevs = devicesList.filter(d => (d.SiteID === siteName || d.Location === siteName) && !d.__isStock);
    const siteSws = siteDevs.filter(d => /^sw$/i.test(d.DeviceType || '') || (d.DeviceType || '').toLowerCase().includes('switch'));
    const siteAps = siteDevs.filter(d => /^ap$/i.test(d.DeviceType || '') || (d.DeviceType || '').toLowerCase().includes('access'));
    const siteIncs = incidentsList.filter(i => (i.SiteID === siteName || i.Location === siteName));
    const siteApIncs = siteIncs.filter(i => (i.DeviceType || '').toLowerCase().includes('ap') || (i.DeviceID && i.DeviceID.includes('-AP-')));

    // Page A: Statistical Analytics Page
    const rackMap = {};
    siteSws.forEach(d => {
      let rack = d.Rack || 'Main Rack';
      if (rack === 'NA' || rack.includes('Not Cover') || rack.length > 20) rack = 'Main Rack';
      if (!rackMap[rack]) rackMap[rack] = { rack, devs: [] };
      rackMap[rack].devs.push(d);
    });
    const rackRows = Object.values(rackMap).map(r => {
      const avgUp = r.devs.reduce((a, b) => a + (b.__proactiveUptime ?? b.proactiveUptime ?? 100), 0) / r.devs.length;
      return `<tr><td class="bold text-left">${r.rack}</td><td class="center bold"><span class="${getSlaClass(avgUp)}">${avgUp.toFixed(2)}%</span></td></tr>`;
    }).join('');

    perSiteSuitesHtml += `
    <!-- SITE REVIEW PAGE A: Analytics -->
    <div class="page">
      <div class="header">
        <div>
          <h1>SITE REVIEW &bull; ${siteIdx + 1} OF 8 &bull; ${siteName} – AP and Switch statistical analytics</h1>
          <div class="subtitle">Access Point RCA Breakdown &amp; Rack-Wise Switch Uptime %</div>
        </div>
        <div class="period-badge">${reportingPeriod}</div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 15px;">
        <div class="kpi-card" style="padding: 16px;">
          <div class="kpi-title" style="margin-bottom: 12px; font-size: 12px;">Access Point Breakdown</div>
          ${siteApIncs.length > 0 ? `
            <div style="font-size: 16px; font-weight: 800; color: #2563eb; margin-bottom: 8px;">${siteApIncs.length} AP Incidents</div>
            <div style="font-size: 13px; color: #334155; font-weight: 600;">Primary RCA: ${apRca}</div>
          ` : `
            <div style="font-size: 13px; color: #16a34a; font-weight: 600; padding: 20px 0;">No Access Point (AP) incidents were recorded at the ${siteName} location during this reporting period.</div>
          `}
        </div>
        <div>
          <div class="kpi-title" style="margin-bottom: 6px; font-size: 11px;">Rack-Wise Switch Uptime %</div>
          <table>
            <thead>
              <tr>
                <th style="width: 60%; text-align: left;">RACK#</th>
                <th style="width: 40%; text-align: center;">Overall percentage of Rack-wise</th>
              </tr>
            </thead>
            <tbody>
              ${rackRows || '<tr><td colspan="2" class="center">No rack data.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
      <div class="footer">
        <div>JFL – Proactive Monthly Review</div>
        <div>Page ${pageCounter++}</div>
      </div>
    </div>
    `;

    // Page B: Switch Uptime Report Table (Paginated in 22 rows per page)
    const swAt100Count = siteSws.filter(d => (d.__proactiveUptime ?? 100) >= 100).length;
    const swChunks = chunkArray(siteSws, 22);
    if (swChunks.length === 0) swChunks.push([]);

    swChunks.forEach((swChunk, chunkIdx) => {
      const pageLabel = swChunks.length > 1 ? ` (Page ${chunkIdx + 1} of ${swChunks.length})` : '';
      const swReportRows = swChunk.map((s, idx) => {
        const globalIndex = chunkIdx * 22 + idx + 1;
        let rackName = s.Rack || 'Main Rack';
        if (rackName === 'NA' || rackName.includes('Not Cover') || rackName.length > 25) rackName = 'Main Rack';
        return `
          <tr class="${idx % 2 === 0 ? 'even' : 'odd'}">
            <td class="center">${globalIndex}</td>
            <td class="text-left">${siteName}</td>
            <td class="bold text-left">${s.Hostname || s.DeviceID || 'N/A'}</td>
            <td class="font-mono text-left">${s.SerialNo || s.DeviceID || 'N/A'}</td>
            <td class="center">${s.DeviceType || 'SW'}</td>
            <td class="text-left">${rackName}</td>
            <td class="center"><span class="${getSlaClass(s.__proactiveUptime ?? 100)}">${fmtPct(s.__proactiveUptime ?? 100)}</span></td>
          </tr>
        `;
      }).join('');

      perSiteSuitesHtml += `
      <!-- SITE REVIEW PAGE B: Switch Uptime Report -->
      <div class="page">
        <div class="header">
          <div>
            <h1>SITE REVIEW &bull; ${siteName} — Switch Uptime Report${pageLabel}</h1>
            <div class="subtitle">Individual Switch Operational Availability &amp; Device Status</div>
          </div>
          <div class="period-badge">${reportingPeriod}</div>
        </div>
        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-title">Aggregated Switch Uptime</div>
            <div class="kpi-value text-primary">${fmtPct(proVal)}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-title">Switches Monitored</div>
            <div class="kpi-value">${siteSws.length}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-title">Primary RCA Driver</div>
            <div style="font-size: 13px; font-weight: 700; color: #0284c7; margin-top: 4px;">${swRca}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-title">Switch at 100% uptime</div>
            <div class="kpi-value text-green">${swAt100Count}</div>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th style="width: 6%; text-align: center;">S.N</th>
              <th style="width: 14%; text-align: left;">Location</th>
              <th style="width: 22%; text-align: left;">Hostname</th>
              <th style="width: 20%; text-align: left;">Serial No.</th>
              <th style="width: 10%; text-align: center;">Device Type</th>
              <th style="width: 14%; text-align: left;">Rack no.</th>
              <th style="width: 14%; text-align: center;">Proactive -Uptime%</th>
            </tr>
          </thead>
          <tbody>
            ${swReportRows || '<tr><td colspan="7" class="center">No switches monitored at this location.</td></tr>'}
          </tbody>
        </table>
        <div class="footer">
          <div>JFL – Proactive Monthly Review</div>
          <div>Page ${pageCounter++}</div>
        </div>
      </div>
      `;
    });

    // Page C: AP Incidents & RCA Table (Paginated in 22 rows per page)
    const apIncMetCount = siteApIncs.filter(i => i.sla_status !== 'SLA Breached').length;
    const apIncBreachCount = siteApIncs.filter(i => i.sla_status === 'SLA Breached').length;
    const apChunks = chunkArray(siteAps, 22);
    if (apChunks.length === 0) apChunks.push([]);

    apChunks.forEach((apChunk, chunkIdx) => {
      const pageLabel = apChunks.length > 1 ? ` (Page ${chunkIdx + 1} of ${apChunks.length})` : '';
      const apReportRows = apChunk.map((a, idx) => {
        const globalIndex = chunkIdx * 22 + idx + 1;
        const incs = siteApIncs.filter(i => i.DeviceID === a.DeviceID || i.SerialNo === a.SerialNo);
        const incCount = incs.length;
        const rca = incs.length > 0 ? (incs[0].RCA || apRca) : 'Stable Operations (No Incidents)';
        return `
          <tr class="${idx % 2 === 0 ? 'even' : 'odd'}">
            <td class="center">${globalIndex}</td>
            <td class="text-left">${siteName}</td>
            <td class="bold text-left">${a.Hostname || a.DeviceID || 'N/A'}</td>
            <td class="font-mono text-left">${a.SerialNo || a.DeviceID || 'N/A'}</td>
            <td class="center">${a.DeviceType || 'AP'}</td>
            <td class="center bold text-primary">${incCount}</td>
            <td class="text-left">${rca}</td>
          </tr>
        `;
      }).join('');

      perSiteSuitesHtml += `
      <!-- SITE REVIEW PAGE C: AP Incidents & RCA -->
      <div class="page">
        <div class="header">
          <div>
            <h1>SITE REVIEW &bull; ${siteName} — AP Incidents &amp; RCA${pageLabel}</h1>
            <div class="subtitle">Access Point Incident Log &amp; Root Cause Analysis</div>
          </div>
          <div class="period-badge">${reportingPeriod}</div>
        </div>
        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-title">Total number of incidents</div>
            <div class="kpi-value text-primary">${siteApIncs.length}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-title">Met Cases</div>
            <div class="kpi-value text-green">${apIncMetCount}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-title">Breach Cases</div>
            <div class="kpi-value text-danger">${apIncBreachCount}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-title">Primary RCA Driver</div>
            <div style="font-size: 13px; font-weight: 700; color: #7c3aed; margin-top: 4px;">${apRca}</div>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th style="width: 6%; text-align: center;">S NO</th>
              <th style="width: 14%; text-align: left;">Location</th>
              <th style="width: 22%; text-align: left;">Hostname</th>
              <th style="width: 20%; text-align: left;">Serial No.</th>
              <th style="width: 10%; text-align: center;">Device Type</th>
              <th style="width: 12%; text-align: center;">No of Incidents</th>
              <th style="width: 16%; text-align: left;">Primary RCA Driver</th>
            </tr>
          </thead>
          <tbody>
            ${apReportRows || '<tr><td colspan="7" class="center">No Access Points monitored at this location.</td></tr>'}
          </tbody>
        </table>
        <div class="footer">
          <div>JFL – Proactive Monthly Review</div>
          <div>Page ${pageCounter++}</div>
        </div>
      </div>
      `;
    });
  });

  // 3. Engineer Breakdown Table Rows
  const engineerList = pro.byEngineer || [];
  const engineerRowsHtml = engineerList.map((e, idx) => {
    const met = e.slaMet || 0;
    const missed = e.slaMissed || 0;
    const total = e.total || (met + missed) || 0;
    const slaPctNum = total > 0 ? (met / total) * 100 : 100;
    const slaColorClass = slaPctNum >= 90 ? 'badge-success' : slaPctNum >= 70 ? 'badge-warning' : 'badge-danger';

    return `
      <tr class="${idx % 2 === 0 ? 'even' : 'odd'}">
        <td class="bold text-left">${e.name}</td>
        <td class="center bold">${total}</td>
        <td class="center text-amber">${e.open || 0}</td>
        <td class="center">${e.onHold || 0}</td>
        <td class="center">${e.assignment || 0}</td>
        <td class="center text-green">${e.closed || 0}</td>
        <td class="center text-green bold">${met}</td>
        <td class="center text-danger bold">${missed}</td>
        <td class="center"><span class="${slaColorClass}">${slaPctNum.toFixed(2)}%</span></td>
      </tr>
    `;
  }).join('');

  // Hold Reasons Breakdown Rows
  const holdReasonsList = pro.holdReasons || [];
  const holdReasonsRowsHtml = holdReasonsList.map((hr, idx) => `
    <tr class="${idx % 2 === 0 ? 'even' : 'odd'}">
      <td class="bold text-left">${hr.reason}</td>
      <td class="center bold text-primary">${hr.count}</td>
      <td class="text-left">${hr.engineers ? hr.engineers.join(', ') : 'N/A'}</td>
      <td class="text-left">${hr.sites && hr.sites.length ? hr.sites.join(', ') : 'N/A'}</td>
    </tr>
  `).join('');

  // 4. Appendix A: All Switch Devices (Paginated 22 rows per page)
  let rackSwitches = switchAn.expandedRackwiseUptime || switchAn.rackwiseUptime || [];
  if (!rackSwitches || rackSwitches.length === 0) {
    const devices = data.devices || [];
    rackSwitches = devices.filter(d => (d.DeviceType === 'SW' || (d.DeviceID && d.DeviceID.includes('-SW-'))) && !d.__isStock);
  }
  const appSwChunks = chunkArray(rackSwitches, 22);
  if (appSwChunks.length === 0) appSwChunks.push([]);

  const appendixAPagesHtml = appSwChunks.map((chunk, chunkIdx) => {
    const pageLabel = appSwChunks.length > 1 ? ` (Page ${chunkIdx + 1} of ${appSwChunks.length})` : '';
    const rowsHtml = chunk.map((r, idx) => `
      <tr class="${idx % 2 === 0 ? 'even' : 'odd'}">
        <td class="bold text-left">${r.site || r.Location || r.SiteID || 'N/A'}</td>
        <td class="text-left">${r.rack || r.Rack || 'Main Rack'}</td>
        <td class="font-mono text-left">${r.serialNumber || r.SerialNo || 'N/A'}</td>
        <td class="bold text-left">${r.hostname || r.Hostname || r.DeviceID || 'N/A'}</td>
        <td class="center"><span class="${getSlaClass(r.proactiveUptime || r.__proactiveUptime || r.monthlyUptime || r.periodUptime)}">${fmtPct(r.proactiveUptime || r.__proactiveUptime || r.monthlyUptime || r.periodUptime)}</span></td>
        <td class="center"><span class="${getSlaClass(r.jflUptime || r.monthlyUptime || r.__jflUptime || r.periodUptime)}">${fmtPct(r.jflUptime || r.monthlyUptime || r.__jflUptime || r.periodUptime)}</span></td>
        <td class="center">${r.operatingStatus || r.status || (r.__slaBreach ? '<span class="badge-danger">Breached</span>' : '<span class="badge-success">Operational</span>')}</td>
      </tr>
    `).join('');

    return `
    <div class="page">
      <div class="header">
        <div>
          <h1>Appendix: Switch Infrastructure &amp; Rack Performance (${rackSwitches.length} Switches)${pageLabel}</h1>
          <div class="subtitle">Complete Rack-wise Operational Uptime &amp; Device Status</div>
        </div>
        <div class="period-badge">${reportingPeriod}</div>
      </div>
      <table>
        <thead>
          <tr>
            <th style="width: 15%; text-align: left;">Site Location</th>
            <th style="width: 14%; text-align: left;">Rack Location</th>
            <th style="width: 16%; text-align: left;">Serial Number</th>
            <th style="width: 18%; text-align: left;">Hostname / Device ID</th>
            <th style="width: 13%; text-align: center;">Proactive Uptime %</th>
            <th style="width: 12%; text-align: center;">JFL Uptime %</th>
            <th style="width: 12%; text-align: center;">Operating Status</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || '<tr><td colspan="7" class="center">No switch rack data available.</td></tr>'}
        </tbody>
      </table>
      <div class="footer">
        <div>Appendix A: Switch Inventory — SSOT Engine</div>
        <div>Page ${pageCounter++}</div>
      </div>
    </div>
    `;
  }).join('');

  // 5. Appendix B: All AP Devices / Outages (Paginated 22 rows per page)
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
  const appApChunks = chunkArray(apOutages, 22);
  if (appApChunks.length === 0) appApChunks.push([]);

  const appendixBPagesHtml = appApChunks.map((chunk, chunkIdx) => {
    const pageLabel = appApChunks.length > 1 ? ` (Page ${chunkIdx + 1} of ${appApChunks.length})` : '';
    const rowsHtml = chunk.map((a, idx) => `
      <tr class="${idx % 2 === 0 ? 'even' : 'odd'}">
        <td class="bold text-left">${a.DeviceID || a.Hostname || 'N/A'}</td>
        <td class="font-mono text-left">${a.SerialNo || 'N/A'}</td>
        <td class="text-left">${a.Location || a.SiteID || 'N/A'}</td>
        <td class="center bold text-primary">${a.incCount || 1}</td>
        <td class="center"><span class="${getSlaClass(a.uptime)}">${fmtPct(a.uptime)}</span></td>
        <td class="text-left">${a.rca || a.RCA || a.primaryRca || 'Device Power Issues'}</td>
      </tr>
    `).join('');

    return `
    <div class="page">
      <div class="header">
        <div>
          <h1>Appendix: Access Point (AP) Incident Distribution (${apOutages.length} AP Records)${pageLabel}</h1>
          <div class="subtitle">Complete AP Device Incident Count, Effective Uptime &amp; Primary RCA</div>
        </div>
        <div class="period-badge">${reportingPeriod}</div>
      </div>
      <table>
        <thead>
          <tr>
            <th style="width: 20%; text-align: left;">Device Hostname / ID</th>
            <th style="width: 18%; text-align: left;">Serial Number</th>
            <th style="width: 16%; text-align: left;">Site Location</th>
            <th style="width: 12%; text-align: center;">Incident Count</th>
            <th style="width: 14%; text-align: center;">Effective Uptime %</th>
            <th style="width: 20%; text-align: left;">Primary RCA Driver</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || '<tr><td colspan="6" class="center">No AP outages recorded during period. Operations 100% Stable.</td></tr>'}
        </tbody>
      </table>
      <div class="footer">
        <div>Appendix B: AP Incident Distribution — SSOT Engine</div>
        <div>Page ${pageCounter++}</div>
      </div>
    </div>
    `;
  }).join('');

  // 6. Appendix C: All Incident Audit Trail Records (Paginated 22 rows per page)
  const allIncidents = data.incidents || data.incidentDetails || data.incidentList || [];
  const appIncChunks = chunkArray(allIncidents, 22);
  if (appIncChunks.length === 0) appIncChunks.push([]);

  const appendixCPagesHtml = appIncChunks.map((chunk, chunkIdx) => {
    const pageLabel = appIncChunks.length > 1 ? ` (Page ${chunkIdx + 1} of ${appIncChunks.length})` : '';
    const rowsHtml = chunk.map((inc, idx) => {
      const ref = inc.display_reference ? `${inc.display_reference.type}: ${inc.display_reference.value}` : (inc.TicketNumber || inc.IncidentNumber || inc.IncidentID || `INC-${idx+1}`);
      const slaBadge = inc.sla_status === 'SLA Breached' 
        ? '<span class="badge-danger">SLA Breached</span>'
        : '<span class="badge-success">SLA Met</span>';

      return `
        <tr class="${idx % 2 === 0 ? 'even' : 'odd'}">
          <td class="bold font-mono text-left">${ref}</td>
          <td class="text-left">${inc.Location || inc.SiteID || inc.Site || 'N/A'}</td>
          <td class="text-left">${inc.DeviceID || inc.SerialNo || 'N/A'}</td>
          <td class="center bold">${inc.DeviceType || (inc.DeviceID?.includes('-AP-') ? 'AP' : 'Switch')}</td>
          <td class="center">${inc.HoldTimeMin !== undefined ? inc.HoldTimeMin : (inc.HoldDurationMin || 0)} min</td>
          <td class="center">${inc.ActualResolutionMin !== undefined ? inc.ActualResolutionMin : (inc.ResolutionMin || 0)} min</td>
          <td class="text-left">${inc.RCA || inc.Category || 'Operational Fault'}</td>
          <td class="center">${slaBadge}</td>
        </tr>
      `;
    }).join('');

    return `
    <div class="page">
      <div class="header">
        <div>
          <h1>Appendix: Raw Incidents Audit Trail (${allIncidents.length} Tickets)${pageLabel}</h1>
          <div class="subtitle">Complete Monitored Incidents Log with Hold Time, Resolution &amp; SLA Status</div>
        </div>
        <div class="period-badge">${reportingPeriod}</div>
      </div>
      <table>
        <thead>
          <tr>
            <th style="width: 18%; text-align: left;">Reference (Ticket / Incident ID)</th>
            <th style="width: 13%; text-align: left;">Location</th>
            <th style="width: 16%; text-align: left;">Device ID / Serial</th>
            <th style="width: 7%; text-align: center;">Type</th>
            <th style="width: 9%; text-align: center;">Hold Time</th>
            <th style="width: 9%; text-align: center;">Fix Time</th>
            <th style="width: 16%; text-align: left;">RCA Driver</th>
            <th style="width: 12%; text-align: center;">SLA Status</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || '<tr><td colspan="8" class="center">No incident records found. Operations 100% Stable.</td></tr>'}
        </tbody>
      </table>
      <div class="footer">
        <div>Appendix C: Incidents Audit Trail — SSOT Engine</div>
        <div>Page ${pageCounter++}</div>
      </div>
    </div>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Executive QBR Summary &amp; Presentation Report - ${customerName}</title>
  <style>
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    body { margin: 0; padding: 0; background: #ffffff; color: #0f172a; font-size: 11px; line-height: 1.4; }
    
    @page {
      size: A4 landscape;
      margin: 6mm;
    }

    .page {
      page-break-after: always;
      page-break-inside: avoid;
      box-sizing: border-box;
      padding: 16px 20px;
      position: relative;
      background: #ffffff;
      min-height: 185mm;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .page:last-child { page-break-after: avoid; }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 3px solid #2563eb;
      padding-bottom: 8px;
      margin-bottom: 12px;
    }
    .header h1 { margin: 0; font-size: 18px; color: #0f172a; font-weight: 800; letter-spacing: -0.3px; }
    .header .subtitle { font-size: 11px; color: #64748b; margin-top: 2px; font-weight: 500; }
    .header .period-badge { background: #eff6ff; color: #1d4ed8; font-weight: 700; padding: 5px 14px; border-radius: 20px; font-size: 11px; border: 1px solid #bfdbfe; }

    .cover-page {
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #1e3a5f 100%);
      color: #ffffff;
      border-radius: 12px;
      padding: 44px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      min-height: 520px;
    }
    .cover-tag { color: #38bdf8; font-weight: 800; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; }
    .cover-title { font-size: 32px; font-weight: 900; margin: 12px 0 6px 0; color: #f8fafc; }
    .cover-sub { font-size: 16px; color: #cbd5e1; font-weight: 500; margin-bottom: 28px; }
    .cover-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; background: rgba(255,255,255,0.08); padding: 18px; border-radius: 10px; backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.15); }
    .cover-stat-val { font-size: 22px; font-weight: 800; color: #ffffff; }
    .cover-stat-lbl { font-size: 10px; text-transform: uppercase; color: #94a3b8; font-weight: 700; margin-top: 2px; }

    .footer {
      border-top: 1px solid #e2e8f0;
      padding-top: 6px;
      margin-top: 12px;
      display: flex;
      justify-content: space-between;
      font-size: 9px;
      color: #94a3b8;
      font-weight: 500;
    }

    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 12px;
    }
    .kpi-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 10px 12px;
    }
    .kpi-title { font-size: 10px; text-transform: uppercase; color: #64748b; font-weight: 700; letter-spacing: 0.5px; }
    .kpi-value { font-size: 20px; font-weight: 800; color: #0f172a; margin: 4px 0 2px 0; }
    .kpi-sub { font-size: 9px; color: #64748b; }

    .badge { padding: 3px 8px; border-radius: 4px; font-weight: 700; font-size: 10px; display: inline-block; text-align: center; }
    .badge-success { background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; }
    .badge-warning { background: #fef3c7; color: #b45309; border: 1px solid #fde68a; }
    .badge-danger { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }

    /* Table alignment and typography */
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 6px;
      margin-bottom: 10px;
      font-size: 9.5px;
      table-layout: fixed;
    }
    thead { display: table-header-group; }
    th {
      background: #1e293b;
      color: #ffffff;
      padding: 6px 8px;
      font-weight: 700;
      font-size: 9.5px;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      border: 1px solid #0f172a;
      vertical-align: middle;
    }
    td {
      padding: 5px 8px;
      border-bottom: 1px solid #e2e8f0;
      border-right: 1px solid #f1f5f9;
      vertical-align: middle;
      height: 20px;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    td:first-child { border-left: 1px solid #e2e8f0; }
    td:last-child { border-right: 1px solid #e2e8f0; }

    tr { page-break-inside: avoid; }
    tr.even { background: #ffffff; }
    tr.odd { background: #f8fafc; }
    tr:hover { background: #f1f5f9; }

    .text-left { text-align: left !important; }
    .text-right { text-align: right !important; }
    .center { text-align: center !important; }
    .bold { font-weight: 700; }
    .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 9.5px; }
    .text-primary { color: #2563eb; }
    .text-blue { color: #0284c7; }
    .text-purple { color: #7c3aed; }
    .text-green { color: #16a34a; }
    .text-amber { color: #b45309; }
    .text-danger { color: #dc2626; }

    .section-title {
      font-size: 12px;
      font-weight: 800;
      color: #0f172a;
      margin: 10px 0 4px 0;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .section-title::before {
      content: '';
      display: inline-block;
      width: 4px;
      height: 12px;
      background: #2563eb;
      border-radius: 2px;
    }

    .site-inspector-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
      margin-top: 6px;
    }
    .site-inspector-card {
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-top: 3px solid #2563eb;
      border-radius: 8px;
      padding: 10px 12px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.03);
    }
    .site-card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; border-bottom: 1px solid #f1f5f9; padding-bottom: 4px; }
    .site-card-title { font-weight: 800; font-size: 12px; color: #0f172a; display: block; }
    .site-card-sub { font-size: 9px; color: #64748b; font-weight: 500; }
    .site-card-body { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; font-size: 9.5px; }
    .site-stat-col { background: #f8fafc; padding: 5px 7px; border-radius: 6px; border: 1px solid #f1f5f9; }
    .stat-label { font-size: 8px; text-transform: uppercase; color: #64748b; font-weight: 700; }
    .stat-val { font-size: 10.5px; font-weight: 700; margin-top: 2px; }

    @media print {
      .no-print { display: none !important; }
      body { background: #fff; }
      .page { page-break-after: always; }
      table { page-break-inside: auto; }
      tr { page-break-inside: avoid; page-break-after: auto; }
    }
    @media screen {
      body { background: #f1f5f9; padding: 20px; }
      .page {
        background: #ffffff;
        border-radius: 12px;
        box-shadow: 0 4px 24px rgba(0,0,0,0.10);
        margin-bottom: 32px;
        padding: 24px 28px;
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
    📄 <strong>Executive QBR PDF Report</strong> &nbsp;|&nbsp;
    To save as PDF: Press <kbd>Ctrl+P</kbd> (Windows) or <kbd>⌘+P</kbd> (Mac) &nbsp;→&nbsp; Destination: <strong>Save as PDF</strong> &nbsp;→&nbsp; Layout: <strong>Landscape</strong> &nbsp;→&nbsp; Save
  </div>

  <!-- SLIDE 1: COVER PAGE -->
  <div class="page">
    <div class="cover-page">
      <div>
        <div class="cover-tag">Cisco &amp; ServiceNow Enterprise Analytics</div>
        <div class="cover-title">Quarterly Business Review (QBR)</div>
        <div class="cover-sub">Executive Operations &amp; Infrastructure Performance Report — ${customerName}</div>
      </div>
      <div>
        <div class="cover-grid">
          <div>
            <div class="cover-stat-val">${fmtNum(exec.totalDevices)}</div>
            <div class="cover-stat-lbl">Monitored Assets</div>
          </div>
          <div>
            <div class="cover-stat-val">${fmtPct(exec.jflSwitchUptime)}</div>
            <div class="cover-stat-lbl">JFL Switch Uptime</div>
          </div>
          <div>
            <div class="cover-stat-val">${fmtNum(exec.healthScore, '100')}/100</div>
            <div class="cover-stat-lbl">Health Score</div>
          </div>
          <div>
            <div class="cover-stat-val">${fmtPct(exec.slaCompliance)}</div>
            <div class="cover-stat-lbl">SLA Compliance</div>
          </div>
        </div>
        <div style="margin-top: 24px; font-size: 11px; color: #94a3b8; display: flex; justify-content: space-between;">
          <div>Reporting Period: <strong style="color: #ffffff;">${reportingPeriod}</strong></div>
          <div>Verified SSOT Data Engine &bull; Confidential</div>
        </div>
      </div>
    </div>
  </div>

  <!-- SLIDE 2: EXECUTIVE OVERVIEW & KPIS -->
  <div class="page">
    <div class="header">
      <div>
        <h1>Executive Summary &amp; Network Health</h1>
        <div class="subtitle">${customerName} — Strategic Operations Overview</div>
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
        <div class="kpi-value"><span class="${getSlaClass(exec.jflSwitchUptime)}">${fmtPct(exec.jflSwitchUptime)}</span></div>
        <div class="kpi-sub">Target SLA: ${slaTargetNum.toFixed(2)}%</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Proactive Switch Uptime %</div>
        <div class="kpi-value"><span class="${getSlaClass(exec.proactiveSwitchUptime)}">${fmtPct(exec.proactiveSwitchUptime)}</span></div>
        <div class="kpi-sub">Net Working Time Deducted</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Infrastructure Health Score</div>
        <div class="kpi-value text-primary">${fmtNum(exec.healthScore, '100')}/100</div>
        <div class="kpi-sub">${exec.healthLabel || 'Optimal Operations'} (${fmtPct(exec.incidentFreePercent)} Incident-Free)</div>
      </div>
    </div>

    <div class="section-title">Primary Executive Findings &amp; RCA Drivers</div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
      <div class="kpi-card">
        <div class="kpi-title">Primary RCA Driver (Switches)</div>
        <div style="font-size: 13px; font-weight: 700; color: #0284c7; margin-top: 6px;">${exec.primaryRcaSwitches || 'Stable Operations (No Incidents)'}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Primary RCA Driver (APs)</div>
        <div style="font-size: 13px; font-weight: 700; color: #7c3aed; margin-top: 6px;">${exec.primaryRcaAPs || 'Stable Operations (No Incidents)'}</div>
      </div>
    </div>

    <div class="section-title">Executive Operational Narrative</div>
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px 16px; border-radius: 8px; font-size: 11px; line-height: 1.5; color: #334155;">
      During the <strong>${reportingPeriod}</strong> reporting period, network operations for <strong>${customerName}</strong> maintained robust availability across all <strong>${fmtNum(exec.totalDevices)}</strong> monitored network assets, achieving an Executive Health Score of <strong>${fmtNum(exec.healthScore, '100')}/100 (${exec.healthLabel || 'Good'})</strong> and a <strong>${fmtPct(exec.slaCompliance)} SLA Compliance Rate</strong> across incident resolution records. Switch infrastructure availability averaged <strong>${fmtPct(exec.jflSwitchUptime)}</strong> against the contractual <strong>${slaTargetNum.toFixed(2)}% SLA Target</strong>.
    </div>

    <div class="footer">
      <div>Confidential — ${customerName} Executive Report</div>
      <div>Page 2</div>
    </div>
  </div>

  <!-- SLIDE 3: EXECUTIVE SITE SUMMARY TABLE (SLIDE 5 FORMAT) -->
  <div class="page">
    <div class="header">
      <div>
        <h1>Site Executive Performance Summary Table</h1>
        <div class="subtitle">Site-by-Site Device Count, Switch Uptimes, AP Incidents &amp; Primary RCA Drivers</div>
      </div>
      <div class="period-badge">${reportingPeriod}</div>
    </div>

    <table>
      <thead>
        <tr>
          <th style="width: 15%; text-align: left;">Site Location</th>
          <th style="width: 11%; text-align: center;">No of Devices</th>
          <th style="width: 16%; text-align: center;">Proactive Switch Uptime</th>
          <th style="width: 16%; text-align: center;">JFL Switch Uptime</th>
          <th style="width: 17%; text-align: left;">Primary RCA Driver (Switches)</th>
          <th style="width: 10%; text-align: center;">AP Incidents (Unique)</th>
          <th style="width: 15%; text-align: left;">Primary RCA Driver (APs)</th>
        </tr>
      </thead>
      <tbody>
        ${siteRowsHtml.length > 0 ? siteRowsHtml : '<tr><td colspan="7" class="center">No site data available.</td></tr>'}
      </tbody>
    </table>

    <div class="section-title" style="margin-top: 10px;">Contractual SLA Boundary &amp; Hold Policy</div>
    <div style="background: #f8fafc; border: 1px solid #cbd5e1; padding: 10px 14px; border-radius: 6px; font-size: 10px; color: #334155;">
      <strong>Note:</strong> Utility power cuts, store cabling activities, and third-party ISP outages are categorized transparently as local site dependencies and isolated from MSP SLA penalty deductions.
    </div>

    <div class="footer">
      <div>Slide 5 Executive Summary Table — SSOT Synchronized</div>
      <div>Page 3</div>
    </div>
  </div>

  <!-- SLIDE 4: SITE INSPECTOR BREAKDOWN (PER-SITE OVERVIEW CARDS) -->
  <div class="page">
    <div class="header">
      <div>
        <h1>Site Operational Inspection (${siteSummary.length} Monitored Sites)</h1>
        <div class="subtitle">Location-Specific Breakdown of Switches, APs, Stock Inventory &amp; Incident Metrics</div>
      </div>
      <div class="period-badge">${reportingPeriod}</div>
    </div>

    <div class="site-inspector-grid">
      ${siteInspectorCardsHtml}
    </div>

    <div class="footer">
      <div>Site Inspector Breakdown — SSOT Engine</div>
      <div>Page 4</div>
    </div>
  </div>

  <!-- PER-SITE 3-PAGE SUITES (ALL 8 MONITORED SITES, PAGINATED) -->
  ${perSiteSuitesHtml}

  <!-- ENGINEER SLA & PROACTIVE TICKET BREAKDOWN -->
  <div class="page">
    <div class="header">
      <div>
        <h1>Engineer SLA Performance &amp; Ticket Breakdown</h1>
        <div class="subtitle">Ticket Owner Workload, Resolution SLA Compliance &amp; Breach Tracking</div>
      </div>
      <div class="period-badge">${reportingPeriod}</div>
    </div>

    <table>
      <thead>
        <tr>
          <th style="width: 20%; text-align: left;">Ticket Owner / Engineer</th>
          <th style="width: 10%; text-align: center;">Total</th>
          <th style="width: 10%; text-align: center;">Open</th>
          <th style="width: 10%; text-align: center;">On Hold</th>
          <th style="width: 10%; text-align: center;">Assignment</th>
          <th style="width: 10%; text-align: center;">Closed</th>
          <th style="width: 10%; text-align: center;">SLA Met</th>
          <th style="width: 10%; text-align: center;">SLA Breached</th>
          <th style="width: 10%; text-align: center;">SLA %</th>
        </tr>
      </thead>
      <tbody>
        ${engineerRowsHtml.length > 0 ? engineerRowsHtml : '<tr><td colspan="9" class="center">No engineer workload data available.</td></tr>'}
      </tbody>
    </table>

    ${holdReasonsRowsHtml.length > 0 ? `
    <div class="section-title" style="margin-top: 14px;">Categorized Hold Reasons Frequency</div>
    <table>
      <thead>
        <tr>
          <th style="width: 35%; text-align: left;">Categorized Hold Reason</th>
          <th style="width: 15%; text-align: center;">Incident Count</th>
          <th style="width: 25%; text-align: left;">Engineers Assigned</th>
          <th style="width: 25%; text-align: left;">Affected Sites</th>
        </tr>
      </thead>
      <tbody>
        ${holdReasonsRowsHtml}
      </tbody>
    </table>
    ` : ''}

    <div class="footer">
      <div>Engineer Workload Analytics — SSOT Engine</div>
      <div>Page ${pageCounter++}</div>
    </div>
  </div>

  <!-- APPENDIX A: SWITCH INFRASTRUCTURE (PAGINATED) -->
  ${appendixAPagesHtml}

  <!-- APPENDIX B: ACCESS POINT INCIDENT DISTRIBUTION (PAGINATED) -->
  ${appendixBPagesHtml}

  <!-- APPENDIX C: RAW INCIDENTS AUDIT TRAIL (PAGINATED) -->
  ${appendixCPagesHtml}

</body>
</html>
  `;
}

module.exports = { generatePDF, buildHTMLReport };
