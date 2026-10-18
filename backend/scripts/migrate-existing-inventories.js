// backend/scripts/migrate-existing-inventories.js
// One-time migration: seeds Turso inventory_devices from existing dashboard_data.json

const fs = require('fs');
const path = require('path');
const { normalizeSerial, deriveDeviceType } = require('../services/inventorySyncService');
const { getClient } = require('../config/database');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const JFL_PATH = path.join(ROOT_DIR, 'reports/job_b4db8832-e68f-4658-9f3d-f1dce351e962/dashboard_data.json');
const MMTC_PATH = path.join(ROOT_DIR, 'reports/job_dfadab6d-7735-4221-b45a-4a4253c30006/dashboard_data.json');

const EXPECTED_STATS = {
  jfl: { total: 444, active: 372, stock: 72, sites: 8 },
  mmtc: { total: 145, active: 145, stock: 0, sites: 21 },
};

function deriveStatus(device) {
  const KNOWN = new Set(['active', 'stock', 'faulty', 'not_covered']);
  const s = String(device.status || '').trim().toLowerCase();
  if (KNOWN.has(s)) return s;
  if (device.__isStock === true) return 'stock';
  return 'active';
}

function mapDashboardDeviceToDbRow(device, clientId, idx) {
  if (!device || typeof device !== 'object') {
    throw new Error(`Row ${idx !== undefined ? idx : 'unknown'}: device is not an object`);
  }
  const serial_no = normalizeSerial(device.SerialNo);
  const site_id = device.Location || device.SiteID || null;
  if (!serial_no) {
    throw new Error(`Row ${idx !== undefined ? idx : 'unknown'}: serial_no is required`);
  }
  if (!site_id) {
    throw new Error(`Row ${idx !== undefined ? idx : 'unknown'}: site_id is required`);
  }
  return {
    client_id: clientId,
    serial_no,
    hostname: device.Hostname || device.SerialNo || null,
    site_id,
    rack_location: device.Rack || null,
    model: device.Model || 'Unknown',
    device_type: device.DeviceType || deriveDeviceType(device.Model || ''),
    mac_address: device.MAC || null,
    cloud_id: device.NetworkID || device.NetworkName || null,
    status: deriveStatus(device),
  };
}

function computeMigrationStats(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const active = list.filter((r) => r.status === 'active').length;
  const stock = list.filter((r) => r.status === 'stock').length;
  const faulty = list.filter((r) => r.status === 'faulty').length;
  const not_covered = list.filter((r) => r.status === 'not_covered').length;
  const sites = new Set(list.map((r) => r.site_id).filter(Boolean)).size;
  return {
    total: list.length,
    active,
    stock,
    faulty,
    not_covered,
    sites,
    byStatus: {
      active,
      stock,
      faulty,
      not_covered,
    },
  };
}

function loadDashboardJobData(jobPath) {
  if (!fs.existsSync(jobPath)) throw new Error(`Migration source missing: ${jobPath}`);
  const raw = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
  if (!Array.isArray(raw.devices)) throw new Error(`Invalid dashboard file (no devices array): ${jobPath}`);
  return {
    devices: raw.devices,
    customerName: raw.customerName || null,
    clientId: raw.clientId || null,
  };
}

async function runDryRun() {
  console.log('[dry-run] Starting pre-migration inventory check...');
  let failed = false;
  const targets = [
    ['jfl', JFL_PATH, 'jfl'],
    ['mmtc', MMTC_PATH, 'mmtc'],
  ];

  for (const [label, pathStr, clientId] of targets) {
    console.log(`\n--- Target: ${label.toUpperCase()} (${clientId}) ---`);
    console.log(`Source: ${pathStr}`);
    const data = loadDashboardJobData(pathStr);
    const rows = data.devices.map((d, i) => mapDashboardDeviceToDbRow(d, clientId, i));
    const stats = computeMigrationStats(rows);

    console.log(
      `Mapped rows: total=${stats.total}, active=${stats.active}, stock=${stats.stock}, faulty=${stats.faulty}, not_covered=${stats.not_covered}, sites=${stats.sites}`
    );
    console.log('byStatus:', stats.byStatus);

    const exp = EXPECTED_STATS[label];
    for (const field of ['total', 'active', 'stock', 'sites']) {
      if (stats[field] !== exp[field]) {
        console.error(`MISMATCH ${label}.${field}: expected ${exp[field]} got ${stats[field]}`);
        failed = true;
      }
    }
  }

  if (failed) {
    console.error('\nDRY-RUN FAILED: one or more counts deviated from expected specification.');
    process.exit(1);
  } else {
    console.log('\nDRY-RUN PASS: all counts match expected specification 100%.');
  }
}

