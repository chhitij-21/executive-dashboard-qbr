// backend/tests/excelParser.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeSiteName,
  isGenericLocation,
  parseIncidentSheet,
  buildSerialToHostnameMap,
} = require('../services/excelParser');

test('excelParser - normalizeSiteName', () => {
  assert.equal(normalizeSiteName('BLR'), 'Bangalore');
  assert.equal(normalizeSiteName('Bangalore'), 'Bangalore');
  assert.equal(normalizeSiteName('Greater Noida'), 'Greater Noida');
  assert.equal(normalizeSiteName('G.Noida'), 'Greater Noida');
  assert.equal(normalizeSiteName('Guwahati'), 'Guwahati');
  assert.equal(normalizeSiteName('HYD'), 'Hyderabad');
  assert.equal(normalizeSiteName('MUMBAI_DC'), 'Mumbai');
  assert.equal(normalizeSiteName('Unknown'), 'Unknown');
  assert.equal(normalizeSiteName(null), 'Unknown');
});

test('excelParser - isGenericLocation', () => {
  assert.equal(isGenericLocation('Raw'), true);
  assert.equal(isGenericLocation('Sheet1'), true);
  assert.equal(isGenericLocation('All Location'), true);
  assert.equal(isGenericLocation('Bangalore'), false);
  assert.equal(isGenericLocation('Mumbai'), false);
});

test('excelParser - parseIncidentSheet', () => {
  const rawRows = [
    {
      'Ticket Number': 'INC-1001',
      'Device Serial': 'SW-001',
      'Location': 'Bangalore',
      'RCA': 'Power Issue',
      'Category': 'Hardware',
    },
    {
      'Ticket Number': 'CR-2001',
      'Device Serial': 'SW-002',
      'Location': 'Mumbai',
      'Category': 'Change Request',
    },
  ];

  const parsed = parseIncidentSheet(rawRows);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].TicketNumber, 'INC-1001');
  assert.equal(parsed[0].SerialNo, 'SW-001');
  assert.equal(parsed[0].Location, 'Bangalore');
  assert.equal(parsed[0].IsChangeRequest, false);
  assert.equal(parsed[1].IsChangeRequest, true);
});

test('excelParser - buildSerialToHostnameMap', () => {
  const devices = [
    { SerialNo: 'S123', Hostname: 'SW-BLR-01' },
    { SerialNo: 'S456', Hostname: 'N/A' },
  ];
  const incidents = [
    { SerialNo: 'S789', Hostname: 'SW-MUM-01' },
  ];

  const map = buildSerialToHostnameMap(devices, incidents);
  assert.equal(map['S123'], 'SW-BLR-01');
  assert.equal(map['S456'], undefined); // N/A filtered out
  assert.equal(map['S789'], 'SW-MUM-01');
});
