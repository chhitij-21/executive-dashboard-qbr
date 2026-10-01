'use strict';
// scripts/capture-both.js
// Captures the same dashboard URL from two environments and reports
// whether the rendered pixels differ.
// Usage: node scripts/capture-both.js <urlA> <urlB> [outDir]
const puppeteer = require('puppeteer');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

async function captureBoth(urlA, urlB, outDir) {
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const results = {};
  for (const [label, url] of [['A', urlA], ['B', urlB]]) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('.dashboard-section, .kpi-grid', { timeout: 10000 })
      .catch(() => {});
    const file = path.join(outDir, `${label}.png`);
    await page.screenshot({ path: file, fullPage: true });
    results[label] = {
      file,
      hash: crypto.createHash('sha256')
        .update(fs.readFileSync(file)).digest('hex'),
    };
    await page.close();
  }

  await browser.close();
  results.match = results.A.hash === results.B.hash;
  return results;
}

if (require.main === module) {
  const [,, urlA, urlB, outDir = 'tmp_parity'] = process.argv;
  if (!urlA || !urlB) {
    console.error('Usage: node scripts/capture-both.js <urlA> <urlB> [outDir]');
    process.exit(2);
  }
  captureBoth(urlA, urlB, outDir)
    .then(r => {
      console.log('A :', r.A.file, r.A.hash);
      console.log('B :', r.B.file, r.B.hash);
      console.log('Match:', r.match ? 'PASS' : 'FAIL');
      process.exit(r.match ? 0 : 1);
    })
    .catch(e => { console.error('ERROR:', e.message); process.exit(2); });
}

module.exports = { captureBoth };
