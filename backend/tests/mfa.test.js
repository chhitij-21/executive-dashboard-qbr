// backend/tests/mfa.test.js
process.env.NODE_ENV = 'test';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const speakeasy = require('speakeasy');
const authService = require('../services/authService');
const app = require('../index');

describe('MFA (TOTP) Multi-Factor Authentication Suite', () => {
  let server;
  let baseUrl;
  let adminToken;

  beforeEach(async () => {
    // Reset MFA state for admin
    authService.resetUserMFA('user-super-admin');

    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    // Login as admin
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@portal.com', password: process.env.ADMIN_PASSWORD || 'admin123' }),
    });
    const loginJson = await loginRes.json();
    adminToken = loginJson.token;
  });

  afterEach(async () => {
    authService.resetUserMFA('user-super-admin');
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('Scenario 1: POST /api/mfa/setup generates secret and data:image/png QR code URI', async () => {
    const res = await fetch(`${baseUrl}/api/mfa/setup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    });

    assert.equal(res.status, 200, 'POST /api/mfa/setup should return 200');
    const json = await res.json();
    assert.equal(json.success, true);
    assert.ok(json.secret, 'Expected secret base32 string');
    assert.ok(json.qrCode, 'Expected qrCode data URI');
    assert.match(json.qrCode, /^data:image\/png;base64,/);
  });

  test('Scenario 2: POST /api/mfa/verify verifies valid TOTP code, enables MFA, rejects invalid code', async () => {
    // 1. Setup MFA
    const setupRes = await fetch(`${baseUrl}/api/mfa/setup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    });
    const { secret } = await setupRes.json();

    // 2. Attempt verify with invalid code
    const invalidRes = await fetch(`${baseUrl}/api/mfa/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ token: '000000' }),
    });
    assert.equal(invalidRes.status, 400, 'Invalid TOTP code should return 400');
    const invalidJson = await invalidRes.json();
    assert.equal(invalidJson.success, false);

    // 3. Generate valid TOTP token using speakeasy
    const validCode = speakeasy.totp({
      secret: secret,
      encoding: 'base32',
    });

    const verifyRes = await fetch(`${baseUrl}/api/mfa/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ token: validCode }),
    });

    assert.equal(verifyRes.status, 200, 'Valid TOTP code should return 200');
    const verifyJson = await verifyRes.json();
    assert.equal(verifyJson.success, true);
    assert.equal(verifyJson.mfaEnabled, true);

    // Verify user object reflects mfaEnabled
    const user = authService.getUserById('user-super-admin');
    assert.equal(user.mfaEnabled, true);
  });

  test('Scenario 3: POST /api/auth/login returns { mfaRequired: true, tempToken } when MFA enabled', async () => {
    // Enable MFA for admin user directly
    const secret = speakeasy.generateSecret().base32;
    authService.setUserMFA('user-super-admin', { mfaSecret: secret, mfaEnabled: true });

    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@portal.com', password: process.env.ADMIN_PASSWORD || 'admin123' }),
    });

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.mfaRequired, true, 'Expected mfaRequired: true');
    assert.ok(json.tempToken, 'Expected temporary token for MFA challenge');
    assert.equal(json.token, undefined, 'Must NOT issue final session token without MFA verification');
  });

  test('Scenario 4: POST /api/mfa/login-verify exchanges valid tempToken + TOTP code for full session token', async () => {
    // Enable MFA for admin user
    const secret = speakeasy.generateSecret().base32;
    authService.setUserMFA('user-super-admin', { mfaSecret: secret, mfaEnabled: true });

    // Step 1: Initial login returns tempToken
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@portal.com', password: process.env.ADMIN_PASSWORD || 'admin123' }),
    });
    const { tempToken } = await loginRes.json();
    assert.ok(tempToken);

    // Step 2: Attempt login-verify with wrong code
    const wrongRes = await fetch(`${baseUrl}/api/mfa/login-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempToken, token: '999999' }),
    });
    assert.equal(wrongRes.status, 401);
    const wrongJson = await wrongRes.json();
    assert.equal(wrongJson.success, false);

    // Step 3: Login-verify with valid code
    const validCode = speakeasy.totp({ secret, encoding: 'base32' });
    const successRes = await fetch(`${baseUrl}/api/mfa/login-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempToken, token: validCode }),
    });
    assert.equal(successRes.status, 200);
    const successJson = await successRes.json();
    assert.equal(successJson.success, true);
    assert.ok(successJson.token, 'Expected real session token');
    assert.equal(successJson.user.email, 'admin@portal.com');
    assert.equal(successJson.user.mfaSecret, undefined, 'Never expose mfaSecret in session user object');
  });
});
