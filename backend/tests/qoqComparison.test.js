require('./_setup');
// backend/tests/qoqComparison.test.js
// Comprehensive Unit & Integration Tests for Item #9: QoQ Compare
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Dependencies to test
const {
  deriveQuarterAndFiscalYear,
  getISTDateParts,
} = require('../services/processData');
const historyService = require('../services/historyService');
const qoqComparisonService = require('../services/qoqComparisonService');
const { generatePPT } = require('../services/pptGenerator');

describe('Item #9: QoQ Compare & Analytics Suite', () => {
  const tempTestDir = path.join(os.tmpdir(), `qoq_test_${Date.now()}`);

  before(() => {
    fs.mkdirSync(tempTestDir, { recursive: true });
  });

  after(() => {
    try {
      fs.rmSync(tempTestDir, { recursive: true, force: true });
    } catch (_) {}
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Standard Quarter Boundary & Fiscal Calendar Tests
  // ───────────────────────────────────────────────────────────────────────────
  it('1. Standard Quarter Validation: Exact Indian Fiscal Quarters (Q1-Q4)', () => {
    const q1 = deriveQuarterAndFiscalYear('2026-04-01', '2026-06-30');
    assert.strictEqual(q1.quarter, 'Q1');
    assert.strictEqual(q1.fiscal_year, 'FY2026');
    assert.strictEqual(q1.is_standard_quarter, true);
    assert.strictEqual(q1.qoq_disabled_reason, null);

    const q2 = deriveQuarterAndFiscalYear('2026-07-01', '2026-09-30');
    assert.strictEqual(q2.quarter, 'Q2');
    assert.strictEqual(q2.fiscal_year, 'FY2026');
    assert.strictEqual(q2.is_standard_quarter, true);

    const q3 = deriveQuarterAndFiscalYear('2026-10-01', '2026-12-31');
    assert.strictEqual(q3.quarter, 'Q3');
    assert.strictEqual(q3.fiscal_year, 'FY2026');
    assert.strictEqual(q3.is_standard_quarter, true);

    const q4 = deriveQuarterAndFiscalYear('2026-01-01', '2026-03-31');
    assert.strictEqual(q4.quarter, 'Q4');
    assert.strictEqual(q4.fiscal_year, 'FY2025'); // Jan-Mar 2026 is Q4 of FY2025
    assert.strictEqual(q4.is_standard_quarter, true);
  });

  it('2. Custom Period Validation: Non-aligned range tags CUSTOM', () => {
    const custom = deriveQuarterAndFiscalYear('2026-08-15', '2026-11-15');
    assert.strictEqual(custom.quarter, 'CUSTOM');
    assert.strictEqual(custom.is_standard_quarter, false);
    assert.strictEqual(
      custom.qoq_disabled_reason,
      'QoQ comparison is only available for standard quarterly periods.'
    );
  });

  it('3. Single Month Validation: 1 Jul to 31 Jul tags CUSTOM', () => {
    const month = deriveQuarterAndFiscalYear('2026-07-01', '2026-07-31');
    assert.strictEqual(month.quarter, 'CUSTOM');
    assert.strictEqual(month.is_standard_quarter, false);
  });

  it('4. Timezone Math Fallback: Pure numerical IST offset (UTC+5.5h)', () => {
    // 2026-06-30T20:00:00Z -> IST is 2026-07-01 01:30:00 (next day in IST)
    const parts = getISTDateParts('2026-06-30T20:00:00Z');
    assert.strictEqual(parts.year, 2026);
    assert.strictEqual(parts.month, 7);
    assert.strictEqual(parts.day, 1);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. History Migration & Strict Multi-Tenant Isolation
  // ───────────────────────────────────────────────────────────────────────────
  it('5. historyService legacy migration: backfills quarter and fiscal_year', () => {
    const legacyHistory = [
      {
        id: 'job-legacy-1',
        clientId: 'client-jfl',
        startDate: '2026-04-01',
        endDate: '2026-06-30',
        report_period: { start_date: '2026-04-01', end_date: '2026-06-30' },
      },
    ];
    const migrated = historyService.migrateLegacyQuarterMetadata(legacyHistory);
    assert.strictEqual(migrated[0].quarter, 'Q1');
    assert.strictEqual(migrated[0].fiscal_year, 'FY2026');
    assert.strictEqual(migrated[0].is_standard_quarter, true);
  });

  it('6. findPreviousQuarterReport: Exact preceding quarter resolution', () => {
    // Q2 FY2026 -> prior is Q1 FY2026
    const prevQ2 = qoqComparisonService.getPrecedingQuarter('Q2', 'FY2026');
    assert.deepStrictEqual(prevQ2, { quarter: 'Q1', fiscal_year: 'FY2026' });

    // Q1 FY2026 -> prior is Q4 FY2025
    const prevQ1 = qoqComparisonService.getPrecedingQuarter('Q1', 'FY2026');
    assert.deepStrictEqual(prevQ1, { quarter: 'Q4', fiscal_year: 'FY2025' });
  });

  it('7. Strict Multi-Tenant Isolation: Tenant B never accesses Tenant A history', () => {
    const mockReports = [
      {
        id: 'job-jfl-q1',
        clientId: 'client-jfl',
        quarter: 'Q1',
        fiscal_year: 'FY2026',
        is_standard_quarter: true,
        status: 'completed',
        data: { customerName: 'Jubilant FoodWorks' },
      },
      {
        id: 'job-mmtc-q1',
        clientId: 'client-mmtcpamp',
        quarter: 'Q1',
        fiscal_year: 'FY2026',
        is_standard_quarter: true,
        status: 'completed',
        data: { customerName: 'MMTC-PAMP' },
      },
    ];

    // Tenant B (client-mmtcpamp) querying Q1 FY2026 should return MMTC, not JFL
    const resultMMTC = historyService.findPreviousQuarterReportFromList(
      mockReports,
      'client-mmtcpamp',
      'Q1',
      'FY2026'
    );
    assert.ok(resultMMTC);
    assert.strictEqual(resultMMTC.clientId, 'client-mmtcpamp');
    assert.strictEqual(resultMMTC.data.customerName, 'MMTC-PAMP');

    // Tenant C querying with no matching history returns null
    const resultOther = historyService.findPreviousQuarterReportFromList(
      mockReports,
      'client-nonexistent',
      'Q1',
      'FY2026'
    );
    assert.strictEqual(resultOther, null);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. QoQ KPI Delta & Directional Polarity
  // ───────────────────────────────────────────────────────────────────────────
  it('8. compareQoQ: Calculates exact KPI deltas and directional polarity', () => {
    const currentQbr = {
      customerName: 'JFL',
      clientId: 'client-jfl',
      report_period: { quarter: 'Q2', fiscal_year: 'FY2026', is_standard_quarter: true, display_label: '1 Jul 2026 – 30 Sep 2026' },
      executiveSummary: {
        overallUptime: '99.85',
        jflUptime: '99.90',
        proactiveUptime: '99.70',
        totalIncidents: 10,
        incidentFreeSitesPercent: '95.00',
        healthScore: '96.5',
      },
      siteSummary: [
        { siteId: 'Site-A', jflUptime: 99.80, incidentCount: 2, slaStatus: 'SLA Met' },
      ],
      rcaBreakdown: [{ category: 'Power', count: 5 }],
    };

    const priorQbr = {
      customerName: 'JFL',
      clientId: 'client-jfl',
      report_period: { quarter: 'Q1', fiscal_year: 'FY2026', is_standard_quarter: true, display_label: '1 Apr 2026 – 30 Jun 2026' },
      executiveSummary: {
        overallUptime: '99.50',
        jflUptime: '99.60',
        proactiveUptime: '99.40',
        totalIncidents: 15,
        incidentFreeSitesPercent: '90.00',
        healthScore: '92.0',
      },
      siteSummary: [
        { siteId: 'Site-A', jflUptime: 99.20, incidentCount: 5, slaStatus: 'SLA Breached' },
      ],
      rcaBreakdown: [{ category: 'Power', count: 8 }],
    };

    const comparison = qoqComparisonService.compareQoQ(currentQbr, priorQbr);
    assert.strictEqual(comparison.is_standard_quarter, true);
    assert.strictEqual(comparison.has_prior_quarter, true);
    assert.strictEqual(comparison.kpis.overallUptime.delta, 0.35);
    assert.strictEqual(comparison.kpis.overallUptime.direction, 'improved');

    // Incident drop from 15 to 10 is an IMPROVEMENT
    assert.strictEqual(comparison.kpis.totalIncidents.delta, -5);
    assert.strictEqual(comparison.kpis.totalIncidents.direction, 'improved');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. RCA Normalization & Division-by-Zero Protection
  // ───────────────────────────────────────────────────────────────────────────
  it('9. RCA Normalization: Coalesces "Power", "power", and "Power "', () => {
    const currentRca = [{ category: 'Power ', count: 4 }, { category: 'ISP Outage', count: 2 }];
    const priorRca = [{ category: 'power', count: 6 }, { category: 'Hardware Failure', count: 3 }];

    const shifts = qoqComparisonService.calculateRcaShifts(currentRca, priorRca);
    const powerShift = shifts.find(s => s.normalizedCategory === 'power');
    assert.ok(powerShift, 'Power category should be found normalized');
    assert.strictEqual(powerShift.priorCount, 6);
    assert.strictEqual(powerShift.currentCount, 4);
    assert.strictEqual(powerShift.delta, -2);
    assert.strictEqual(powerShift.isNewOccurrence, false);
  });

  it('10. RCA Division-by-Zero: Safe labels for 0 counts', () => {
    // New occurrence: prior 0 -> current 3
    const newOccur = qoqComparisonService.calculateRcaDelta(3, 0);
    assert.strictEqual(newOccur.pctChange, 100.0);
    assert.strictEqual(newOccur.changeLabel, 'New Occurrence (+100%)');
    assert.strictEqual(newOccur.isNewOccurrence, true);

    // Resolved: prior 4 -> current 0
    const resolved = qoqComparisonService.calculateRcaDelta(0, 4);
    assert.strictEqual(resolved.pctChange, -100.0);
    assert.strictEqual(resolved.changeLabel, 'Resolved (-100%)');

    // Both zero: 0 -> 0
    const bothZero = qoqComparisonService.calculateRcaDelta(0, 0);
    assert.strictEqual(bothZero.pctChange, 0.0);
    assert.strictEqual(bothZero.changeLabel, 'Unchanged (0%)');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Site-Level QoQ Calculation & Executive Narrative
  // ───────────────────────────────────────────────────────────────────────────
  it('11. Site-Level QoQ Calculation: Computes site uptime delta and narrative', () => {
    const currentSites = [
      { siteId: 'Site-A', jflUptime: 99.80, incidentCount: 2, slaCompliancePercent: 98.0 },
      { siteId: 'Site-B', jflUptime: 97.00, incidentCount: 8, slaCompliancePercent: 95.0 },
    ];
    const priorSites = [
      { siteId: 'Site-A', jflUptime: 99.45, incidentCount: 4, slaCompliancePercent: 96.0 },
      { siteId: 'Site-B', jflUptime: 99.10, incidentCount: 1, slaCompliancePercent: 99.0 },
    ];

    const siteDiffs = qoqComparisonService.calculateSiteComparisons(currentSites, priorSites);
    
    // Site-A improved
    assert.strictEqual(siteDiffs['Site-A'].uptimeDelta, 0.35);
    assert.strictEqual(siteDiffs['Site-A'].incidentDelta, -2);
    assert.strictEqual(siteDiffs['Site-A'].status, 'improved');

    // Site-B degraded (SLA drop)
    assert.strictEqual(siteDiffs['Site-B'].slaDelta, -4.0);
    assert.strictEqual(siteDiffs['Site-B'].status, 'degraded');
    assert.ok(
      siteDiffs['Site-B'].narrative.includes("SLA dropped") ||
      siteDiffs['Site-B'].narrative.includes("degraded"),
      `Expected degradation narrative, got: ${siteDiffs['Site-B'].narrative}`
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Sparkline Coordinate Series
  // ───────────────────────────────────────────────────────────────────────────
  it('12. Sparkline Coordinate Series: Generates mini trend series', () => {
    const series = qoqComparisonService.generateSparklineSeries('overallUptime', 99.5, 99.85, 'Q1 FY2026', 'Q2 FY2026');
    assert.strictEqual(series.length, 2);
    assert.strictEqual(series[0].period, 'Q1 FY2026');
    assert.strictEqual(series[0].value, 99.5);
    assert.strictEqual(series[1].period, 'Q2 FY2026');
    assert.strictEqual(series[1].value, 99.85);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7. Lazy Computation Performance Guard
  // ───────────────────────────────────────────────────────────────────────────
  it('13. Lazy Computation Guard: Skips computation if has_prior_quarter is false', () => {
    const qbrDataNoPrior = {
      report_period: { quarter: 'Q1', fiscal_year: 'FY2026', is_standard_quarter: true },
      has_prior_quarter: false,
    };
    const comp = qoqComparisonService.resolveOrSkipQoQ(qbrDataNoPrior, null);
    assert.strictEqual(comp, null, 'Must skip computation when prior quarter is absent');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 8. PPT Generation Integration & Fallback
  // ───────────────────────────────────────────────────────────────────────────
  it('14. PPT Fallback: NO prior quarter skips QoQ slide with zero errors', async () => {
    const bundledPath = path.resolve(__dirname, '../../data/bundled_default/dashboard_data.json');
    const baseData = JSON.parse(fs.readFileSync(bundledPath, 'utf8'));

    const qbrDataInitial = {
      ...baseData,
      report_period: { quarter: 'Q1', fiscal_year: 'FY2026', is_standard_quarter: true, display_label: '1 Apr 2026 – 30 Jun 2026' },
      qoqComparison: null,
      has_prior_quarter: false,
    };

    const outPpt = path.join(tempTestDir, 'fallback_test.pptx');
    await assert.doesNotReject(async () => {
      await generatePPT(qbrDataInitial, null, outPpt);
    }, 'Generating PPT with null qoqComparison should complete without crashing');
    assert.ok(fs.existsSync(outPpt), 'Presentation file should be created');
  });

  it('15. PPT Integration: With valid qoqComparison creates QoQ slide cleanly', async () => {
    const bundledPath = path.resolve(__dirname, '../../data/bundled_default/dashboard_data.json');
    const baseData = JSON.parse(fs.readFileSync(bundledPath, 'utf8'));

    const qbrDataWithQoQ = {
      ...baseData,
      report_period: { quarter: 'Q2', fiscal_year: 'FY2026', is_standard_quarter: true, display_label: '1 Jul 2026 – 30 Sep 2026' },
      has_prior_quarter: true,
      qoqComparison: {
        currentPeriod: 'Q2 FY2026',
        priorPeriod: 'Q1 FY2026',
        is_standard_quarter: true,
        has_prior_quarter: true,
        kpis: {
          overallUptime: { current: '99.85', prior: '99.50', delta: 0.35, direction: 'improved' },
          jflUptime: { current: '99.90', prior: '99.60', delta: 0.30, direction: 'improved' },
          proactiveUptime: { current: '99.70', prior: '99.40', delta: 0.30, direction: 'improved' },
          totalIncidents: { current: 10, prior: 15, delta: -5, direction: 'improved' },
          slaCompliance: { current: '99.50', prior: '98.00', delta: 1.50, direction: 'improved' },
          healthScore: { current: '98.0', prior: '96.5', delta: 1.50, direction: 'improved' },
        },
        siteComparisons: {
          'Noida': { uptimeDelta: 0.35, incidentDelta: -1, status: 'improved', narrative: 'Uptime increased by +0.35%' },
        },
        rcaShifts: [
          { category: 'Power', priorCount: 5, currentCount: 2, delta: -3, pctChange: -60.0, direction: 'improved' }
        ],
      },
    };

    const outPpt = path.join(tempTestDir, 'with_qoq_test.pptx');
    await assert.doesNotReject(async () => {
      await generatePPT(qbrDataWithQoQ, null, outPpt);
    }, 'Generating PPT with valid qoqComparison should complete without crashing');
    assert.ok(fs.existsSync(outPpt), 'Presentation file should be created');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 9. Legacy Dataset On-the-Fly QoQ Computation
  // ───────────────────────────────────────────────────────────────────────────
  it('16. Legacy Dataset On-the-Fly QoQ Computation: Missing qoqComparison computes on-the-fly', () => {
    const legacyData = {
      clientId: 'client-jfl',
      customerName: 'Jubilant FoodWorks',
      startDate: '2026-07-01',
      endDate: '2026-09-30',
      report_period: { start_date: '2026-07-01', end_date: '2026-09-30' },
      // qoqComparison is deliberately undefined
      executiveSummary: { overallUptime: '99.9', jflUptime: '99.9', proactiveUptime: '99.8', totalIncidents: 5 },
    };

    const priorData = {
      clientId: 'client-jfl',
      quarter: 'Q1',
      fiscal_year: 'FY2026',
      executiveSummary: { overallUptime: '99.5', jflUptime: '99.6', proactiveUptime: '99.4', totalIncidents: 10 },
    };

    const qInfo = deriveQuarterAndFiscalYear(legacyData.startDate, legacyData.endDate);
    assert.strictEqual(qInfo.quarter, 'Q2');
    assert.strictEqual(qInfo.fiscal_year, 'FY2026');

    // Simulate on-the-fly resolution
    const comp = qoqComparisonService.compareQoQ(
      { ...legacyData, report_period: { ...legacyData.report_period, ...qInfo } },
      priorData
    );
    assert.ok(comp, 'Should compute comparison on-the-fly');
    assert.strictEqual(comp.has_prior_quarter, true);
    assert.strictEqual(comp.kpis.overallUptime.delta, 0.4);
  });
});
