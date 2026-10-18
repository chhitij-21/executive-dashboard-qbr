// backend/routes/mfa.js
// Enterprise Multi-Factor Authentication (TOTP) router powered by speakeasy and qrcode.

'use strict';

const express = require('express');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const authService = require('../services/authService');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/mfa/setup
 * Generates a new TOTP secret and QR code for the authenticated user.
 */
router.post('/setup', requireAuth, async (req, res) => {
  try {
    const user = authService.getUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    const secret = speakeasy.generateSecret({
      length: 20,
      name: `Executive Dashboard (${user.email})`,
      issuer: 'Executive Dashboard QBR',
    });

    authService.setUserMFA(user.id, {
      pendingMfaSecret: secret.base32,
    });

    const qrCode = await qrcode.toDataURL(secret.otpauth_url);

    return res.status(200).json({
      success: true,
      secret: secret.base32,
      qrCode,
      otpauthUrl: secret.otpauth_url,
    });
  } catch (err) {
    console.error('[mfaRoute] Setup error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to initialize MFA setup.' });
  }
});

/**
 * POST /api/mfa/verify
 * Validates a 6-digit code against the pending secret and enables MFA on the account.
 */
router.post('/verify', requireAuth, (req, res) => {
  try {
    const { token, code } = req.body || {};
    const totpCode = (token || code || '').toString().trim();

    if (!totpCode || totpCode.length !== 6) {
      return res.status(400).json({ success: false, error: 'A valid 6-digit code is required.' });
    }

    const user = authService.getUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    const secretToVerify = user.pendingMfaSecret || user.mfaSecret;
    if (!secretToVerify) {
      return res.status(400).json({ success: false, error: 'MFA setup has not been initialized.' });
    }

    const verified = speakeasy.totp.verify({
      secret: secretToVerify,
      encoding: 'base32',
      token: totpCode,
      window: 1, // allow ±30 seconds clock drift
    });

    if (!verified) {
      return res.status(400).json({ success: false, error: 'Invalid 6-digit verification code.' });
    }

    authService.setUserMFA(user.id, {
      mfaSecret: secretToVerify,
      mfaEnabled: true,
      pendingMfaSecret: null,
    });

    return res.status(200).json({
      success: true,
      mfaEnabled: true,
      message: 'Multi-Factor Authentication enabled successfully.',
    });
  } catch (err) {
    console.error('[mfaRoute] Verify error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to verify MFA code.' });
  }
});

/**
 * POST /api/mfa/disable
 * Disables MFA on the authenticated user account.
 */
router.post('/disable', requireAuth, (req, res) => {
  try {
    const user = authService.getUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    authService.resetUserMFA(user.id);
    return res.status(200).json({
      success: true,
      mfaEnabled: false,
      message: 'Multi-Factor Authentication disabled successfully.',
    });
  } catch (err) {
    console.error('[mfaRoute] Disable error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to disable MFA.' });
  }
});

/**
 * GET /api/mfa/status
 * Returns current MFA status for authenticated user.
 */
router.get('/status', requireAuth, (req, res) => {
  const user = authService.getUserById(req.user.id);
  return res.status(200).json({
    success: true,
    mfaEnabled: !!user?.mfaEnabled,
  });
});

/**
 * POST /api/mfa/login-verify
 * Public endpoint to complete challenge login: exchanges tempToken + 6-digit TOTP code for full session JWT.
 */
router.post('/login-verify', (req, res) => {
  try {
    const { tempToken, token, code } = req.body || {};
    const totpCode = (token || code || '').toString().trim();

    if (!tempToken || typeof tempToken !== 'string') {
      return res.status(400).json({ success: false, error: 'Temporary session token is required.' });
    }

    if (!totpCode || totpCode.length !== 6) {
      return res.status(400).json({ success: false, error: 'A valid 6-digit code is required.' });
    }

    const user = authService.verifyMFATempToken(tempToken);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid or expired temporary session. Please sign in again.' });
    }

    if (!user.mfaSecret) {
      return res.status(400).json({ success: false, error: 'MFA is not configured for this user.' });
    }

    const verified = speakeasy.totp.verify({
      secret: user.mfaSecret,
      encoding: 'base32',
      token: totpCode,
      window: 1, // allow ±30 seconds clock drift
    });

    if (!verified) {
      return res.status(401).json({ success: false, error: 'Invalid 6-digit verification code.' });
    }

    // Single-use guarantee: consume tempToken
    authService.consumeMFATempToken(tempToken);

    // Issue permanent session token
    const session = authService.issueSessionForUser(user);

    return res.status(200).json({
      success: true,
      ...session,
    });
  } catch (err) {
    console.error('[mfaRoute] Login-verify error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to complete MFA verification.' });
  }
});

module.exports = router;
