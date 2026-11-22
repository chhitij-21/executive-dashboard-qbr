require('./_setup');
// backend/tests/sheetMapping.test.js
// TDD Test Suite for Item #6: Sheet Mapping UI & Custom Mapping Support

process.env.NODE_ENV = 'test';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  detectSheets,
  parseIncidentSheet,
} = require('../services/excelParser');

describe('Sheet Mapping UI & Custom Mapping Engine (Item #6)', () => {
  const mockWorkbook = {
    __sheetNames: ['Raw_Old', 'Custom_Incidents_Sheet', 'Summary_Sheet', 'Store_Alpha', 'Store_Beta', 'Removed_Sites'],
    'Raw_Old': [
      { 'Ticket Number': 'INC-001', 'Summary': 'Old Issue' },
    ],
    'Custom_Incidents_Sheet': [
      { 'Custom_Ref': 'TICKET-999', 'Cause': 'Power Failure', 'Downtime': '15', 'Resolved': 'Yes' },
    ],
    'Summary_Sheet': [
      { 'Total': '100' },
    ],
    'Store_Alpha': [
      { 'Serial No': 'FCZ111', 'Model': 'C9300', 'Location': 'Noida' },
    ],
    'Store_Beta': [
      { 'Serial No': 'FCZ222', 'Model': 'C9300', 'Location': 'Delhi' },
    ],
    'Removed_Sites': [
      { 'Serial No': 'FCZ999', 'Model': 'Old', 'Location': 'Decommissioned' },
    ],
  };

  describe('detectSheets with customSheetMapping overrides', () => {
    it('uses heuristic detection when customSheetMapping is omitted', () => {
      const res = detectSheets(mockWorkbook);
      // Under default heuristics, Raw_Old is prioritized because it starts with "Raw"
      assert.equal(res.incidentSheet, 'Raw_Old');
    });

    it('honors user-specified incidentSheet override over heuristic defaults', () => {
      const options = {
        customSheetMapping: {
          incidentSheet: 'Custom_Incidents_Sheet',
        },
      };
      const res = detectSheets(mockWorkbook, options);
      assert.equal(res.incidentSheet, 'Custom_Incidents_Sheet', 'Must use user-specified incidentSheet');
    });

    it('honors user-specified locationSheets override list', () => {
      const options = {
        isInventory: true,
        customSheetMapping: {
          locationSheets: ['Store_Alpha'],
        },
      };
      const res = detectSheets(mockWorkbook, options);
      assert.deepEqual(res.locationSheets, ['Store_Alpha'], 'Must only include user-specified location sheets');
    });

    it('falls back gracefully if specified custom incident sheet does not exist in workbook', () => {
      const options = {
        customSheetMapping: {
          incidentSheet: 'NonExistent_Sheet_Name',
        },
      };
      const res = detectSheets(mockWorkbook, options);
      // Must fall back safely to heuristic sheet
      assert.equal(res.incidentSheet, 'Raw_Old');
    });
  });

  describe('parseIncidentSheet with columnOverrides', () => {
    it('maps custom column names when columnOverrides is provided', () => {
      const rows = [
        {
          'Custom_Ref': 'TICK-404',
          'Cause': 'ISP Fiber Cut',
          'Resolved_Minutes': '45',
          'Waiting_Minutes': '10',
          'Device': 'Core-SW-01',
        },
      ];

      const options = {
        columnOverrides: {
          ticketId: 'Custom_Ref',
          rca: 'Cause',
          actualResolutionMin: 'Resolved_Minutes',
          holdMin: 'Waiting_Minutes',
          deviceId: 'Device',
        },
      };

      const parsed = parseIncidentSheet(rows, options);
      assert.equal(parsed.length, 1);
      const inc = parsed[0];
      assert.equal(inc.TicketNumber, 'TICK-404');
      assert.equal(inc.RCA, 'ISP Fiber Cut');
      assert.equal(Number(inc.ActualResolutionMin), 45);
      assert.equal(Number(inc.HoldTimeMin), 10);
      assert.equal(inc.DeviceID, 'Core-SW-01');
    });

    it('preserves standard column detection when columnOverrides is not provided', () => {
      const rows = [
        {
          'Incident ID': 'INC-700',
          'Problem Description': 'Switch Overheat',
          'Actual Resolution Time (Minutes)': '30',
        },
      ];

      const parsed = parseIncidentSheet(rows);
      assert.equal(parsed.length, 1);
      assert.equal(parsed[0].TicketNumber, 'INC-700');
      assert.equal(Number(parsed[0].ActualResolutionMin), 30);
    });
  });
});