async function runVerify() {
  console.log('[verify] Querying Turso database for current inventory counts...');
  const db = getClient();
  let failed = false;
  const targets = [
    ['jfl', 'jfl'],
    ['mmtc', 'mmtc'],
  ];

  for (const [label, clientId] of targets) {
    console.log(`\n--- Verifying: ${label.toUpperCase()} (${clientId}) ---`);
    const totalRes = await db.execute({
      sql: 'SELECT COUNT(*) AS c FROM inventory_devices WHERE client_id = ?',
      args: [clientId],
    });
    const activeRes = await db.execute({
      sql: "SELECT COUNT(*) AS c FROM inventory_devices WHERE client_id = ? AND status = 'active'",
      args: [clientId],
    });
    const stockRes = await db.execute({
      sql: "SELECT COUNT(*) AS c FROM inventory_devices WHERE client_id = ? AND status = 'stock'",
      args: [clientId],
    });
    const sitesRes = await db.execute({
      sql: 'SELECT COUNT(DISTINCT site_id) AS c FROM inventory_devices WHERE client_id = ? AND site_id IS NOT NULL',
      args: [clientId],
    });

    const actual = {
      total: Number(totalRes.rows[0]?.c || 0),
      active: Number(activeRes.rows[0]?.c || 0),
      stock: Number(stockRes.rows[0]?.c || 0),
      sites: Number(sitesRes.rows[0]?.c || 0),
    };

    console.log(`DB Counts: total=${actual.total}, active=${actual.active}, stock=${actual.stock}, sites=${actual.sites}`);
    const exp = EXPECTED_STATS[label];

    for (const field of ['total', 'active', 'stock', 'sites']) {
      if (actual[field] !== exp[field]) {
        console.error(`MISMATCH ${label}.${field}: expected ${exp[field]} got ${actual[field]}`);
        failed = true;
      }
    }
  }

  if (failed) {
    console.error('\nVERIFY FAILED: database counts do not match expected migration target.');
    process.exit(1);
  } else {
    console.log('\nVERIFY PASS: database matches expected migration counts 100%.');
  }
}

async function runExecute() {
  if (!process.argv.includes('--confirm')) {
    console.error('Refusing to execute without --confirm flag');
    console.error('Run: node migrate-existing-inventories.js --execute --confirm');
    process.exit(1);
  }

  const jflData = loadDashboardJobData(JFL_PATH);
  const mmtcData = loadDashboardJobData(MMTC_PATH);

  const jflRows = jflData.devices.map((d, i) => mapDashboardDeviceToDbRow(d, 'jfl', i));
  const mmtcRows = mmtcData.devices.map((d, i) => mapDashboardDeviceToDbRow(d, 'mmtc', i));

  const db = getClient();
  const tx = await db.transaction('write');
  try {
    for (const { label, rows } of [
      { label: 'jfl', rows: jflRows },
      { label: 'mmtc', rows: mmtcRows },
    ]) {
      let upserted = 0;
      for (const row of rows) {
        const now = new Date().toISOString();
        await tx.execute({
          sql: `INSERT INTO inventory_devices
                  (client_id, serial_no, mac_address, cloud_id, hostname,
                   device_type, model, site_id, rack_location, status,
                   first_seen_at, last_seen_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(client_id, serial_no) DO UPDATE SET
                  mac_address   = excluded.mac_address,
                  cloud_id      = excluded.cloud_id,
                  hostname      = excluded.hostname,
                  device_type   = excluded.device_type,
                  model         = excluded.model,
                  site_id       = excluded.site_id,
                  rack_location = excluded.rack_location,
                  status        = excluded.status,
                  last_seen_at  = excluded.last_seen_at`,
          args: [
            row.client_id,
            row.serial_no,
            row.mac_address,
            row.cloud_id,
            row.hostname,
            row.device_type,
            row.model,
            row.site_id,
            row.rack_location,
            row.status,
            now,
            now,
          ],
        });
        upserted++;
      }
      console.log(`[execute] ${label}: upserted ${upserted} rows`);
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    console.error('EXECUTE FAILED:', err.message);
    process.exit(1);
  }

  await runVerify();
}

async function main() {
  const args = process.argv.slice(2);
  const has = (f) => args.includes(f);

  if (has('--dry-run') && !has('--execute') && !has('--verify')) {
    await runDryRun();
    process.exit(0);
  }
  if (has('--execute') && has('--confirm') && !has('--dry-run') && !has('--verify')) {
    await runExecute();
    return;
  }
  if (has('--verify') && !has('--dry-run') && !has('--execute')) {
    await runVerify();
    process.exit(0);
  }
  if (has('--execute') && !has('--confirm')) {
    console.error('--execute requires --confirm');
    process.exit(1);
  }
  console.error('Usage: node migrate-existing-inventories.js --dry-run | --execute --confirm | --verify');
  process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('FATAL:', err.message);
    process.exit(1);
  });
}

module.exports = {
  mapDashboardDeviceToDbRow,
  computeMigrationStats,
  loadDashboardJobData,
  EXPECTED_STATS,
  runDryRun,
  runVerify,
  runExecute,
};
