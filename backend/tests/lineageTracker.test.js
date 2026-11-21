// backend/tests/lineageTracker.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { buildLineage } = require('../services/validators/lineageTracker');

describe('Lineage Tracker Suite (Item #7)', () => {
  const mockQbrData = {
    generatedAt: '2026-04-30T12:00:00.000Z',
    executiveSummary: {
      totalDevices: 145,
      totalIncidents: 12,
      healthyDevices: 138,
      atRiskDevices: 7,
      overallUptime: '99.85',
      slaCompliance: '99.43',
      healthScore: '98.5',
      jflSwitchUptime: '99.90',
      proactiveSwitchUptime: '99.80',
    },
    devices: [
      {
        DeviceID: 'SW-DEL-01',
        SiteID: 'Site-A',
        Location: 'Site-A',
        DeviceType: 'SW',
        Rack: 'Rack-01',
        __proactiveUptime: 99.80,
        __jflUptime: 99.90,
        __effectiveUptime: 99.85,
        __source: { file: 'inventory.xlsx', sheet: 'Delhi', row: 14 },
      },
      {
        DeviceID: 'AP-DEL-01',
        SiteID: 'Site-A',
        Location: 'Site-A',
        DeviceType: 'AP',
        Rack: 'Rack-01',
        __proactiveUptime: 100.0,
        __jflUptime: 100.0,
        __effectiveUptime: 100.0,
        __source: { file: 'inventory.xlsx', sheet: 'Delhi', row: 15 },
      },
    ],
    incidents: [
      {
        TicketNumber: 'INC-1001',
        DeviceID: 'SW-DEL-01',
        Location: 'Site-A',
        HoldTimeMin: 15,
        ActualResolutionMin: 45,
        TotalAvailableMinutes: 43200,
        __source: { file: 'incidents.xlsx', sheet: 'Incident Dump', row: 2 },
      },
    ],
    siteSummary: [
      {
        siteId: 'Site-A',
        proactiveSwitchUptime: '99.80',
        jflSwitchUptime: '99.90',
        overallUptime: '99.85',
        healthScore: '98.5',
      },
    ],
    switchAnalytics: {
      rackwiseUptime: [
        { rack: 'Rack-01', uptime: '99.80' },
      ],
    },
  };

  it('1. buildLineage populates extended executive KPI metrics', () => {
    const result = buildLineage(mockQbrData);
    assert.strictEqual(result.success, true);
    assert.ok(result.lineage);
    assert.ok(result.lineage.metrics);

    // Check newly added executive metrics
    assert.ok(result.lineage.metrics['executiveSummary.totalDevices'], 'totalDevices metric must exist');
    assert.ok(result.lineage.metrics['executiveSummary.totalIncidents'], 'totalIncidents metric must exist');
    assert.ok(result.lineage.metrics['executiveSummary.healthyDevices'], 'healthyDevices metric must exist');
    assert.ok(result.lineage.metrics['executiveSummary.atRiskDevices'], 'atRiskDevices metric must exist');
    assert.ok(result.lineage.metrics['executiveSummary.jflSwitchUptime'], 'jflSwitchUptime metric must exist');
    assert.ok(result.lineage.metrics['executiveSummary.proactiveSwitchUptime'], 'proactiveSwitchUptime metric must exist');
  });

  it('2. buildLineage computes cell coordinate references for device source rows', () => {
    const result = buildLineage(mockQbrData);
    const swLineage = result.lineage.devices['SW-DEL-01'];
    assert.ok(swLineage, 'Device SW-DEL-01 must have lineage');
    assert.strictEqual(swLineage.derivedFrom[0].row, 14);
    assert.strictEqual(swLineage.derivedFrom[0].cellCoordinates?.sheet, 'Delhi');
    assert.strictEqual(swLineage.derivedFrom[0].cellCoordinates?.row, 14);
    assert.ok(swLineage.derivedFrom[0].cellCoordinates?.cellRef, 'Cell reference string must be generated');
  });

  it('3. buildLineage traces totalIncidents to incident sheet and rows', () => {
    const result = buildLineage(mockQbrData);
    const incLineage = result.lineage.metrics['executiveSummary.totalIncidents'];
    assert.strictEqual(incLineage.value, 12);
    assert.strictEqual(incLineage.derivedFrom[0].sourceType, 'INCIDENT_SHEET');
    assert.strictEqual(incLineage.derivedFrom[0].file, 'incidents.xlsx');
    assert.strictEqual(incLineage.derivedFrom[0].sheet, 'Incident Dump');
    assert.deepStrictEqual(incLineage.derivedFrom[0].contributingRows, [2]);
  });

  it('4. buildLineage handles empty or invalid inputs gracefully', () => {
    const resNull = buildLineage(null);
    assert.strictEqual(resNull.success, false);
    assert.strictEqual(resNull.summary.totalEntries, 0);

    const resEmpty = buildLineage({});
    assert.strictEqual(resEmpty.success, true);
    assert.strictEqual(resEmpty.summary.totalEntries, 0);
  });

  it('5. buildLineage traces site uptime and health metrics', () => {
    const result = buildLineage(mockQbrData);
    const siteLineage = result.lineage.sites['Site-A'];
    assert.ok(siteLineage, 'Site-A lineage must exist');
    assert.strictEqual(siteLineage.value.siteId, 'Site-A');
    assert.strictEqual(siteLineage.derivedFrom[0].aggregationType, 'AVG');
    assert.deepStrictEqual(siteLineage.derivedFrom[0].inputs, ['SW-DEL-01', 'AP-DEL-01']);
  });
});
