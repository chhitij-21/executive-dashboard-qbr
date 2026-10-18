const fs = require('fs');
const path = require('path');
const { getClient } = require('../config/database');
const { loadWorkbook } = require('./excelParser');
const { buildSiteSummary, validateAnalytics } = require('./processData');

const COMPARED_FIELDS = [
  'cloud_id',
  'device_type',
  'hostname',
  'mac_address',
  'model',
  'rack_location',
  'site_id',
  'status',
];

/**
 * Normalizes a hardware serial number by trimming whitespace and converting to uppercase.
 * @param {string|unknown} serial
 * @returns {string}
 */
function normalizeSerial(serial) {
  return String(serial || '').trim().toUpperCase();
}

/**
 * Pure function: compares current inventory against uploaded inventory.
 *
 * @param {Array<object>} currentArray - Array of current device records
 * @param {Array<object>} uploadedArray - Array of uploaded device records
 * @returns {{
 *   added: Array<object>,
 *   removed: Array<object>,
 *   replaced: Array<{ serial_no: string, before: object, after: object, changed_fields: string[] }>,
 *   unchanged: Array<object>
 * }}
 */
function computeDiff(currentArray, uploadedArray) {
  const currentList = Array.isArray(currentArray) ? currentArray : [];
  const uploadedList = Array.isArray(uploadedArray) ? uploadedArray : [];

  const seenSerials = new Set();
  const normalizedUploaded = [];

  for (const rawItem of uploadedList) {
    const serialRaw = rawItem ? rawItem.serial_no : undefined;
    const normalized = normalizeSerial(serialRaw);

    if (!normalized) {
      throw new Error('Device serial number is empty or missing');
    }
    if (seenSerials.has(normalized)) {
      throw new Error(`Duplicate serial number in upload: ${normalized}`);
    }

    seenSerials.add(normalized);
    normalizedUploaded.push({
      ...rawItem,
      serial_no: normalized,
    });
  }

  // Index current inventory by normalized serial number
  const currentMap = new Map();
  for (const rawItem of currentList) {
    const normSerial = normalizeSerial(rawItem?.serial_no);
    if (normSerial) {
      currentMap.set(normSerial, rawItem);
    }
  }

  const added = [];
  const replaced = [];
  const unchanged = [];
  const matchedCurrentSerials = new Set();

  for (const uploadedItem of normalizedUploaded) {
    const serial = uploadedItem.serial_no;

    if (currentMap.has(serial)) {
      matchedCurrentSerials.add(serial);
      const currentItem = currentMap.get(serial);
      const changedFields = [];

      for (const field of COMPARED_FIELDS) {
        const valA = currentItem[field] !== undefined ? currentItem[field] : null;
        const valB = uploadedItem[field] !== undefined ? uploadedItem[field] : null;
        if (valA !== valB) {
          changedFields.push(field);
        }
      }

      if (changedFields.length > 0) {
        replaced.push({
          serial_no: serial,
          before: { ...currentItem },
          after: { ...uploadedItem },
          changed_fields: changedFields.sort(),
        });
      } else {
        unchanged.push({ ...currentItem });
      }
    } else {
      added.push({ ...uploadedItem });
    }
  }

  const removed = [];
  for (const currentItem of currentList) {
    const normSerial = normalizeSerial(currentItem?.serial_no);
    if (!matchedCurrentSerials.has(normSerial)) {
      removed.push({ ...currentItem });
    }
  }

  return {
    added,
    removed,
    replaced,
    unchanged,
  };
}

/**
 * Factory creating an inventory sync service instance bound to a specific db client.
 *
 * @param {import('@libsql/client').Client} dbClient
 */
