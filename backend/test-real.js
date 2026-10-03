// backend/test-real.js
const path = require('path');
const fs = require('fs');
const { processJFLWorkbooks } = require('./services/processData');

const incFile = 'C:\\Users\\Chhitij\\Desktop\\jfl monthly raw - sep with rollover 1 sep to 30 sep 26.xlsx';
const invFile = 'C:\\Users\\Chhitij\\Downloads\\2.xlsx';

console.log('Incidents file:', incFile);
console.log('Inventory file:', invFile);
console.log('Exists?', fs.existsSync(incFile), fs.existsSync(invFile));

if (!fs.existsSync(incFile)) {
  console.error('ERROR: Incidents file not found');
  process.exit(1);
}
if (!fs.existsSync(invFile)) {
  console.error('ERROR: Inventory file not found');
  process.exit(1);
}

processJFLWorkbooks(incFile, invFile, './test-verify-output', {
  ruleConfigFile: 'rules.yaml',
  startDate: '2026-09-01',
  endDate: '2026-09-30'
}).then(r => {
  if (!r.success) {
    console.log('FAILED:', r.error);
    return;
  }
  const d = JSON.parse(fs.readFileSync(r.dashboardPath, 'utf8'));
  
  console.log('\n=== SITES ===');
  d.siteSummary.slice(0, 10).forEach(s => {
    console.log(
      String(s.siteId).padEnd(16),
      'P-dev: ' + String(s.proactiveSwitchUptime || '').padEnd(7),
      'P-tkt: ' + String(s.proactiveTicketAvg || '').padEnd(7),
      'J-dev: ' + String(s.jflSwitchUptime || '').padEnd(7),
      'J-tkt: ' + String(s.jflTicketAvg || '').padEnd(7),
      'tickets: ' + (s.ticketCountWithUptime || 0)
    );
  });

  console.log('\n=== HEALTHCARE DEVICE ===');
  const hc = d.devices.find(x => x.DeviceID === 'HEALTHCARE');
  if (hc) {
    console.log('DeviceID:', hc.DeviceID);
    console.log('SiteID:', hc.SiteID);
    console.log('__jflUptime:', hc.__jflUptime);
    console.log('__proactiveUptime:', hc.__proactiveUptime);
    console.log('__debugUptimeSource:', hc.__debugUptimeSource);
  } else {
    console.log('NOT FOUND');
  }

  console.log('\n=== REJECTED PIVOTS ===');
  const rejected = d.devices.filter(x => x.__debugUptimeSource === 'rejected-cross-site-pivot');
  console.log('Rejected count:', rejected.length);
  rejected.slice(0, 10).forEach(x => 
    console.log('  ' + x.DeviceID + ' (' + x.SiteID + ')')
  );

}).catch(e => console.error('ERROR:', e.message));