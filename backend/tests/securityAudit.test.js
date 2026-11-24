require('./_setup');
// backend/tests/securityAudit.test.js
// Enterprise Security Audit Trail & Compliance Logging Test Suite (Item #21)

process.env.NODE_ENV = 'test';
process.env.ALLOW_DEMO_ACCOUNTS = 'true';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const app = require('../index');
const auditService = require('../services/auditService');
const authService = require('../services/authService');
const database = require('../config/database');

describe('Security Audit Trail & Compliance Suite (Item #21)', () => {
  let server;
  let baseUrl;
  let adminToken;
  let jflToken;
  let mmtcToken;

  before(async () => {
    // Ensure audit DB tables exist
    await auditService.ensureTable();

    // Start ephemeral HTTP server
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    if (typeof app.resetRateLimits === 'function') {
      app.resetRateLimits();
    }
    if (typeof authService.resetRateLimits === 'function') {
      authService.resetRateLimits();
    }

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

  beforeEach(async () => {
    if (typeof app.resetRateLimits === 'function') {
      app.resetRateLimits();
    }
    if (typeof authService.resetRateLimits === 'function') {
      authService.resetRateLimits();
    }
  });

  // 1. Direct Service Persistence & Querying
  it('1. logEvent persists record to SQLite DB and queries back accurately', async () => {
    const event = await auditService.logEvent({
      eventType: 'SYSTEM_STARTUP',
      severity: 'INFO',
      tenantId: 'client-jfl',
      action: 'BOOT',
      status: 'SUCCESS',
      details: { version: '2.0.0', mode: 'cluster' },
    });

    assert.ok(event.id);
    assert.equal(event.event_type, 'SYSTEM_STARTUP');
    assert.equal(event.severity, 'INFO');
    assert.equal(event.tenant_id, 'client-jfl');

    const result = await auditService.queryLogs({
      eventType: 'SYSTEM_STARTUP',
      tenantId: 'client-jfl',
    });

    assert.ok(result.total >= 1);
    const found = result.logs.find((l) => l.id === event.id);
    assert.ok(found);
    assert.equal(found.eventType, 'SYSTEM_STARTUP');
    assert.equal(found.details.version, '2.0.0');
  });

  // 2. SIEM Append-Only File Writing
  it('2. logEvent appends structured JSON lines to daily SIEM log file', async () => {
    const testAction = `SIEM_TEST_${Date.now()}`;
    await auditService.logEvent({
      eventType: 'SIEM_EVENT',
      severity: 'WARN',
      action: testAction,
      status: 'SUCCESS',
      details: { telemetry: 'active' },
    });

    const auditDir = auditService.getAuditLogDir();
    assert.ok(fs.existsSync(auditDir), `Audit dir ${auditDir} should exist`);

    const todayStr = new Date().toISOString().substring(0, 10);
    const logFilePath = path.join(auditDir, `audit-${todayStr}.log`);
    assert.ok(fs.existsSync(logFilePath), `SIEM file ${logFilePath} should exist`);

    const content = fs.readFileSync(logFilePath, 'utf8');
    assert.ok(content.includes(testAction), 'SIEM file should contain logged action');
  });

  // 3. Sensitive Data Sanitization
  it('3. sanitizeDetails redacts credentials, secrets, tokens, and cookies', async () => {
    const testSecret = 'super-secret-password-123';
    const testJwt = 'ey.header.payload.signature';
    const testCookie = 'session_id=abcdef';

    const event = await auditService.logEvent({
      eventType: 'SECURITY_TEST_REDACTION',
      severity: 'INFO',
      action: 'TEST_REDACT',
      status: 'SUCCESS',
      details: {
        password: testSecret,
        token: testJwt,
        jwt: testJwt,
        cookie: testCookie,
        authorization: 'Bearer 123456',
        mfa_secret: 'ABCDEF123456',
        publicInfo: 'visible-metadata',
        nested: {
          password: 'nested-password',
          safeKey: 'nested-safe',
        },
      },
    });

    // Check in-memory returned record
    assert.equal(event.details.password, '[REDACTED]');
    assert.equal(event.details.token, '[REDACTED]');
    assert.equal(event.details.jwt, '[REDACTED]');
    assert.equal(event.details.cookie, '[REDACTED]');
    assert.equal(event.details.authorization, '[REDACTED]');
    assert.equal(event.details.mfa_secret, '[REDACTED]');
    assert.equal(event.details.publicInfo, 'visible-metadata');
    assert.equal(event.details.nested.password, '[REDACTED]');
    assert.equal(event.details.nested.safeKey, 'nested-safe');

    // Check DB query result
    const dbResult = await auditService.queryLogs({ eventType: 'SECURITY_TEST_REDACTION' });
    const log = dbResult.logs.find((l) => l.id === event.id);
    assert.ok(log);
    assert.equal(log.details.password, '[REDACTED]');
    assert.equal(log.details.nested.password, '[REDACTED]');
  });

  // 4. Authentication Login Success Event
  it('4. POST /api/auth/login on success emits AUTH_LOGIN_SUCCESS audit event', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@portal.com', password: process.env.ADMIN_PASSWORD || 'admin123' }),
    });
    assert.equal(res.status, 200);

    const logs = await auditService.queryLogs({
      eventType: 'AUTH_LOGIN_SUCCESS',
      action: 'LOGIN',
      limit: 10,
    });

    assert.ok(logs.total >= 1);
    const lastLogin = logs.logs[0];
    assert.equal(lastLogin.eventType, 'AUTH_LOGIN_SUCCESS');
    assert.equal(lastLogin.username, 'admin@portal.com');
    assert.equal(lastLogin.status, 'SUCCESS');
    assert.equal(lastLogin.role, 'admin');
  });

  // 5. Authentication Login Failure Event
  it('5. POST /api/auth/login with wrong credentials emits AUTH_LOGIN_FAILURE audit event', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@portal.com', password: 'wrong-password' }),
    });
    assert.equal(res.status, 401);

    const logs = await auditService.queryLogs({
      eventType: 'AUTH_LOGIN_FAILURE',
      action: 'LOGIN',
      limit: 10,
    });

    assert.ok(logs.total >= 1);
    const lastFailure = logs.logs[0];
    assert.equal(lastFailure.eventType, 'AUTH_LOGIN_FAILURE');
    assert.equal(lastFailure.status, 'FAILURE');
    assert.equal(lastFailure.severity, 'WARN');
    assert.equal(lastFailure.details.email, 'admin@portal.com');
    assert.equal(lastFailure.details.reason, 'INVALID_CREDENTIALS');
  });

  // 6. Security Rate Limiting Event
  it('6. Triggering login rate limit emits SECURITY_RATE_LIMITED audit event', async () => {
    const badEmail = `ratelimit_${Date.now()}@test.com`;

    // Send 5 rapid invalid attempts
    for (let i = 0; i < 5; i++) {
      await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: badEmail, password: 'bad' }),
      });
    }

    // 6th attempt hits 429
    const rateLimitRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: badEmail, password: 'bad' }),
    });
    assert.equal(rateLimitRes.status, 429);

    const logs = await auditService.queryLogs({
      eventType: 'SECURITY_RATE_LIMITED',
      limit: 5,
    });

    assert.ok(logs.total >= 1);
    const rateLog = logs.logs.find((l) => l.details.email === badEmail);
    assert.ok(rateLog, 'Should have logged rate limit event for this email');
    assert.equal(rateLog.severity, 'WARN');
    assert.equal(rateLog.status, 'FAILURE');
  });

  // 7. Cross-Tenant Authorization Denial Event
  it('7. Cross-tenant access denial emits SECURITY_ACCESS_DENIED audit event', async () => {
    // JFL client token tries to access MMTC schedules
    const res = await fetch(`${baseUrl}/api/tenants/client-mmtc/schedules`, {
      headers: { Authorization: `Bearer ${jflToken}` },
    });
    assert.equal(res.status, 403);

    const logs = await auditService.queryLogs({
      eventType: 'SECURITY_ACCESS_DENIED',
      limit: 5,
    });

    assert.ok(logs.total >= 1);
    const denyLog = logs.logs[0];
    assert.equal(denyLog.eventType, 'SECURITY_ACCESS_DENIED');
    assert.equal(denyLog.severity, 'WARN');
    assert.equal(denyLog.status, 'FAILURE');
    assert.ok(
      denyLog.details.requestedTenant === 'client-mmtc' || denyLog.details.requestedTenant === 'client-mmtcpamp',
      'requestedTenant should match target'
    );
    assert.equal(denyLog.details.userTenant, 'client-jfl');
  });

  // 8. Admin-Wide Audit Log API Permissions
  it('8. GET /api/v1/audit requires Admin role (401 unauth, 403 client, 200 admin)', async () => {
    // 8a. No auth -> 401
    const unauthRes = await fetch(`${baseUrl}/api/v1/audit`);
    assert.equal(unauthRes.status, 401);

    // 8b. Client user -> 403
    const clientRes = await fetch(`${baseUrl}/api/v1/audit`, {
      headers: { Authorization: `Bearer ${jflToken}` },
    });
    assert.equal(clientRes.status, 403);

    // 8c. Admin user -> 200
    const adminRes = await fetch(`${baseUrl}/api/v1/audit?limit=10`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(adminRes.status, 200);
    const body = await adminRes.json();
    assert.ok(Array.isArray(body.logs));
    assert.equal(typeof body.total, 'number');
    assert.equal(body.limit, 10);
  });

  // 9. Tenant-Scoped Audit Log API Isolation
  it('9. GET /api/v1/tenants/:id/audit enforces tenant boundary', async () => {
    // Log distinct events for client-jfl and client-mmtc
    await auditService.logEvent({
      eventType: 'TENANT_A_EVENT',
      tenantId: 'client-jfl',
      action: 'ACTION_A',
      status: 'SUCCESS',
    });
    await auditService.logEvent({
      eventType: 'TENANT_B_EVENT',
      tenantId: 'client-mmtc',
      action: 'ACTION_B',
      status: 'SUCCESS',
    });

    // JFL client user requesting JFL audit -> 200
    const jflAuditRes = await fetch(`${baseUrl}/api/v1/tenants/client-jfl/audit`, {
      headers: { Authorization: `Bearer ${jflToken}` },
    });
    assert.equal(jflAuditRes.status, 200);
    const jflAuditBody = await jflAuditRes.json();
    assert.ok(jflAuditBody.logs.some((l) => l.eventType === 'TENANT_A_EVENT'));
    assert.ok(!jflAuditBody.logs.some((l) => l.eventType === 'TENANT_B_EVENT'));

    // JFL client user requesting MMTC audit -> 403 Forbidden
    const crossRes = await fetch(`${baseUrl}/api/v1/tenants/client-mmtc/audit`, {
      headers: { Authorization: `Bearer ${jflToken}` },
    });
    assert.equal(crossRes.status, 403);
  });

  // 10. Compliance CSV Export
  it('10. GET /api/v1/audit/export returns RFC 4180 CSV with headers and Content-Disposition', async () => {
    const res = await fetch(`${baseUrl}/api/v1/audit/export`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type').includes('text/csv'));
    assert.ok(res.headers.get('content-disposition').includes('attachment; filename="audit_log_'));

    const csvText = await res.text();
    const lines = csvText.split('\r\n');
    assert.ok(lines.length >= 2, 'CSV should have at least header + 1 row');

    const expectedHeader = 'ID,Timestamp (UTC),Event Type,Severity,Tenant ID,User ID,Username,Role,IP Address,Action,Status,Resource Type,Resource ID,Details';
    assert.equal(lines[0], expectedHeader);
  });

  // 11. Tenant-Scoped CSV Export
  it('11. GET /api/v1/tenants/:id/audit/export exports tenant-specific CSV', async () => {
    const res = await fetch(`${baseUrl}/api/v1/tenants/client-jfl/audit/export`, {
      headers: { Authorization: `Bearer ${jflToken}` },
    });
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type').includes('text/csv'));
    assert.ok(res.headers.get('content-disposition').includes('audit_client-jfl_'));

    const csvText = await res.text();
    const lines = csvText.split('\r\n');
    assert.ok(lines.length >= 1);
    assert.ok(lines[0].startsWith('ID,Timestamp (UTC)'));
  });

  // 12. Non-blocking Resilience
  it('12. logEvent handles errors gracefully without throwing', async () => {
    // Passing null or malformed data should not throw
    const result = await auditService.logEvent({
      eventType: null,
      action: null,
    });
    // Should complete and return an object or null without unhandled rejection
    assert.ok(result === null || typeof result === 'object');
  });
});
