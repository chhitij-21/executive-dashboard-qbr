const fs = require('fs');
const path = require('path');
const ruleEngine = require('../backend/services/ruleEngine');

const CUSTOMER_NAME = 'Jubilant Foodworks Ltd (JFL)';
const REPORTING_PERIOD = '1 August 2026 – 31 August 2026';
const SLA_TARGET = 99.3;
const INCIDENT_SLA_TARGET_HOURS = 2.0;

const reportPeriodMeta = {
  start_date: '2026-08-01',
  end_date: '2026-08-31',
  period_type: 'custom',
  display_label: REPORTING_PERIOD,
};

const sites = [
  'Bangalore',
  'Greater Noida',
  'Noida',
  'Mohali',
  'Hyderabad',
  'Nagpur',
  'Mumbai-DC',
  'Guwahati',
];

// ── 1. Generate 444 Devices (148 Switches + 224 APs + 72 Stock) ───────────────
const devices = [];

// 148 Switches (6 breaching SLA < 99.3%)
for (let i = 1; i <= 148; i++) {
  const site = sites[(i - 1) % sites.length];
  const host = `JFL-${site.slice(0, 4).toUpperCase().replace('-', '')}-SW-${String(i).padStart(2, '0')}`;
  const serial = `SW-SER-${String(i).padStart(4, '0')}`;
  const isBreached = i <= 6;
  const uptime = isBreached ? parseFloat((91.5 + i * 1.1).toFixed(2)) : parseFloat((99.4 + (i % 5) * 0.1).toFixed(2));
  devices.push({
    DeviceID: host,
    SerialNo: serial,
    Hostname: host,
    Location: site,
    SiteID: site,
    DeviceType: 'SW',
    CoreNonCore: i % 4 === 0 ? 'Core' : 'Non-Core',
    'JFL Uptime %': `${uptime}%`,
    'Proactive Uptime %': '99.96%',
    __effectiveUptime: uptime,
    __jflUptime: uptime,
    __proactiveUptime: 99.96,
    __monthlyUptime: uptime,
    __quarterlyUptime: uptime,
    __isStock: false,
    __slaBreach: isBreached,
    __isClientSideOnly: false,
    __slaTarget: SLA_TARGET,
  });
}

// 224 APs (9 breaching SLA < 99.3%)
for (let i = 1; i <= 224; i++) {
  const site = sites[(i - 1) % sites.length];
  const host = `JFL-${site.slice(0, 4).toUpperCase().replace('-', '')}-AP-${String(i).padStart(2, '0')}`;
  const serial = `AP-SER-${String(i).padStart(4, '0')}`;
  const isBreached = i <= 9;
  const uptime = isBreached ? parseFloat((92.0 + i * 0.7).toFixed(2)) : parseFloat((99.5 + (i % 5) * 0.1).toFixed(2));
  devices.push({
    DeviceID: host,
    SerialNo: serial,
    Hostname: host,
    Location: site,
    SiteID: site,
    DeviceType: 'AP',
    CoreNonCore: 'Access Point',
    'JFL Uptime %': `${uptime}%`,
    'Proactive Uptime %': '99.98%',
    __effectiveUptime: uptime,
    __jflUptime: uptime,
    __proactiveUptime: 99.98,
    __monthlyUptime: uptime,
    __quarterlyUptime: uptime,
    __isStock: false,
    __slaBreach: isBreached,
    __isClientSideOnly: false,
    __slaTarget: SLA_TARGET,
  });
}

// 72 Stock Devices (Excluded from SLA)
for (let i = 1; i <= 72; i++) {
  const site = sites[(i - 1) % sites.length];
  const host = `JFL-${site.slice(0, 4).toUpperCase().replace('-', '')}-STK-${String(i).padStart(2, '0')}`;
  const serial = `STK-SER-${String(i).padStart(4, '0')}`;
  devices.push({
    DeviceID: host,
    SerialNo: serial,
    Hostname: host,
    Location: site,
    SiteID: site,
    DeviceType: i % 2 === 0 ? 'SW' : 'AP',
    CoreNonCore: 'Stock',
    'JFL Uptime %': '100.00%',
    'Proactive Uptime %': '100.00%',
    __effectiveUptime: 100,
    __jflUptime: 100,
    __proactiveUptime: 100,
    __monthlyUptime: 100,
    __quarterlyUptime: 100,
    __isStock: true,
    __slaBreach: false,
    __isClientSideOnly: false,
    __slaTarget: SLA_TARGET,
  });
}

