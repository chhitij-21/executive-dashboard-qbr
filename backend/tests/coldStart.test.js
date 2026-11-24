require('./_setup');
// backend/tests/coldStart.test.js
// Cold Start Optimization & Production Readiness Probe Suite (Item #1)

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const path = require('path');
const app = require('../index');
const database = require('../config/database');
const storageRepo = require('../repositories/storageRepo');

describe('Cold Start Optimization & Health Probes Suite (Item #1)', () => {
  let server = null;
  let baseUrl = '';

  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('1. GET /health/live: Root liveness probe returns HTTP 200 immediately with process metadata', async () => {
    const res = await fetch(`${baseUrl}/health/live`);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.strictEqual(body.status, 'ok');
    assert.strictEqual(body.live, true);
    assert.strictEqual(typeof body.uptimeSec, 'number');
    assert.ok(body.uptimeSec >= 0);
    assert.ok(body.timestamp);
    assert.strictEqual(typeof body.pid, 'number');
    assert.ok(body.memoryMb);
    assert.strictEqual(typeof body.memoryMb.rss, 'number');
    assert.strictEqual(typeof body.memoryMb.heapUsed, 'number');
    assert.strictEqual(typeof body.memoryMb.heapTotal, 'number');
  });

  it('2. GET /api/v1/health/live: Canonical v1 liveness probe returns 200 without deprecation headers', async () => {
    const res = await fetch(`${baseUrl}/api/v1/health/live`);
    assert.strictEqual(res.status, 200);

    // Must NOT carry deprecation headers
    assert.strictEqual(res.headers.get('deprecation'), null);
    assert.strictEqual(res.headers.get('link'), null);

    const body = await res.json();
    assert.strictEqual(body.status, 'ok');
    assert.strictEqual(body.live, true);
  });

  it('3. GET /health/ready: Deep readiness probe returns HTTP 200 when all core components are healthy', async () => {
    const res = await fetch(`${baseUrl}/health/ready`);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.strictEqual(body.status, 'ok');
    assert.strictEqual(body.ready, true);
    assert.ok(body.timestamp);
    assert.ok(body.components);

    assert.strictEqual(body.components.database.healthy, true);
    assert.strictEqual(body.components.storage.healthy, true);
    assert.strictEqual(typeof body.components.scheduler.ready, 'boolean');
    assert.strictEqual(body.components.queue.ready, true);
  });

  it('4. GET /api/v1/health/ready: Canonical v1 readiness probe returns 200 with full component telemetry', async () => {
    const res = await fetch(`${baseUrl}/api/v1/health/ready`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('deprecation'), null);

    const body = await res.json();
    assert.strictEqual(body.ready, true);
    assert.strictEqual(body.components.database.healthy, true);
    assert.strictEqual(body.components.storage.healthy, true);
  });

  it('5. GET /health/ready degrades to HTTP 503 when database health check fails', async () => {
    const originalDbHealth = database.healthCheck;
    try {
      database.healthCheck = async () => ({ healthy: false, error: 'Simulated Turso outage' });

      const res = await fetch(`${baseUrl}/health/ready`);
      assert.strictEqual(res.status, 503);

      const body = await res.json();
      assert.strictEqual(body.status, 'degraded');
      assert.strictEqual(body.ready, false);
      assert.strictEqual(body.components.database.healthy, false);
      assert.strictEqual(body.components.database.error, 'Simulated Turso outage');
    } finally {
      database.healthCheck = originalDbHealth;
    }
  });

  it('6. GET /health/ready degrades to HTTP 503 when storage health check fails', async () => {
    const originalStorageHealth = storageRepo.healthCheck;
    try {
      storageRepo.healthCheck = async () => ({ healthy: false, backend: 'database_blob', error: 'Storage cluster unavailable' });

      const res = await fetch(`${baseUrl}/health/ready`);
      assert.strictEqual(res.status, 503);

      const body = await res.json();
      assert.strictEqual(body.status, 'degraded');
      assert.strictEqual(body.ready, false);
      assert.strictEqual(body.components.storage.healthy, false);
      assert.strictEqual(body.components.storage.error, 'Storage cluster unavailable');
    } finally {
      storageRepo.healthCheck = originalStorageHealth;
    }
  });

  it('7. Lazy Loading Verification: Requiring backend/index.js loads neither xlsx nor pptxgenjs into require.cache', () => {
    const checkScript = `
      process.env.NODE_ENV = 'test';
      require('./backend/index.js');
      const keys = Object.keys(require.cache);
      const hasXlsx = keys.some(k => k.includes('xlsx'));
      const hasPptx = keys.some(k => k.includes('pptxgenjs'));
      process.stdout.write('__RESULT__' + JSON.stringify({ hasXlsx, hasPptx }) + '__RESULT__');
    `;

    const result = spawnSync(process.execPath, ['-e', checkScript], {
      cwd: path.join(__dirname, '..', '..'),
      env: { ...process.env, NODE_ENV: 'test' },
      encoding: 'utf8',
    });

    assert.strictEqual(result.status, 0, `Script failed: ${result.stderr}`);
    const match = result.stdout.match(/__RESULT__(.*?)__RESULT__/);
    assert.ok(match, `Could not find __RESULT__ delimiter in output: ${result.stdout}`);
    const out = JSON.parse(match[1]);
    assert.strictEqual(out.hasXlsx, false, 'Expected xlsx NOT to be loaded into require.cache on server import');
    assert.strictEqual(out.hasPptx, false, 'Expected pptxgenjs NOT to be loaded into require.cache on server import');
  });

  it('8. Backward Compatibility: Canonical /api/health and /api/v1/health endpoints retain v1 summary shape', async () => {
    const v1Res = await fetch(`${baseUrl}/api/v1/health`);
    assert.strictEqual(v1Res.status, 200);
    const v1Body = await v1Res.json();
    assert.strictEqual(v1Body.status, 'ok');
    assert.strictEqual(v1Body.version, 'v1');
    assert.ok(v1Body.observability);
    assert.strictEqual(v1Body.observability.logger, 'pino');

    const legacyRes = await fetch(`${baseUrl}/api/health`);
    assert.strictEqual(legacyRes.status, 200);
    assert.strictEqual(legacyRes.headers.get('deprecation'), 'true');
    const legacyBody = await legacyRes.json();
    assert.strictEqual(legacyBody.status, 'ok');
    assert.strictEqual(legacyBody.version, 'v1');
  });
});
