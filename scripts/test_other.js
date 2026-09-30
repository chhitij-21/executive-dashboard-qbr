const http = require('http');

http.get('http://127.0.0.1:3000/api/dashboard', (res) => {
  let raw = '';
  res.on('data', chunk => raw += chunk);
  res.on('end', () => {
    try {
      const data = JSON.parse(raw);
      console.log('STATUS:', res.statusCode);
      console.log('otherActivities count:', data.otherActivities?.length);
      console.log('\n--- ALL 17 OTHER ACTIVITIES ---');
      (data.otherActivities || []).forEach((row, i) => {
        console.log(`${i + 1}. Subject: "${row.Subject}" | SubCategory: ${row.SubCategory} | Location: ${row.DeviceName} | Serial: ${row.DeviceSerial} | Type: ${row.DeviceType} | Host: ${row.Hostname} | Status: ${row.Status} | RCA: ${row.RCA}`);
      });
    } catch (e) {
      console.error('Error parsing response:', e.message);
    }
  });
}).on('error', (err) => {
  console.error('HTTP Error:', err.message);
});
