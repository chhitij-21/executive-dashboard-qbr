// scripts/cleanup-turso-ci.js
// Drops ephemeral test tables created during Turso CI test runs to respect 1GB quota.

'use strict';

const database = require('../backend/config/database');

async function cleanupTurso() {
  if (!process.env.TURSO_DATABASE_URL || !process.env.TEST_USE_TURSO) {
    console.log('[cleanup-turso] Skipping Turso cleanup (not in Turso test mode).');
    return;
  }

  console.log('[cleanup-turso] Dropping test tables from remote Turso database...');
  try {
    const prefix = process.env.TURSO_TABLE_PREFIX || '';
    const res = await database.execute("SELECT name FROM sqlite_master WHERE type='table'");
    const tables = res.rows.map((r) => r.name);

    for (const table of tables) {
      if (prefix && table.startsWith(prefix)) {
        await database.execute(`DROP TABLE IF EXISTS "${table}"`);
        console.log(`Dropped ${table}`);
      }
    }
    console.log('✓ Turso CI cleanup complete.');
  } catch (err) {
    console.warn('[cleanup-turso] Warning during Turso cleanup:', err.message);
  }
}

cleanupTurso().then(() => process.exit(0)).catch(() => process.exit(0));
