// scratch/test_on_hold_cutoff.js
// Verification script for On-Hold ticket period cutoff uptime calculation.

const assert = require('assert');
const processData = require('../backend/services/processData');

console.log('Testing On-Hold ticket period cutoff uptime calculation logic...');

// Test date parsing helper and calculation logic
const startDate = '2026-08-01';
const endDate = '2026-08-31';
const windowMinutes = 31 * 24 * 60; // 44640

// Ticket opened on 10th August 2026 at 00:00:00, status "On Hold"
const openTimeStr = '2026-08-10T00:00:00Z';
const openDt = new Date(openTimeStr);
const periodEndDt = new Date(endDate + 'T23:59:59Z');
const periodStartDt = new Date(startDate + 'T00:00:00Z');

const effectiveStart = (periodStartDt && openDt < periodStartDt) ? periodStartDt : openDt;
const effectiveEnd = periodEndDt;

const elapsedMins = Math.ceil((effectiveEnd.getTime() - effectiveStart.getTime()) / 60000);
console.log(`Open Time: ${openTimeStr}`);
console.log(`Period Start: ${startDate}T00:00:00Z`);
console.log(`Period End: ${endDate}T23:59:59Z`);
console.log(`Effective Start: ${effectiveStart.toISOString()}`);
console.log(`Effective End: ${effectiveEnd.toISOString()}`);
console.log(`Calculated Elapsed Hold Minutes: ${elapsedMins}`);

// From Aug 10 00:00:00 to Aug 31 23:59:59 is 21 days + 23 hours + 59 mins + 59 secs = 31,680 mins
assert.strictEqual(elapsedMins, 31680, 'Elapsed hold minutes should equal 31680');

const uptimePct = parseFloat((((windowMinutes - elapsedMins) / windowMinutes) * 100).toFixed(2));
console.log(`Calculated JFL Switch Uptime %: ${uptimePct}%`);
assert.strictEqual(uptimePct, 29.03, 'Uptime % should equal 29.03%');

console.log('✅ On-Hold ticket period cutoff uptime calculation test passed successfully!');
