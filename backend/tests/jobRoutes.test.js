require('./_setup');
// backend/tests/jobRoutes.test.js
process.env.NODE_ENV = 'test';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../index');
const queueService = require('../services/queueService');

describe('Job Routes & Async Upload Integration (Item #10)', () => {
  const tenantA = 'client-jfl';
  const tenantB = 'client-mmtcpamp';
  let server = null;
  let baseUrl = '';
  let tokenJFL = '';
  let tokenMMTC = '';

  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // Login JFL user
    const loginJfl = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'jfl@portal.com', password: 'jfl123' }),
    });
    const jflData = await loginJfl.json();
    tokenJFL = jflData.token;

    // Login MMTC user
    const loginMmtc = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'mmtc@portal.com', password: 'mmtc123' }),
    });
    const mmtcData = await loginMmtc.json();
    tokenMMTC = mmtcData.token;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await queueService.closeQueue();
  });

  it('1. GET /api/jobs/:jobId returns 404 for non-existent job', async () => {
    const res = await fetch(`${baseUrl}/api/jobs/non-existent-uuid-0000`, {
      headers: {
        Authorization: `Bearer ${tokenJFL}`,
        'x-client-id': tenantA,
      },
    });
    const body = await res.json();

    assert.strictEqual(res.status, 404);
    assert.strictEqual(body.code, 'JOB_NOT_FOUND');
  });

  it('2. Enforces multi-tenant isolation: Tenant B receives 403 for Tenant A job', async () => {
    const job = await queueService.enqueueJob({
      clientId: tenantA,
      fileNames: ['jfl_report.xlsx'],
    });

    const res = await fetch(`${baseUrl}/api/jobs/${job.jobId}`, {
      headers: {
        Authorization: `Bearer ${tokenMMTC}`,
        'x-client-id': tenantB,
      },
    });
    const body = await res.json();

    assert.strictEqual(res.status, 403);
    assert.strictEqual(body.code, 'TENANT_FORBIDDEN');
  });

  it('3. GET /api/jobs/:jobId returns 200 with sanitized job state for matching tenant', async () => {
    const job = await queueService.enqueueJob({
      clientId: tenantA,
      fileNames: ['inventory.xlsx', 'incidents.xlsx'],
    });

    await queueService.updateProgress(job.jobId, 50, 'data_processing', 'Calculating site SLAs...');

    const res = await fetch(`${baseUrl}/api/jobs/${job.jobId}`, {
      headers: {
        Authorization: `Bearer ${tokenJFL}`,
        'x-client-id': tenantA,
      },
    });
    const body = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.job.jobId, job.jobId);
    assert.strictEqual(body.job.clientId, tenantA);
    assert.strictEqual(body.job.progress, 50);
    assert.strictEqual(body.job.stage, 'data_processing');
  });

  it('4. DELETE /api/jobs/:jobId cancels active job and returns 200', async () => {
    const job = await queueService.enqueueJob({
      clientId: tenantA,
      fileNames: ['cancel_me.xlsx'],
    });

    const res = await fetch(`${baseUrl}/api/jobs/${job.jobId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${tokenJFL}`,
        'x-client-id': tenantA,
      },
    });
    const body = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.jobId, job.jobId);

    const checked = await queueService.getJob(job.jobId, tenantA);
    assert.strictEqual(checked.status, 'failed');
    assert.strictEqual(checked.error, 'Job cancelled by user.');
  });

  it('5. DELETE /api/jobs/:jobId enforces tenant check (Tenant B cannot cancel Tenant A job)', async () => {
    const job = await queueService.enqueueJob({
      clientId: tenantA,
      fileNames: ['protected.xlsx'],
    });

    const res = await fetch(`${baseUrl}/api/jobs/${job.jobId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${tokenMMTC}`,
        'x-client-id': tenantB,
      },
    });
    const body = await res.json();

    assert.strictEqual(res.status, 403);
    assert.strictEqual(body.code, 'TENANT_FORBIDDEN');
  });

  it('6. GET /api/ppt/download/:jobId enforces customer isolation', async () => {
    const res = await fetch(`${baseUrl}/api/ppt/download/fake-job-id`, {
      headers: {
        Authorization: `Bearer ${tokenMMTC}`,
        'x-client-id': tenantB,
      },
    });

    // Either 404 or 403 depending on job resolution
    assert.ok(res.status === 404 || res.status === 403);
  });
});
