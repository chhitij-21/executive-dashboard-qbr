// backend/tests/migrationScript.test.js
// Automated test suite for Phase G.5 Migration Script (TDD)

process.env.NODE_ENV = 'test';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  mapDashboardDeviceToDbRow,
  computeMigrationStats,
  EXPECTED_STATS,
} = require('../scripts/migrate-existing-inventories');

describe('Phase G.5 Migration Script Suite (T17–T20)', () => {
  // ── T17. mapDashboardDeviceToDbRow — JFL stock device ───────────────────
  it('T17. mapDashboardDeviceToDbRow — JFL stock device', () => {
    const input = {
      SerialNo: 'ABC123',
      Hostname: 'jfl-ap-01',
      Location: 'Bangalore',
      Rack: 'R1',
      Model: 'MR86',
      DeviceType: 'AP',
      MAC: 'aa:bb:cc:dd:ee:ff',
      __isStock: true,
    };
    const row = mapDashboardDeviceToDbRow(input, 'jfl');
    assert.equal(row.serial_no, 'ABC123');
    assert.equal(row.hostname, 'jfl-ap-01');
    assert.equal(row.site_id, 'Bangalore');
    assert.equal(row.rack_location, 'R1');
    assert.equal(row.model, 'MR86');
    assert.equal(row.device_type, 'AP');
    assert.equal(row.mac_address, 'aa:bb:cc:dd:ee:ff');
    assert.equal(row.status, 'stock');
    assert.equal(row.client_id, 'jfl');
  });

  // ── T18. mapDashboardDeviceToDbRow — status priority ─────────────────────
  it('T18. mapDashboardDeviceToDbRow — status priority', () => {
    // Input A: device.status wins
    const inputA = {
      SerialNo: 'X1',
      Location: 'Bangalore',
      status: 'faulty',
      __isStock: false,
    };
    const rowA = mapDashboardDeviceToDbRow(inputA, 'jfl');
    assert.equal(rowA.status, 'faulty');

    // Input B: device.status wins over __isStock
    const inputB = {
      SerialNo: 'X2',
      Location: 'Bangalore',
      status: 'active',
      __isStock: true,
    };
    const rowB = mapDashboardDeviceToDbRow(inputB, 'jfl');
    assert.equal(rowB.status, 'active');

    // Input C: fallback to active when no status and not stock
    const inputC = {
      SerialNo: 'X3',
      Location: 'Bangalore',
      __isStock: false,
    };
    const rowC = mapDashboardDeviceToDbRow(inputC, 'jfl');
    assert.equal(rowC.status, 'active');
  });

  // ── T19. mapDashboardDeviceToDbRow — MMTC site preserved verbatim ────────
  it('T19. mapDashboardDeviceToDbRow — MMTC site preserved verbatim', () => {
    const input = {
      SerialNo: 'Q2XX-YYYY-ZZZZ',
      Location: 'Gurgaon Plant',
      Hostname: 'mmtc-sw-01',
      Model: 'MS120',
      DeviceType: 'SW',
      __isStock: false,
    };
    const row = mapDashboardDeviceToDbRow(input, 'mmtc');
    assert.equal(row.site_id, 'Gurgaon Plant');
    assert.equal(row.client_id, 'mmtc');
  });

  // ── T20. computeMigrationStats — mixed set ───────────────────────────────
  it('T20. computeMigrationStats — mixed set', () => {
    const input = [
      { status: 'active', site_id: 'Bangalore' },
      { status: 'active', site_id: 'Bangalore' },
      { status: 'stock', site_id: 'Bangalore' },
      { status: 'active', site_id: 'Mumbai-DC' },
      { status: 'faulty', site_id: 'Mumbai-DC' },
    ];
    const stats = computeMigrationStats(input);
    assert.equal(stats.total, 5);
    assert.equal(stats.active, 3);
    assert.equal(stats.stock, 1);
    assert.equal(stats.faulty, 1);
    assert.equal(stats.sites, 2);
    assert.equal(stats.byStatus.active, 3);
    assert.equal(stats.byStatus.stock, 1);
    assert.equal(stats.byStatus.faulty, 1);
  });
});
