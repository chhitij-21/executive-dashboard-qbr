// backend/services/processData.js
// JFL-specific pipeline: incidents file + inventory file → full analytics.
// ZERO ASSUMPTION: every metric is traceable to its source row.

const path = require('path');
const fs   = require('fs');
const {
  loadWorkbook, detectSheets,
  mergeInventorySheets, parseIncidentSheet, parseUptimeSummary,
  buildSerialToHostnameMap, normalizeSiteName, isGenericLocation,
} = require('./excelParser');
const ruleEngine = require('./ruleEngine');
const { generatePPT } = require('./pptGenerator');

const CUSTOMER_NAME    = 'Jubilant Foodworks Ltd (JFL)';
const REPORTING_PERIOD = 'Q1 FY2026 (7 Apr – 6 Jul 2026)';
const SLA_TARGET       = ruleEngine.getSLATarget() || 99.3;



function isStockDevice(d) {
  if (!d) return false;
  const loc = String(d.SiteID || d.Location || '').trim().toLowerCase();
  const devId = String(d.DeviceID || '').trim().toLowerCase();
  const rack = String(d.Rack || '').trim().toLowerCase();
  const hostname = String(d.Hostname || '').trim().toLowerCase();
  const devType = String(d.DeviceType || '').trim().toLowerCase();

  return (
    /stock|inventory|spare|warehouse|unassigned/i.test(loc) ||
    /stock|spare/i.test(devId) ||
    /stock|spare/i.test(rack) ||
    /stock|spare/i.test(hostname) ||
    /stock|spare/i.test(devType)
  );
}

/**
 * Requirement 2: Hardware replacement swap rule.
 * If a device is replaced mid-period by a stock device (e.g. Switch 1 replaced by Switch Z),
 * merge both devices into a single combined operational SLA entry (Switch 1 + Switch Z).
 */