function createInventorySyncService(dbClient) {
  /**
   * Loads currently active inventory devices for a client.
   *
   * @param {string} clientId - 'jfl' or 'mmtc'
   * @returns {Promise<Array<object>>}
   */
  async function loadCurrentInventory(clientId, includeAll = false) {
    if (!clientId) {
      throw new Error('clientId is required');
    }
    const sql = includeAll
      ? `SELECT * FROM inventory_devices WHERE client_id = ? AND status != 'removed' ORDER BY serial_no`
      : `SELECT * FROM inventory_devices WHERE client_id = ? AND status = 'active' ORDER BY serial_no`;
    const result = await dbClient.execute({
      sql,
      args: [clientId],
    });
    return result.rows || [];
  }

  /**
   * Stages an inventory diff as a pending sync preview.
   *
   * @param {{
   *   clientId: string,
   *   triggeredBy?: string,
   *   fileName?: string,
   *   diff: { added: any[], removed: any[], replaced: any[], unchanged: any[] }
   * }} params
   * @returns {Promise<{ syncId: number }>}
   */
  async function createSyncPreview({ clientId, triggeredBy, fileName, diff }) {
    if (!clientId || (clientId !== 'jfl' && clientId !== 'mmtc')) {
      throw new Error(`Invalid clientId: ${clientId}. Must be 'jfl' or 'mmtc'`);
    }
    if (
      !diff ||
      typeof diff !== 'object' ||
      !Array.isArray(diff.added) ||
      !Array.isArray(diff.removed) ||
      !Array.isArray(diff.replaced) ||
      !Array.isArray(diff.unchanged)
    ) {
      throw new Error('Invalid diff: must contain added, removed, replaced, and unchanged arrays');
    }

    const diffSummary = JSON.stringify(diff);
    const result = await dbClient.execute({
      sql: `INSERT INTO inventory_syncs (client_id, triggered_by, uploaded_file_name, diff_summary, status)
            VALUES (?, ?, ?, ?, 'pending')`,
      args: [clientId, triggeredBy || 'system', fileName || null, diffSummary],
    });

    const syncId = Number(result.lastInsertRowid);
    return { syncId };
  }

  /**
   * Approves a pending sync preview in an atomic transaction with snapshot.
   *
   * @param {number} syncId
   * @returns {Promise<{
   *   syncId: number,
   *   snapshotId: number,
   *   applied: { added: number, replaced: number, removed: number },
   *   historyCount: number
   * }>}
   */
  async function approveSync(syncId) {
    // STEP 1 — Load sync row (outside transaction, read-only)
    const syncRes = await dbClient.execute({
      sql: `SELECT * FROM inventory_syncs WHERE id = ?`,
      args: [syncId],
    });
    const syncRow = syncRes.rows[0];

    if (!syncRow) {
      throw new Error(`Sync ${syncId} not found`);
    }
    if (syncRow.status !== 'pending') {
      throw new Error(`Sync ${syncId} is ${syncRow.status}, cannot approve`);
    }

    // STEP 2 — Parse diff
    let diff;
    try {
      diff = JSON.parse(syncRow.diff_summary);
    } catch (e) {
      throw new Error(`Malformed diff_summary for sync ${syncId}`);
    }
    if (
      !diff ||
      typeof diff !== 'object' ||
      !Array.isArray(diff.added) ||
      !Array.isArray(diff.removed) ||
      !Array.isArray(diff.replaced)
    ) {
      throw new Error(`Malformed diff_summary for sync ${syncId}`);
    }

    const clientId = syncRow.client_id;

    // STEP 3 — Begin transaction
    const tx = await dbClient.transaction('write');
    try {
      // STEP 4 — Load current state (inside transaction, all statuses)
      const currentRes = await tx.execute({
        sql: `SELECT * FROM inventory_devices WHERE client_id = ?`,
        args: [clientId],
      });
      const currentState = currentRes.rows;

      // STEP 5 — Write snapshot (before any mutation)
      const snapRes = await tx.execute({
        sql: `INSERT INTO inventory_snapshots (sync_id, client_id, snapshot_data, created_at)
              VALUES (?, ?, ?, datetime('now'))`,
        args: [syncId, clientId, JSON.stringify(currentState)],
      });
      const snapshotId = Number(snapRes.lastInsertRowid);

      // STEP 6 — Apply changes via transaction client
      for (const d of diff.added) {
        const serialNo = normalizeSerial(d.serial_no);
        const status = d.status || 'active';
        await tx.execute({
          sql: `INSERT INTO inventory_devices
                  (client_id, serial_no, mac_address, cloud_id, hostname,
                   device_type, model, site_id, rack_location, status,
                   last_sync_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            clientId,
            serialNo,
            d.mac_address || null,
            d.cloud_id || null,
            d.hostname || null,
            d.device_type || null,
            d.model || null,
            d.site_id || null,
            d.rack_location || null,
            status,
            syncId,
          ],
        });
      }

      for (const replaced of diff.replaced) {
        const after = replaced.after || {};
        const serialNo = normalizeSerial(replaced.serial_no || after.serial_no);
        await tx.execute({
          sql: `UPDATE inventory_devices SET
                  mac_address = ?, cloud_id = ?, hostname = ?,
                  device_type = ?, model = ?, site_id = ?,
                  rack_location = ?, status = ?,
                  last_seen_at = datetime('now'), last_sync_id = ?
                WHERE client_id = ? AND serial_no = ?`,
          args: [
            after.mac_address ?? null,
            after.cloud_id ?? null,
            after.hostname ?? null,
            after.device_type ?? null,
            after.model ?? null,
            after.site_id ?? null,
            after.rack_location ?? null,
            after.status ?? null,
            syncId,
            clientId,
            serialNo,
          ],
        });
      }

      for (const removed of diff.removed) {
        const serialNo = normalizeSerial(removed.serial_no);
        await tx.execute({
          sql: `UPDATE inventory_devices SET
                  status = 'removed',
                  last_seen_at = datetime('now'), last_sync_id = ?
                WHERE client_id = ? AND serial_no = ?`,
          args: [syncId, clientId, serialNo],
        });
      }

      // STEP 7 — Write inventory_history rows
      for (const d of diff.added) {
        const serialNo = normalizeSerial(d.serial_no);
        await tx.execute({
          sql: `INSERT INTO inventory_history
                  (sync_id, client_id, serial_no, change_type,
                   before_state, after_state, changed_fields, created_at)
                VALUES (?, ?, ?, 'added', NULL, ?, NULL, datetime('now'))`,
          args: [syncId, clientId, serialNo, JSON.stringify(d)],
        });
      }

      for (const replaced of diff.replaced) {
        const after = replaced.after || {};
        const serialNo = normalizeSerial(replaced.serial_no || after.serial_no);
        const sortedFields = (replaced.changed_fields || []).slice().sort();
        await tx.execute({
          sql: `INSERT INTO inventory_history
                  (sync_id, client_id, serial_no, change_type,
                   before_state, after_state, changed_fields, created_at)
                VALUES (?, ?, ?, 'replaced', ?, ?, ?, datetime('now'))`,
          args: [
            syncId,
            clientId,
            serialNo,
            JSON.stringify(replaced.before || null),
            JSON.stringify(replaced.after || null),
            JSON.stringify(sortedFields),
          ],
        });
      }

      for (const removed of diff.removed) {
        const serialNo = normalizeSerial(removed.serial_no);
        await tx.execute({
          sql: `INSERT INTO inventory_history
                  (sync_id, client_id, serial_no, change_type,
                   before_state, after_state, changed_fields, created_at)
                VALUES (?, ?, ?, 'removed', ?, NULL, NULL, datetime('now'))`,
          args: [syncId, clientId, serialNo, JSON.stringify(removed)],
        });
      }

      // STEP 8 — Mark sync approved (inside tx)
      const updateRes = await tx.execute({
        sql: `UPDATE inventory_syncs
              SET status = 'approved', approved_at = datetime('now')
              WHERE id = ? AND status = 'pending'`,
        args: [syncId],
      });

      if (!updateRes || Number(updateRes.rowsAffected) !== 1) {
        throw new Error(`Failed to approve sync: sync is not pending or was updated concurrently`);
      }

      // STEP 9 — Commit
      await tx.commit();

      const historyCount = diff.added.length + diff.replaced.length + diff.removed.length;

      // STEP 10 — Return
      return {
        syncId,
        clientId,
        snapshotId,
        applied: {
          added: diff.added.length,
          replaced: diff.replaced.length,
          removed: diff.removed.length,
        },
        historyCount,
      };
    } catch (err) {
      try {
        await tx.rollback();
      } catch (rbErr) {
        // Ignore rollback failure if tx already closed
      }
      throw err;
    }
  }

  /**
   * Rolls back inventory_devices for a client to a previous snapshot state.
   *
   * @param {number} snapshotId
   * @returns {Promise<{
   *   snapshotId: number,
   *   clientId: string,
   *   restoredCount: number
   * }>}
   */
  async function rollbackToSnapshot(snapshotId) {
    // STEP 1 — Load snapshot row
    const snapRes = await dbClient.execute({
      sql: `SELECT * FROM inventory_snapshots WHERE id = ?`,
      args: [snapshotId],
    });
    const snapshotRow = snapRes.rows[0];

    if (!snapshotRow) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }

    // STEP 2 — Parse snapshot_data
    let snapshotData;
    try {
      snapshotData = JSON.parse(snapshotRow.snapshot_data);
    } catch (e) {
      throw new Error(`Malformed snapshot_data for ${snapshotId}`);
    }
    if (!Array.isArray(snapshotData)) {
      throw new Error(`Malformed snapshot_data for ${snapshotId}`);
    }

    // STEP 3 — Determine clientId
    const clientId = snapshotRow.client_id;

    // STEP 4 — Begin transaction
    const tx = await dbClient.transaction('write');
    try {
      // STEP 5 — Delete current rows for client
      await tx.execute({
        sql: `DELETE FROM inventory_devices WHERE client_id = ?`,
        args: [clientId],
      });

      // STEP 6 — Re-insert devices from snapshot exactly
      for (const d of snapshotData) {
        await tx.execute({
          sql: `INSERT INTO inventory_devices
                  (client_id, serial_no, mac_address, cloud_id, hostname,
                   device_type, model, site_id, rack_location, status,
                   first_seen_at, last_seen_at, last_sync_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            clientId,
            d.serial_no,
            d.mac_address || null,
            d.cloud_id || null,
            d.hostname || null,
            d.device_type || null,
            d.model || null,
            d.site_id || null,
            d.rack_location || null,
            d.status || 'active',
            d.first_seen_at || null,
            d.last_seen_at || null,
            d.last_sync_id || null,
          ],
        });
      }

      // STEP 7 — Commit
      await tx.commit();

      // STEP 8 — Return summary
      return {
        snapshotId,
        clientId,
        restoredCount: snapshotData.length,
      };
    } catch (err) {
      try {
        await tx.rollback();
      } catch (rbErr) {
        // Ignore rollback failure if tx already closed
      }
      throw err;
    }
  }

  return {
    computeDiff,
    loadCurrentInventory,
    createSyncPreview,
    approveSync,
    rollbackToSnapshot,
  };
}

