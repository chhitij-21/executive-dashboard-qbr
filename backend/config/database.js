// backend/config/database.js
// Enterprise Turso & Embedded SQLite Database Client (Item #3)
// Supports cloud Turso (libsql://) in production and zero-dependency embedded SQLite (file:) in local/test.

const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from root .env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const { createClient } = require('@libsql/client');

let _client = null;
let _currentUrl = null;

/**
 * Resolves the database connection URL based on environment.
 * If TURSO_DATABASE_URL is set, uses it.
 * Otherwise, falls back to embedded SQLite file.
 */
function getDatabaseUrl() {
  if (process.env.TURSO_DATABASE_URL && process.env.TURSO_DATABASE_URL.trim()) {
    const url = process.env.TURSO_DATABASE_URL.trim();
    if (process.env.NODE_ENV !== 'test' || url.startsWith('file:') || process.env.TEST_USE_TURSO) {
      return url;
    }
  }

  if (process.env.NODE_ENV === 'test') {
    if (process.env.TEST_DB_PATH) {
      return `file:${path.resolve(process.env.TEST_DB_PATH).replace(/\\/g, '/')}`;
    }
    const workerDbFile = path.resolve(__dirname, `../../data/test-${process.pid}.db`);
    return `file:${workerDbFile.replace(/\\/g, '/')}`;
  }

  const defaultDbFile = path.resolve(__dirname, '../../data/app.db');
  return `file:${defaultDbFile.replace(/\\/g, '/')}`;
}

/**
 * Asserts that the database connection configuration is valid.
 * In production without TURSO_DATABASE_URL, warns or falls back safely.
 */
function assertConfigured() {
  const url = getDatabaseUrl();
  if (process.env.NODE_ENV === 'production' && !process.env.TURSO_DATABASE_URL) {
    console.warn('[database] WARNING: Running in production without TURSO_DATABASE_URL. Falling back to local embedded SQLite file.');
  }
  return url;
}

/**
 * Lazy getter for the LibSQL client instance.
 * Automatically enforces foreign key constraints (PRAGMA foreign_keys = ON;).
 * @returns {import('@libsql/client').Client}
 */
function getClient() {
  const targetUrl = getDatabaseUrl();
  if (!_client || _currentUrl !== targetUrl) {
    if (_client) {
      try { _client.close(); } catch (_) {}
    }
    _currentUrl = targetUrl;
    _client = createClient({
      url: targetUrl,
      authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    });

    // Enforce foreign key constraints in SQLite/LibSQL
    _client.execute('PRAGMA foreign_keys = ON;').catch((err) => {
      // In cloud Turso or environments without PRAGMA support, log debug only
      if (!err.message?.includes('not supported')) {
        console.warn('[database] Note on PRAGMA foreign_keys:', err.message);
      }
    });
  }
  return _client;
}

/**
 * Reset client (used in tests when changing DB URLs)
 */
function resetClient() {
  if (_client) {
    try { _client.close(); } catch (_) {}
    _client = null;
    _currentUrl = null;
  }
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
 * Execute a SQL query with parameters against the database.
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
 * Execute a batch of SQL statements in a single transaction against the database.
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
 * Check health and connectivity to the database.
 * @returns {Promise<{healthy: boolean, timestamp: string, rows?: number, error?: string, url?: string}>}
 */
async function healthCheck() {
  try {
    assertConfigured();
    const res = await execute('SELECT 1 as healthy');
    return {
      healthy: true,
      timestamp: new Date().toISOString(),
      rows: res.rows?.length || 0,
      url: _currentUrl,
    };
  } catch (error) {
    return {
      healthy: false,
      timestamp: new Date().toISOString(),
      error: error.message,
      url: _currentUrl,
    };
  }
}

module.exports = {
  db,
  getClient,
  resetClient,
  assertConfigured,
  getDatabaseUrl,
  execute,
  batch,
  healthCheck,
};
