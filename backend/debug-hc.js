// backend/debug-hc.js
const path = require('path');
const fs = require('fs');
const { processJFLWorkbooks } = require('./services/processData');

const incFile = 'C:\\Users\\Chhitij\\Desktop\\jfl monthly raw - sep with rollover 1 sep to 30 sep 26.xlsx';
const invFile = 'C:\\Users\\Chhitij\\Downloads\\2.xlsx';

// Intercept device enrichment by patching the module
const processDataPath = require.resolve('./services/processData');
const originalModule = require.cache[processDataPath];

processJFLWorkbooks(incFile, invFile, './debug-output', {
  ruleConfigFile: 'rules.yaml',
  startDate: '2026-09-01',
  endDate: '2026-09-30'
}).then(r => {
  const d = JSON.parse(fs.readFileSync(r.dashboardPath, 'utf8'));
  
  console.log('\n=== FINAL HEALTHCARE ===');
  const hc = d.devices.find(x => x.DeviceID === 'HEALTHCARE');
  console.log('DeviceID:', hc.DeviceID);
  console.log('SiteID:', hc.SiteID);
  console.log('__jflUptime:', hc.__jflUptime);
  console.log('__proactiveUptime:', hc.__proactiveUptime);
  console.log('__debugUptimeSource:', hc.__debugUptimeSource);
  
  console.log('\n=== ALL DEVICES WITH jflUptime = 65.11 ===');
  const suspects = d.devices.filter(x => 
    Math.abs(parseFloat(x.__jflUptime) - 65.11) < 0.001
  );
  console.log('Count:', suspects.length);
  suspects.forEach(x => 
    console.log('  ', x.DeviceID, '|', x.SiteID, '|', x.__debugUptimeSource)
  );
  
  console.log('\n=== SITE SUMMARY ===');
  d.siteSummary.forEach(s => 
    console.log(s.siteId.padEnd(15), 'J-dev:', s.jflSwitchUptime, '| J-tkt:', s.jflTicketAvg)
  );
  
}).catch(e => console.error('ERROR:', e.message));