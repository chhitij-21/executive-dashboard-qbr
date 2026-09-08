const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { generatePDF } = require('../services/pdfGenerator');

test('pdfGenerator - generatePDF generates PDF file from qbrData model', async () => {
  const tmpDir = path.join(os.tmpdir(), `pdf_test_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const pdfPath = path.join(tmpDir, 'test_output.pdf');

  const dummyQbrData = {
    customerName: 'Jubilant Foodworks Ltd (JFL)',
    reportingPeriod: '1 July 2026 – 31 July 2026',
    executiveSummary: {
      totalSites: 5,
      totalDevices: 12,
      totalSwitches: 8,
      totalAPs: 4,
      jflSwitchUptime: '99.50',
      proactiveSwitchUptime: '99.20',
      overallUptime: '99.50',
      healthScore: 98,
      healthLabel: 'Optimal Operations',
      incidentFreePercent: '95.00',
      slaCompliance: '98.50',
      slaTarget: 99.3,
      primaryRcaSwitches: 'Power Outage',
      primaryRcaAPs: 'Fiber Cut',
    },
    siteSummary: [
      {
        siteId: 'Greater Noida',
        deviceCount: 3,
        proactiveSwitchUptime: '99.20',
        jflSwitchUptime: '99.50',
        primaryRcaSwitches: 'Power Outage',
        apIncidents: 1,
        uniqueAPsWithIncidents: 1,
        primaryRcaAPs: 'Fiber Cut',
      }
    ],
    switchAnalytics: {
      totalSwitches: 8,
      expandedRackwiseUptime: [
        { site: 'Greater Noida', rack: 'Main Rack', serialNumber: 'SW01', monthlyUptime: '99.50%', operatingStatus: 'Operational' }
      ]
    },
    apAnalytics: {
      totalAPs: 4,
      top10APOutages: [
        { DeviceID: 'JFL-GNSC-AP05', SerialNo: 'AP05', Location: 'Greater Noida', incCount: 1, uptime: '98.50' }
      ]
    }
  };

  try {
    const resultPath = await generatePDF(dummyQbrData, null, pdfPath);
    assert.ok(fs.existsSync(resultPath), 'PDF file should exist on disk');
    assert.ok(fs.statSync(resultPath).size > 0, 'PDF file should be non-empty');
  } finally {
    if (fs.existsSync(tmpDir)) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
  }
});
