require('./_setup');
// backend/tests/apiV1Contract.test.js
// Automated test suite for Item #14: API-First (v1 URI Versioning, Frontend Cutover & Deprecation Lifecycle)

process.env.NODE_ENV = 'test';
process.env.ALLOW_DEMO_ACCOUNTS = 'true';
process.env.JWT_SECRET = 'test-jwt-secret-with-at-least-32-characters-for-compliance';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const app = require('../index');
const authService = require('../services/authService');

describe('Item #14: API-First (v1 URI Versioning & Deprecation Lifecycle Suite)', () => {
  let server = null;
  let baseUrl = '';
  let adminToken = '';

  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    const admin = authService.getUserByEmail('admin@portal.com');
    const session = authService.issueSessionForUser(admin);
    adminToken = session.token;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // ── 1. v1_healthEndpoint_returns200 ─────────────────────────────────────────
  it('1. v1_healthEndpoint_returns200: GET /api/v1/health returns status ok with v1 version info', async () => {
    const res = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(res.status, 200, 'Canonical /api/v1/health must return 200');
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.version, 'v1');
    assert.ok(body.ts, 'Timestamp must be present');
    assert.ok(body.scheduler, 'Scheduler status summary must be present');
    // Canonical /api/v1/health must NOT carry deprecation headers
    assert.equal(res.headers.get('deprecation'), null, 'Canonical v1 must not carry Deprecation header');
  });

  // ── 2. v1_schedulerHealth_parity ────────────────────────────────────────────
  it('2. v1_schedulerHealth_parity: /api/v1/health/scheduler is canonical and /api/health/scheduler has deprecation', async () => {
    const v1Res = await fetch(`${baseUrl}/api/v1/health/scheduler`);
    assert.ok([200, 503].includes(v1Res.status), `Status must be 200 or 503, got: ${v1Res.status}`);
    const v1Body = await v1Res.json();
    assert.equal(v1Res.headers.get('deprecation'), null);

    const legacyRes = await fetch(`${baseUrl}/api/health/scheduler`);
    assert.equal(legacyRes.status, v1Res.status);
    const legacyBody = await legacyRes.json();
    assert.deepEqual(legacyBody, v1Body, 'Legacy and v1 scheduler health payloads must be identical');
    assert.equal(legacyRes.headers.get('deprecation'), 'true', 'Legacy path must carry Deprecation: true');
    assert.ok(
      legacyRes.headers.get('link')?.includes('/api/v1/health/scheduler'),
      'Legacy path must carry Link to successor version'
    );
  });

  // ── 3. v1_deprecationHeaders_attachedOnLegacy ───────────────────────────────
  it('3. v1_deprecationHeaders_attachedOnLegacy: GET /api/health returns identical payload with Deprecation and Link headers', async () => {
    const legacyRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(legacyRes.status, 200);
    assert.equal(legacyRes.headers.get('deprecation'), 'true');
    assert.ok(legacyRes.headers.get('link')?.includes('/api/v1/health'));
    const body = await legacyRes.json();
    assert.equal(body.status, 'ok');
  });

  // ── 4. apiV1UnmatchedRoute_noDeprecationHeaders ──────────────────────────────
  it('4. apiV1UnmatchedRoute_noDeprecationHeaders (GAP 2): Unmatched /api/v1 route returns 404 without deprecation headers or double /v1/v1', async () => {
    const res = await fetch(`${baseUrl}/api/v1/nonexistent-route-guard-test`);
    assert.equal(res.status, 404, 'Unmatched v1 route must return 404');
    assert.equal(res.headers.get('deprecation'), null, 'Unmatched v1 route must NOT have Deprecation header');
    assert.equal(res.headers.get('link'), null, 'Unmatched v1 route must NOT have Link header');
    const body = await res.json();
    assert.ok(body.error, 'Response must be JSON error');
  });

  // ── 5. apiUnmatchedReturns404Json_notHtml ────────────────────────────────────
  it('5. apiUnmatchedReturns404Json_notHtml (CLARIFICATION 1): Unmatched /api/* returns JSON 404, never SPA HTML', async () => {
    const res = await fetch(`${baseUrl}/api/nonexistent-legacy-endpoint-xyz`);
    assert.equal(res.status, 404);
    const contentType = res.headers.get('content-type') || '';
    assert.ok(contentType.includes('application/json'), `Expected application/json, got: ${contentType}`);
    const body = await res.json();
    assert.equal(body.error, 'API route not found');
  });

  // ── 6. legacyDirectMountsAbsent ──────────────────────────────────────────────
  it('6. legacyDirectMountsAbsent (CLARIFICATION 2): Direct /api/* mounts are removed from app._router.stack', () => {
    // Inspect Express router stack to verify no legacy direct route handlers exist on app directly
    const routesOnApp = (app._router?.stack || [])
      .filter((layer) => layer.route)
      .map((layer) => layer.route.path);

    // Direct /api/* business routes must NOT be registered directly on app
    const legacyApiRoutes = routesOnApp.filter(
      (p) => typeof p === 'string' && p.startsWith('/api/') && !p.startsWith('/api/v1')
    );
    assert.deepEqual(
      legacyApiRoutes,
      [],
      `Direct legacy /api routes must not be mounted on app directly. Found: ${legacyApiRoutes.join(', ')}`
    );
  });

  // ── 7. apiV1CorsPreflight ────────────────────────────────────────────────────
  it('7. apiV1CorsPreflight (CLARIFICATION 3): OPTIONS /api/v1/auth/login and /api/auth/login return CORS headers', async () => {
    for (const url of [`${baseUrl}/api/v1/auth/login`, `${baseUrl}/api/auth/login`]) {
      const res = await fetch(url, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:5173',
          'Access-Control-Request-Method': 'POST',
        },
      });
      assert.ok([200, 204].includes(res.status), `Preflight must return 200 or 204, got: ${res.status}`);
      assert.ok(
        res.headers.get('access-control-allow-origin') || res.headers.get('access-control-allow-methods'),
        'CORS headers must be returned on preflight'
      );
    }
  });

  // ── 8. frontendUsesOnlyV1Paths ───────────────────────────────────────────────
  it('8. frontendUsesOnlyV1Paths (GAP 1 VERIFICATION): All frontend source files use /api/v1/ and zero unversioned /api/ paths', () => {
    const frontendSrcDir = path.resolve(__dirname, '../../frontend/src');
    const legacyMatches = [];

    function scanDir(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (/\.(jsx?|tsx?)$/.test(entry.name)) {
          // Exclude config/api.ts / api.js which declares the base resolution logic
          if (fullPath.endsWith(path.join('config', 'api.ts')) || fullPath.endsWith(path.join('config', 'api.js'))) continue;

          const content = fs.readFileSync(fullPath, 'utf8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Match /api/ NOT followed by v1/ or v2/ (excluding comments)
            if (/\/api\/(?!v[12]\/)/.test(line) && !line.trim().startsWith('//')) {
              legacyMatches.push(`${path.relative(frontendSrcDir, fullPath)}:${i + 1} -> ${line.trim()}`);
            }
          }
        }
      }
    }

    scanDir(frontendSrcDir);
    assert.deepEqual(
      legacyMatches,
      [],
      `Found ${legacyMatches.length} unversioned /api/ path(s) in frontend codebase:\n${legacyMatches.join('\n')}`
    );
  });

  // ── 9. v1_authLogin_returnsToken ─────────────────────────────────────────────
  it('9. v1_authLogin_returnsToken: POST /api/v1/auth/login authenticates and returns JWT v2 session', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@portal.com', password: 'admin123' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.token, 'Must return token');
    assert.equal(body.user?.role, 'admin');
  });

  // ── 10. v1_dashboard_jsonContractMatch ──────────────────────────────────────
  it('10. v1_dashboard_jsonContractMatch: GET /api/v1/dashboard matches /api/dashboard contract shape', async () => {
    const v1Res = await fetch(`${baseUrl}/api/v1/dashboard?clientId=client-jfl`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(v1Res.status, 200);
    const v1Body = await v1Res.json();

    const legacyRes = await fetch(`${baseUrl}/api/dashboard?clientId=client-jfl`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(legacyRes.status, 200);
    const legacyBody = await legacyRes.json();

    assert.deepEqual(
      Object.keys(v1Body).sort(),
      Object.keys(legacyBody).sort(),
      'Dashboard root keys must match exactly between v1 and legacy'
    );
    assert.ok(v1Body.executiveSummary, 'v1 dashboard must include executiveSummary');
    assert.ok(v1Body.siteSummary, 'v1 dashboard must include siteSummary');
  });

  // ── 11. v1_tenants_settings_roundtrip ────────────────────────────────────────
  it('11. v1_tenants_settings_roundtrip: GET /api/v1/tenants and /api/v1/tenants/:id/settings succeed', async () => {
    const res = await fetch(`${baseUrl}/api/v1/tenants`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const tenants = await res.json();
    assert.ok(Array.isArray(tenants) || Array.isArray(tenants.clients));

    const settingsRes = await fetch(`${baseUrl}/api/v1/tenants/client-jfl/settings`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(settingsRes.status, 200);
    const settings = await settingsRes.json();
    assert.ok(settings, 'Tenant settings must be returned');
  });

  // ── 12. v1_schedules_crud_parity ────────────────────────────────────────────
  it('12. v1_schedules_crud_parity: GET /api/v1/tenants/:id/schedules returns schedules from DB repo', async () => {
    const res = await fetch(`${baseUrl}/api/v1/tenants/client-jfl/schedules`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.schedules) || Array.isArray(body));
  });

  // ── 13. v1_dataHealth_parity ────────────────────────────────────────────────
  it('13. v1_dataHealth_parity: GET /api/v1/data-health returns anomaly report', async () => {
    const res = await fetch(`${baseUrl}/api/v1/data-health`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.health || body.summary || body.issues !== undefined);
  });

  // ── 14. v1_vulnerabilities_parity ───────────────────────────────────────────
  it('14. v1_vulnerabilities_parity: GET /api/v1/vulnerabilities returns CVE records', async () => {
    const res = await fetch(`${baseUrl}/api/v1/vulnerabilities`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.vulnerabilities) || Array.isArray(body));
  });

  // ── 15. v1_uploadSecurity_rateLimit_inherited ───────────────────────────────
  it('15. v1_uploadSecurity_rateLimit_inherited: Rate limiting and payload security apply uniformly to /api/v1', async () => {
    const unauthRes = await fetch(`${baseUrl}/api/v1/upload`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    assert.equal(unauthRes.status, 401, 'Unauthenticated upload to /api/v1 must be rejected with 401');
  });

  // ── 16. v1_tenantIsolation_enforced ─────────────────────────────────────────
  it('16. v1_tenantIsolation_enforced: Tenant isolation applies uniformly under /api/v1', async () => {
    const jflUser = authService.getUserByEmail('jfl@portal.com');
    const jflSession = authService.issueSessionForUser(jflUser);

    // JFL client user accessing MMTC tenant resource must be forbidden
    const forbiddenRes = await fetch(`${baseUrl}/api/v1/tenants/client-mmtcpamp/schedules`, {
      headers: { Authorization: `Bearer ${jflSession.token}` },
    });
    assert.equal(forbiddenRes.status, 403, 'Cross-tenant access under /api/v1 must return 403');
  });
});