// ━━━ SHEET SELECTION ━━━

function selectInventorySheet(wb) {
  const names = wb.__sheetNames || [];
  if (names.length === 0) throw new Error('Workbook has no sheets');

  // 1. Explicit: 'Updated inventory' (or close variants)
  const updated = names.find((n) => /updated.?inventory/i.test(n));
  if (updated && (wb[updated] || []).length > 0) return updated;

  // 2. Fallback: sheet with most rows
  let best = null,
    bestCount = 0;
  for (const n of names) {
    const c = (wb[n] || []).length;
    if (c > bestCount) {
      best = n;
      bestCount = c;
    }
  }
  if (!best || bestCount === 0) throw new Error('Workbook has no data rows');
  return best;
}

// Explicit token → dashboard-display-name map matching dashboard_data.json
const MMTC_TOKEN_DISPLAY = {
  AHMEDABAD: 'Ahmedabad',
  BANGALORE: 'Bangalore',
  BHUBANESWAR: 'Bhubaneswar',
  CHENNAI: 'Chennai',
  COIMBATORE: 'Coimbatore',
  GGN: 'Gurgaon',
  GUWAHATI: 'Guwahati',
  HYDERABAD: 'Hyderabad',
  KAROLBAGH: 'Karolbagh',
  KOLKATA: 'Kolkata',
  LAJPATNAGAR: 'Lajpat Nagar',
  LUDHIANA: 'Ludhiana',
  MUMBAI: 'Mumbai',
  NAGPUR: 'Nagpur',
  NOIDA: 'Noida',
  OKHLA: 'Okhla',
  ROHINI: 'Rohini Delhi',
  THRISSUR: 'Thrissur',
  VIJAYWADA: 'Vijaywada',
  VIZAG: 'Vizag',
};

