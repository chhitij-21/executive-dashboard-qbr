// backend/config/database.js
// Enterprise Turso Database Client (Phase G)

const path = require('path');
const dotenv = require('dotenv');

// Load environment variables strictly from root .env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const { createClient } = require('@libsql/client');

let _client = null;

/**
 * Asserts that the Turso database URL is configured.
 * Throws a fatal error if missing.
 */
function assertConfigured() {
  if (!process.env.TURSO_DATABASE_URL) {
    throw new Error('[FATAL] Missing TURSO_DATABASE_URL environment variable. Turso connection is strictly required.');
  }
}

/**
 * Lazy getter for the LibSQL client instance.
 * @returns {import('@libsql/client').Client}
 */
function getClient() {
  assertConfigured();
  if (!_client) {
    _client = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return _client;
}

/**
 * Transparent proxy for the database client, allowing lazy instantiation on first use.
 */
const db = new Proxy({}, {
  get(target, prop) {
    const client = getClient();
    const val = client[prop];
    return typeof val === 'function' ? val.bind(client) : val;
  }
});

/**
 * Execute a SQL query with parameters against the Turso database.
 * @param {string|object} query SQL query string or statement object
 * @param {Array} params Parameter array for SQL placeholders
 * @returns {Promise<object>} Query result set
 */
async function execute(query, params = []) {
  assertConfigured();
  const client = getClient();
  if (typeof query === 'string') {
    return await client.execute({ sql: query, args: params });
  }
  return await client.execute(query);
}

/**
 * Execute a batch of SQL statements in a single transaction against the Turso database.
 * @param {Array<string|object>} statements Array of SQL queries or statement objects
 * @param {string} [mode='deferred'] Transaction mode ('deferred' | 'immediate' | 'exclusive')
 * @returns {Promise<Array<object>>} Batch query result set
 */
async function batch(statements, mode = 'deferred') {
  if (module.exports.execute !== execute) {
    const results = [];
    for (const stmt of statements) {
      const sql = typeof stmt === 'string' ? stmt : stmt.sql;
      const args = typeof stmt === 'string' ? [] : (stmt.args || []);
      results.push(await module.exports.execute(sql, args));
    }
    return results;
  }
  assertConfigured();
  const client = getClient();
  return await client.batch(statements, mode);
}

/**
 * Check health and connectivity to the Turso database.
 * @returns {Promise<{healthy: boolean, timestamp: string, rows?: number, error?: string}>}
 */
async function healthCheck() {
  try {
    assertConfigured();
    const res = await execute('SELECT 1 as healthy');
    return {
      healthy: true,
      timestamp: new Date().toISOString(),
      rows: res.rows?.length || 0,
    };
  } catch (error) {
    return {
      healthy: false,
      timestamp: new Date().toISOString(),
      error: error.message,
    };
  }
}

module.exports = {
  db,
  getClient,
  assertConfigured,
  execute,
  batch,
  healthCheck,
};
