'use strict';
// scripts/ssot-reconciler.js
// Compares the human-authored PDF against dashboard_data.json.
// Usage: node scripts/ssot-reconciler.js <humanPdf> [dashboardJson]

const fs   = require('fs');
const path = require('path');

let pdfParse;
try {
  pdfParse = require('pdf-parse');
} catch {
  try {
    pdfParse = require(path.resolve(__dirname, '..', 'backend', 'node_modules', 'pdf-parse'));
  } catch {
    console.error('ERROR: pdf-parse not installed.');
    console.error('Install with:  npm install pdf-parse');
    process.exit(2);
  }
}

const humanPdf = process.argv[2];
const dashPath = process.argv[3] || path.resolve('data', 'dashboard_data.json');

if (!humanPdf) {
  console.error('Usage: node scripts/ssot-reconciler.js <humanPdf> [dashboardJson]');
  process.exit(2);
}
if (!fs.existsSync(humanPdf)) {
  console.error('ERROR: PDF not found: ' + humanPdf);
  process.exit(2);
}
if (!fs.existsSync(dashPath)) {
  console.error('ERROR: dashboard JSON not found: ' + dashPath);
  process.exit(2);
}

function normalizePct(s) {
  if (s === null || s === undefined) return null;
  const n = parseFloat(String(s).replace('%', '').trim());
  return isNaN(n) ? null : n;
}

function normalizeRatio(s) {
  if (!s) return '';
  return String(s).replace(/\s+/g, '').trim();
}

function parseHumanSummary(text) {
  // Look for the Executive Summary section. Row format from the PDF:
  // <Site> <No of devices> <Proactive %> <JFL %> <RCA switches> <X / Y> <RCA APs>
  // Site names: Bangalore, Greater Noida, Noida, Mohali, Hyderabad, Nagpur,
  //             Mumbai-DC, Guwahati
  const SITES = ['Bangalore', 'Greater Noida', 'Noida', 'Mohali',
                 'Hyderabad', 'Nagpur', 'Mumbai-DC', 'Guwahati'];
  const out = {};
  for (const site of SITES) {
    let idx = -1;
    if (site === 'Noida') {
      // Find Noida when NOT preceded by 'Greater '
      const match = text.match(/(?<!Greater\s)Noida/);
      if (match) idx = match.index;
    } else {
      idx = text.indexOf(site);
    }
    if (idx === -1) continue;
    const tail = text.slice(idx, idx + 200);
    // numeric fields appear in order: devices, proactive %, jfl %
    const nums = tail.match(/(\d+(?:\.\d+)?)/g) || [];
    if (nums.length >= 3) {
      out[site] = {
        deviceCount:          parseInt(nums[0], 10),
        proactiveSwitchUptime: parseFloat(nums[1]),
        jflSwitchUptime:       parseFloat(nums[2]),
      };
    }
  }
  return out;
}

async function main() {
  const buf  = fs.readFileSync(humanPdf);
  let text = '';
  if (typeof pdfParse === 'function') {
    const res = await pdfParse(buf);
    text = res.text;
  } else if (pdfParse.PDFParse) {
    const parser = new pdfParse.PDFParse(new Uint8Array(buf));
    const res = await parser.getText();
    text = res.text;
  } else if (pdfParse.default && typeof pdfParse.default === 'function') {
    const res = await pdfParse.default(buf);
    text = res.text;
  }

  if (!text || text.length < 100) {
    console.error('PDF NOT PARSEABLE (extracted text too short).');
    process.exit(2);
  }

  const human = parseHumanSummary(text);
  const dash  = JSON.parse(fs.readFileSync(dashPath, 'utf8'));
  const sites = Array.isArray(dash.siteSummary) ? dash.siteSummary : [];

  const rows = [];
  let anyFail = false;

  for (const [siteName, h] of Object.entries(human)) {
    const d = sites.find(s => s.siteId === siteName);
    if (!d) {
      rows.push({ site: siteName, metric: 'coverage', human: 'present',
                  dash: 'MISSING', delta: '-', verdict: 'FAIL' });
      anyFail = true;
      continue;
    }

    const checks = [
      ['deviceCount', h.deviceCount, d.deviceCount, null],
      ['proactiveSwitchUptime', h.proactiveSwitchUptime,
        normalizePct(d.proactiveTicketAvg ?? d.proactiveSwitchUptime), 0],
      ['jflSwitchUptime', h.jflSwitchUptime,
        normalizePct(d.jflTicketAvg ?? d.jflSwitchUptime), 0],
    ];

    for (const [metric, humanVal, dashVal, tol] of checks) {
      const delta = (typeof humanVal === 'number' && typeof dashVal === 'number')
        ? Number((dashVal - humanVal).toFixed(4))
        : '-';
      const ok = (typeof humanVal === 'number' && typeof dashVal === 'number')
        ? Math.abs(dashVal - humanVal) <= (tol ?? 0)
        : String(humanVal) === String(dashVal);
      if (!ok) anyFail = true;
      rows.push({ site: siteName, metric,
        human: String(humanVal), dash: String(dashVal),
        delta: String(delta), verdict: ok ? 'PASS' : 'FAIL' });
    }
  }

  console.log('');
  console.log('SSOT Reconciliation — ' + path.basename(humanPdf));
  console.log('Against dashboard  — ' + dashPath);
  console.log('');
  console.log(['Site'.padEnd(16), 'Metric'.padEnd(24),
               'Human'.padEnd(10), 'Dashboard'.padEnd(10),
               'Delta'.padEnd(10), 'Verdict'].join(' | '));
  console.log('-'.repeat(100));
  for (const r of rows) {
    console.log([
      r.site.padEnd(16), r.metric.padEnd(24),
      r.human.padEnd(10), r.dash.padEnd(10),
      r.delta.padEnd(10), r.verdict,
    ].join(' | '));
  }

  console.log('');
  console.log('PASS: ' + rows.filter(r => r.verdict === 'PASS').length);
  console.log('FAIL: ' + rows.filter(r => r.verdict === 'FAIL').length);

  process.exit(anyFail ? 1 : 0);
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(2); });