// ── 2. Generate 98 Incidents (37 Switch + 61 AP Incidents) ────────────────────
const rcaDrivers = [
  'Device Power Issues',
  'ISP Link Down',
  'New Configuration',
  'Client Side Activity',
  'Hardware Degradation',
  'Cable Damage',
];

const incidents = [];
for (let i = 1; i <= 98; i++) {
  const isSwitch = i <= 37;
  const site = sites[(i - 1) % sites.length];
  const devType = isSwitch ? 'SW' : 'AP';
  const targetDevs = devices.filter((d) => !d.__isStock && d.DeviceType === devType && d.Location === site);
  const targetDev = targetDevs.length > 0 ? targetDevs[i % targetDevs.length] : devices[0];
  const rca = rcaDrivers[(i - 1) % rcaDrivers.length];
  const isResolutionBreached = i % 25 === 0; // 4 breached incidents out of 98 (95.92% Resolution SLA)
  const actualMin = isResolutionBreached ? 145.0 : 45.0;

  incidents.push({
    SNo: i,
    IncidentNumber: `PRO/INC/${62526 + i}`,
    TicketNumber: `PRO/INC/${62526 + i}`,
    DeviceID: targetDev.DeviceID,
    SerialNo: targetDev.SerialNo,
    Hostname: targetDev.Hostname,
    Location: site,
    SiteID: site,
    DeviceType: devType,
    Category: rca,
    Description: `Incident on ${targetDev.Hostname} - ${rca}`,
    RCA: rca,
    Status: 'Closed',
    CreatedTime: '2026-08-12T10:00:00Z',
    OpenTime: '2026-08-12T10:00:00Z',
    ResolvedTime: '2026-08-12T11:00:00Z',
    ActualResolutionMin: actualMin,
    TotalResolutionMin: actualMin + 15,
    HoldTimeMin: 15,
    sla_status: isResolutionBreached ? 'SLA Breached' : 'SLA Met',
    display_reference: { type: 'Incident ID', value: `PRO/INC/${62526 + i}` },
  });
}

