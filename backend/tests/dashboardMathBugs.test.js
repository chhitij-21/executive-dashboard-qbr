const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildReport } = require('../services/reportService');
const {
  buildExecutiveSummary,
  buildIncidentAnalytics,
  buildSLAAnalytics,
  deriveSubCategory,
} = require('../services/processData');

describe('Dashboard Math, Charts & Data Inconsistencies Bug Fixes (TDD)', () => {

  describe('Bug 1: SLA Trend Calculation & Negative Protection', () => {
    it('does not calculate negative SLA trend when incident device count exceeds inventory devices', () => {
      // 13 inventory devices, but 42 incident device IDs in month 2026-09
      const devices = Array.from({ length: 13 }, (_, i) => ({
        DeviceID: `DEV-${i}`,
        SiteID: 'SiteA',
        __effectiveUptime: 99.5,
        __slaBreach: false,
      }));

      const incidents = Array.from({ length: 42 }, (_, i) => ({
        DeviceID: `INC-DEV-${i}`,
        CreatedTime: '2026-09-15 10:00',
        sla_status: i < 40 ? 'SLA Met' : 'SLA Breached',
      }));

      const slaAnalytics = buildSLAAnalytics(devices, incidents);
      assert.ok(slaAnalytics.monthlySLATrend.length > 0, 'Should have monthly trend');
      
      const septTrend = slaAnalytics.monthlySLATrend.find(t => t.month === '2026-09');
      assert.ok(septTrend, 'September trend should exist');
      
      const val = parseFloat(septTrend.slaPercent);
      assert.ok(val >= 0, `SLA trend must not be negative, got ${val}`);
      assert.ok(val <= 100, `SLA trend must be <= 100, got ${val}`);
      // Based on 40 Met out of 42 = 95.24%
      assert.equal(val, 95.24);
    });
  });

  describe('Bug 2: SLA Compliance Contradiction (Ticket SLA vs Device Uptime)', () => {
    it('calculates ticket-based SLA compliance for non-JFL client when tickets have SLA breaches', () => {
      const devices = [
        { DeviceID: 'D1', SiteID: 'SiteA', __slaBreach: false, __effectiveUptime: 100 },
        { DeviceID: 'D2', SiteID: 'SiteA', __slaBreach: false, __effectiveUptime: 100 },
      ];
      // 342 Met, 4 Breached
      const incidents = [
        ...Array.from({ length: 342 }, () => ({ sla_status: 'SLA Met', DeviceID: 'D1' })),
        ...Array.from({ length: 4 }, () => ({ sla_status: 'SLA Breached', DeviceID: 'D2' })),
      ];

      const exec = buildExecutiveSummary(
        devices,
        devices,
        [],
        incidents,
        [],
        '1 September 2026 – 30 September 2026',
        'MMTC',
        { clientId: 'client-mmtcpamp' }
      );

      // Met / (Met + Breached) = 342 / 346 = 98.84%
      assert.notEqual(exec.slaCompliance, '100.00', 'Should not report 100.00% when there are 4 SLA breaches');
      assert.equal(exec.slaCompliance, '98.84');
    });
  });

  describe('Bug 4: Total Sites Union', () => {
    it('computes totalSites as union of inventory sites and incident sites', () => {
      const devices = [
        { DeviceID: 'D1', SiteID: 'SiteA' },
        { DeviceID: 'D2', SiteID: 'SiteB' },
      ];
      const incidents = [
        { DeviceID: 'D1', SiteID: 'SiteA' },
        { DeviceID: 'D2', SiteID: 'SiteB' },
        { DeviceID: 'D3', SiteID: 'SiteC' },
        { DeviceID: 'D4', SiteID: 'SiteD' },
        { DeviceID: 'D5', SiteID: 'SiteE' },
      ];

      const exec = buildExecutiveSummary(
        devices,
        devices,
        [],
        incidents,
        [],
        '1 September 2026 – 30 September 2026',
        'MMTC',
        { clientId: 'client-mmtcpamp' }
      );

      assert.equal(exec.totalSites, 5, 'Should count union of 5 unique sites (SiteA, SiteB, SiteC, SiteD, SiteE)');
    });
  });

  describe('Bug 6: Missing 1 Ticket Math (Open status support)', () => {
    it('surfaces open tickets in report summary so total equals closed + on_hold + open', () => {
      const tickets = [
        { 'Created Time': '2026-09-05 10:00', Status: 'Closed', 'Account Name': 'MMTC' },
        { 'Created Time': '2026-09-06 10:00', Status: 'Closed', 'Account Name': 'MMTC' },
        { 'Created Time': '2026-09-07 10:00', Status: 'On Hold', 'Account Name': 'MMTC' },
        { 'Created Time': '2026-09-08 10:00', Status: 'Ticket Assignment', 'Account Name': 'MMTC' },
      ];

      const rep = buildReport('client-mmtcpamp', '2026-09-01', '2026-09-30', { tickets });
      assert.equal(rep.summary.total, 4);
      assert.equal(rep.summary.closed, 2);
      assert.equal(rep.summary.on_hold, 1);
      assert.equal(rep.summary.open, 1, 'Should track 1 open ticket');
      assert.equal(rep.summary.closed + rep.summary.on_hold + rep.summary.open, rep.summary.total);
    });
  });

  describe('Bug 7: Dynamic Upgrade Classification', () => {
    it('dynamically classifies Meraki upgrade instead of hardcoded IOS Upgradation', () => {
      const merakiItem = {
        Subject: 'Meraki upgrade activity',
        Description: 'Meraki upgrade activity',
        SubCategory: 'IOS Upgradation Activity',
        Category: 'Meraki Managed Services',
      };
      assert.equal(deriveSubCategory(merakiItem), 'Meraki Firmware Upgrade');
    });

    it('dynamically classifies FMC upgrade', () => {
      const fmcItem = {
        Subject: 'FMC Security Upgrade (CVE-2026-76420)',
        Description: 'FMC Security Upgrade',
        SubCategory: 'IOS Upgradation Activity',
        Category: 'Security Managed Services',
      };
      assert.equal(deriveSubCategory(fmcItem), 'FMC/FTD Upgrade');
    });

    it('dynamically classifies Switch IOS upgrade', () => {
      const switchItem = {
        Subject: 'IOS Upgrade of Switches',
        Description: 'IOS Upgrade of Switches',
        SubCategory: 'IOS Upgradation Activity',
      };
      assert.equal(deriveSubCategory(switchItem), 'Switch IOS Upgrade');
    });
  });

  describe('Bug 8: Timeseries Continuity & Zero-fill', () => {
    it('zero-fills intervening missing months between start and end', () => {
      const incidents = [
        { CreatedTime: '2026-06-15 10:00' },
        { CreatedTime: '2026-09-10 10:00' },
      ];
      const res = buildIncidentAnalytics(incidents, { startDate: '2026-06-01', endDate: '2026-09-30' });
      const months = res.monthlyTrend.map(m => m.month);
      assert.ok(months.includes('2026-06'));
      assert.ok(months.includes('2026-07'), 'July should be zero-filled');
      assert.ok(months.includes('2026-08'), 'August should be zero-filled');
      assert.ok(months.includes('2026-09'));
      
      const july = res.monthlyTrend.find(m => m.month === '2026-07');
      assert.equal(july.count, 0);
    });
  });

  describe('Bug 3: Category Filter Alignment (Incidents vs Other Activities)', () => {
    it('separates Change Requests, Request Fulfillment, and Upgrades from Incidents', () => {
      const tickets = [
        { 'Created Time': '2026-09-01 10:00', Status: 'Closed', RCA: 'ISP Issue', 'Sub Category': 'Software / Configuration' },
        { 'Created Time': '2026-09-02 10:00', Status: 'Closed', RCA: 'ISP Issue', 'Sub Category': 'Change Request' },
        { 'Created Time': '2026-09-03 10:00', Status: 'Closed', RCA: 'New Configuration', 'Sub Category': 'Request Fulfillment' },
        { 'Created Time': '2026-09-04 10:00', Status: 'Closed', RCA: 'Planned Maintenance', Subject: 'Meraki upgrade' },
      ];

      const rep = buildReport('client-mmtcpamp', '2026-09-01', '2026-09-30', { tickets });
      assert.equal(rep.sla.by_type.Incident, 1, 'Only non-CR/RF/Upgrade tickets should be classified as Incident');
      assert.equal(rep.sla.by_type.CR, 1);
      assert.equal(rep.sla.by_type.RF, 1);
      assert.equal(rep.sla.by_type.Upgrade, 1);
    });
  });

  describe('Bug 5: RCA Breakdown & ISP Count Consistency', () => {
    it('ensures RCA breakdown ticket count for ISP Issue matches ispCount', () => {
      const tickets = [
        { 'Created Time': '2026-09-01 10:00', Status: 'Closed', RCA: 'ISP Issue', 'Device Name': 'SiteA-SW1' },
        { 'Created Time': '2026-09-02 10:00', Status: 'Closed', RCA: 'ISP Issue', 'Device Name': 'SiteA-SW2' },
        { 'Created Time': '2026-09-03 10:00', Status: 'Closed', RCA: 'Power Failure', 'Device Name': 'SiteB-SW1' },
      ];

      const rep = buildReport('client-mmtcpamp', '2026-09-01', '2026-09-30', { tickets });
      const ispRcaEntry = rep.rca_breakdown.find(r => r.rca === 'ISP Issue');
      const totalIspInLocation = rep.isp_location.reduce((sum, s) => sum + s.count, 0);

      assert.ok(ispRcaEntry, 'ISP Issue must exist in RCA breakdown');
      assert.equal(ispRcaEntry.tickets, 2, 'Should count both ISP tickets in breakdown table');
      assert.equal(totalIspInLocation, 2, 'ISP location table total must match RCA table tickets');
    });
  });

});
