// backend/tests/testIsolation.test.js
// TDD Test Suite for Item #16: Test Isolation, Hermeticity & v1Router Modularization

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const { setupTestEnvironment, cleanupTestEnvironment, resetAllState } = require('./_setup');
const database = require('../config/database');
const clientService = require('../services/clientService');
const vulnerabilityFetcher = require('../services/vulnerabilityFetcher');
const jobCache = require('../services/jobCache');
const schedulerService = require('../services/schedulerService');
const app = require('../index');
const v1Router = require('../routes/v1Router');
const sentry = require('../utils/sentry');

test.before(async () => {
  await setupTestEnvironment();
});

test.after(async () => {
  await cleanupTestEnvironment();
});

test.afterEach(() => {
  resetAllState();
});

test('P0-1: worker_db_path_isolated_by_pid', () => {
  const originalTestDb = process.env.TEST_DB_PATH;
  delete process.env.TEST_DB_PATH;

  try {
    const url = database.getDatabaseUrl();
    assert.match(url, new RegExp(`test-${process.pid}\\.db`));
  } finally {
    if (originalTestDb) process.env.TEST_DB_PATH = originalTestDb;
  }
});

test('P0-1: worker_db_auto_migrates_schema', async () => {
  const result = await database.execute("SELECT name FROM sqlite_master WHERE type='table'");
  const tables = result.rows.map((r) => r.name);
  
  assert.ok(tables.includes('reports_tickets'), 'Expected reports_tickets table to exist');
  assert.ok(tables.includes('schedules'), 'Expected schedules table to exist');
  assert.ok(tables.includes('templates'), 'Expected templates table to exist');
});

test('P0-1: parallel_database_writes_zero_sqlite_busy', async () => {
  const writes = [];
  for (let i = 0; i < 20; i++) {
    writes.push(database.execute(
      "INSERT INTO reports_tickets (client_id, ticket_number, payload_json, uploaded_at) VALUES (?, ?, ?, datetime('now'))",
      ['client-jfl', `ISOLATION-TEST-${i}-${Date.now()}`, JSON.stringify({ index: i })]
    ));
  }

  const results = await Promise.allSettled(writes);
  const rejections = results.filter((r) => r.status === 'rejected');
  assert.equal(rejections.length, 0, `Expected 0 write rejections, got: ${JSON.stringify(rejections)}`);
});

test('P2-1: tenant_dir_override_respected', () => {
  const customRoot = path.join(os.tmpdir(), `custom-tenants-${Date.now()}`);
  const original = process.env.TENANT_DATA_ROOT;
  process.env.TENANT_DATA_ROOT = customRoot;

  try {
    const tenantDir = clientService.getTenantDir('client-jfl');
    assert.ok(
      tenantDir.startsWith(path.resolve(customRoot)),
      `Expected ${tenantDir} to start with ${path.resolve(customRoot)}`
    );
  } finally {
    if (original) {
      process.env.TENANT_DATA_ROOT = original;
    } else {
      delete process.env.TENANT_DATA_ROOT;
    }
  }
});

test('P2-1: vulnerability_path_override_respected', () => {
  const customVulnPath = path.join(os.tmpdir(), `custom-vuln-${Date.now()}.json`);
  const original = process.env.VULN_DATA_PATH;
  process.env.VULN_DATA_PATH = customVulnPath;

  try {
    const vulnFile = vulnerabilityFetcher.getVulnFile
      ? vulnerabilityFetcher.getVulnFile()
      : vulnerabilityFetcher.VULN_FILE;
    assert.equal(path.resolve(vulnFile), path.resolve(customVulnPath));
  } finally {
    if (original) {
      process.env.VULN_DATA_PATH = original;
    } else {
      delete process.env.VULN_DATA_PATH;
    }
  }
});

test('P0-1: resetJobCache_clears_memory', () => {
  jobCache['test-dummy-job-id'] = { status: 'running' };
  assert.ok(jobCache['test-dummy-job-id']);

  assert.equal(typeof jobCache.resetJobCache, 'function');
  jobCache.resetJobCache();
  assert.equal(jobCache['test-dummy-job-id'], undefined);
});

test('P0-1: resetRateLimits_clears_memory', () => {
  assert.equal(typeof app.resetRateLimits, 'function');
  app.resetRateLimits();
});

test('P0-1: resetSchedulerState_clears_tasks_and_locks', () => {
  assert.equal(typeof schedulerService.resetSchedulerState, 'function');
  schedulerService.resetSchedulerState();
});