// ── 3. Canonical 17 Other Activities ──────────────────────────────────────────
const canonicalOtherActivities = [
  { Subject: "Port Reset | JFL, Nagpur", Description: "Port Reset | JFL, Nagpur", SubCategory: "Change Request", Category: "Change Request", DeviceName: "Nagpur", Location: "Nagpur", DeviceSerial: "Q5JJ-68KZ-MXAS", SerialNo: "Q5JJ-68KZ-MXAS", DeviceID: "Q5JJ-68KZ-MXAS", DeviceType: "SW", Hostname: "JFL-NAG-SSC-SW01", Status: "Closed", RCA: "New Configuration", display_reference: "Ticket: CR-NAG-01" },
  { Subject: "Creating new user for BLR-SCC-GUEST SSID - Q3AC-Y2HS-V29M", Description: "Creating new user for BLR-SCC-GUEST SSID - Q3AC-Y2HS-V29M", SubCategory: "Change Request", Category: "Change Request", DeviceName: "Bangalore", Location: "Bangalore", DeviceSerial: "Q3AC-Y2HS-V29M", SerialNo: "Q3AC-Y2HS-V29M", DeviceID: "Q3AC-Y2HS-V29M", DeviceType: "AP", Hostname: "1F-AP26-R5-SW02-34P", Status: "Closed", RCA: "New Configuration", display_reference: "Ticket: CR-BLR-01" },
  { Subject: "Remove port security on the ports listed below on the mentioned switches. || FCW2222B4KE and FVH2914L0BV", Description: "Remove port security on the ports listed below on the mentioned switches. || FCW2222B4KE and FVH2914L0BV", SubCategory: "Change Request", Category: "Change Request", DeviceName: "Greater Noida", Location: "Greater Noida", DeviceSerial: "FVH2914L0BV", SerialNo: "FVH2914L0BV", DeviceID: "FVH2914L0BV", DeviceType: "SW", Hostname: "JFL-GNSC-GF-AC-SW-03", Status: "Closed", RCA: "New Configuration", display_reference: "Ticket: CR-GN-01" },
  { Subject: "Port Security Remove on Switch Port 2/0/2 – JFL-GNSC-ER-AC-SW-01", Description: "Port Security Remove on Switch Port 2/0/2 – JFL-GNSC-ER-AC-SW-01", SubCategory: "Change Request", Category: "Change Request", DeviceName: "Greater Noida", Location: "Greater Noida", DeviceSerial: "FOC2536Y0JD", SerialNo: "FOC2536Y0JD", DeviceID: "FOC2536Y0JD", DeviceType: "SW", Hostname: "JFL-GNMC-ER-AC-SW-01", Status: "Closed", RCA: "New Configuration", display_reference: "Ticket: CR-GN-02" },
  { Subject: "Enable Port 24 on switch 1F-R2-SW1 and assign it to VLAN 9. || Q2QW-EXJY-SE64", Description: "Enable Port 24 on switch 1F-R2-SW1 and assign it to VLAN 9. || Q2QW-EXJY-SE64", SubCategory: "Change Request", Category: "Change Request", DeviceName: "Bangalore", Location: "Bangalore", DeviceSerial: "Q2QW-EXJY-SE64", SerialNo: "Q2QW-EXJY-SE64", DeviceID: "Q2QW-EXJY-SE64", DeviceType: "SW", Hostname: "1F-R2-SW1", Status: "Closed", RCA: "New Configuration", display_reference: "Ticket: CR-BLR-02" },
  { Subject: "ISE Advantage Licence", Description: "ISE Advantage Licence", SubCategory: "Request Fulfillment", Category: "Request Fulfillment", DeviceName: "Noida", Location: "Noida", DeviceSerial: "WMP27030033", SerialNo: "WMP27030033", DeviceID: "WMP27030033", DeviceType: "Cisco ISE", Hostname: "JFL-ISE", Status: "Closed", RCA: "Others", display_reference: "Ticket: RF-NOI-01" },
  { Subject: "Network Asset Scan Reports---FOC2635Y89M", Description: "Network Asset Scan Reports---FOC2635Y89M", SubCategory: "Request Fulfillment", Category: "Request Fulfillment", DeviceName: "Noida", Location: "Noida", DeviceSerial: "FOC2635Y89M", SerialNo: "FOC2635Y89M", DeviceID: "FOC2635Y89M", DeviceType: "SW", Hostname: "JFL-Core-Sw1", Status: "Ticket Assignment", RCA: "On Hold", display_reference: "Ticket: RF-NOI-02" },
  { Subject: "Fw: Request to Switch Off Unnecessary Power Loads During BESCOM Shutdown.", Description: "Fw: Request to Switch Off Unnecessary Power Loads During BESCOM Shutdown.", SubCategory: "Request Fulfillment", Category: "Request Fulfillment", DeviceName: "Bangalore", Location: "Bangalore", DeviceSerial: "Q2DW-EM6A-8GPL", SerialNo: "Q2DW-EM6A-8GPL", DeviceID: "Q2DW-EM6A-8GPL", DeviceType: "SW", Hostname: "CORE-1", Status: "Closed", RCA: "On Hold", display_reference: "Ticket: RF-BLR-01" },
  { Subject: "Need to IP WHITELIST ---------10.167.6.119", Description: "Need to IP WHITELIST ---------10.167.6.119", SubCategory: "Change Request", Category: "Change Request", DeviceName: "Bangalore", Location: "Bangalore", DeviceSerial: "Q2QW-FCJL-LJS8", SerialNo: "Q2QW-FCJL-LJS8", DeviceID: "Q2QW-FCJL-LJS8", DeviceType: "SW", Hostname: "SEC-CAB-SW1", Status: "Closed", RCA: "New Configuration", display_reference: "Ticket: CR-BLR-03" },
  { Subject: "Need to IP WHITELIST ---------10.167.6.123", Description: "Need to IP WHITELIST ---------10.167.6.123", SubCategory: "Change Request", Category: "Change Request", DeviceName: "Bangalore", Location: "Bangalore", DeviceSerial: "Q2QW-FCJL-LJS8", SerialNo: "Q2QW-FCJL-LJS8", DeviceID: "Q2QW-FCJL-LJS8", DeviceType: "SW", Hostname: "SEC-CAB-SW1", Status: "Closed", RCA: "New Configuration", display_reference: "Ticket: CR-BLR-04" },
  { Subject: "Need to IP WHITELIST ---------10.167.6.120", Description: "Need to IP WHITELIST ---------10.167.6.120", SubCategory: "Change Request", Category: "Change Request", DeviceName: "Bangalore", Location: "Bangalore", DeviceSerial: "Q2QW-FCJL-LJS8", SerialNo: "Q2QW-FCJL-LJS8", DeviceID: "Q2QW-FCJL-LJS8", DeviceType: "SW", Hostname: "SEC-CAB-SW1", Status: "Closed", RCA: "New Configuration", display_reference: "Ticket: CR-BLR-05" },
  { Subject: "ALLOW MAC ADDRESS 60:3e:5f:7b:a9:47 JFL WIFI", Description: "ALLOW MAC ADDRESS 60:3e:5f:7b:a9:47 JFL WIFI", SubCategory: "Change Request", Category: "Change Request", DeviceName: "Bangalore", Location: "Bangalore", DeviceSerial: "Q2QW-FCJL-LJS8", SerialNo: "Q2QW-FCJL-LJS8", DeviceID: "Q2QW-FCJL-LJS8", DeviceType: "SW", Hostname: "SEC-CAB-SW1", Status: "Closed", RCA: "New Configuration", display_reference: "Ticket: CR-BLR-06" },
  { Subject: "ALLOW MAC ADDRESS 8e:49:15:8d:86:55 JFL WIFI", Description: "ALLOW MAC ADDRESS 8e:49:15:8d:86:55 JFL WIFI", SubCategory: "Change Request", Category: "Change Request", DeviceName: "Bangalore", Location: "Bangalore", DeviceSerial: "Q2QW-FCJL-LJS8", SerialNo: "Q2QW-FCJL-LJS8", DeviceID: "Q2QW-FCJL-LJS8", DeviceType: "SW", Hostname: "SEC-CAB-SW1", Status: "Closed", RCA: "New Configuration", display_reference: "Ticket: CR-BLR-07" },
  { Subject: 'Scheduled maintenance for 1 network(s) in organization "Jubilant Foods"', Description: 'Scheduled maintenance for 1 network(s) in organization "Jubilant Foods"', SubCategory: "IOS Upgradation Activity", Category: "IOS Upgradation Activity", DeviceName: "Greater Noida", Location: "Greater Noida", DeviceSerial: "Q5AR-527V-Z8YR", SerialNo: "Q5AR-527V-Z8YR", DeviceID: "Q5AR-527V-Z8YR", DeviceType: "AP", Hostname: "JFL-GNSC-AP23", Status: "Ticket Assignment", RCA: "On Hold", display_reference: "Ticket: MA-GN-01" },
  { Subject: 'Scheduled maintenance for 1 network(s) in organization "Jubilant Foodworks Ltd"', Description: 'Scheduled maintenance for 1 network(s) in organization "Jubilant Foodworks Ltd"', SubCategory: "IOS Upgradation Activity", Category: "IOS Upgradation Activity", DeviceName: "Greater Noida", Location: "Greater Noida", DeviceSerial: "Q5AR-527V-Z8YR", SerialNo: "Q5AR-527V-Z8YR", DeviceID: "Q5AR-527V-Z8YR", DeviceType: "AP", Hostname: "JFL-GNSC-AP23", Status: "Ticket Assignment", RCA: "On Hold", display_reference: "Ticket: MA-GN-02" },
  { Subject: "JFL Network Asset Scan Report", Description: "JFL Network Asset Scan Report", SubCategory: "Request Fulfillment", Category: "Request Fulfillment", DeviceName: "Noida", Location: "Noida", DeviceSerial: "FOC2635Y89T", SerialNo: "FOC2635Y89T", DeviceID: "FOC2635Y89T", DeviceType: "SW", Hostname: "JFL-Core-Sw2", Status: "Ticket Assignment", RCA: "On Hold", display_reference: "Ticket: RF-NOI-03" },
  { Subject: "Guest Wi-Fi Credentials Required-KPMG Audit", Description: "Guest Wi-Fi Credentials Required-KPMG Audit", SubCategory: "Change Request", Category: "Change Request", DeviceName: "Greater Noida", Location: "Greater Noida", DeviceSerial: "Q5AA-Z3WW-CY6C", SerialNo: "Q5AA-Z3WW-CY6C", DeviceID: "Q5AA-Z3WW-CY6C", DeviceType: "AP", Hostname: "JFL-GNSC-AP05", Status: "On Hold", RCA: "On Hold", display_reference: "Ticket: CR-GN-03" },
];

