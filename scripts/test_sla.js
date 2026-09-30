const http = require('http');

http.get('http://127.0.0.1:3000/api/dashboard', (res) => {
  let raw = '';
  res.on('data', chunk => raw += chunk);
  res.on('end', () => {
    try {
      const d = JSON.parse(raw);
      console.log('STATUS:', res.statusCode);
      console.log('\n=== DEVICE UPTIME SLA COMPLIANCE ===');
      console.log('Overall Device SLA Compliance %:', d.slaAnalytics?.overallSLAPercent, '%');
      console.log('SLA Target:', d.slaAnalytics?.slaTarget, '%');
      console.log('Total Active Devices Evaluated:', d.slaAnalytics?.totalDevices);
      console.log('Compliant Active Devices (>= 99.3%):', d.slaAnalytics?.compliantDevices);
      console.log('Breaching Active Devices (< 99.3%):', d.slaAnalytics?.breachingDevices);
      console.log('Device SLA Breaching List Count:', d.slaAnalytics?.deviceSLA?.length);

      console.log('\n=== INCIDENT RESOLUTION SLA COMPLIANCE ===');
      console.log('Total Hardware Incidents:', d.incidentAnalytics?.totalIncidents);
      console.log('SLA Met Count (<= 2h):', d.incidentAnalytics?.slaMetCount);
      console.log('SLA Breached Count (> 2h):', d.incidentAnalytics?.slaBreachedCount);
      console.log('Incident Resolution SLA Compliance %:', d.incidentAnalytics?.resolutionSlaCompliancePct, '%');
    } catch (e) {
      console.error('Error parsing JSON:', e.message);
    }
  });
}).on('error', (err) => {
  console.error('HTTP Error:', err.message);
});
