// backend/tests/authV2.test.js
// Automated test suite for Item #4 Real Auth (JWT v2, Redis Revocation, Bcrypt Migration, Rate Limiting)

process.env.NODE_ENV = 'test';
process.env.ALLOW_DEMO_ACCOUNTS = 'true';
process.env.JWT_SECRET = 'test-jwt-secret-with-at-least-32-characters-for-compliance';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const authService = require('../services/authService');
const app = require('../index');

describe('Item #4: Enterprise Real Auth (JWT v2 & Redis Revocation Suite)', () => {
  let server = null;
  let baseUrl = '';

  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  beforeEach(() => {
    // Reset in-memory rate limits & revocation between tests
    if (typeof authService.resetRevocationState === 'function') {
      authService.resetRevocationState();
    }
    if (typeof authService.resetRateLimits === 'function') {
      authService.resetRateLimits();
    }
  });

  // ── 1. mintJwt_valid4hTtl ──────────────────────────────────────────────────
  it('1. mintJwt_valid4hTtl: Minted token contains exp - iat === 14400s (4 hours) and valid signature', () => {
    const adminUser = authService.getUserByEmail('admin@portal.com');
    assert.ok(adminUser, 'Admin user must exist');

    const session = authService.issueSessionForUserV2(adminUser);
    assert.ok(session.token, 'Session must have token');
    assert.equal(session.user.email, 'admin@portal.com');

    const decoded = authService.decodeJwt(session.token);
    assert.ok(decoded, 'Token must be decodable');
    assert.ok(decoded.payload.jti, 'Payload must include jti UUID');
    assert.equal(decoded.payload.sub, adminUser.id);
    assert.equal(decoded.payload.email, adminUser.email);
    assert.equal(decoded.payload.role, 'admin');

    const lifespan = decoded.payload.exp - decoded.payload.iat;
    assert.equal(lifespan, 4 * 60 * 60, 'Token lifespan must be exactly 4 hours (14,400 seconds)');
  });

  // ── 2. verifyToken_validSignature ──────────────────────────────────────────
  it('2. verifyToken_validSignature: requireAuth succeeds with HTTP 200 and attaches req.user', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@portal.com', password: process.env.ADMIN_PASSWORD || 'admin123' }),
    });
    assert.equal(loginRes.status, 200);
    const { token } = await loginRes.json();

    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(meRes.status, 200);
    const meData = await meRes.json();
    assert.equal(meData.user.email, 'admin@portal.com');
    assert.equal(meData.user.role, 'admin');
    assert.equal(meData.user.password, undefined, 'Sensitive password field must never be exposed');
  });

  // ── 3. verifyToken_expiredToken_returns401 ──────────────────────────────────
  it('3. verifyToken_expiredToken_returns401: Token with past exp is rejected with HTTP 401', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const expiredPayload = {
      sub: 'user-client-jfl',
      email: 'jfl@portal.com',
      role: 'client_user',
      assignedClient: 'client-jfl',
      jti: 'expired-jti-uuid',
      iat: nowSec - 20000,
      exp: nowSec - 5000, // Expired 5,000s ago
    };
    const expiredToken = authService.signJwt(expiredPayload);

    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.code, 'TOKEN_EXPIRED');
  });

  // ── 4. verifyToken_invalidSecret_returns401 ────────────────────────────────
  it('4. verifyToken_invalidSecret_returns401: Token signed with mismatched secret returns HTTP 401', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const payload = {
      sub: 'user-client-jfl',
      email: 'jfl@portal.com',
      role: 'client_user',
      assignedClient: 'client-jfl',
      jti: 'bad-secret-jti',
      iat: nowSec,
      exp: nowSec + 14400,
    };
    const badSecretToken = authService.signJwt(payload, 'wrong-secret-key-that-does-not-match-current');

    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${badSecretToken}` },
    });
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.code, 'INVALID_TOKEN');
  });

  // ── 5. logout_revokesJti_subsequentRequest401 ──────────────────────────────
  it('5. logout_revokesJti_subsequentRequest401: POST /api/auth/logout revokes jti; next call returns 401', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'jfl@portal.com', password: process.env.JFL_PASSWORD || 'jfl123' }),
    });
    assert.equal(loginRes.status, 200);
    const { token } = await loginRes.json();

    // Verify token works before logout
    const preRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(preRes.status, 200);

    // Call logout
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(logoutRes.status, 200);

    // Verify token is now blocked
    const postRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(postRes.status, 401);
    const postData = await postRes.json();
    assert.equal(postData.code, 'TOKEN_REVOKED');
  });

  // ── 6. revoke_adminOnly_nonAdminForbidden ──────────────────────────────────
  it('6. revoke_adminOnly_nonAdminForbidden: POST /api/auth/revoke blocks client user with HTTP 403', async () => {
    const jflLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'jfl@portal.com', password: process.env.JFL_PASSWORD || 'jfl123' }),
    });
    const { token: jflToken } = await jflLogin.json();

    const revokeRes = await fetch(`${baseUrl}/api/auth/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jflToken}`,
      },
      body: JSON.stringify({ userId: 'user-client-jfl' }),
    });
    assert.equal(revokeRes.status, 403);
    const body = await revokeRes.json();
    assert.equal(body.code, 'ADMIN_ACCESS_REQUIRED');
  });

  // ── 7. revoke_userLevel_killsAllActiveSessions ─────────────────────────────
  it('7. revoke_userLevel_killsAllActiveSessions: Admin revoking userId cuts off all sessions for that user', async () => {
    // 1. Login JFL user on session 1
    const s1Res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'jfl@portal.com', password: process.env.JFL_PASSWORD || 'jfl123' }),
    });
    const { token: t1 } = await s1Res.json();

    // 2. Login Admin
    const adminRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@portal.com', password: process.env.ADMIN_PASSWORD || 'admin123' }),
    });
    const { token: adminToken } = await adminRes.json();

    // JFL session 1 works
    const check1 = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${t1}` },
    });
    assert.equal(check1.status, 200);

    // Admin revokes all sessions for user-client-jfl
    const revokeRes = await fetch(`${baseUrl}/api/auth/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ userId: 'user-client-jfl' }),
    });
    assert.equal(revokeRes.status, 200);

    // JFL session 1 must now return 401 USER_SESSION_TERMINATED
    const check2 = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${t1}` },
    });
    assert.equal(check2.status, 401);
    const check2Data = await check2.json();
    assert.equal(check2Data.code, 'USER_SESSION_TERMINATED');
  });

  // ── 8. passwordChange_triggersUserRevocation ───────────────────────────────
  it('8. passwordChange_triggersUserRevocation: Changing user password invalidates all existing sessions', async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'mmtc@portal.com', password: process.env.MMTC_PASSWORD || 'mmtc123' }),
    });
    const { token } = await loginRes.json();

    const okRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(okRes.status, 200);

    // Simulate password change via service
    await authService.updateUserPassword('user-client-mmtc', 'NewMmtcSecurePass123!');

    // Session minted before password change must now fail
    const revokedRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(revokedRes.status, 401);
    const body = await revokedRes.json();
    assert.equal(body.code, 'USER_SESSION_TERMINATED');

    // Restore original password for downstream tests
    await authService.updateUserPassword('user-client-mmtc', process.env.MMTC_PASSWORD || 'mmtc123');
  });

  // ── 9. prodFailClosed_redisDown_returns503 ─────────────────────────────────
  it('9. prodFailClosed_redisDown_returns503: In production, Redis outage returns HTTP 503 Service Unavailable', async () => {
    const adminUser = authService.getUserByEmail('admin@portal.com');
    const validToken = authService.issueSessionForUserV2(adminUser).token;

    // Simulate production environment with broken Redis client
    const origEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      authService.setSimulatedRedisFailure(true);

      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${validToken}` },
      });
      assert.equal(res.status, 503);
      const data = await res.json();
      assert.equal(data.code, 'AUTH_SERVICE_UNAVAILABLE');
    } finally {
      process.env.NODE_ENV = origEnv;
      authService.setSimulatedRedisFailure(false);
    }
  });

  // ── 10. onBootMigration_hashesPlaintextDemoUsers ───────────────────────────
  it('10. onBootMigration_hashesPlaintextDemoUsers: Plaintext passwords are automatically migrated to bcrypt hashes', async () => {
    const testUsersPath = path.resolve(__dirname, '../../data/test_migration_users.json');
    const plaintextFixture = {
      'user-legacy-test': {
        id: 'user-legacy-test',
        email: 'legacy@enterprise.com',
        username: 'legacy_user',
        password: 'unhashed_plain_password_123',
        role: 'client_user',
        assignedClient: 'client-jfl',
      },
    };
    fs.writeFileSync(testUsersPath, JSON.stringify(plaintextFixture, null, 2), 'utf8');

    try {
      const migratedCount = await authService.migratePlaintextPasswordsFile(testUsersPath);
      assert.equal(migratedCount, 1, 'Must migrate 1 plaintext user');

      const migratedContent = JSON.parse(fs.readFileSync(testUsersPath, 'utf8'));
      const migratedUser = migratedContent['user-legacy-test'];
      assert.notEqual(migratedUser.password, 'unhashed_plain_password_123');
      assert.ok(
        migratedUser.password.startsWith('$2a$') || migratedUser.password.startsWith('$2b$'),
        'Password must be transformed into standard bcrypt hash'
      );
      assert.ok(
        bcrypt.compareSync('unhashed_plain_password_123', migratedUser.password),
        'Bcrypt hash must verify against original plaintext'
      );
    } finally {
      if (fs.existsSync(testUsersPath)) fs.unlinkSync(testUsersPath);
    }
  });

  // ── 11. noUserEnumeration_constantTimeCompare ──────────────────────────────
  it('11. noUserEnumeration_constantTimeCompare: Non-existent user and wrong password return identical HTTP 401', async () => {
    const badUserRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nonexistent-user-xyz@portal.com', password: 'SomeRandomPassword999!' }),
    });
    assert.equal(badUserRes.status, 401);
    const badUserBody = await badUserRes.json();

    const badPassRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@portal.com', password: 'DefinitivelyIncorrectPassword!' }),
    });
    assert.equal(badPassRes.status, 401);
    const badPassBody = await badPassRes.json();

    assert.equal(badUserBody.code, 'INVALID_CREDENTIALS');
    assert.equal(badPassBody.code, 'INVALID_CREDENTIALS');
    assert.equal(badUserBody.error, badPassBody.error, 'Error message must be identical to prevent user enumeration');
  });

  // ── 12. authV2_rollbackFlag_preservesLegacyMap ─────────────────────────────
  it('12. authV2_rollbackFlag_preservesLegacyMap: AUTH_V2=false flag routes auth through legacy session map', async () => {
    const origFlag = process.env.AUTH_V2;
    try {
      process.env.AUTH_V2 = 'false';

      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@portal.com', password: process.env.ADMIN_PASSWORD || 'admin123' }),
      });
      assert.equal(loginRes.status, 200);
      const { token } = await loginRes.json();

      // Legacy token is a 64-char hex string, NOT a 3-part JWT
      assert.equal(token.split('.').length, 1, 'Legacy token must not be a 3-part dot-separated JWT');

      const meRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(meRes.status, 200);
      const meData = await meRes.json();
      assert.equal(meData.user.email, 'admin@portal.com');
    } finally {
      process.env.AUTH_V2 = origFlag;
    }
  });

  // ── 13. loginRateLimit_5Attempts_6thReturns429 ──────────────────────────────
  it('13. loginRateLimit_5Attempts_6thReturns429: 5 failed attempts succeed, 6th attempt returns HTTP 429 with Retry-After', async () => {
    const testEmail = 'bruteforce-test@portal.com';
    const testIp = '192.168.10.45';

    for (let i = 1; i <= 5; i++) {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': testIp,
        },
        body: JSON.stringify({ email: testEmail, password: `WrongPassAttempt${i}` }),
      });
      assert.equal(res.status, 401, `Attempt ${i} should return 401`);
    }

    // 6th attempt must be rejected by rate limiter
    const blockedRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': testIp,
      },
      body: JSON.stringify({ email: testEmail, password: 'WrongPassAttempt6' }),
    });

    assert.equal(blockedRes.status, 429, '6th attempt must return HTTP 429 Too Many Requests');
    assert.equal(blockedRes.headers.get('retry-after'), '900', 'Must include Retry-After header with 900 seconds');
    const blockedBody = await blockedRes.json();
    assert.equal(blockedBody.code, 'RATE_LIMIT_EXCEEDED');
  });

  // ── 14. prodStartup_missingJwtSecret_throws ────────────────────────────────
  it('14. prodStartup_missingJwtSecret_throws: Production startup halts if JWT_SECRET is missing or < 32 chars', () => {
    const origEnv = process.env.NODE_ENV;
    const origSecret = process.env.JWT_SECRET;

    try {
      process.env.NODE_ENV = 'production';
      delete process.env.JWT_SECRET;

      assert.throws(
        () => {
          authService.assertJwtSecretValid();
        },
        /FATAL.*Missing or insecure JWT_SECRET/
      );

      process.env.JWT_SECRET = 'too-short';
      assert.throws(
        () => {
          authService.assertJwtSecretValid();
        },
        /FATAL.*Missing or insecure JWT_SECRET/
      );
    } finally {
      process.env.NODE_ENV = origEnv;
      process.env.JWT_SECRET = origSecret;
    }
  });
});