// ── 4. Build Complete QBR Data Model ──────────────────────────────────────────
const activeDevices = devices.filter((d) => !d.__isStock);
const stockDevices = devices.filter((d) => d.__isStock);
const switches = activeDevices.filter((d) => d.DeviceType === 'SW');
const aps = activeDevices.filter((d) => d.DeviceType === 'AP');

const activeSLABreaches = activeDevices.filter((d) => d.__slaBreach).length;
const activeCompliant = activeDevices.length - activeSLABreaches;
const overallSLA = ((activeCompliant / activeDevices.length) * 100).toFixed(2);

const execSummary = {
  customerName: CUSTOMER_NAME,
  reportingPeriod: REPORTING_PERIOD,
  totalSites: sites.length,
  totalDevices: devices.length,
  totalStockDevices: stockDevices.length,
  totalSwitches: switches.length,
  totalAPs: aps.length,
  apIncidents: 61,
  uniqueAPsWithIncidents: 32,
  primaryRcaSwitches: 'Device Power Issues',
  primaryRcaAPs: 'Device Power Issues',
  primaryRca: 'Device Power Issues',
  primaryRcaForAPs: 'Device Power Issues',
  overallUptime: '99.43',
  jflSwitchUptime: '94.43',
  proactiveSwitchUptime: '99.96',
  incidentFreePercent: '88.51',
  healthScore: 95.06,
  healthLabel: 'Excellent',
  slaCompliance: overallSLA, // 95.97%
  slaTarget: SLA_TARGET,
  totalIncidents: incidents.length,
  criticalIncidents: 0,
  majorIncidents: 0,
  minorIncidents: incidents.length,
};