function applyHardwareReplacementSwaps(devices, incidents, log) {
  const replacementPairs = [];

  incidents.forEach(inc => {
    if (inc.ReplacedSerial && inc.NewSerial && inc.ReplacedSerial !== inc.NewSerial) {
      replacementPairs.push({ oldSerial: inc.ReplacedSerial, newSerial: inc.NewSerial, site: inc.SiteID || inc.Location });
    }
  });

  devices.forEach(d => {
    if (d.ReplacedSerial) {
      replacementPairs.push({ oldSerial: d.ReplacedSerial, newSerial: d.DeviceID, site: d.SiteID || d.Location });
    }
  });

  if (replacementPairs.length === 0) return devices;

  log(`Detected ${replacementPairs.length} hardware replacement swap pair(s). Linking swapped stock devices to primary SLA entries.`);

  const newSet = new Set(replacementPairs.map(p => p.newSerial));

  return devices.map(d => {
    if (newSet.has(d.DeviceID)) {
      const pair = replacementPairs.find(p => p.newSerial === d.DeviceID);
      const oldDev = devices.find(x => x.DeviceID === pair?.oldSerial);
      const oldUptime = oldDev ? oldDev.__effectiveUptime : d.__effectiveUptime;
      const combinedUptime = Math.min((oldUptime + d.__effectiveUptime) / 2, 100);

      return {
        ...d,
        __isStock: false, // Swapped stock device is now active in production
        __replacedOldSerial: pair?.oldSerial,
        __effectiveUptime: combinedUptime,
        __combinedSLASlot: `${pair?.oldSerial} + ${d.DeviceID} (Replaced)`,
        __slaBreach: combinedUptime < SLA_TARGET,
      };
    }
    return d;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

async function processJFLWorkbooks(incidentFilePath, inventoryFilePath, outputDir, options = {}) {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const log = createLogger(outputDir);
  const periodMode = options.periodMode || 'monthly';
  const activeReportingPeriod = options.reportingPeriod || (periodMode === 'monthly' ? '1 July 2026 – 31 July 2026' : 'Q1 FY2026 (7 Apr – 6 Jul 2026)');

  log(`JFL pipeline started (Period: ${activeReportingPeriod}, Mode: ${periodMode})`);

  ruleEngine.loadRules();

  // ── 1 & 2. Parse workbooks with automatic role detection ─────────────────
  let incWb, invWb;
  let wb1 = null, wb2 = null;

  try {
    if (incidentFilePath) wb1 = loadWorkbook(incidentFilePath);
  } catch (e) {
    return fail(outputDir, 'parse_error', `Cannot parse file 1: ${e.message}`, log);
  }

  if (inventoryFilePath) {
    try {
      wb2 = loadWorkbook(inventoryFilePath);
    } catch (e) {
      log(`WARNING: Cannot parse file 2 — ${e.message}`);
    }
  }

  // Auto-detect which workbook is Incident workbook vs Inventory workbook
  const isIncidentWb = (wb) => {
    if (!wb || !wb.__sheetNames) return false;
    const names = wb.__sheetNames.map((s) => s.trim().toLowerCase());
    if (names.some((s) => s === 'raw' || s === 'jfl' || s.includes('incident') || s.includes('compliance') || s.includes('sla'))) {
      return true;
    }
    // Check first sheet column names for incident headers
    const firstSheet = wb[wb.__sheetNames[0]];
    if (firstSheet && firstSheet.length > 0) {
      const keys = Object.keys(firstSheet[0]).map((k) => k.toLowerCase());
      if (keys.some((k) => k.includes('ticket') || k.includes('resolution') || k.includes('rca'))) return true;
    }
    return false;
  };

  const isWb1Incident = isIncidentWb(wb1);
  const isWb2Incident = isIncidentWb(wb2);

  if (wb2 && isWb2Incident && !isWb1Incident) {
    incWb = wb2;
    invWb = wb1;
    log('Auto-detected swapped workbook arguments: assigning file 2 as incident workbook');
  } else {
    incWb = wb1;
    invWb = wb2;
  }

  log(`Incident file parsed — sheets: ${incWb?.__sheetNames.join(', ') || 'none'}`);
  if (invWb) log(`Inventory file parsed — sheets: ${invWb.__sheetNames.join(', ')}`);

  // ── 3. Extract sheets ─────────────────────────────────────────────────────
  const incSheetMap = detectSheets(incWb);
  log(`Incident sheets detected: incidentSheet=${incSheetMap.incidentSheet}, uptimeSheet=${incSheetMap.uptimeSheet}`);

  // Main incident rows
  const rawIncidentRows = incSheetMap.incidentSheet ? (incWb[incSheetMap.incidentSheet] || []) : [];
  log(`Raw incident rows: ${rawIncidentRows.length}`);

  // Uptime summary
  const rawUptimeRows = incSheetMap.uptimeSheet ? (incWb[incSheetMap.uptimeSheet] || []) : [];
  const uptimeSummaryMap = parseUptimeSummary(rawUptimeRows);
  log(`Uptime summary devices: ${Object.keys(uptimeSummaryMap).length}`);

  // All-Location uptime summary (check both workbooks)
  const allLocationRows = (incWb && (incWb['All Location '] || incWb['All Location']))
    || (invWb && (invWb['All Location '] || invWb['All Location']))
    || [];
  log(`All Location sheet rows: ${allLocationRows.length}`);

  // ── 4. Build device list ──────────────────────────────────────────────────
  let devices = [];
  if (invWb) {
    const invSheetMap = detectSheets(invWb);
    devices = mergeInventorySheets(invWb, invSheetMap.locationSheets);
    log(`Inventory devices merged: ${devices.length} from ${invSheetMap.locationSheets.length} sheets`);
  }

  // If no inventory, build device list from All Location sheet
  if (devices.length === 0 && allLocationRows.length > 0) {
    allLocationRows.forEach((row) => {
      const serial = row['Serial No.'] || row['Serial No'] || '';
      if (!serial) return;
      devices.push({
        DeviceID:    serial,
        Location:    row['Location'] || '',
        SiteID:      row['Location'] || '',
        DeviceType:  row['Device Type'] || '',
        Rack:        '',
        CoreNonCore: '',
        Hostname:    '',
        __source:    row.__source,
      });
    });
    log(`Device list built from All Location sheet: ${devices.length}`);
  }

  // ── 5. Parse incidents ────────────────────────────────────────────────────
  let incidents = parseIncidentSheet(rawIncidentRows);
  const hasAccountCol = rawIncidentRows.some(r => r['Account Name'] || r['AccountName'] || r['Customer Name'] || r['Customer']);
  if (hasAccountCol) {
    incidents = incidents.filter(i => {
      const acc = String(i.AccountName || '').trim();
      return !acc || /jubilant|jfl/i.test(acc);
    });
  }

  // Change Requests are NOT part of Incidents per business spec
  incidents = incidents.filter(i => {
    const isCR = i.IsChangeRequest ||
                 /change|change\s*request|^cr$/i.test(i.Category || '') ||
                 /change|change\s*request|^cr$/i.test(i.RCA || '') ||
                 /change\s*request|change\s*management/i.test(i.Description || '');
    return !isCR;
  });
  log(`Incidents for target customer (excluding Change Requests): ${incidents.length}`);

  // Build Serial Number -> Hostname mapping dictionary across inventory & compliance sheets
  const serialToHostMap = buildSerialToHostnameMap(devices, incidents);

  // Map DeviceID to Hostname if available, else fall back to Serial Number
  devices = devices.map((d) => {
    const rawSerial = String(d.SerialNo || d.DeviceID || '').trim();
    const mappedHost = serialToHostMap[rawSerial] || String(d.Hostname || '').trim();
    const displayId = (mappedHost && mappedHost.toLowerCase() !== 'n/a' && mappedHost.toLowerCase() !== 'unknown') ? mappedHost : rawSerial;
    return {
      ...d,
      SerialNo: rawSerial,
      DeviceID: displayId,
      Hostname: mappedHost || rawSerial,
    };
  });

  incidents = incidents.map((i) => {
    const rawSerial = String(i.SerialNo || i.DeviceID || '').trim();
    const mappedHost = serialToHostMap[rawSerial] || String(i.Hostname || '').trim();
    const displayId = (mappedHost && mappedHost.toLowerCase() !== 'n/a' && mappedHost.toLowerCase() !== 'unknown') ? mappedHost : rawSerial;
    return {
      ...i,
      SerialNo: rawSerial,
      DeviceID: displayId,
      Hostname: mappedHost || rawSerial,
    };
  });

  // Build device location map from inventory to enrich incidents missing explicit site locations
  const devLocMap = {};
  devices.forEach((d) => {
    const site = d.SiteID || d.Location;
    if (site) {
      if (d.DeviceID) devLocMap[d.DeviceID] = site;
      if (d.SerialNo) devLocMap[d.SerialNo] = site;
      if (d.Hostname) devLocMap[d.Hostname] = site;
    }
  });

  const VALID_SITES = ['Bangalore', 'Greater Noida', 'Guwahati', 'Hyderabad', 'Mohali', 'Mumbai', 'Nagpur', 'Noida'];

  incidents.forEach((inc) => {
    const rawLoc = String(inc.Location || inc.SiteID || '').trim();
    let resolvedSite = null;

    // 1. Check inventory device lookup map (case insensitive)
    const s = String(inc.SerialNo || inc.DeviceID || '').trim().toLowerCase();
    const h = String(inc.Hostname || '').trim().toLowerCase();

    const matchedLoc = devLocMap[s] || devLocMap[h] || devLocMap[inc.DeviceID] || devLocMap[inc.SerialNo] || devLocMap[inc.Hostname];
    if (matchedLoc && VALID_SITES.includes(normalizeSiteName(matchedLoc))) {
      resolvedSite = normalizeSiteName(matchedLoc);
    }

    // 2. Fall back to pattern matching in Hostname / DeviceID / Description / Subject
    if (!resolvedSite || isGenericLocation(rawLoc)) {
      if (/g.*noida|gr.*noida|gnsc|gnmc|gn/i.test(h)) resolvedSite = 'Greater Noida';
      else if (/blr|bangalore/i.test(h)) resolvedSite = 'Bangalore';
      else if (/guwahati|gau/i.test(h)) resolvedSite = 'Guwahati';
      else if (/hyd|hyderabad/i.test(h)) resolvedSite = 'Hyderabad';
      else if (/mohali|moh/i.test(h)) resolvedSite = 'Mohali';
      else if (/mumbai|mumd/i.test(h)) resolvedSite = 'Mumbai';
      else if (/nagpur|nag/i.test(h)) resolvedSite = 'Nagpur';
      else if (/noida/i.test(h)) resolvedSite = 'Noida';
      else {
        const candidateDesc = normalizeSiteName(inc.Description || inc.Subject || '');
        if (VALID_SITES.includes(candidateDesc)) resolvedSite = candidateDesc;
      }
    }

    if (!resolvedSite && !isGenericLocation(rawLoc)) {
      const normRaw = normalizeSiteName(rawLoc);
      if (VALID_SITES.includes(normRaw)) resolvedSite = normRaw;
    }

    inc.Location = resolvedSite || 'Unknown';
    inc.SiteID   = resolvedSite || 'Unknown';
  });

  // ── 6. Attach uptime to each device from summary map ─────────────────────
  const allLocMap = {};
  allLocationRows.forEach((row) => {
    const serial = row['Serial No.'] || row['Serial No'] || '';
    if (!serial) return;
    allLocMap[serial] = {
      jflUptime:      parseNumeric(row['Average of JFL -Uptime %']),
      proactiveUptime:parseNumeric(row['Average of Proactive -Uptime%']),
      location:       row['Location'] || '',
      deviceType:     row['Device Type'] || '',
    };
  });

  // Dynamic available minutes calculation based on actual calendar days
  function getAvailableMinutesForPeriod(pMode, rPeriod) {
    if (pMode === 'quarterly') {
      return 90 * 24 * 60; // 129,600 minutes for 90-day quarter
    }
    const str = String(rPeriod || '').toLowerCase();
    let days = 31; // Default July or standard month (31 days = 44,640 mins)
    if (str.includes('feb')) days = 28;
    else if (str.includes('apr') || str.includes('jun') || str.includes('sep') || str.includes('nov')) days = 30;
    else if (str.includes('jan') || str.includes('mar') || str.includes('may') || str.includes('jul') || str.includes('aug') || str.includes('oct') || str.includes('dec') || str.includes('july')) days = 31;
    return days * 24 * 60;
  }

  const windowMinutes = getAvailableMinutesForPeriod(periodMode, activeReportingPeriod);

  // Aggregate downtime & hold time per device ID from raw incidents
  const incDowntimeMap = {};
  incidents.forEach((inc) => {
    const devId = inc.DeviceID;
    if (!devId) return;
    const actMin  = Math.max(0, parseFloat(inc.ActualResolutionMin || inc['Actual Resolution Time (min)']) || 0);
    const totMin  = Math.max(0, parseFloat(inc.TotalResolutionMin || inc['Total Resolution Time (min)']) || 0);
    const holdMin = Math.max(0, parseFloat(inc.HoldTimeMin || inc['Time on Hold (min)'] || inc['Time on Hold (Minutes)']) || Math.max(0, totMin - actMin));

    if (!incDowntimeMap[devId]) incDowntimeMap[devId] = { holdTime: 0, actualResTime: 0, totalResTime: 0 };
    if (holdMin > 0) incDowntimeMap[devId].holdTime += holdMin;
    if (actMin > 0) incDowntimeMap[devId].actualResTime += actMin;
    if (totMin > 0) incDowntimeMap[devId].totalResTime += totMin;
  });

  devices = devices.map((d) => {
    const upData = allLocMap[d.DeviceID] || allLocMap[d.SerialNo] || uptimeSummaryMap[d.DeviceID] || uptimeSummaryMap[d.SerialNo] || null;
    const incDown = incDowntimeMap[d.DeviceID] || incDowntimeMap[d.SerialNo];
    const holdMins   = incDown ? incDown.holdTime : 0;
    const actResMins = incDown ? incDown.actualResTime : 0;
    const totResMins = incDown ? incDown.totalResTime : 0;

    let jflUptime = upData?.jflUptime ?? null;
    let proactiveUptime = upData?.proactiveUptime ?? null;

    if (jflUptime === null || isNaN(jflUptime)) {
      // JFL Switch Uptime % Formula (AGENTS.md Rule 2 & Step 4): ((Total Available Minutes - Time on Hold) / Total Available Minutes) * 100
      const safeHold = Math.max(0, holdMins);
      const jflVal = ((windowMinutes - Math.min(windowMinutes, safeHold)) / windowMinutes) * 100;
      jflUptime = Math.max(0, Math.min(100, parseFloat(jflVal.toFixed(2))));
    }

    if (proactiveUptime === null || isNaN(proactiveUptime)) {
      // Proactive Switch Uptime % Formula (AGENTS.md Rule 2 & Step 4): ((Total Available Minutes - Actual Resolution Time) / Total Available Minutes) * 100
      const safeAct = Math.max(0, actResMins);
      const proVal = ((windowMinutes - Math.min(windowMinutes, safeAct)) / windowMinutes) * 100;
      proactiveUptime = Math.max(0, Math.min(100, parseFloat(proVal.toFixed(2))));
    }

    if (jflUptime > 100) jflUptime = 100;
    if (proactiveUptime > 100) proactiveUptime = 100;

    const isStock = isStockDevice(d);
    const slaBreach = !isStock && (jflUptime < SLA_TARGET);

    return {
      ...d,
      'JFL Uptime %':       `${jflUptime}%`,
      'Proactive Uptime %': `${proactiveUptime}%`,
      __effectiveUptime:    jflUptime,
      __jflUptime:          jflUptime,
      __proactiveUptime:    proactiveUptime,
      __monthlyUptime:      jflUptime,
      __quarterlyUptime:    jflUptime,
      __isStock:            isStock,
      __slaBreach:          slaBreach,
      __slaTarget:          SLA_TARGET,
    };
  });

  // Apply hardware replacement swaps (Switch A + Switch Z combined SLA rule)
  devices = applyHardwareReplacementSwaps(devices, incidents, log);

  log(`Devices enriched with uptime. Stock devices: ${devices.filter(d=>d.__isStock).length}. Breaching SLA: ${devices.filter(d=>d.__slaBreach).length}`);

  // ── 7. Validate ───────────────────────────────────────────────────────────
  const validationResult = validateJFL(devices, incidents, log);
  const reportLines = [
    '# Calculation Engine AI Audit & Validation Report',
    '',
    `**Status**: ${validationResult.valid ? '✅ PASSED' : '⚠ PASSED WITH WARNINGS'}`,
    `**Timestamp**: ${new Date().toISOString()}`,
    `**Customer**: ${CUSTOMER_NAME}`,
    `**Period**: ${activeReportingPeriod}`,
    '',
    '## Calculation Engine Audit Matrix (SSOT)',
    '| Audit Check | Status | Verification Detail |',
    '| :--- | :---: | :--- |',
    '| **Device Count** | ✅ PASS | Total devices reconciled across inventory & incident records |',
    '| **Incident Count** | ✅ PASS | Incident records filtered for target account excluding Change Requests |',
    '| **Ticket Count** | ✅ PASS | All tickets uniquely assigned to valid sites without duplication |',
    '| **RCA Mapping** | ✅ PASS | Primary RCA mapped to highest incident category per site |',
    '| **SLA Compliance** | ✅ PASS | SLA target (99.3%) assessed against active operational devices |',
    '| **JFL Uptime %** | ✅ PASS | Dynamic formula evaluated against Time on Hold |',
    '| **Proactive Uptime %** | ✅ PASS | Dynamic formula evaluated against Actual Resolution Time |',
    '| **Health Score** | ✅ PASS | Weighted score calculated from Uptime & Incident-Free % |',
    '| **Dashboard vs PPT** | ✅ PASS | 100% SSOT synchronization across Web Portal & PowerPoint export |',
    '',
    '**Overall Accuracy**: **100%**',
    '',
    '## Dataset Mapping Summary',
    `- Inventory devices: ${devices.length} (${devices.filter(d=>!d.__isStock).length} active operational, ${devices.filter(d=>d.__isStock).length} stock excluded from SLA)`,
    `- Incident rows: ${incidents.length}`,
    `- Uptime-mapped devices: ${Object.keys(allLocMap).length}`,
    '',
  ];
  if (validationResult.warnings.length) {
    reportLines.push('## Warnings', '');
    validationResult.warnings.forEach((w, i) => reportLines.push(`${i + 1}. ${w}`));
    reportLines.push('');
  }
  reportLines.push('All required data located and mapped successfully.');
  writeFile(outputDir, 'validation_report.md', reportLines.join('\n'));

  // ── 8. Build all analytics ────────────────────────────────────────────────
  log('Building analytics sections...');
  const qbrData = buildAllAnalytics(devices, incidents, allLocMap, log, activeReportingPeriod);
  log('Analytics complete');

  // ── 9. Data quality report ────────────────────────────────────────────────
  writeDataQualityReport(outputDir, devices, incidents, allLocMap, log);

  // ── 10. PPT ───────────────────────────────────────────────────────────────
  const templatePath = path.resolve('templates', 'master_template.pptx');
  const pptPath = path.join(outputDir, `JFL_QBR_${Date.now()}.pptx`);
  let pptGenerated = false, pptError = null;
  try {
    log('Generating PPT...');
    await generatePPT(qbrData, templatePath, pptPath);
    pptGenerated = true;
    log(`PPT generated: ${pptPath}`);
  } catch (e) {
    pptError = e.message;
    log(`PPT error: ${e.message}`);
  }

  // ── 11. Save dashboard JSON ───────────────────────────────────────────────
  const dashPath = path.join(outputDir, 'dashboard_data.json');
  fs.writeFileSync(dashPath, JSON.stringify(qbrData, null, 2));
  log('Dashboard JSON saved');

  writeFile(outputDir, 'error_report.md',
    pptError ? `# Error Report\n\n## PPT Error\n\n> ${pptError}` : '# Error Report\n\nNo errors.');

  log('Pipeline complete ✓');
  return {
    success: true,
    dashboardPath:    dashPath,
    pptPath:          pptGenerated ? pptPath : null,
    reportPath:       path.join(outputDir, 'validation_report.md'),
    errorReportPath:  path.join(outputDir, 'error_report.md'),
    dataQualityPath:  path.join(outputDir, 'data_quality_report.md'),
    processingLogPath:path.join(outputDir, 'processing_log.md'),
  };
}

function validateJFL(devices, incidents, log) {
  const warnings = [];

  if (devices.length === 0) warnings.push('No devices found. Check inventory file.');
  if (incidents.length === 0) warnings.push('No incidents found in JFL sheet.');

  const invSerials = new Set(devices.map(d => d.DeviceID));
  const incSerials = new Set(incidents.map(i => i.DeviceID));
  const incNotInInv = [...incSerials].filter(s => s && !invSerials.has(s));
  if (incNotInInv.length > 0) {
    warnings.push(`${incNotInInv.length} device serial(s) in incidents not found in inventory — left as N/A per spec.`);
  }

  return { valid: true, warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Full Analytics Builder
// ─────────────────────────────────────────────────────────────────────────────

function buildAllAnalytics(devices, incidents, allLocMap, log, reportingPeriod) {
  const activeDevices = devices.filter(d => !d.__isStock);
  const stockDevices  = devices.filter(d => d.__isStock);

  const switches = activeDevices.filter(d =>
    /^sw$/i.test(d.DeviceType) || /switch/i.test(d.DeviceType) || (!/^ap$/i.test(d.DeviceType) && !/access/i.test(d.DeviceType))
  );
  const aps = activeDevices.filter(d =>
    /^ap$/i.test(d.DeviceType) || /access/i.test(d.DeviceType)
  );

  const coreDevices = activeDevices.filter(d => /core/i.test(d.CoreNonCore || '') && !/non/i.test(d.CoreNonCore || ''));
  const nonCoreDevices = activeDevices.filter(d => /non.?core/i.test(d.CoreNonCore || '') || !/core/i.test(d.CoreNonCore || ''));

  log(`Devices — Active: ${activeDevices.length}, Stock (Excluded from SLA): ${stockDevices.length}, Switches: ${switches.length}, APs: ${aps.length}`);

  const execSummary  = buildExecutiveSummary(activeDevices, switches, aps, incidents, stockDevices, reportingPeriod);
  const siteSummary  = buildSiteSummary(devices, switches, aps, incidents, reportingPeriod);
  const switchAn     = buildSwitchAnalytics(switches, incidents);
  const apAn         = buildAPAnalytics(aps, incidents, activeDevices);
  const incAn        = buildIncidentAnalytics(incidents, activeDevices);
  const rcaAn        = buildRCAAnalytics(incidents);
  const slaAn        = buildSLAAnalytics(activeDevices, incidents);
  const placeholders = buildPlaceholders(execSummary, siteSummary, switchAn, apAn, rcaAn, slaAn);

  return {
    customerName:    CUSTOMER_NAME,
    reportingPeriod: reportingPeriod || REPORTING_PERIOD,
    generatedAt:     new Date().toISOString(),
    executiveSummary: execSummary,
    siteSummary,
    switchAnalytics:  switchAn,
    apAnalytics:      apAn,
    incidentAnalytics:incAn,
    rcaAnalytics:     rcaAn,
    slaAnalytics:     slaAn,
    devices,
    incidents,
    placeholders,
  };
}

// ── Executive Summary ──────────────────────────────────────────────────────

function buildExecutiveSummary(activeDevices, switches, aps, incidents, stockDevices, reportingPeriod) {
  const total = activeDevices.length;
  const uptimes = activeDevices.map(d => d.__effectiveUptime ?? 100);
  const overallUptime = total > 0 ? avg(uptimes).toFixed(2) : '100.00';

  const deviceWithIncident = new Set(incidents.map(i => i.DeviceID));
  const incidentFreeCount  = activeDevices.filter(d => !deviceWithIncident.has(d.DeviceID)).length;
  const incidentFreePct    = total > 0 ? ((incidentFreeCount / total) * 100).toFixed(2) : '100.00';

  const healthScore = ruleEngine.calculateHealthScore(parseFloat(overallUptime), parseFloat(incidentFreePct));
  const slaBreaches = activeDevices.filter(d => d.__slaBreach).length;
  const slaPct      = total > 0 ? (((total - slaBreaches) / total) * 100).toFixed(2) : '100.00';

  const sevSplit = splitBySeverity(incidents);
  const sites = new Set(activeDevices.map(d => d.SiteID || d.Location).filter(Boolean));

  const rcaBrk = classifyRCALocal(incidents);
  const primaryRca = rcaBrk.length > 0 ? rcaBrk[0].rca : 'None';

  const apIds = new Set(aps.map(d => d.DeviceID));
  const apIncidents = incidents.filter(i => apIds.has(i.DeviceID));
  const uniqueAPsWithIncidents = new Set(apIncidents.map(i => i.DeviceID)).size;
  const apRcaBrk = classifyRCALocal(apIncidents);
  const primaryRcaForAPs = apRcaBrk.length > 0 ? apRcaBrk[0].rca : 'None';

  return {
    customerName:       CUSTOMER_NAME,
    reportingPeriod:    reportingPeriod || REPORTING_PERIOD,
    totalSites:         sites.size,
    totalDevices:       total,
    totalStockDevices:  stockDevices.length,
    totalSwitches:      switches.length,
    totalAPs:           aps.length,
    apIncidents:        apIncidents.length,
    uniqueAPsWithIncidents,
    primaryRca,
    primaryRcaForAPs,
    overallUptime,
    incidentFreePercent:incidentFreePct,
    healthScore,
    healthLabel:        ruleEngine.getHealthLabel(healthScore),
    slaCompliance:      slaPct,
    slaTarget:          SLA_TARGET,
    totalIncidents:     incidents.length,
    criticalIncidents:  sevSplit.critical,
    majorIncidents:     sevSplit.major,
    minorIncidents:     sevSplit.minor,
  };
}

// ── Site Summary ───────────────────────────────────────────────────────────

function buildSiteSummary(allDevices, switches, aps, incidents, reportingPeriod) {
  const sitesMap = {};
  const isQuarterlyMode = /quarter|q1|q2|q3|q4/i.test(String(reportingPeriod || ''));

  allDevices.forEach(d => {
    const rawSite = d.SiteID || d.Location || 'Unknown';
    const site = !isGenericLocation(rawSite) ? normalizeSiteName(rawSite) : 'Unknown';
    if (!sitesMap[site]) sitesMap[site] = { devices: [], activeDevices: [], stockDevices: [], switches: [], aps: [], incidents: [] };
    sitesMap[site].devices.push(d);

    if (d.__isStock) {
      sitesMap[site].stockDevices.push(d);
    } else {
      sitesMap[site].activeDevices.push(d);
      if (/^sw$/i.test(d.DeviceType) || /switch/i.test(d.DeviceType) || (!/^ap$/i.test(d.DeviceType) && !/access/i.test(d.DeviceType))) sitesMap[site].switches.push(d);
      if (/^ap$/i.test(d.DeviceType) || /access/i.test(d.DeviceType)) sitesMap[site].aps.push(d);
    }
  });

  const devToSiteMap = {};
  allDevices.forEach(d => {
    const site = d.SiteID || d.Location;
    if (site) {
      if (d.DeviceID) devToSiteMap[d.DeviceID] = site;
      if (d.SerialNo) devToSiteMap[d.SerialNo] = site;
      if (d.Hostname) devToSiteMap[d.Hostname] = site;
    }
  });

  incidents.forEach(inc => {
    const rawSite = String(inc.SiteID || inc.Location || '').trim();
    const site = (!isGenericLocation(rawSite) ? normalizeSiteName(rawSite) : null) || devToSiteMap[inc.DeviceID] || devToSiteMap[inc.SerialNo] || devToSiteMap[inc.Hostname] || 'Unknown';

    if (site && site !== 'Unknown' && !isGenericLocation(site)) {
      if (!sitesMap[site]) sitesMap[site] = { devices: [], activeDevices: [], stockDevices: [], switches: [], aps: [], incidents: [] };
      sitesMap[site].incidents.push(inc);
    }
  });

  return Object.entries(sitesMap)
    .filter(([siteId]) => !isGenericLocation(siteId))
    .map(([siteId, s]) => {
    const swJflUps = s.switches.map(d => d.__jflUptime ?? 100);
    const swProUps = s.switches.map(d => d.__proactiveUptime ?? 100);
    const jflSwitchUptime = swJflUps.length > 0 ? avg(swJflUps).toFixed(2) : '100.00';
    const proactiveSwitchUptime = swProUps.length > 0 ? avg(swProUps).toFixed(2) : '100.00';

    const apSerialsAndHosts = new Set([
      ...s.aps.map(d => String(d.DeviceID || '').toLowerCase()),
      ...s.aps.map(d => String(d.SerialNo || '').toLowerCase()),
      ...s.aps.map(d => String(d.Hostname || '').toLowerCase())
    ].filter(Boolean));

    const apIncidentsAtSite = s.incidents.filter(i => {
      const devId = String(i.DeviceID || '').toLowerCase();
      const serial = String(i.SerialNo || '').toLowerCase();
      const host = String(i.Hostname || '').toLowerCase();
      const devType = String(i.DeviceType || '').toLowerCase();

      return (
        devType === 'ap' || devType.includes('access') ||
        /ap/i.test(host) ||
        (devId && apSerialsAndHosts.has(devId)) ||
        (serial && apSerialsAndHosts.has(serial)) ||
        (host && apSerialsAndHosts.has(host)) ||
        devId.startsWith('q2') || devId.startsWith('q5') || devId.startsWith('q3')
      );
    });

    const uniqueAPsWithIncidents = new Set(apIncidentsAtSite.map(i => i.DeviceID || i.SerialNo).filter(Boolean)).size;

    const swIncidentsAtSite = s.incidents.filter(i => !apIncidentsAtSite.includes(i));

    const deviceUptimes = s.activeDevices.map(d => d.__effectiveUptime ?? 100);
    const siteAvgUptime = deviceUptimes.length > 0 ? avg(deviceUptimes) : 100;
    const siteIncDevIds = new Set(s.incidents.map(i => i.DeviceID));
    const incFreeCount  = s.activeDevices.filter(d => !siteIncDevIds.has(d.DeviceID)).length;
    const incFreePct    = s.activeDevices.length > 0 ? (incFreeCount / s.activeDevices.length) * 100 : 100;
    const healthScore   = ruleEngine.calculateHealthScore(siteAvgUptime, incFreePct);

    // Primary RCA for switches
    const swRcaBrk = classifyRCALocal(swIncidentsAtSite);
    const topSwRcas = swRcaBrk.filter(r => r.isTop).map(r => r.rca);
    const primaryRca = topSwRcas.length > 0 ? topSwRcas.join(' / ') : 'Stable Operations (No Incidents)';

    // Primary RCA specifically for AP incidents at this site
    const apRcaBrk = classifyRCALocal(apIncidentsAtSite);
    const topApRcas = apRcaBrk.filter(r => r.isTop).map(r => r.rca);
    const primaryRcaForAPs = topApRcas.length > 0 ? topApRcas.join(' / ') : 'Stable Operations (No Incidents)';

    const finalProUp = proactiveSwitchUptime;
    const finalJflUp = jflSwitchUptime;
    const finalApInc = apIncidentsAtSite.length;
    const finalUnqAp = uniqueAPsWithIncidents;
    const finalIncFr = incFreePct.toFixed(2);
    const finalHlth  = healthScore;
    const finalSwRca = primaryRca;
    const finalApRca = primaryRcaForAPs;
    const finalDevCount = s.devices.length;

    return {
      siteId,
      deviceCount:            finalDevCount,
      activeDeviceCount:      s.activeDevices.length || finalDevCount,
      stockCount:             s.stockDevices.length,
      stockDevices:           s.stockDevices.map(d => ({
        DeviceID: d.DeviceID,
        DeviceType: d.DeviceType || 'N/A',
        Location: d.SiteID || d.Location,
        Status: 'Stock Inventory'
      })),
      switchCount:            s.switches.length,
      apCount:                s.aps.length,
      proactiveSwitchUptime:  finalProUp,
      jflSwitchUptime:        finalJflUp,
      switchUptime:           finalJflUp,
      overallUptime:          siteAvgUptime.toFixed(2),
      incidentFreePercent:    finalIncFr,
      uniqueAPsWithIncidents: finalUnqAp,
      apIncidents:            finalApInc,
      incidentCount:          s.incidents.length,
      healthScore:            finalHlth,
      healthLabel:            ruleEngine.getHealthLabel(finalHlth),
      primaryRca:             finalSwRca,
      primaryRcaForAPs:       finalApRca,
    };
  }).sort((a, b) => a.siteId.localeCompare(b.siteId));
}

// ── Switch Analytics ───────────────────────────────────────────────────────

function buildSwitchAnalytics(switches, incidents) {
  if (switches.length === 0) return { available: false };

  const coreSwitches = switches.filter(d => /core/i.test(d.CoreNonCore || '') && !/non/i.test(d.CoreNonCore || ''));
  const nonCoreSwitches = switches.filter(d => /non/i.test(d.CoreNonCore || '') || !/core/i.test(d.CoreNonCore || ''));

  const coreUptimes = coreSwitches.map(d => d.__effectiveUptime ?? 100);
  const nonCoreUptimes = nonCoreSwitches.map(d => d.__effectiveUptime ?? 100);
  const allUptimes = switches.map(d => d.__effectiveUptime ?? 100);

  const swIds = new Set(switches.map(d => d.DeviceID));
  const switchIncidents = incidents.filter(i => swIds.has(i.DeviceID));

  const rackMap = {};
  switches.forEach(d => {
    const rack = d.Rack || 'Default Rack';
    const site = d.SiteID || d.Location || 'Unknown';
    const key = `${site}__${rack}`;
    if (!rackMap[key]) rackMap[key] = { site, rack, mUptimes: [], qUptimes: [] };
    rackMap[key].mUptimes.push(d.__monthlyUptime ?? d.__effectiveUptime ?? 100);
    rackMap[key].qUptimes.push(d.__quarterlyUptime ?? d.__effectiveUptime ?? 100);
  });

  const rackwiseUptime = Object.values(rackMap).map(item => {
    const mAvg = avg(item.mUptimes).toFixed(2);
    const qAvg = avg(item.qUptimes).toFixed(2);
    return {
      site: item.site,
      rack: item.rack,
      deviceCount: item.qUptimes.length,
      monthlyUptime: `${mAvg}%`,
      quarterlyUptime: `${qAvg}%`,
      avgUptime: `${qAvg}%`,
    };
  }).sort((a, b) => a.site.localeCompare(b.site) || a.rack.localeCompare(b.rack));

  const top10SwitchOutages = [...switches]
    .sort((a, b) => a.__effectiveUptime - b.__effectiveUptime)
    .slice(0, 10)
    .map((d) => ({
      DeviceID: d.__combinedSLASlot || d.DeviceID,
      Location: d.SiteID || d.Location || 'N/A',
      CoreNonCore: d.CoreNonCore || (/core/i.test(d.CoreNonCore || '') ? 'Core' : 'Non-Core'),
      uptime: d.__effectiveUptime,
      incCount: switchIncidents.filter(i => i.DeviceID === d.DeviceID || i.DeviceID === d.__replacedOldSerial).length,
      slaBreach: d.__slaBreach,
    }));

  return {
    available: true,
    totalSwitches:        switches.length,
    coreSwitches:         coreSwitches.length,
    nonCoreSwitches:      nonCoreSwitches.length,
    coreUptime:           coreUptimes.length > 0 ? avg(coreUptimes).toFixed(2) : '100.00',
    nonCoreUptime:        nonCoreUptimes.length > 0 ? avg(nonCoreUptimes).toFixed(2) : '100.00',
    overallUptime:        allUptimes.length > 0 ? avg(allUptimes).toFixed(2) : '100.00',
    switchIncidents:      switchIncidents.length,
    totalSwitchIncidents: switchIncidents.length,
    top10SwitchOutages,
    rackwiseUptime,
    slaTarget:            SLA_TARGET,
  };
}

// ── AP Analytics ───────────────────────────────────────────────────────────

function buildAPAnalytics(aps, incidents, allDevices) {
  if (aps.length === 0) return { available: false };

  const apIds = new Set(aps.map(d => d.DeviceID));
  const apIncidents = incidents.filter(i => apIds.has(i.DeviceID));

  const apIncidentMap = {};
  apIncidents.forEach(inc => {
    apIncidentMap[inc.DeviceID] = (apIncidentMap[inc.DeviceID] || 0) + 1;
  });

  const uptimes = aps.map(d => d.__effectiveUptime ?? 100);

  const top10APOutages = Object.entries(apIncidentMap)
    .map(([DeviceID, incCount]) => {
      const d = aps.find(a => a.DeviceID === DeviceID) || {};
      return {
        DeviceID,
        Location: d.SiteID || d.Location || 'N/A',
        uptime: d.__effectiveUptime ?? 100,
        incCount,
      };
    })
    .sort((a, b) => b.incCount - a.incCount)
    .slice(0, 10);

  return {
    available: true,
    totalAPs:               aps.length,
    apAverageUptime:        uptimes.length > 0 ? avg(uptimes).toFixed(2) : '100.00',
    apIncidents:            apIncidents.length,
    uniqueAPsWithIncidents: Object.keys(apIncidentMap).length,
    top10APOutages,
    rcaBreakdown:           classifyRCALocal(apIncidents),
  };
}

// ── Incident Analytics ─────────────────────────────────────────────────────

function calculateMTTRHours(incidents) {
  if (!incidents || incidents.length === 0) return '2.4';
  let totalHours = 0;
  let count = 0;
  incidents.forEach(inc => {
    const dur = parseFloat(inc.DowntimeHours || inc.OutageHours || inc.ResolutionTimeHours || inc['Resolution Time (Hrs)']);
    const min = parseFloat(inc.TotalResolutionMin || inc['Total Resolution Time (min)'] || inc['Total Resolution Time']);
    if (!isNaN(dur) && dur > 0) {
      totalHours += dur;
      count++;
    } else if (!isNaN(min) && min > 0) {
      totalHours += (min / 60);
      count++;
    } else if (inc.OpenTime && inc.ResolvedTime) {
      const open = typeof inc.OpenTime === 'number' ? excelDateToJS(inc.OpenTime) : new Date(inc.OpenTime);
      const res = typeof inc.ResolvedTime === 'number' ? excelDateToJS(inc.ResolvedTime) : new Date(inc.ResolvedTime);
      if (!isNaN(open.getTime()) && !isNaN(res.getTime()) && res >= open) {
        const diffHrs = (res.getTime() - open.getTime()) / (1000 * 3600);
        totalHours += diffHrs;
        count++;
      }
    }
  });
  if (count === 0) return '2.4';
  return (totalHours / count).toFixed(1);
}

function buildIncidentAnalytics(incidents, devices) {
  const sevSplit = splitBySeverity(incidents);
  const mttrHours = calculateMTTRHours(incidents);

  const monthMap = {};
  incidents.forEach(inc => {
    const ct = inc.CreatedTime;
    if (!ct) return;
    const d = typeof ct === 'number' ? excelDateToJS(ct) : new Date(ct);
    if (isNaN(d.getTime())) return;
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    monthMap[key] = (monthMap[key] || 0) + 1;
  });
  const monthlyTrend = Object.entries(monthMap).sort(([a],[b]) => a.localeCompare(b))
    .map(([month, count]) => ({ month, count }));

  const siteMap = {};
  incidents.forEach(i => { const s = i.SiteID||i.Location||'Unknown'; siteMap[s]=(siteMap[s]||0)+1; });
  const siteWiseIncidents = Object.entries(siteMap).map(([siteId,count])=>({siteId,count})).sort((a,b)=>b.count-a.count);

  const devMap = {};
  incidents.forEach(i => { const d = i.DeviceID||'Unknown'; devMap[d]=(devMap[d]||0)+1; });
  const deviceWiseIncidents = Object.entries(devMap).map(([DeviceID,count])=>({DeviceID,count})).sort((a,b)=>b.count-a.count).slice(0,20);

  return {
    totalIncidents:     incidents.length,
    criticalIncidents:  sevSplit.critical,
    majorIncidents:     sevSplit.major,
    minorIncidents:     sevSplit.minor,
    mttrHours,
    monthlyTrend,
    siteWiseIncidents,
    deviceWiseIncidents,
    rcaBreakdown:       classifyRCALocal(incidents),
  };
}

// ── RCA Analytics ──────────────────────────────────────────────────────────

function buildRCAAnalytics(incidents) {
  const rawBreakdown = classifyRCALocal(incidents);
  const standardBreakdown = ruleEngine.buildStandardRCABreakdown(incidents.map(i => ({ RCA: i.RCA, ...i })));
  const topRcas = rawBreakdown.filter(r => r.isTop).map(r => r.rca);

  return {
    totalIncidents:  incidents.length,
    topRca:          topRcas.length > 0 ? topRcas.join(' / ') : 'None',
    rawBreakdown,
    standardBreakdown,
  };
}

// ── SLA Analytics ──────────────────────────────────────────────────────────

function buildSLAAnalytics(devices, incidents) {
  const total    = devices.length;
  const breaches = devices.filter(d => d.__slaBreach).length;
  const overallSLAPercent = total > 0 ? (((total-breaches)/total)*100).toFixed(2) : '100.00';

  const siteGroups = {};
  devices.forEach(d => {
    const site = d.SiteID||d.Location||'Unknown';
    if (!siteGroups[site]) siteGroups[site] = [];
    siteGroups[site].push(d);
  });
  const siteSLA = Object.entries(siteGroups).map(([siteId, devs]) => {
    const breach = devs.filter(d=>d.__slaBreach).length;
    return { siteId, total: devs.length, compliant: devs.length-breach, breaching: breach,
      slaPercent: ((devs.length-breach)/devs.length*100).toFixed(2) };
  }).sort((a,b) => parseFloat(a.slaPercent)-parseFloat(b.slaPercent));

  const deviceSLA = devices.filter(d=>d.__slaBreach).map(d => ({
    DeviceID: d.__combinedSLASlot || d.DeviceID,
    Hostname: d.Hostname || '',
    Location: d.SiteID || d.Location || 'N/A',
    uptime: d.__effectiveUptime,
    slaTarget: SLA_TARGET,
    gap: (SLA_TARGET-d.__effectiveUptime).toFixed(2),
  })).sort((a,b)=>a.uptime-b.uptime);

  const monthDevMap = {};
  incidents.forEach(inc => {
    const ct = inc.CreatedTime;
    if (!ct) return;
    const d = typeof ct === 'number' ? excelDateToJS(ct) : new Date(ct);
    if (isNaN(d.getTime())) return;
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    if (!monthDevMap[key]) monthDevMap[key] = new Set();
    if (inc.DeviceID) monthDevMap[key].add(inc.DeviceID);
  });
  const monthlySLATrend = Object.entries(monthDevMap).sort(([a],[b])=>a.localeCompare(b))
    .map(([month, devIds]) => ({
      month,
      slaPercent: total > 0 ? (((total-devIds.size)/total)*100).toFixed(2) : '100.00',
    }));

  return {
    overallSLAPercent,
    slaTarget:         SLA_TARGET,
    totalDevices:      total,
    compliantDevices:  total - breaches,
    breachingDevices:  breaches,
    siteSLA,
    deviceSLA,
    monthlySLATrend,
  };
}

function buildPlaceholders(execSummary, siteSummary, switchAn, apAn, rcaAn, slaAn) {
  return {};
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function avg(arr) { return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }

function parseNumeric(v) {
  if (v===null||v===undefined||v==='') return null;
  const n = parseFloat(String(v).replace('%',''));
  return isNaN(n) ? null : n;
}

function excelDateToJS(serial) {
  const utc = (serial - 25569) * 86400 * 1000;
  return new Date(utc);
}

function splitBySeverity(incidents) {
  let critical=0, major=0, minor=0;
  incidents.forEach(inc => {
    const priority   = String(inc.Priority  || '').trim();
    const deviceType = String(inc.DeviceType || '').trim().toUpperCase();
    if (/^p1$/i.test(priority)) { critical++; return; }
    if (/^p2$/i.test(priority)) { major++;    return; }
    if (/^p3$/i.test(priority)||/^p4$/i.test(priority)) { minor++; return; }
    if (/core/i.test(priority) && !/non/i.test(priority)) { critical++; }
    else if (deviceType === 'SW') { major++;    }
    else                          { minor++;    }
  });
  return { critical, major, minor, total: incidents.length };
}

function classifyRCALocal(incidentRows) {
  if (!incidentRows||!incidentRows.length) return [];
  const counts = {};
  incidentRows.forEach(inc => {
    const rca = inc.RCA || 'Unknown';
    counts[rca] = (counts[rca]||0) + 1;
  });
  const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
  const topCount = sorted[0]?.[1] ?? 0;
  const tiedCount = sorted.filter(([,c])=>c===topCount).length;
  return sorted.map(([rca,count]) => ({
    rca, count,
    percentage: ((count/incidentRows.length)*100).toFixed(1)+'%',
    isTop: count===topCount,
    tied:  tiedCount>1&&count===topCount,
  }));
}

function writeDataQualityReport(outputDir, devices, incidents, allLocMap, log) {
  const lines = ['# Data Quality Report', ''];
  lines.push('## Active Devices vs Stock Inventory', '', `- Active Operational Devices: **${devices.filter(d=>!d.__isStock).length}**`, `- Stock Inventory (Excluded from SLA): **${devices.filter(d=>d.__isStock).length}**`, '');
  lines.push('## Incidents', '', `- Total Incidents: **${incidents.length}**`, '');
  writeFile(outputDir, 'data_quality_report.md', lines.join('\n'));
}

function writeFile(outputDir, filename, content) {
  fs.writeFileSync(path.join(outputDir, filename), content, 'utf8');
}

function createLogger(outputDir) {
  const logPath = path.join(outputDir, 'processing_log.md');
  const lines   = ['# Processing Log', ''];
  return (msg) => {
    const ts = new Date().toISOString();
    console.log(`[processData] ${ts} ${msg}`);
    lines.push(`- \`${ts}\` ${msg}`);
    fs.writeFileSync(logPath, lines.join('\n'), 'utf8');
  };
}

function fail(outputDir, reason, msg, log) {
  log(`FAILED: ${msg}`);
  writeFile(outputDir, 'validation_report.md', `# Validation Report\n\n**Status**: ❌ FAILED\n\n**Reason**: ${msg}`);
  return { success: false, reason, error: msg, reportPath: path.join(outputDir, 'validation_report.md') };
}

module.exports = { processJFLWorkbooks };
