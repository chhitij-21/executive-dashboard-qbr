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
  assert.equal(normalizeSiteName('MUMBAI_DC'), 'Mumbai-DC');
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

test('excelParser - isRemovedSheet identifies decommissioned sheets', () => {
  const { isRemovedSheet } = require('../services/excelParser');
  assert.equal(isRemovedSheet('Remove from the network'), true);
  assert.equal(isRemovedSheet('Remove from the network '), true);
  assert.equal(isRemovedSheet('Decommissioned Devices'), true);
  assert.equal(isRemovedSheet('Retired Hardware'), true);
  assert.equal(isRemovedSheet('Updated Inventory -139'), false);
  assert.equal(isRemovedSheet('ftd fmc'), false);
  assert.equal(isRemovedSheet('Greater Noida'), false);
});

test('excelParser - detectSheets targets active sheets and excludes removed sheets in inventory workbook', () => {
  const { detectSheets } = require('../services/excelParser');
  const mockInvWorkbook = {
    __sheetNames: ['Updated Inventory -139', 'ftd fmc', 'Remove from the network '],
    'Updated Inventory -139': [
      { 'Product Detail Name/Serial No.': 'SN-001', 'Installed Location': 'NUH', 'Device Type': 'SW', Model: 'MS425' },
    ],
    'ftd fmc': [
      { 'PAK/Serial Number': 'FJC-001', 'Product Number': 'FPR1140', 'Product Type': 'CHASSIS' },
    ],
    'Remove from the network ': [
      { 'Serial No.': 'REM-001', Location: 'NUH', 'Device Type': 'SW' },
    ],
  };

  const detected = detectSheets(mockInvWorkbook);
  assert.equal(detected.incidentSheet, null, 'Inventory workbook should not pick an incident sheet');
  assert.deepEqual(detected.locationSheets, ['Updated Inventory -139', 'ftd fmc']);
  assert.ok(!detected.locationSheets.includes('Remove from the network '));
});

test('excelParser - mergeInventorySheets combines active sheets and extracts all serial aliases', () => {
  const { mergeInventorySheets } = require('../services/excelParser');
  const mockInvWorkbook = {
    __sheetNames: ['Updated Inventory -139', 'ftd fmc', 'Remove from the network '],
    'Updated Inventory -139': [
      { 'Product Detail Name/Serial No.': 'Q2CW-3HSV-5J6D', 'Installed Location': 'NUH', 'Device Type': 'SW', Model: 'MS425-16' },
      { 'Product Detail Name/Serial No.': 'Q2CW-8F3E-KK9T', 'Installed Location': 'GURUGRAM', 'Device Type': 'AP', Model: 'MR46' },
    ],
    'ftd fmc': [
      { 'PAK/Serial Number': 'FJC282419ZF', 'Product Number': 'FPR1140-NGFW-K9', 'Product Type': 'CHASSIS' },
    ],
    'Remove from the network ': [
      { 'Serial No.': 'Q2GW-KEMQ-4W5C', Location: 'NUH', 'Device Type': 'SW' },
    ],
  };

  // Pass active sheets only
  const devices = mergeInventorySheets(mockInvWorkbook, ['Updated Inventory -139', 'ftd fmc']);
  assert.equal(devices.length, 3, 'Should parse 2 from sheet 1 + 1 from sheet 2 = 3 active devices');

  const serials = devices.map(d => d.SerialNo);
  assert.ok(serials.includes('Q2CW-3HSV-5J6D'), 'Should extract serial from Product Detail Name/Serial No.');
  assert.ok(serials.includes('Q2CW-8F3E-KK9T'));
  assert.ok(serials.includes('FJC282419ZF'), 'Should extract serial from PAK/Serial Number');
  assert.ok(!serials.includes('Q2GW-KEMQ-4W5C'), 'Should not include removed device');

  // Even if removed sheet is accidentally included in locationSheets, safeSheets should filter it
  const devicesWithRemoved = mergeInventorySheets(mockInvWorkbook, ['Updated Inventory -139', 'ftd fmc', 'Remove from the network ']);
  assert.equal(devicesWithRemoved.length, 3, 'Safe filter must drop removed sheet even if passed');
});