function titleCase(token) {
  if (!token) return token;
  return token
    .toLowerCase()
    .split(/([-\s])/)
    .map((w) => (w.length && !/^[-\s]$/.test(w) ? w[0].toUpperCase() + w.slice(1) : w))
    .join('');
}

function deriveMMTCSite(network) {
  if (!network) return null;
  let s = String(network).trim().toUpperCase();
  s = s.replace(/^(INDIA|IND)[-_]/, '');

  // HEAD-OFFICE branch → '<City> Head Office'
  if (/HEAD[-_]?OFFICE/i.test(s)) {
    const city = s
      .split(/[-_]/)
      .filter((p) => p && !['PVC', 'PLANT', 'HEAD', 'OFFICE', 'SITE', 'CCTV', 'FSB', 'BLOCK', 'IT'].includes(p))[0];
    if (!city) return 'Head Office';
    return `${MMTC_TOKEN_DISPLAY[city] || titleCase(city)} Head Office`;
  }

  // PLANT branch → '<City> Plant'
  if (/PLANT/i.test(s)) {
    const city = s
      .split(/[-_]/)
      .filter((p) => p && !['PVC', 'PLANT', 'HEAD', 'OFFICE', 'SITE', 'CCTV', 'FSB', 'BLOCK', 'IT'].includes(p))[0];
    if (!city) return 'Plant';
    return `${MMTC_TOKEN_DISPLAY[city] || titleCase(city)} Plant`;
  }

  // Default branch — first meaningful token → dashboard name
  const parts = s.split(/[-_]/).filter(Boolean);
  const skip = new Set(['PVC', 'PLANT', 'HEAD', 'OFFICE', 'SITE', 'CCTV', 'FSB', 'BLOCK', 'IT']);
  for (const p of parts) {
    if (!skip.has(p)) {
      return MMTC_TOKEN_DISPLAY[p] || titleCase(p);
    }
  }
  return titleCase(s);
}