const siteSummary = sites.map((siteId) => {
  const siteDevs = activeDevices.filter((d) => d.Location === siteId);
  const siteSw = siteDevs.filter((d) => d.DeviceType === 'SW');
  const siteAp = siteDevs.filter((d) => d.DeviceType === 'AP');
  const siteInc = incidents.filter((i) => i.Location === siteId);
  return {
    siteId,
    totalDevices: siteDevs.length + 9, // include stock allocation
    switchCount: siteSw.length,
    apCount: siteAp.length,
    jflSwitchUptime: '94.43',
    proactiveSwitchUptime: '99.96',
    primaryRcaSwitches: 'Device Power Issues',
    apIncidents: `${siteInc.filter((i) => i.DeviceType === 'AP').length} / ${Math.min(4, siteAp.length)}`,
    primaryRcaAPs: 'Device Power Issues',
  };
});

const switchAnalytics = {
  totalSwitches: switches.length,
  avgJflUptime: '94.43',
  avgProactiveUptime: '99.96',
  switchIncidents: 37,
  primaryRca: 'Device Power Issues',
  rcaBreakdown: [
    { rca: 'Device Power Issues', count: 14, percentage: '37.84' },
    { rca: 'ISP Link Down', count: 9, percentage: '24.32' },
    { rca: 'New Configuration', count: 6, percentage: '16.22' },
    { rca: 'Client Side Activity', count: 5, percentage: '13.51' },
    { rca: 'Hardware Degradation', count: 3, percentage: '8.11' },
  ],
};

const apAnalytics = {
  totalAPs: aps.length,
  apIncidents: 61,
  uniqueAPsWithIncidents: 32,
  primaryRca: 'Device Power Issues',
  rcaBreakdown: [
    { rca: 'Device Power Issues', count: 24, percentage: '39.34' },
    { rca: 'ISP Link Down', count: 16, percentage: '26.23' },
    { rca: 'New Configuration', count: 10, percentage: '16.39' },
    { rca: 'Client Side Activity', count: 7, percentage: '11.48' },
    { rca: 'Hardware Degradation', count: 4, percentage: '6.56' },
  ],
};

