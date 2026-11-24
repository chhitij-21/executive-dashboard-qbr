// backend/tests/_setup.js
// Worker-Scoped Test Isolation Harness (Item #16)
// Provides per-process isolated SQLite database, temp tenant directories,
// in-memory state resets, and strictly synchronous exit cleanup.

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

// Force test environment
process.env.NODE_ENV = 'test';

// Always ensure worker paths match current process.pid unless explicitly testing a custom fixed path
const defaultWorkerDb = path.resolve(__dirname, `../../data/test-${process.pid}.db`);
if (!process.env.TEST_DB_PATH || (process.env.TEST_DB_PATH.includes('test-') && !process.env.TEST_DB_PATH.includes(`test-${process.pid}.db`))) {
  process.env.TEST_DB_PATH = defaultWorkerDb;
}

const defaultTenantRoot = path.join(os.tmpdir(), `test-tenants-${process.pid}`);
if (!process.env.TENANT_DATA_ROOT || (process.env.TENANT_DATA_ROOT.includes('test-tenants-') && !process.env.TENANT_DATA_ROOT.includes(`test-tenants-${process.pid}`))) {
  process.env.TENANT_DATA_ROOT = defaultTenantRoot;
}

const defaultVulnPath = path.join(os.tmpdir(), `vuln-${process.pid}.json`);
if (!process.env.VULN_DATA_PATH || (process.env.VULN_DATA_PATH.includes('vuln-') && !process.env.VULN_DATA_PATH.includes(`vuln-${process.pid}.json`))) {
  process.env.VULN_DATA_PATH = defaultVulnPath;
}

const defaultAuditDir = path.join(os.tmpdir(), `test-audit-${process.pid}`);
if (!process.env.AUDIT_LOG_DIR || (process.env.AUDIT_LOG_DIR.includes('test-audit-') && !process.env.AUDIT_LOG_DIR.includes(`test-audit-${process.pid}`))) {
  process.env.AUDIT_LOG_DIR = defaultAuditDir;
}

const defaultUsersPath = path.join(os.tmpdir(), `test-users-${process.pid}.json`);
if (!process.env.USERS_DATA_PATH || (process.env.USERS_DATA_PATH.includes('test-users-') && !process.env.USERS_DATA_PATH.includes(`test-users-${process.pid}.json`))) {
  process.env.USERS_DATA_PATH = defaultUsersPath;
}

let _initialized = false;
let _cleanedUp = false;

/**
 * Synchronous cleanup executed on process termination.
 * Must NEVER use async/await or promises because Node ignores them inside 'exit'.
 */
function cleanupSynchronous() {
  if (_cleanedUp) return;
  _cleanedUp = true;

  try {
    const { resetClient } = require('../config/database');
    resetClient();
  } catch (_) {}

  try {
    const dbPath = process.env.TEST_DB_PATH;
    if (dbPath) {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`);
      if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`);
    }
  } catch (_) {}

  try {
    const tenantDir = process.env.TENANT_DATA_ROOT;
    if (tenantDir && fs.existsSync(tenantDir)) {
      fs.rmSync(tenantDir, { recursive: true, force: true });
    }
  } catch (_) {}

  try {
    const vulnPath = process.env.VULN_DATA_PATH;
    if (vulnPath && fs.existsSync(vulnPath)) {
      fs.unlinkSync(vulnPath);
    }
  } catch (_) {}

  try {
    const auditDir = process.env.AUDIT_LOG_DIR;
    if (auditDir && fs.existsSync(auditDir)) {
      fs.rmSync(auditDir, { recursive: true, force: true });
    }
  } catch (_) {}

  try {
    const usersPath = process.env.USERS_DATA_PATH;
    if (usersPath && fs.existsSync(usersPath)) {
      fs.unlinkSync(usersPath);
    }
  } catch (_) {}
}

// Register synchronous exit and signal hooks
process.on('exit', cleanupSynchronous);
process.on('SIGINT', () => {
  cleanupSynchronous();
  process.exit(130);
});
process.on('SIGTERM', () => {
  cleanupSynchronous();
  process.exit(143);
});

/**
 * Initialize test environment for the current worker.
 * Ensures directories exist and migrates schema into the worker's isolated DB.
 */
async function setupTestEnvironment() {
  if (_initialized) return;
  _initialized = true;

  const dataDir = path.resolve(__dirname, '../../data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const tenantDir = process.env.TENANT_DATA_ROOT;
  if (tenantDir && !fs.existsSync(tenantDir)) {
    fs.mkdirSync(tenantDir, { recursive: true });
  }

  // Seed isolated worker vulnerability cache from repo seed data if present
  const vulnPath = process.env.VULN_DATA_PATH;
  const seedVuln = path.resolve(__dirname, '../../data/vulnerabilities.json');
  if (vulnPath && !fs.existsSync(vulnPath) && fs.existsSync(seedVuln)) {
    try {
      fs.copyFileSync(seedVuln, vulnPath);
    } catch (_) {}
  }

  // Auto-migrate the worker's database
  try {
    const { migrate } = require('../db/migrate');
    await migrate();
  } catch (err) {
    if (!err.message?.includes('already exists')) {
      console.warn(`[test-setup] Worker ${process.pid} migration notice:`, err.message);
    }
  }
}

/**
 * Tear down worker artifacts (can be called manually in test.after).
 */
async function cleanupTestEnvironment() {
  cleanupSynchronous();
}

/**
 * Reset all in-memory caches and state across jobs, schedulers, and rate limiters.
 */
function resetAllState() {
  try {
    const jobCache = require('../services/jobCache');
    if (typeof jobCache.resetJobCache === 'function') {
      jobCache.resetJobCache();
    }
  } catch (_) {}

  try {
    const schedulerService = require('../services/schedulerService');
    if (typeof schedulerService.resetSchedulerState === 'function') {
      schedulerService.resetSchedulerState();
    }
  } catch (_) {}

  try {
    const authService = require('../services/authService');
    if (typeof authService.resetRateLimits === 'function') {
      authService.resetRateLimits();
    }
  } catch (_) {}

  try {
    const app = require('../index');
    if (typeof app.resetRateLimits === 'function') {
      app.resetRateLimits();
    }
  } catch (_) {}
}

module.exports = {
  setupTestEnvironment,
  cleanupTestEnvironment,
  cleanupSynchronous,
  resetAllState,
};