function deriveDeviceType(model) {
  if (!model) return 'Unknown';
  const m = String(model).trim().toUpperCase();
  if (/^MR\d/.test(m)) return 'AP';
  if (/^CW9\d/.test(m)) return 'AP';
  if (/^MS\d/.test(m)) return 'SW';
  if (/^C9[23]\d{2}/.test(m)) return 'SW';
  if (/^C9800/.test(m)) return 'WLC';
  if (/^WLC/.test(m)) return 'WLC';
  if (/^MX\d/.test(m)) return 'Router';
  if (/^ISR\d/.test(m)) return 'Router';
  if (/^SNS-/.test(m)) return 'Cisco ISE';
  return 'Unknown';
}

function deriveJFLStatus(row) {
  const hostname = String(row['Hostname'] || '').trim();
  const rack = String(row['Rack no.'] || '').trim();
  const faulty = String(row['Faulty Serial no'] || '').trim();
  if (hostname === 'STOCK') return 'stock';
  if (rack === 'Not Cover with us') return 'not_covered';
  if (faulty) return 'faulty';
  return 'active';
}

function cleanStr(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

// ━━━ MAPPERS ━━━

function mapJFLRow(row) {
  return {
    client_id: 'jfl',
    serial_no: normalizeSerial(row['Serial No.']),
    mac_address: cleanStr(row['MAC Address']),
    cloud_id: cleanStr(row['Network ID']),
    hostname: cleanStr(row['Hostname']),
    device_type: cleanStr(row['Device Type']),
    model: cleanStr(row['Model']),
    site_id: cleanStr(row['Location']),
    rack_location: cleanStr(row['Rack no.']),
    status: deriveJFLStatus(row),
  };
}

function mapMMTCRow(row) {
  return {
    client_id: 'mmtc',
    serial_no: normalizeSerial(row['Cloud ID']),
    mac_address: cleanStr(row['MAC address']),
    cloud_id: null,
    hostname: null,
    device_type: deriveDeviceType(row['Model']),
    model: cleanStr(row['Model']),
    site_id: deriveMMTCSite(row['Network']),
    rack_location: null,
    status: 'active',
  };
}

// ━━━ MAIN FUNCTION ━━━

async function parseUploadedInventory(filePath, clientId) {
  if (clientId !== 'jfl' && clientId !== 'mmtc') {
    throw new Error(`Invalid clientId: ${clientId}. Must be 'jfl' or 'mmtc'`);
  }
  const wb = loadWorkbook(filePath);
  const sheetName = selectInventorySheet(wb);
  const rows = wb[sheetName] || [];
  const mapper = clientId === 'jfl' ? mapJFLRow : mapMMTCRow;

  const devices = [];
  const warnings = [];
  const seenSerials = new Set();

  for (const row of rows) {
    const hasAnyValue = Object.entries(row).some(
      ([k, v]) => !k.startsWith('__') && v !== '' && v !== null && v !== undefined
    );
    if (!hasAnyValue) continue;

    const device = mapper(row);

    if (!device.serial_no) {
      warnings.push({
        row: row.__source?.row,
        sheet: row.__source?.sheet,
        reason: 'empty serial number',
      });
      continue;
    }

    if (seenSerials.has(device.serial_no)) {
      throw new Error(
        `Duplicate serial number in ${clientId} upload: ${device.serial_no} (row ${row.__source?.row})`
      );
    }
    seenSerials.add(device.serial_no);
    devices.push(device);
  }

  return { devices, warnings, sheetUsed: sheetName };
}

/**
 * Merges physical inventory from DB into the base dashboard_data.json shell.
 *
 * @param {string} clientId
 * @param {object} base
 * @param {Array<object>} [dbDevices]
 * @returns {object}
 */
function buildDashboardFromDb(clientId, base, dbDevices = []) {
  if (!base || typeof base !== 'object') {
    throw new Error('Base dashboard data is required');
  }

  if (!dbDevices || dbDevices.length === 0) {
    return {
      ...base,
      __inventoryMeta: {
        skipped: true,
        reason: 'no-db-data',
        rebuiltAt: new Date().toISOString(),
        sourceClientId: clientId,
      },
    };
  }

  // 1. Build lookup map of base devices by serial (case-insensitive + trimmed)
  const baseMap = new Map();
  const baseDevices = Array.isArray(base.devices) ? base.devices : [];
  for (const d of baseDevices) {
    const s = String(d.SerialNo || d.DeviceID || '').trim().toUpperCase();
    if (s && !baseMap.has(s)) {
      baseMap.set(s, d);
    }
  }

  // 2. Iterate dbDevices (excluding removed) and merge with base
  const finalDevices = [];
  for (const db of dbDevices) {
    const status = String(db.status || 'active').trim().toLowerCase();
    if (status === 'removed') {
      continue;
    }

    const serial = String(db.serial_no || '').trim().toUpperCase();
    const baseDevice = serial ? baseMap.get(serial) : null;

    if (baseDevice) {
      const merged = {
        ...baseDevice,
        Hostname: db.hostname || baseDevice.Hostname || db.serial_no,
        Model: db.model || baseDevice.Model || 'Unknown',
        Location: db.site_id || baseDevice.Location || 'Unknown',
        SiteID: db.site_id || baseDevice.SiteID || 'Unknown',
        DeviceType: db.device_type || baseDevice.DeviceType || 'SW',
        Rack: db.rack_location || baseDevice.Rack || 'NA',
        status: db.status || baseDevice.status || 'active',
        __isStock: status === 'stock',
      };
      finalDevices.push(merged);
    } else {
      // TODO: Newly added DB devices carry null analytics until next report generation cycle
      const isStock = status === 'stock';
      const devType = db.device_type || 'SW';
      finalDevices.push({
        DeviceID: db.serial_no,
        SerialNo: db.serial_no,
        Hostname: db.hostname || db.serial_no,
        Model: db.model || 'Unknown',
        Location: db.site_id || 'Unknown',
        SiteID: db.site_id || 'Unknown',
        DeviceType: devType,
        Rack: db.rack_location || 'NA',
        NetworkName: '',
        ReplacedSerial: '',
        CoreNonCore: '',
        status: db.status || 'active',
        'JFL Uptime %': null,
        'Proactive Uptime %': null,
        __effectiveUptime: null,
        __jflUptime: null,
        __proactiveUptime: null,
        __holdMins: null,
        __proactiveDownMins: null,
        __monthlyUptime: null,
        __quarterlyUptime: null,
        __isStock: isStock,
        __slaBreach: false,
        __isClientSideOnly: true,
        __slaTarget: null,
        __debugUptimeSource: 'no-analytics',
      });
    }
  }

  // 3. Topology recompute (CORRECTED SPEC)
  const activeDevices = finalDevices.filter((d) => d.status === 'active');
  const stockDevices = finalDevices.filter((d) => d.status === 'stock');

  const newExec = { ...(base.executiveSummary || {}) };
  newExec.totalDevices = activeDevices.length;
  newExec.totalSites = new Set(
    activeDevices.map((d) => d.SiteID || d.Location).filter(Boolean)
  ).size;
  newExec.totalStockDevices = stockDevices.length;
  newExec.totalSwitches = activeDevices.filter((d) => d.DeviceType === 'SW').length;
  newExec.totalAPs = activeDevices.filter((d) => d.DeviceType === 'AP').length;

  // 4. buildSiteSummary inputs
  const switches = activeDevices.filter((d) => d.DeviceType === 'SW');
  const aps = activeDevices.filter((d) => d.DeviceType === 'AP');
  const incidents = base.incidents || [];

  const periodOptions = {
    ...(base.report_period || {}),
    windowMinutes: base.report_period?.window_minutes || 44640,
    clientId,
    customerName: base.customerName || '',
  };

  let siteSummary = base.siteSummary || [];
  if (typeof buildSiteSummary === 'function') {
    try {
      siteSummary = buildSiteSummary(
        finalDevices,
        switches,
        aps,
        incidents,
        base.reportingPeriod || 'User Selected Period',
        periodOptions,
        base.customerName || ''
      );
    } catch (_) {
      siteSummary = base.siteSummary || [];
    }
  }

  // 5. Build output payload
  const payload = {
    ...base,
    executiveSummary: newExec,
    siteSummary,
    devices: finalDevices,
  };

  // 6. validateAnalytics filter
  let validationWarnings = [];
  if (typeof validateAnalytics === 'function') {
    try {
      const allWarnings = validateAnalytics(payload) || [];
      const inventorySideEffectPatterns = [
        /RCA breakdown sum.*does not match/i,
        /total switch incidents/i,
        /total ap incidents/i,
      ];
      validationWarnings = allWarnings.filter(
        (w) => !inventorySideEffectPatterns.some((p) => p.test(w))
      );
    } catch (_) {}
  }

  // 7. Add __inventoryMeta
  payload.__inventoryMeta = {
    rebuiltAt: new Date().toISOString(),
    execSummaryNote:
      'Topology counts refreshed from Turso; uptime/SLA/health preserved from last report generation',
    validationWarnings,
    sourceClientId: clientId,
    originalReportDeviceCount: baseDevices.length,
    currentDbDeviceCount: finalDevices.length,
  };

  return payload;
}

/**
 * Regenerates the canonical data/dashboard_data.json file from the latest completed report
 * overlayed with the latest Turso hardware inventory.
 *
 * @param {string} clientId
 * @param {object} [deps]
 * @returns {Promise<{ skipped: boolean, reason?: string, writtenAt?: string, deviceCount?: number }>}
 */
async function regenerateDashboardFileForClient(clientId, deps = {}) {
  const rawId = String(clientId || '').toLowerCase().trim();
  if (!['jfl', 'mmtc', 'client-jfl', 'client-mmtcpamp'].includes(rawId)) {
    throw new Error('clientId must be short or canonical form');
  }
  const clientService = require('./clientService');
  const canonicalClientId = clientService.resolveCanonicalClientId(clientId);
  let normClient = String(clientId || '').toLowerCase().trim();
  if (normClient === 'client-jfl' || normClient === 'jfl') {
    normClient = 'jfl';
  } else if (
    normClient === 'client-mmtcpamp' ||
    normClient === 'client-mmtc' ||
    normClient === 'mmtc' ||
    normClient === 'mmtc-pamp' ||
    normClient === 'mmtcpamp'
  ) {
    normClient = 'mmtc';
  } else {
    normClient = normClient.replace(/^client-/, '');
  }

  // 1. Resolve base dashboard JSON
  const resolveBase =
    deps.resolveBase ||
    (async () => {
      try {
        const historyService = require('./historyService');
        const clientHistory = historyService.getHistory({
          clientId: canonicalClientId,
          status: 'completed',
        });
        if (!clientHistory || clientHistory.length === 0) return null;
        const sorted = [...clientHistory].sort((a, b) => {
          const tb = new Date(b.uploadTimestamp || 0).getTime();
          const ta = new Date(a.uploadTimestamp || 0).getTime();
          return tb - ta;
        });
        const latest = sorted[0];
        if (!latest || !latest.dashboardPath || !fs.existsSync(latest.dashboardPath)) return null;
        const raw = fs.readFileSync(latest.dashboardPath, 'utf8');
        return JSON.parse(raw);
      } catch (err) {
        return null;
      }
    });

  const base = await resolveBase();
  if (!base) {
    return { skipped: true, reason: 'no-base' };
  }

  // 2. Load current DB inventory
  const loadDb =
    deps.loadDb ||
    (async (c) => {
      return await defaultService.loadCurrentInventory(c, { includeAll: true });
    });

  const dbDevices = await loadDb(normClient);

  // 3. Merge DB topology onto base
  const merged = buildDashboardFromDb(normClient, base, dbDevices);

  // 4. Write canonical dashboard file
  const canonicalPath =
    deps.canonicalPath || path.resolve(__dirname, '../..', 'data', 'dashboard_data.json');
  const writeFile =
    deps.writeFile ||
    (async (filePath, content) => {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, content, 'utf8');
    });

  await writeFile(canonicalPath, JSON.stringify(merged, null, 2));

  return {
    skipped: false,
    writtenAt: new Date().toISOString(),
    deviceCount: merged.devices ? merged.devices.length : 0,
  };
}

// Default instance bound lazily to database client
const defaultService = {
  computeDiff,
  parseUploadedInventory,
  buildDashboardFromDb,
  regenerateDashboardFileForClient,
  loadCurrentInventory: (...args) => createInventorySyncService(getClient()).loadCurrentInventory(...args),
  createSyncPreview: (...args) => createInventorySyncService(getClient()).createSyncPreview(...args),
  approveSync: (...args) => createInventorySyncService(getClient()).approveSync(...args),
  rollbackToSnapshot: (...args) => createInventorySyncService(getClient()).rollbackToSnapshot(...args),
};

module.exports = {
  createInventorySyncService,
  computeDiff,
  parseUploadedInventory,
  selectInventorySheet,
  deriveMMTCSite,
  deriveDeviceType,
  normalizeSerial,
  deriveJFLStatus,
  mapJFLRow,
  mapMMTCRow,
  MMTC_TOKEN_DISPLAY,
  titleCase,
  buildDashboardFromDb,
  regenerateDashboardFileForClient,
  defaultService,
  ...defaultService,
};