const incidentAnalytics = {
  totalIncidents: incidents.length,
  slaMetCount: 94,
  slaBreachedCount: 4,
  openCount: 0,
  resolutionSlaCompliancePct: '95.92',
  siteWiseIncidents: sites.map((siteId) => ({
    siteId,
    count: incidents.filter((i) => i.Location === siteId).length,
  })),
  deviceWiseIncidents: devices.slice(0, 10).map((d) => ({
    DeviceID: d.DeviceID,
    SerialNo: d.SerialNo,
    count: incidents.filter((i) => i.DeviceID === d.DeviceID).length || 1,
  })),
  monthlyTrend: [
    { month: '2026-08', count: 98 },
  ],
};

const rcaAnalytics = {
  totalIncidents: incidents.length,
  standardBreakdown: [
    { category: 'Device Power Issues', count: 38, percentage: '38.78' },
    { category: 'ISP Link Down', count: 25, percentage: '25.51' },
    { category: 'New Configuration', count: 16, percentage: '16.33' },
    { category: 'Client Side Activity', count: 12, percentage: '12.24' },
    { category: 'Hardware Degradation', count: 7, percentage: '7.14' },
  ],
  rawBreakdown: [
    { rca: 'Device Power Issues', count: 38, percentage: '38.78' },
    { rca: 'ISP Link Down', count: 25, percentage: '25.51' },
    { rca: 'New Configuration', count: 16, percentage: '16.33' },
    { rca: 'Client Side Activity', count: 12, percentage: '12.24' },
    { rca: 'Hardware Degradation', count: 7, percentage: '7.14' },
  ],
};

const breachingDeviceList = activeDevices.filter((d) => d.__slaBreach).map((d) => ({
  DeviceID: d.DeviceID,
  SerialNo: d.SerialNo,
  Hostname: d.Hostname,
  Location: d.Location,
  uptime: d.__effectiveUptime,
  slaTarget: SLA_TARGET,
  gap: parseFloat((SLA_TARGET - d.__effectiveUptime).toFixed(2)),
})).sort((a, b) => a.uptime - b.uptime);

const siteSLABreakdown = sites.map((siteId) => {
  const siteDevs = activeDevices.filter((d) => d.Location === siteId);
  const breaching = siteDevs.filter((d) => d.__slaBreach).length;
  const compliant = siteDevs.length - breaching;
  return {
    siteId,
    total: siteDevs.length,
    compliant,
    breaching,
    slaPercent: ((compliant / siteDevs.length) * 100).toFixed(2),
  };
});

const slaAnalytics = {
  overallSLAPercent: overallSLA, // 95.97%
  slaTarget: SLA_TARGET, // 99.3%
  totalDevices: activeDevices.length, // 372 active operational devices
  compliantDevices: activeCompliant, // 357 devices
  breachingDevices: activeSLABreaches, // 15 devices
  siteSLA: siteSLABreakdown,
  deviceSLA: breachingDeviceList,
  monthlySLATrend: [
    { month: '2026-08', slaPercent: overallSLA },
  ],
};

const fullQbrData = {
  customerName: CUSTOMER_NAME,
  reportingPeriod: REPORTING_PERIOD,
  report_period: reportPeriodMeta,
  generatedAt: new Date().toISOString(),
  executiveSummary: execSummary,
  siteSummary,
  switchAnalytics,
  apAnalytics,
  incidentAnalytics,
  rcaAnalytics,
  slaAnalytics,
  devices,
  incidents,
  otherActivities: canonicalOtherActivities,
};

const targetFiles = [
  path.resolve('data', 'dashboard_data.json'),
  path.resolve('data', 'bundled_default', 'dashboard_data.json'),
  path.resolve('frontend', 'src', 'data', 'defaultDashboardData.json'),
];

targetFiles.forEach((filePath) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(fullQbrData, null, 2));
  console.log(`Successfully hydrated ${path.relative(process.cwd(), filePath)} with all 14 analytics keys.`);
});
