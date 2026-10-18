// backend/tests/inventorySync.test.js
// Automated test suite for Phase G Inventory Sync Service (TDD)

process.env.NODE_ENV = 'test';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');
const { splitSqlStatements } = require('../db/migrate');

// Attempt import of service (TDD red-first: module initially absent or stubbed)
let serviceModule = {};
try {
  serviceModule = require('../services/inventorySyncService');
} catch (e) {
  serviceModule = {};
}

const { computeDiff, createInventorySyncService } = serviceModule;

/**
 * Creates an isolated in-memory LibSQL database and initializes schema.sql.
 * @returns {Promise<import('@libsql/client').Client>}
 */
async function createFreshMemoryDb() {
  const db = createClient({ url: 'file::memory:' });
  const schemaPath = path.resolve(__dirname, '../db/schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  const statements = splitSqlStatements(schemaSql);
  for (const statement of statements) {
    await db.execute(statement);
  }
  return db;
}

describe('Phase G — Inventory Sync Service Suite', () => {
  // ── T1. computeDiff identifies added device ──────────────────────────────
  it('T1. computeDiff identifies added device', () => {
    const current = [];
    const uploaded = [
      {
        serial_no: 'Q3KG-AAAA-0001',
        hostname: 'AP-01',
        mac_address: 'aa:bb:cc:00:00:01',
        model: 'MR86',
        site_id: 'Guwahati',
        device_type: 'AP',
        rack_location: 'NA',
        cloud_id: null,
        status: 'active',
      },
    ];

    const diff = computeDiff(current, uploaded);

    assert.equal(diff.added.length, 1);
    assert.equal(diff.added[0].serial_no, 'Q3KG-AAAA-0001');
    assert.equal(diff.removed.length, 0);
    assert.equal(diff.replaced.length, 0);
    assert.equal(diff.unchanged.length, 0);
  });

  // ── T2. computeDiff identifies removed device ────────────────────────────
  it('T2. computeDiff identifies removed device', () => {
    const deviceA = {
      serial_no: 'Q3KG-AAAA-0001',
      hostname: 'SW-01',
      mac_address: 'aa:bb:cc:00:00:01',
      model: 'MS250',
      site_id: 'Greater Noida',
      device_type: 'SW',
      rack_location: 'R1',
      cloud_id: 'L_12345',
      status: 'active',
    };
    const current = [deviceA];
    const uploaded = [];

    const diff = computeDiff(current, uploaded);

    assert.equal(diff.removed.length, 1);
    assert.equal(diff.removed[0].serial_no, 'Q3KG-AAAA-0001');
    assert.equal(diff.added.length, 0);
    assert.equal(diff.replaced.length, 0);
    assert.equal(diff.unchanged.length, 0);
  });

  // ── T3. computeDiff identifies replaced — MAC change ─────────────────────
  it('T3. computeDiff identifies replaced — MAC change', () => {
    const currentDevice = {
      serial_no: 'Q3KG-AAAA-0001',
      hostname: 'SW-01',
      mac_address: 'aa:bb:cc:00:00:01',
      model: 'MS250',
      site_id: 'Greater Noida',
      device_type: 'SW',
      rack_location: 'R1',
      cloud_id: 'L_12345',
      status: 'active',
    };
    const current = [currentDevice];
    const uploaded = [
      {
        ...currentDevice,
        mac_address: 'aa:bb:cc:00:00:99',
      },
    ];

    const diff = computeDiff(current, uploaded);

    assert.equal(diff.replaced.length, 1);
    assert.equal(diff.replaced[0].serial_no, 'Q3KG-AAAA-0001');
    assert.equal(diff.replaced[0].before.mac_address, 'aa:bb:cc:00:00:01');
    assert.equal(diff.replaced[0].after.mac_address, 'aa:bb:cc:00:00:99');
    assert.ok(diff.replaced[0].changed_fields.includes('mac_address'));
  });

  // ── T4. computeDiff identifies replaced — status change (active→stock) ───
  it('T4. computeDiff identifies replaced — status change (active→stock)', () => {
    const current = [
      {
        serial_no: 'FCW2302XXXX',
        hostname: 'SWITCH-CORE',
        mac_address: '11:22:33:44:55:66',
        model: 'C9300-48P',
        site_id: 'Bangalore',
        device_type: 'SW',
        rack_location: 'Rack-A',
        cloud_id: null,
        status: 'active',
      },
    ];
    const uploaded = [
      {
        serial_no: 'FCW2302XXXX',
        hostname: 'STOCK',
        mac_address: '11:22:33:44:55:66',
        model: 'C9300-48P',
        site_id: 'Bangalore',
        device_type: 'SW',
        rack_location: 'Rack-A',
        cloud_id: null,
        status: 'stock',
      },
    ];

    const diff = computeDiff(current, uploaded);

    assert.equal(diff.replaced.length, 1);
    assert.equal(diff.added.length, 0);
    assert.equal(diff.removed.length, 0);
    assert.ok(diff.replaced[0].changed_fields.includes('status'));
  });

  // ── T5. computeDiff identifies unchanged (identical row) ─────────────────
  it('T5. computeDiff identifies unchanged (identical row)', () => {
    const currentDevice = {
      serial_no: 'Q2CW-1111-2222',
      hostname: null,
      mac_address: '00:11:22:33:44:55',
      model: 'MS120-8FP',
      site_id: 'OKHLA',
      device_type: 'SW',
      rack_location: null,
      cloud_id: null,
      status: 'active',
    };
    const current = [currentDevice];
    const uploaded = [
      {
        ...currentDevice,
        serial_no: ' q2cw-1111-2222 ', // DC-2 normalization: whitespace + lowercase
      },
    ];

    const diff = computeDiff(current, uploaded);

    assert.equal(diff.unchanged.length, 1);
    assert.equal(diff.unchanged[0].serial_no, 'Q2CW-1111-2222');
    assert.equal(diff.added.length, 0);
    assert.equal(diff.removed.length, 0);
    assert.equal(diff.replaced.length, 0);
  });

  // ── T6. approveSync — real DB (file::memory:) ────────────────────────────
  it('T6. approveSync — real DB (file::memory:)', async () => {
    const db = await createFreshMemoryDb();
    const syncService = createInventorySyncService(db);

    // Seed 2 initial JFL devices
    await db.execute({
      sql: `INSERT INTO inventory_devices (client_id, serial_no, hostname, mac_address, model, site_id, device_type, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['jfl', 'SN-001', 'HOST-1', 'mac-1', 'MR86', 'Bangalore', 'AP', 'active'],
    });
    await db.execute({
      sql: `INSERT INTO inventory_devices (client_id, serial_no, hostname, mac_address, model, site_id, device_type, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['jfl', 'SN-002', 'HOST-2', 'mac-2', 'MS250', 'Bangalore', 'SW', 'active'],
    });

    const diff = {
      added: [
        {
          client_id: 'jfl',
          serial_no: 'SN-003',
          hostname: 'HOST-3',
          mac_address: 'mac-3',
          model: 'MR86',
          site_id: 'Bangalore',
          device_type: 'AP',
          status: 'active',
        },
      ],
      replaced: [
        {
          serial_no: 'SN-001',
          before: { serial_no: 'SN-001', hostname: 'HOST-1', status: 'active', mac_address: 'mac-1', model: 'MR86', site_id: 'Bangalore', device_type: 'AP' },
          after: { serial_no: 'SN-001', hostname: 'HOST-1-UPDATED', status: 'stock', mac_address: 'mac-1', model: 'MR86', site_id: 'Bangalore', device_type: 'AP' },
          changed_fields: ['hostname', 'status'],
        },
      ],
      removed: [
        {
          client_id: 'jfl',
          serial_no: 'SN-002',
          hostname: 'HOST-2',
          status: 'active',
        },
      ],
      unchanged: [],
    };

    const { syncId } = await syncService.createSyncPreview({
      clientId: 'jfl',
      triggeredBy: 'admin',
      fileName: 'jfl_update.xlsx',
      diff,
    });

    await syncService.approveSync(syncId);

    // Asserts:
    // 1. Devices in DB: 2 originals updated + 1 new added = 3 rows total in DB
    const devRows = (await db.execute("SELECT * FROM inventory_devices WHERE client_id = 'jfl' ORDER BY serial_no")).rows;
    assert.equal(devRows.length, 3);

    const sn001 = devRows.find((d) => d.serial_no === 'SN-001');
    assert.equal(sn001.status, 'stock');
    assert.equal(sn001.hostname, 'HOST-1-UPDATED');

    const sn002 = devRows.find((d) => d.serial_no === 'SN-002');
    assert.equal(sn002.status, 'removed'); // Soft delete per DC-4

    const sn003 = devRows.find((d) => d.serial_no === 'SN-003');
    assert.equal(sn003.status, 'active');

    // 2. Exactly 1 snapshot row for this sync_id
    const snapshots = (await db.execute({ sql: 'SELECT * FROM inventory_snapshots WHERE sync_id = ?', args: [syncId] })).rows;
    assert.equal(snapshots.length, 1);
    const snapData = JSON.parse(snapshots[0].snapshot_data);
    assert.ok(Array.isArray(snapData));
    assert.equal(snapData.length, 2); // Captured the 2 pre-mutation devices

    // 3. Exactly 3 inventory_history rows
    const history = (await db.execute({ sql: 'SELECT * FROM inventory_history WHERE sync_id = ? ORDER BY id', args: [syncId] })).rows;
    assert.equal(history.length, 3);
    const changeTypes = history.map((h) => h.change_type).sort();
    assert.deepEqual(changeTypes, ['added', 'removed', 'replaced']);

    // 4. inventory_syncs.status is approved
    const syncRow = (await db.execute({ sql: 'SELECT * FROM inventory_syncs WHERE id = ?', args: [syncId] })).rows[0];
    assert.equal(syncRow.status, 'approved');
  });

  // ── T7. rollbackToSnapshot — real DB (file::memory:) ─────────────────────
  it('T7. rollbackToSnapshot — real DB (file::memory:)', async () => {
    const db = await createFreshMemoryDb();
    const syncService = createInventorySyncService(db);

    // Initial state: 2 devices with fixed timestamps
    await db.execute({
      sql: `INSERT INTO inventory_devices (client_id, serial_no, hostname, status, first_seen_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: ['jfl', 'SN-R1', 'HOST-R1', 'active', '2026-01-01 10:00:00'],
    });
    await db.execute({
      sql: `INSERT INTO inventory_devices (client_id, serial_no, hostname, status, first_seen_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: ['jfl', 'SN-R2', 'HOST-R2', 'active', '2026-01-01 10:00:00'],
    });

    const diff = {
      added: [{ client_id: 'jfl', serial_no: 'SN-R3', hostname: 'HOST-R3', status: 'active' }],
      replaced: [{ serial_no: 'SN-R1', before: { serial_no: 'SN-R1', hostname: 'HOST-R1', status: 'active' }, after: { serial_no: 'SN-R1', hostname: 'HOST-R1-MOD', status: 'active' }, changed_fields: ['hostname'] }],
      removed: [{ client_id: 'jfl', serial_no: 'SN-R2', hostname: 'HOST-R2', status: 'active' }],
      unchanged: [],
    };

    const { syncId } = await syncService.createSyncPreview({
      clientId: 'jfl',
      triggeredBy: 'admin',
      fileName: 'test.xlsx',
      diff,
    });
    await syncService.approveSync(syncId);

    const snapshotRow = (await db.execute({ sql: 'SELECT * FROM inventory_snapshots WHERE sync_id = ?', args: [syncId] })).rows[0];
    const snapshotId = snapshotRow.id;

    // Mutate state further to simulate drift
    await db.execute({
      sql: `INSERT INTO inventory_devices (client_id, serial_no, hostname, status)
            VALUES (?, ?, ?, ?)`,
      args: ['jfl', 'SN-DRIFT', 'HOST-DRIFT', 'active'],
    });

    // Rollback
    await syncService.rollbackToSnapshot(snapshotId);

    const restored = (await db.execute("SELECT * FROM inventory_devices WHERE client_id = 'jfl' ORDER BY serial_no")).rows;
    assert.equal(restored.length, 2); // Matches pre-sync snapshot count
    assert.equal(restored.find((d) => d.serial_no === 'SN-R1').hostname, 'HOST-R1');
    assert.equal(restored.find((d) => d.serial_no === 'SN-R2').status, 'active'); // Restored from 'removed'
    assert.equal(restored.find((d) => d.serial_no === 'SN-R1').first_seen_at, '2026-01-01 10:00:00');
    assert.equal(restored.find((d) => d.serial_no === 'SN-DRIFT'), undefined);
  });

  // ── T8. Multi-tenant isolation ───────────────────────────────────────────
  it('T8. Multi-tenant isolation', async () => {
    const db = await createFreshMemoryDb();
    const syncService = createInventorySyncService(db);

    // Seed 2 JFL + 1 MMTC devices
    await db.execute({
      sql: `INSERT INTO inventory_devices (client_id, serial_no, hostname, status) VALUES (?, ?, ?, ?)`,
      args: ['jfl', 'JFL-SN-1', 'JFL-HOST-1', 'active'],
    });
    await db.execute({
      sql: `INSERT INTO inventory_devices (client_id, serial_no, hostname, status) VALUES (?, ?, ?, ?)`,
      args: ['jfl', 'JFL-SN-2', 'JFL-HOST-2', 'active'],
    });
    await db.execute({
      sql: `INSERT INTO inventory_devices (client_id, serial_no, hostname, status) VALUES (?, ?, ?, ?)`,
      args: ['mmtc', 'MMTC-SN-1', 'MMTC-HOST-1', 'active'],
    });

    // Approve a JFL sync removing JFL-SN-2
    const diff = {
      added: [],
      replaced: [],
      removed: [{ client_id: 'jfl', serial_no: 'JFL-SN-2', hostname: 'JFL-HOST-2', status: 'active' }],
      unchanged: [{ client_id: 'jfl', serial_no: 'JFL-SN-1', hostname: 'JFL-HOST-1', status: 'active' }],
    };

    const { syncId } = await syncService.createSyncPreview({
      clientId: 'jfl',
      triggeredBy: 'admin',
      fileName: 'jfl_remove.xlsx',
      diff,
    });
    await syncService.approveSync(syncId);

    // Asserts:
    const jflActive = await syncService.loadCurrentInventory('jfl');
    assert.equal(jflActive.length, 1);
    assert.equal(jflActive[0].serial_no, 'JFL-SN-1');

    const mmtcActive = await syncService.loadCurrentInventory('mmtc');
    assert.equal(mmtcActive.length, 1);
    assert.equal(mmtcActive[0].serial_no, 'MMTC-SN-1');
    assert.equal(mmtcActive[0].status, 'active');
  });

  // ── T9. computeDiff throws on empty or duplicate serial numbers (DC-3) ───
  it('T9. computeDiff throws on empty or duplicate serial numbers (DC-3)', () => {
    // a) Empty serial throws
    const current = [];
    const uploadedEmpty = [
      {
        serial_no: '   ',
        hostname: 'AP-01',
        mac_address: 'aa:bb:cc:00:00:01',
        model: 'MR86',
        site_id: 'Guwahati',
        device_type: 'AP',
        rack_location: 'NA',
        cloud_id: null,
        status: 'active',
      },
    ];
    assert.throws(
      () => computeDiff(current, uploadedEmpty),
      /empty|missing|serial/i
    );

    // b) Duplicate serial throws (case + whitespace variants)
    const uploadedDup = [
      {
        serial_no: 'DUP-001',
        hostname: 'AP-01',
        mac_address: 'aa:bb:cc:00:00:01',
        model: 'MR86',
        site_id: 'Guwahati',
        device_type: 'AP',
        rack_location: 'NA',
        cloud_id: null,
        status: 'active',
      },
      {
        serial_no: ' dup-001 ',
        hostname: 'AP-02',
        mac_address: 'aa:bb:cc:00:00:02',
        model: 'MR86',
        site_id: 'Guwahati',
        device_type: 'AP',
        rack_location: 'NA',
        cloud_id: null,
        status: 'active',
      },
    ];
    assert.throws(
      () => computeDiff(current, uploadedDup),
      /duplicate/i
    );
  });

  // ── T10. buildDashboardFromDb recompute + analytical preservation ──────────
  it('T10. buildDashboardFromDb recompute + analytical preservation', () => {
    const { buildDashboardFromDb } = require('../services/inventorySyncService');
    const base = {
      customerName: 'Jubilant Foodworks Ltd (JFL)',
      reportingPeriod: 'User Selected Period',
      report_period: { window_minutes: 44640 },
      executiveSummary: {
        totalDevices: 372,
        totalStockDevices: 72,
        totalSwitches: 142,
        totalAPs: 224,
        totalSites: 8,
        overallUptime: 99.85,
        healthScore: 92,
        healthLabel: 'Excellent',
        slaCompliance: 99.8,
        slaTarget: 99.5,
        totalIncidents: 47,
        criticalIncidents: 2,
        majorIncidents: 8,
        minorIncidents: 37,
      },
      devices: [
        { SerialNo: 'R1', DeviceType: 'AP', status: 'active', Location: 'Bangalore' },
      ],
      incidents: [],
    };

    const dbDevices = [];
    for (let i = 0; i < 380; i++) {
      dbDevices.push({
        serial_no: `SW-${i}`,
        device_type: 'SW',
        status: 'active',
        site_id: 'Bangalore',
        hostname: `sw-${i}`,
        model: 'MS250',
        rack_location: 'R1',
      });
    }
    for (let i = 0; i < 70; i++) {
      dbDevices.push({
        serial_no: `AP-${i}`,
        device_type: 'AP',
        status: 'stock',
        site_id: 'Bangalore',
        hostname: `ap-${i}`,
        model: 'MR86',
        rack_location: 'STOCK',
      });
    }
    dbDevices.push({
      serial_no: 'R1',
      device_type: 'AP',
      status: 'removed',
      site_id: 'Bangalore',
      hostname: 'ap-r1',
      model: 'MR86',
      rack_location: 'NA',
    });

    const out = buildDashboardFromDb('jfl', base, dbDevices);
    const exec = out.executiveSummary;

    assert.equal(exec.totalDevices, 380);
    assert.equal(exec.totalStockDevices, 70);
    assert.equal(exec.totalSwitches, 380);
    assert.equal(exec.totalAPs, 0);
    assert.equal(exec.totalSites, 1);
    assert.equal(exec.overallUptime, 99.85);
    assert.equal(exec.healthScore, 92);
    assert.equal(exec.slaCompliance, 99.8);
    assert.equal(exec.totalIncidents, 47);
    assert.match(out.__inventoryMeta.execSummaryNote, /Topology counts refreshed/);
    assert.equal(out.devices.find((d) => d.SerialNo === 'R1'), undefined);
  });

  // ── T11. per-device analytical preservation post-merge ───────────────────
  it('T11. per-device analytical preservation post-merge', () => {
    const { buildDashboardFromDb } = require('../services/inventorySyncService');
    const base = {
      customerName: 'Jubilant Foodworks Ltd (JFL)',
      reportingPeriod: 'User Selected Period',
      report_period: { window_minutes: 44640 },
      executiveSummary: {},
      devices: [
        {
          SerialNo: 'ABC123',
          Hostname: 'old-host',
          Rack: 'R1',
          Location: 'Bangalore',
          SiteID: 'Bangalore',
          DeviceType: 'SW',
          __effectiveUptime: 99.9,
          __monthlyUptime: 99.5,
          __slaTarget: 99.0,
          __isStock: false,
        },
      ],
      incidents: [],
    };
    const dbDevices = [
      {
        serial_no: 'ABC123',
        hostname: 'new-host',
        rack_location: 'R2',
        site_id: 'Bangalore',
        device_type: 'SW',
        status: 'active',
      },
    ];

    const out = buildDashboardFromDb('jfl', base, dbDevices);
    const merged = out.devices.find((d) => d.SerialNo === 'ABC123');
    assert.ok(merged);
    assert.equal(merged.Hostname, 'new-host');
    assert.equal(merged.Rack, 'R2');
    assert.equal(merged.__effectiveUptime, 99.9);
    assert.equal(merged.__monthlyUptime, 99.5);
    assert.equal(merged.__slaTarget, 99.0);
  });

  // ── T12. regen path contract + no-base behavior ──────────────────────────
  it('T12. regen path contract + no-base behavior', async () => {
    const { regenerateDashboardFileForClient } = require('../services/inventorySyncService');
    const writes = [];
    const validBase = {
      customerName: 'Jubilant Foodworks Ltd (JFL)',
      reportingPeriod: 'User Selected Period',
      report_period: { window_minutes: 44640 },
      executiveSummary: {},
      devices: [],
      incidents: [],
    };
    const deps = {
      resolveBase: async () => validBase,
      loadDb: async () => [],
      writeFile: async (filePath) => {
        writes.push(filePath);
      },
      canonicalPath: 'data/dashboard_data.json',
    };

    const ok = await regenerateDashboardFileForClient('jfl', deps);
    assert.deepEqual(writes, ['data/dashboard_data.json']);
    assert.equal(ok.skipped, false);

    const noBase = await regenerateDashboardFileForClient('jfl', {
      ...deps,
      resolveBase: async () => null,
    });
    assert.deepEqual(noBase, { skipped: true, reason: 'no-base' });
    assert.equal(writes.length, 1);
  });

  // ── T13. new DB devices use null analytics, not fabricated 100% ──────────
  it('T13. new DB devices use null analytics, not fabricated 100%', () => {
    const { buildDashboardFromDb } = require('../services/inventorySyncService');
    const base = {
      customerName: 'Jubilant Foodworks Ltd (JFL)',
      reportingPeriod: 'User Selected Period',
      report_period: { window_minutes: 44640 },
      executiveSummary: {},
      devices: [],
      incidents: [],
    };
    const dbDevices = [
      {
        serial_no: 'NEW-001',
        device_type: 'SW',
        status: 'active',
        site_id: 'Bangalore',
        hostname: 'new-sw-001',
        model: 'MS250',
        rack_location: 'R1',
      },
    ];
    const out = buildDashboardFromDb('jfl', base, dbDevices);
    const nd = out.devices.find((d) => d.SerialNo === 'NEW-001');
    assert.equal(nd.__effectiveUptime, null);
    assert.equal(nd.__jflUptime, null);
    assert.equal(nd.__proactiveUptime, null);
    assert.equal(nd.__monthlyUptime, null);
    assert.equal(nd.__quarterlyUptime, null);
    assert.equal(nd.__slaTarget, null);
    assert.equal(nd['JFL Uptime %'], null);
    assert.equal(nd['Proactive Uptime %'], null);
    assert.equal(nd.__debugUptimeSource, 'no-analytics');
  });

  // ── T14. approveSync returns clientId from sync row ──────────────────────
  it('T14. approveSync returns clientId from sync row', async () => {
    const db = await createFreshMemoryDb();
    const syncService = createInventorySyncService(db);
    const { syncId } = await syncService.createSyncPreview({
      clientId: 'jfl',
      triggeredBy: 'admin',
      fileName: 'jfl_update.xlsx',
      diff: { added: [], removed: [], replaced: [], unchanged: [] },
    });
    const result = await syncService.approveSync(syncId);
    assert.equal(result.clientId, 'jfl');
  });

  // ── T15. regenerateDashboardFileForClient maps canonical client-mmtcpamp to mmtc for loadDb ──
  it('T15. regenerateDashboardFileForClient maps canonical client-mmtcpamp to mmtc for loadDb', async () => {
    const { regenerateDashboardFileForClient } = require('../services/inventorySyncService');
    let loadedClient = null;
    const deps = {
      resolveBase: async () => ({
        customerName: 'MMTC-PAMP India Pvt. Ltd.',
        reportingPeriod: 'User Selected Period',
        report_period: { window_minutes: 44640 },
        executiveSummary: {},
        devices: [],
        incidents: [],
      }),
      loadDb: async (clientArg) => {
        loadedClient = clientArg;
        return [];
      },
      writeFile: async () => {},
      canonicalPath: 'data/dashboard_data.json',
    };
    const res = await regenerateDashboardFileForClient('client-mmtcpamp', deps);
    assert.equal(res.skipped, false);
    assert.equal(loadedClient, 'mmtc');
  });

  // ── T16. regenerateDashboardFileForClient throws on non-canonical/non-short clientId ──
  it('T16. regenerateDashboardFileForClient throws on invalid clientId', async () => {
    const { regenerateDashboardFileForClient } = require('../services/inventorySyncService');
    await assert.rejects(
      () => regenerateDashboardFileForClient('invalid-client'),
      /clientId must be short or canonical form/
    );
  });
});


