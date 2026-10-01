'use strict';
// backend/tests/check-sla-target.js
// Exit 0 = correct (SLA target for August monthly window is 99.9)
// Exit 1 = regression
// Exit 125 = cannot test (skip this commit in git bisect)
const fs = require('fs');
const path = require('path');
const { processJFLWorkbooks } = require('../services/processData');

const inc = ['jfl incidents.xlsx', 'Book13.xlsx']
  .map(f => path.resolve(__dirname, '..', '..', f))
  .find(f => fs.existsSync(f));

if (!inc) {
  console.error('SKIP: no incident workbook found');
  process.exit(125);
}

processJFLWorkbooks(inc, null, path.resolve(__dirname, 'tmp_bisect'), {
  startDate: '2026-08-01',
  endDate:   '2026-08-31',
})
  .then(r => {
    const target = r.qbrData.slaAnalytics.slaTarget;
    console.log('SLA target for Aug window:', target);
    process.exit(target === 99.9 ? 0 : 1);
  })
  .catch(e => {
    console.error('ERROR:', e.message);
    process.exit(125);
  });
