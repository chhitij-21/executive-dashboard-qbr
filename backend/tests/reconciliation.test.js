// backend/tests/reconciliation.test.js
// Test suite for Dashboard -> PPT Data Migration & Zero-Tolerance Reconciliation Engine

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const { mapSnapshotToPPTData } = require('../services/pptDataMapper');
const { reconcileDashboardAndPPT } = require('../services/reconciliationEngine');
const { processJFLWorkbooks } = require('../services/processData');

test('Reconciliation Engine - Canonical Data Mapping & Reconciliation PASS', () => {
  const mockqbrData = {
    customerName: 'Jubilant Foodworks Ltd (JFL)',
    reportingPeriod: '1 July 2026 – 31 July 2026',
    generatedAt: new Date().toISOString(),
    executiveSummary: {
      customerName: 'Jubilant Foodworks Ltd (JFL)',
      reportingPeriod: '1 July 2026 – 31 July 2026',
      totalSites: 8,
      totalDevices: 373,
      totalStockDevices: 72,
      totalSwitches: 148,
      totalAPs: 225,
      apIncidents: 302,
      uniqueAPsWithIncidents: 107,
      primaryRca: 'Device Power Issues',
      primaryRcaForAPs: 'Device Power Issues',
      overallUptime: '95.42',
      incidentFreePercent: '61.66',
      healthScore: '81.92',
      healthLabel: 'Fair',
      slaCompliance: '70.24',
      slaTarget: 99.9,
      totalIncidents: 423,
      criticalIncidents: 0,
      majorIncidents: 0,
      minorIncidents: 423
    },
    siteSummary: [
      {
        siteId: 'Bangalore',
        deviceCount: 182,
        activeDeviceCount: 128,
        stockCount: 54,
        switchCount: 50,
        apCount: 78,
        proactiveSwitchUptime: '96.50',
        jflSwitchUptime: '96.50',
        overallUptime: '96.50',
        incidentFreePercent: '70.00',
        apIncidents: 100,
        uniqueAPsWithIncidents: 40,
        incidentCount: 150,
        healthScore: '85.00',
        healthLabel: 'Good',
        primaryRca: 'Power',
        primaryRcaForAPs: 'Power'
      },
      {
        siteId: 'Mumbai',
        deviceCount: 191,
        activeDeviceCount: 191,
        stockCount: 0,
        switchCount: 98,
        apCount: 93,
        proactiveSwitchUptime: '94.00',
        jflSwitchUptime: '94.00',
        overallUptime: '94.00',
        incidentFreePercent: '55.00',
        apIncidents: 202,
        uniqueAPsWithIncidents: 67,
        incidentCount: 273,
        healthScore: '78.84',
        healthLabel: 'Fair',
        primaryRca: 'Power',
        primaryRcaForAPs: 'Power'
      }
    ],
    rcaAnalytics: {
      breakdown: [
        { rca: 'Device Power Issues', count: 300, percentage: '70.9', isTop: true },
        { rca: 'Others', count: 123, percentage: '29.1', isTop: false }
      ]
    },
    slaAnalytics: { breachedDevicesCount: 111 },
    incidentAnalytics: { openCount: 0, closedCount: 423 }
  };

  const pptData = mapSnapshotToPPTData(mockqbrData);
  assert.equal(pptData.slide3_ExecutiveSummary.totalSites.value, 8);
  assert.equal(pptData.slide3_ExecutiveSummary.totalDevices.value, 373);
  assert.equal(pptData.slide3_ExecutiveSummary.overallUptime.value, '95.42');

  const report = reconcileDashboardAndPPT(mockqbrData, pptData);
  assert.equal(report.overallStatus, 'PASS');
  assert.equal(report.mismatchesCount, 0);
});

test('Reconciliation Engine - FAIL CLOSED on Metric Mismatch', () => {
  const mockqbrData = {
    executiveSummary: {
      totalSites: 8,
      totalDevices: 373,
      overallUptime: '98.27',
      totalIncidents: 100
    },
    siteSummary: [],
    rcaAnalytics: { breakdown: [{ rca: 'Power', count: 100, percentage: '100.0' }] }
  };

  const pptData = mapSnapshotToPPTData(mockqbrData);
  // Introduce intentional mismatch
  pptData.slide3_ExecutiveSummary.overallUptime.value = '99.98';

  assert.throws(() => {
    reconcileDashboardAndPPT(mockqbrData, pptData);
  }, /PPT GENERATION FAILED — DATA RECONCILIATION ERROR/);
});

test('Reconciliation Engine - Mathematical Identity Constraints Check', () => {
  const invalidRcaSnapshot = {
    executiveSummary: { totalIncidents: 171 },
    siteSummary: [{ siteId: 'SiteA', incidentCount: 171 }],
    rcaAnalytics: { breakdown: [{ rca: 'Power', count: 150 }] } // Sum = 150 != 171
  };

  const pptData = mapSnapshotToPPTData(invalidRcaSnapshot);
  assert.throws(() => {
    reconcileDashboardAndPPT(invalidRcaSnapshot, pptData);
  }, /RCA_Total_Equals_TotalIncidents/);
});
