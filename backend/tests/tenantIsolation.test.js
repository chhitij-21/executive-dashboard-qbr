// backend/tests/tenantIsolation.test.js
// Automated regression test suite for role-based multi-tenant isolation.
// Verifies 18 distinct security and tenant isolation scenarios across JFL and MMTC.

process.env.NODE_ENV = 'test';
process.env.ALLOW_DEMO_ACCOUNTS = 'true';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const app = require('../index');

describe('Multi-Tenant Isolation & Role-Based Authorization Suite (18 Scenarios)', () => {
  let server;
  let baseUrl;
  let adminToken;
  let jflToken;
  let mmtcToken;

  before(async () => {
    // Start ephemeral HTTP server
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // Obtain access tokens for test personas
    const login = async (email, password) => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      assert.equal(res.status, 200, `Login failed for ${email}`);
      const json = await res.json();
      return json.token;
    };

    adminToken = await login('admin@portal.com', process.env.ADMIN_PASSWORD || 'admin123');
    jflToken = await login('jfl@portal.com', process.env.JFL_PASSWORD || 'jfl123');
    mmtcToken = await login('mmtc@portal.com', process.env.MMTC_PASSWORD || 'mmtc123');
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // Scenario 1: GET /api/dashboard without auth -> 401
  it('Scenario 1: GET /api/dashboard without auth returns 401 UNAUTHORIZED', async () => {
    const res = await fetch(`${baseUrl}/api/dashboard?clientId=client-jfl`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'UNAUTHORIZED');
  });

  // Scenario 2: GET /api/dashboard with admin auth and no clientId -> 400 MISSING_CLIENT_ID
  it('Scenario 2: GET /api/dashboard with admin auth and no clientId returns 400 MISSING_CLIENT_ID', async () => {
    const res = await fetch(`${baseUrl}/api/dashboard`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, 'MISSING_CLIENT_ID');
  });

  // Scenario 3: GET /api/dashboard with admin auth and invalid clientId -> 404 UNKNOWN_CLIENT
  it('Scenario 3: GET /api/dashboard with admin auth and invalid clientId returns 404 UNKNOWN_CLIENT', async () => {
    const res = await fetch(`${baseUrl}/api/dashboard?clientId=client-nonexistent`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.code, 'UNKNOWN_CLIENT');
  });

  // Scenario 4: GET /api/dashboard with admin auth and clientId=client-jfl -> 200, JFL dataset
  it('Scenario 4: GET /api/dashboard with admin auth and clientId=client-jfl returns 200 JFL data', async () => {
    const res = await fetch(`${baseUrl}/api/dashboard?clientId=client-jfl`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.clientId, 'client-jfl');
  });

  // Scenario 5: GET /api/dashboard with admin auth and clientId=client-mmtcpamp -> 200 MMTC scoped
  it('Scenario 5: GET /api/dashboard with admin auth and clientId=client-mmtcpamp returns 200 MMTC scoped', async () => {
    const res = await fetch(`${baseUrl}/api/dashboard?clientId=client-mmtcpamp`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.clientId, 'client-mmtcpamp');
  });

  // Scenario 6: GET /api/dashboard with admin auth and clientId=client-mmtc -> 200 resolves canonical
  it('Scenario 6: GET /api/dashboard with admin auth and clientId=client-mmtc resolves to client-mmtcpamp', async () => {
    const res = await fetch(`${baseUrl}/api/dashboard?clientId=client-mmtc`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.clientId, 'client-mmtcpamp');
  });

  // Scenario 7: GET /api/dashboard with JFL user and clientId=client-jfl -> 200
  it('Scenario 7: GET /api/dashboard with JFL user and clientId=client-jfl returns 200', async () => {
    const res = await fetch(`${baseUrl}/api/dashboard?clientId=client-jfl`, {
      headers: { Authorization: `Bearer ${jflToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.clientId, 'client-jfl');
  });

  // Scenario 8: GET /api/dashboard with JFL user and clientId=client-mmtcpamp -> 403 CUSTOMER_ACCESS_FORBIDDEN
  it('Scenario 8: GET /api/dashboard with JFL user and clientId=client-mmtcpamp returns 403 CUSTOMER_ACCESS_FORBIDDEN', async () => {
    const res = await fetch(`${baseUrl}/api/dashboard?clientId=client-mmtcpamp`, {
      headers: { Authorization: `Bearer ${jflToken}` },
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'CUSTOMER_ACCESS_FORBIDDEN');
  });

  // Scenario 9: GET /api/dashboard with MMTC user and clientId=client-jfl -> 403 CUSTOMER_ACCESS_FORBIDDEN
  it('Scenario 9: GET /api/dashboard with MMTC user and clientId=client-jfl returns 403 CUSTOMER_ACCESS_FORBIDDEN', async () => {
    const res = await fetch(`${baseUrl}/api/dashboard?clientId=client-jfl`, {
      headers: { Authorization: `Bearer ${mmtcToken}` },
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'CUSTOMER_ACCESS_FORBIDDEN');
  });

  // Scenario 10: GET /api/dashboard with MMTC user and clientId=client-mmtc -> 200
  it('Scenario 10: GET /api/dashboard with MMTC user and clientId=client-mmtc returns 200 for canonical workspace', async () => {
    const res = await fetch(`${baseUrl}/api/dashboard?clientId=client-mmtc`, {
      headers: { Authorization: `Bearer ${mmtcToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.clientId, 'client-mmtcpamp');
  });

  // Scenario 11: POST /api/chat without auth -> 401
  it('Scenario 11: POST /api/chat without auth returns 401 UNAUTHORIZED', async () => {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Summarize SLA status', clientId: 'client-jfl' }),
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'UNAUTHORIZED');
  });

  // Scenario 12: POST /api/chat with JFL user and clientId=client-mmtcpamp -> 403 CUSTOMER_ACCESS_FORBIDDEN
  it('Scenario 12: POST /api/chat with JFL user and clientId=client-mmtcpamp returns 403 CUSTOMER_ACCESS_FORBIDDEN', async () => {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jflToken}`,
      },
      body: JSON.stringify({ prompt: 'Summarize SLA status', clientId: 'client-mmtcpamp' }),
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'CUSTOMER_ACCESS_FORBIDDEN');
  });

  // Scenario 13: GET /api/history without auth -> 401
  it('Scenario 13: GET /api/history without auth returns 401 UNAUTHORIZED', async () => {
    const res = await fetch(`${baseUrl}/api/history?clientId=client-jfl`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'UNAUTHORIZED');
  });

  // Scenario 14: GET /api/history with JFL user and clientId=client-jfl -> 200, JFL records only
  it('Scenario 14: GET /api/history with JFL user and clientId=client-jfl returns 200 JFL history only', async () => {
    const res = await fetch(`${baseUrl}/api/history?clientId=client-jfl`, {
      headers: { Authorization: `Bearer ${jflToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.clientId, 'client-jfl');
    assert.ok(Array.isArray(body.history));
    for (const item of body.history) {
      assert.equal(item.clientId, 'client-jfl');
    }
  });

  // Scenario 15: GET /api/history with JFL user and clientId=client-mmtcpamp -> 403 CUSTOMER_ACCESS_FORBIDDEN
  it('Scenario 15: GET /api/history with JFL user and clientId=client-mmtcpamp returns 403 CUSTOMER_ACCESS_FORBIDDEN', async () => {
    const res = await fetch(`${baseUrl}/api/history?clientId=client-mmtcpamp`, {
      headers: { Authorization: `Bearer ${jflToken}` },
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'CUSTOMER_ACCESS_FORBIDDEN');
  });

  // Scenario 16: POST /api/auth/download-ticket with JFL user and clientId=client-mmtcpamp -> 403
  it('Scenario 16: POST /api/auth/download-ticket with JFL user and clientId=client-mmtcpamp returns 403 CUSTOMER_ACCESS_FORBIDDEN', async () => {
    const res = await fetch(`${baseUrl}/api/auth/download-ticket`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jflToken}`,
      },
      body: JSON.stringify({ clientId: 'client-mmtcpamp', jobId: 'latest', exportType: 'ppt' }),
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'CUSTOMER_ACCESS_FORBIDDEN');
  });

  // Scenario 17: Download endpoint with valid ticket -> 200
  it('Scenario 17: Download endpoint with valid ticket serves download successfully', async () => {
    // Acquire single-use download ticket for authorized JFL user
    const ticketRes = await fetch(`${baseUrl}/api/auth/download-ticket`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jflToken}`,
      },
      body: JSON.stringify({ clientId: 'client-jfl', jobId: 'latest', exportType: 'ppt' }),
    });
    assert.equal(ticketRes.status, 200);
    const { downloadTicket } = await ticketRes.json();
    assert.ok(downloadTicket && downloadTicket.startsWith('dl_'));

    // Consume ticket directly without Bearer header (browser navigation emulation)
    const dlRes = await fetch(`${baseUrl}/api/ppt/latest?clientId=client-jfl&ticket=${downloadTicket}`);
    assert.equal(dlRes.status, 200);
    assert.ok(dlRes.headers.get('content-disposition'));
  });

  // Scenario 18: Download endpoint with ticket reused or expired -> 401 INVALID_DOWNLOAD_TICKET
  it('Scenario 18: Download endpoint with reused ticket returns 401 INVALID_DOWNLOAD_TICKET', async () => {
    // Acquire single-use download ticket
    const ticketRes = await fetch(`${baseUrl}/api/auth/download-ticket`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jflToken}`,
      },
      body: JSON.stringify({ clientId: 'client-jfl', jobId: 'latest', exportType: 'ppt' }),
    });
    assert.equal(ticketRes.status, 200);
    const { downloadTicket } = await ticketRes.json();

    // First download consumes the ticket
    const dlRes1 = await fetch(`${baseUrl}/api/ppt/latest?clientId=client-jfl&ticket=${downloadTicket}`);
    assert.equal(dlRes1.status, 200);

    // Second download with same ticket MUST fail (single-use guarantee)
    const dlRes2 = await fetch(`${baseUrl}/api/ppt/latest?clientId=client-jfl&ticket=${downloadTicket}`);
    assert.equal(dlRes2.status, 401);
    const body = await dlRes2.json();
    assert.equal(body.code, 'INVALID_DOWNLOAD_TICKET');
  });

  // Scenario 19: requireAuth rejects req.query.token in URL and returns 401 UNAUTHORIZED
  it('Scenario 19: requireAuth rejects req.query.token in URL and returns 401 UNAUTHORIZED', async () => {
    const res = await fetch(`${baseUrl}/api/dashboard?clientId=client-jfl&token=${adminToken}`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'UNAUTHORIZED');
  });

  // Scenario 20: SSE ticket with valid sse_ token works
  it('Scenario 20: SSE ticket with valid sse_ token connects and streams loop', async () => {
    const ticketRes = await fetch(`${baseUrl}/api/auth/sse-ticket`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jflToken}`,
      },
      body: JSON.stringify({ clientId: 'client-jfl' }),
    });
    assert.equal(ticketRes.status, 200);
    const { sseTicket } = await ticketRes.json();
    assert.ok(sseTicket && sseTicket.startsWith('sse_'));

    const sseRes = await fetch(`${baseUrl}/api/chat/loop?clientId=client-jfl&ticket=${sseTicket}&prompt=ping`);
    assert.equal(sseRes.status, 200);
    assert.ok(sseRes.headers.get('content-type')?.includes('text/event-stream'));
  });

  // Scenario 21: SSE ticket reuse returns 401 INVALID_SSE_TICKET
  it('Scenario 21: SSE ticket reuse returns 401 INVALID_SSE_TICKET', async () => {
    const ticketRes = await fetch(`${baseUrl}/api/auth/sse-ticket`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jflToken}`,
      },
      body: JSON.stringify({ clientId: 'client-jfl' }),
    });
    assert.equal(ticketRes.status, 200);
    const { sseTicket } = await ticketRes.json();

    const res1 = await fetch(`${baseUrl}/api/chat/loop?clientId=client-jfl&ticket=${sseTicket}&prompt=ping`);
    assert.equal(res1.status, 200);

    const res2 = await fetch(`${baseUrl}/api/chat/loop?clientId=client-jfl&ticket=${sseTicket}&prompt=ping`);
    assert.equal(res2.status, 401);
    const body = await res2.json();
    assert.equal(body.code, 'INVALID_SSE_TICKET');
  });

  // Scenario 22: SSE ticket expired (>60s) returns 401 INVALID_SSE_TICKET
  it('Scenario 22: SSE ticket expired (>60s) returns 401 INVALID_SSE_TICKET', async () => {
    const authService = require('../services/authService');
    const { sseTicket } = authService.createSSETicket({
      userId: 'user-client-jfl',
      clientId: 'client-jfl',
      ttlMs: -1000,
    });

    const res = await fetch(`${baseUrl}/api/chat/loop?clientId=client-jfl&ticket=${sseTicket}&prompt=ping`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'INVALID_SSE_TICKET');
  });

  // Scenario 23: SSE ticket for wrong client returns 403 CUSTOMER_ACCESS_FORBIDDEN
  it('Scenario 23: SSE ticket for wrong client returns 403 CUSTOMER_ACCESS_FORBIDDEN', async () => {
    const ticketRes = await fetch(`${baseUrl}/api/auth/sse-ticket`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ clientId: 'client-jfl' }),
    });
    assert.equal(ticketRes.status, 200);
    const { sseTicket } = await ticketRes.json();

    const res = await fetch(`${baseUrl}/api/chat/loop?clientId=client-mmtcpamp&ticket=${sseTicket}&prompt=ping`);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'CUSTOMER_ACCESS_FORBIDDEN');
  });
});