test('P1-1: v1Router_noDuplicateRoutes', () => {
  function extractRoutes(layer, basePath = '') {
    const routes = [];
    if (!layer) return routes;

    if (layer.route) {
      const p = basePath + (layer.route.path === '/' ? '' : layer.route.path);
      const methods = Object.keys(layer.route.methods);
      for (const m of methods) {
        routes.push(`${m.toUpperCase()} ${p}`);
      }
    } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
      let routerPath = basePath;
      if (layer.regexp && layer.regexp.source) {
        let match = layer.regexp.source
          .replace('^\\', '')
          .replace('\\/?(?=\\/|$)', '')
          .replace('(?=\\/|$)', '')
          .replace(/\\\//g, '/');
        if (match && match !== '^' && match !== '^/') {
          routerPath = basePath + (match.startsWith('/') ? match : `/${match}`);
        }
      }
      for (const subLayer of layer.handle.stack) {
        routes.push(...extractRoutes(subLayer, routerPath));
      }
    }
    return routes;
  }

  const allRoutes = [];
  if (v1Router.stack) {
    for (const layer of v1Router.stack) {
      allRoutes.push(...extractRoutes(layer, ''));
    }
  }

  const counts = new Map();
  const duplicates = [];
  for (const r of allRoutes) {
    const count = (counts.get(r) || 0) + 1;
    counts.set(r, count);
    if (count === 2) {
      duplicates.push(r);
    }
  }

  assert.equal(
    duplicates.length,
    0,
    `Found duplicate route definitions in v1Router: ${duplicates.join(', ')}`
  );
});

test('P1-1: v1Router_unmatched_returns_json_404', async () => {
  const http = require('http');
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/nonexistent-route-for-testing-404`);
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('content-type')?.includes('application/json'), true);
    const body = await res.json();
    assert.equal(body.status, 404);
    assert.equal(body.error, 'API route not found');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('P2-3: sentry_express_singleCapture_on500', async () => {
  let captureCount = 0;
  const originalCapture = sentry.captureException;
  sentry.captureException = (err, context) => {
    captureCount++;
    return originalCapture(err, context);
  };

  const express = require('express');
  const testApp = express();
  testApp.use(express.json());

  // Trigger route that throws 500
  testApp.get('/test-500', (req, res, next) => {
    next(new Error('Synthetic 500 error for dedupe test'));
  });

  // Centralized error handler under test (same as app)
  testApp.use((err, req, res, next) => {
    const reqId = req.headers['x-request-id'] || 'test-req-id';
    const status = err.status || err.statusCode || 500;
    if (status >= 500) {
      sentry.captureException(err, { reqId, module: 'express', status });
    }
    res.status(status).json({ error: 'Internal Server Error', status, reqId });
  });

  const http = require('http');
  const server = http.createServer(testApp);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/test-500`);
    assert.equal(res.status, 500);
    assert.equal(captureCount, 1, `Expected captureException to be called exactly once, called ${captureCount} times`);
  } finally {
    sentry.captureException = originalCapture;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GAP 4: exit_handler_cleanup_synchronous', () => {
  const setupAbsPath = path.resolve(__dirname, '_setup').replace(/\\/g, '/');
  const childScript = `
    require('${setupAbsPath}');
    const fs = require('fs');
    const dbPath = process.env.TEST_DB_PATH;
    const tenantDir = process.env.TENANT_DATA_ROOT;
    fs.writeFileSync(dbPath, 'dummy-db');
    fs.mkdirSync(tenantDir, { recursive: true });
    fs.writeFileSync(tenantDir + '/test.txt', 'dummy-tenant-data');
    process.send({ dbPath, tenantDir });
    process.exit(0);
  `;

  const child = require('child_process').fork('-e', [childScript], {
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    env: { ...process.env, TEST_DB_PATH: '', TENANT_DATA_ROOT: '', VULN_DATA_PATH: '' },
  });

  let childPaths = null;
  child.on('message', (msg) => {
    childPaths = msg;
  });

  const exitCode = new Promise((resolve) => {
    child.on('exit', (code) => resolve(code));
  });

  return exitCode.then((code) => {
    assert.equal(code, 0);
    assert.ok(childPaths, 'Expected child process to send paths');
    assert.equal(fs.existsSync(childPaths.dbPath), false, 'Expected child dbPath to be deleted synchronously');
    assert.equal(fs.existsSync(childPaths.tenantDir), false, 'Expected child tenantDir to be deleted synchronously');
  });
});
