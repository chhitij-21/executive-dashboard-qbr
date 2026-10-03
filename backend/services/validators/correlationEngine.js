// backend/services/validators/correlationEngine.js
const crypto = require('crypto');
const { normalizeSiteName } = require('../excelParser');

function sha1(str) {
  return crypto.createHash('sha1').update(String(str || '')).digest('hex');
}

function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Object.isFrozen(obj)) return obj;
  Object.freeze(obj);
  Object.getOwnPropertyNames(obj).forEach(prop => {
    const val = obj[prop];
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  });
  return obj;
}

function parseDateUtc(raw) {
  if (!raw) return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === 'number' && raw > 30000 && raw < 100000) {
    const d = new Date(Math.round((raw - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : d;
  }
  const str = String(raw).trim();
  if (!str || str.toLowerCase() === 'n/a') return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function findCorrelations(qbrData, options = {}) {
  try {
    if (!qbrData || typeof qbrData !== 'object') {
      return {
        success: false,
        correlations: [],
        summary: { total: 0, byType: {} },
        error: 'INVALID_INPUT: qbrData must be an object',
      };
    }

    deepFreeze(qbrData);

    const ignoreStock = options.ignoreStock !== false;
    const minConfidence = options.minConfidence || 'MEDIUM';

    const devices = Array.isArray(qbrData.devices) ? qbrData.devices : [];
    let incidents = Array.isArray(qbrData.incidents) ? qbrData.incidents : [];

    // Map device properties for lookup
    const deviceMap = new Map();
    const stockDeviceSet = new Set();
    devices.forEach(d => {
      const keys = [d.DeviceID, d.SerialNo, d.Hostname].filter(k => Boolean(k && typeof k === 'string'));
      keys.forEach(k => {
        deviceMap.set(k.trim().toLowerCase(), d);
        if (d.__isStock) stockDeviceSet.add(k.trim().toLowerCase());
      });
    });

    if (ignoreStock) {
      incidents = incidents.filter(inc => {
        const keys = [inc.DeviceID, inc.SerialNo, inc.Hostname].filter(k => Boolean(k && typeof k === 'string'));
        return !keys.some(k => stockDeviceSet.has(k.trim().toLowerCase()));
      });
    }

    const correlations = [];

    // C1. SIMULTANEOUS_OUTAGE
    // Trigger: >= 3 incidents in SAME site within 60 min window (using CreatedTime)
    const incidentsBySite = new Map();
    incidents.forEach(inc => {
      const rawSite = inc.SiteID || inc.Location;
      const site = normalizeSiteName(rawSite);
      if (!incidentsBySite.has(site)) incidentsBySite.set(site, []);
      incidentsBySite.get(site).push(inc);
    });

    incidentsBySite.forEach((siteIncs, site) => {
      if (site === 'Unknown') return;
      const timedIncs = siteIncs
        .map(inc => ({ inc, dt: parseDateUtc(inc.CreatedTime || inc.OpenTime) }))
        .filter(item => item.dt !== null)
        .sort((a, b) => a.dt.getTime() - b.dt.getTime());

      for (let i = 0; i < timedIncs.length; i++) {
        const windowIncs = [timedIncs[i].inc];
        const windowStart = timedIncs[i].dt.getTime();
        const windowEnd = windowStart + (60 * 60 * 1000);

        for (let j = i + 1; j < timedIncs.length; j++) {
          if (timedIncs[j].dt.getTime() <= windowEnd) {
            windowIncs.push(timedIncs[j].inc);
          } else {
            break;
          }
        }

        if (windowIncs.length >= 3) {
          const deviceIds = Array.from(new Set(windowIncs.map(x => x.DeviceID || x.SerialNo).filter(Boolean)));
          const timeWindow = `${timedIncs[i].dt.toISOString().substring(11, 16)} - ${new Date(windowEnd).toISOString().substring(11, 16)} UTC`;
          const id = sha1(`C1|${site}|${windowStart}`).slice(0, 16);

          correlations.push({
            id,
            type: 'SIMULTANEOUS_OUTAGE',
            confidence: 'HIGH',
            entities: { site, deviceIds, timeWindow },
            incidentCount: windowIncs.length,
            evidence: { site, incidentCount: windowIncs.length, timeWindow, deviceIds },
            recommendation: 'Check site upstream power, core switch uplinks, or circuit status during outage window.',
          });
          i += windowIncs.length - 1; // Skip window to avoid duplicate reporting
        }
      }
    });

    // C2. RACK_INFRASTRUCTURE_ISSUE
    // Trigger: >= 5 incidents across devices in SAME site + SAME rack
    const siteRackMap = new Map();
    incidents.forEach(inc => {
      const rawSite = inc.SiteID || inc.Location;
      const site = normalizeSiteName(rawSite);
      if (site === 'Unknown') return;

      const keys = [inc.DeviceID, inc.SerialNo, inc.Hostname].filter(k => Boolean(k && typeof k === 'string'));
      let rack = inc.Rack || '';
      if (!rack) {
        for (const k of keys) {
          const dev = deviceMap.get(k.trim().toLowerCase());
          if (dev && dev.Rack) {
            rack = dev.Rack;
            break;
          }
        }
      }

      if (rack && typeof rack === 'string' && rack.trim() && rack.toLowerCase() !== 'n/a') {
        const key = `${site}|${rack.trim()}`;
        if (!siteRackMap.has(key)) siteRackMap.set(key, { site, rack: rack.trim(), incs: [] });
        siteRackMap.get(key).incs.push(inc);
      }
    });

    siteRackMap.forEach(({ site, rack, incs }) => {
      if (incs.length >= 5) {
        const deviceIds = Array.from(new Set(incs.map(x => x.DeviceID || x.SerialNo).filter(Boolean)));
        const id = sha1(`C2|${site}|${rack}`).slice(0, 16);
        correlations.push({
          id,
          type: 'RACK_INFRASTRUCTURE_ISSUE',
          confidence: 'HIGH',
          entities: { site, rack, deviceIds },
          incidentCount: incs.length,
          evidence: { site, rack, incidentCount: incs.length, deviceIds },
          recommendation: 'Audit rack PDU, power distribution, thermal status, and rack patch panel cables.',
        });
      }
    });

    // C3. RECURRING_DEVICE_FAILURE
    // Trigger: >= 3 incidents on SAME DeviceID with SAME RCA value
    const devRcaMap = new Map();
    incidents.forEach(inc => {
      const devId = inc.DeviceID || inc.SerialNo;
      const rca = inc.RCA || 'Unknown';
      if (devId && rca && rca !== 'Unknown') {
        const key = `${devId.trim()}|${rca.trim()}`;
        if (!devRcaMap.has(key)) devRcaMap.set(key, { devId: devId.trim(), rca: rca.trim(), incs: [], site: normalizeSiteName(inc.SiteID || inc.Location) });
        devRcaMap.get(key).incs.push(inc);
      }
    });

    devRcaMap.forEach(({ devId, rca, incs, site }) => {
      if (incs.length >= 3) {
        const id = sha1(`C3|${devId}|${rca}`).slice(0, 16);
        correlations.push({
          id,
          type: 'RECURRING_DEVICE_FAILURE',
          confidence: 'HIGH',
          entities: { site, deviceIds: [devId], rca },
          incidentCount: incs.length,
          evidence: { deviceId: devId, rca, incidentCount: incs.length, site },
          recommendation: 'Initiate targeted RMA replacement or firmware update for failing device.',
        });
      }
    });

    // C4. REPEATED_RCA_PATTERN
    // Trigger: SAME RCA appears in >= 5 different devices in SAME site
    const siteRcaDeviceMap = new Map();
    incidents.forEach(inc => {
      const site = normalizeSiteName(inc.SiteID || inc.Location);
      const rca = inc.RCA || 'Unknown';
      const devId = inc.DeviceID || inc.SerialNo;
      if (site !== 'Unknown' && rca !== 'Unknown' && devId) {
        const key = `${site}|${rca.trim()}`;
        if (!siteRcaDeviceMap.has(key)) siteRcaDeviceMap.set(key, { site, rca: rca.trim(), devices: new Set(), incCount: 0 });
        const entry = siteRcaDeviceMap.get(key);
        entry.devices.add(devId.trim());
        entry.incCount++;
      }
    });

    siteRcaDeviceMap.forEach(({ site, rca, devices: devSet, incCount }) => {
      if (devSet.size >= 5) {
        const deviceIds = Array.from(devSet);
        const id = sha1(`C4|${site}|${rca}`).slice(0, 16);
        correlations.push({
          id,
          type: 'REPEATED_RCA_PATTERN',
          confidence: 'MEDIUM',
          entities: { site, rca, deviceIds },
          incidentCount: incCount,
          evidence: { site, rca, uniqueDevices: devSet.size, totalIncidents: incCount, deviceIds },
          recommendation: 'Perform site-wide remediation targeting systemic root cause pattern.',
        });
      }
    });

    // C5. TIME_OF_DAY_PATTERN
    // Trigger: >= 4 incidents in SAME site in SAME hour-of-day (UTC)
    const siteHourMap = new Map();
    incidents.forEach(inc => {
      const site = normalizeSiteName(inc.SiteID || inc.Location);
      const dt = parseDateUtc(inc.CreatedTime || inc.OpenTime);
      if (site !== 'Unknown' && dt) {
        const hour = dt.getUTCHours();
        const key = `${site}|${hour}`;
        if (!siteHourMap.has(key)) siteHourMap.set(key, { site, hour, incs: [] });
        siteHourMap.get(key).incs.push(inc);
      }
    });

    siteHourMap.forEach(({ site, hour, incs }) => {
      if (incs.length >= 4) {
        const deviceIds = Array.from(new Set(incs.map(x => x.DeviceID || x.SerialNo).filter(Boolean)));
        const hourStr = `${String(hour).padStart(2, '0')}:00 - ${String(hour).padStart(2, '0')}:59 UTC`;
        const id = sha1(`C5|${site}|${hour}`).slice(0, 16);
        correlations.push({
          id,
          type: 'TIME_OF_DAY_PATTERN',
          confidence: 'MEDIUM',
          entities: { site, timeWindow: hourStr, deviceIds },
          incidentCount: incs.length,
          evidence: { site, hourUtc: hour, timeWindow: hourStr, incidentCount: incs.length, deviceIds },
          recommendation: 'Check scheduled backup jobs, cron tasks, or utility load changes occurring at this hour.',
        });
      }
    });

    // Filter by minConfidence
    let filteredCorrelations = correlations;
    if (minConfidence === 'HIGH') {
      filteredCorrelations = correlations.filter(c => c.confidence === 'HIGH');
    }

    // Sort: by type ASC, then incidentCount DESC
    filteredCorrelations.sort((a, b) => {
      if (a.type !== b.type) return a.type.localeCompare(b.type);
      return b.incidentCount - a.incidentCount;
    });

    const byType = {};
    filteredCorrelations.forEach(c => {
      byType[c.type] = (byType[c.type] || 0) + 1;
    });

    return {
      success: true,
      correlations: filteredCorrelations,
      summary: {
        total: filteredCorrelations.length,
        byType,
      },
      error: null,
    };
  } catch (err) {
    return {
      success: false,
      correlations: [],
      summary: { total: 0, byType: {} },
      error: err?.message || 'UNKNOWN_ERROR',
    };
  }
}

module.exports = { findCorrelations };
