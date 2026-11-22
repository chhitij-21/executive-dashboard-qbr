// backend/routes/v1/authRoutes.js
// Authentication, Session, Revocation, and Ticket endpoints (Item #4, #14, #16)

'use strict';

const express = require('express');
const router = express.Router();
const authService = require('../../services/authService');
const clientService = require('../../services/clientService');
const historyService = require('../../services/historyService');
const jobs = require('../../services/jobCache');
const { handleAutoAuthRoute, requireAuth, requireAdmin } = require('../../middleware/auth');

// ── Auto-Auth Route (for dev/automation) ────────────────────────────────────
router.get(['/auth/auto', '/api/auth/auto'], handleAutoAuthRoute);

// ── Login Route ─────────────────────────────────────────────────────────────
router.post(['/auth/login', '/api/auth/login'], async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const ip = req.headers['x-forwarded-for'] || req.ip || req.connection?.remoteAddress || '127.0.0.1';
  const username = email.trim().toLowerCase();

  // Rate limiting check: 5 attempts per 15 min per IP + username
  const rateLimit = await authService.checkLoginRateLimit(ip, username);
  if (!rateLimit.allowed) {
    res.set('Retry-After', String(rateLimit.retryAfter || 900));
    return res.status(429).json({
      error: 'Too many login attempts. Please try again in 15 minutes.',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: rateLimit.retryAfter || 900,
    });
  }

  const result = authService.authenticateUser(email.trim(), password);
  if (!result) {
    return res.status(401).json({ error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
  }

  // Clear failed attempt counter on success
  await authService.clearLoginRateLimit(ip, username);

  if (result.mfaRequired) {
    return res.json({
      mfaRequired: true,
      tempToken: result.tempToken,
      user: result.user,
    });
  }
  res.json(result);
});

// ── Current User Profile ────────────────────────────────────────────────────
router.get(['/auth/me', '/api/auth/me'], requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ── Logout ──────────────────────────────────────────────────────────────────
router.post(['/auth/logout', '/api/auth/logout'], async (req, res) => {
  await authService.invalidateToken(req.headers.authorization);
  res.json({ success: true, message: 'Logged out successfully.' });
});

// ── Admin-only Revocation ───────────────────────────────────────────────────
router.post(['/auth/revoke', '/api/auth/revoke'], requireAuth, requireAdmin, async (req, res) => {
  try {
    const { userId, jti } = req.body || {};
    if (!userId && !jti) {
      return res.status(400).json({ error: 'Either userId or jti is required for revocation.', code: 'MISSING_REVOCATION_TARGET' });
    }
    if (userId) {
      await authService.revokeAllUserTokens(userId);
    }
    if (jti) {
      await authService.revokeToken(jti);
    }
    res.json({ success: true, message: 'Revocation processed successfully.' });
  } catch (err) {
    if (err.statusCode === 503 || err.code === 'AUTH_SERVICE_UNAVAILABLE') {
      return res.status(503).json({ error: err.message, code: 'AUTH_SERVICE_UNAVAILABLE' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ── Demo Accounts Discovery ─────────────────────────────────────────────────
router.get(['/auth/demo-accounts', '/api/auth/demo-accounts'], (req, res) => {
  res.json({ users: authService.getDemoUsers() });
});

// ── Single-Use Short-Lived Download Ticket Issuance (60-second TTL) ───────────
router.post(['/auth/download-ticket', '/api/auth/download-ticket'], requireAuth, (req, res) => {
  const { clientId, jobId, exportType } = req.body || {};
  if (!clientId || typeof clientId !== 'string' || !clientId.trim()) {
    return res.status(400).json({ error: 'Customer identifier (clientId) is required.', code: 'MISSING_CLIENT_ID' });
  }

  const trimmedClientId = clientId.trim();
  const canonicalClientId = clientService.resolveCanonicalClientId(trimmedClientId);
  const client = clientService.getClientById(canonicalClientId);
  if (!client) {
    return res.status(404).json({ error: `Unknown customer '${trimmedClientId}'.`, code: 'UNKNOWN_CLIENT' });
  }

  // FAIL-CLOSED Role & Tenant Authorization Check
  if (!req.user || !req.user.role || !req.user.assignedClient) {
    return res.status(403).json({ error: 'Invalid authenticated profile.', code: 'ACCESS_DENIED' });
  }

  if (req.user.role !== 'admin') {
    const canonicalAssigned = clientService.resolveCanonicalClientId(req.user.assignedClient);
    if (canonicalAssigned !== canonicalClientId) {
      return res.status(403).json({
        error: `Forbidden: You are not authorized to access customer '${client.name || trimmedClientId}'.`,
        code: 'CUSTOMER_ACCESS_FORBIDDEN',
      });
    }
  }

  // Job ownership verification if jobId provided
  if (jobId && jobId !== 'latest' && jobId !== 'default') {
    const job = jobs[jobId] || historyService.getReportByJobId(jobId);
    if (!job) {
      return res.status(404).json({ error: `Job '${jobId}' not found.`, code: 'JOB_NOT_FOUND' });
    }
    if (job.clientId && clientService.resolveCanonicalClientId(job.clientId) !== canonicalClientId) {
      return res.status(403).json({
        error: `Customer isolation violation: Job '${jobId}' belongs to another customer.`,
        code: 'CUSTOMER_ISOLATION_VIOLATION',
      });
    }
  }

  const ticketData = authService.createDownloadTicket({
    user: req.user,
    userId: req.user.id,
    clientId: canonicalClientId,
    jobId: jobId || 'latest',
    exportType: exportType || 'export',
  });

  res.json({
    downloadTicket: ticketData.ticket,
    expiresIn: ticketData.expiresIn,
    clientId: canonicalClientId,
  });
});

// ── Single-Use Short-Lived SSE Ticket Issuance (60-second TTL) ────────────────
router.post(['/auth/sse-ticket', '/api/auth/sse-ticket'], requireAuth, (req, res) => {
  const { clientId } = req.body || {};
  if (!clientId || typeof clientId !== 'string' || !clientId.trim()) {
    return res.status(400).json({ error: 'Customer identifier (clientId) is required.', code: 'MISSING_CLIENT_ID' });
  }

  const trimmedClientId = clientId.trim();
  const canonicalClientId = clientService.resolveCanonicalClientId(trimmedClientId);
  const client = clientService.getClientById(canonicalClientId);
  if (!client) {
    return res.status(404).json({ error: `Unknown customer '${trimmedClientId}'.`, code: 'UNKNOWN_CLIENT' });
  }

  // FAIL-CLOSED Role & Tenant Authorization Check
  if (!req.user || !req.user.role || !req.user.assignedClient) {
    return res.status(403).json({ error: 'Invalid authenticated profile.', code: 'ACCESS_DENIED' });
  }

  if (req.user.role !== 'admin') {
    const canonicalAssigned = clientService.resolveCanonicalClientId(req.user.assignedClient);
    if (canonicalAssigned !== canonicalClientId) {
      return res.status(403).json({
        error: `Forbidden: You are not authorized to access customer '${client.name || trimmedClientId}'.`,
        code: 'CUSTOMER_ACCESS_FORBIDDEN',
      });
    }
  }

  const ticketData = authService.createDownloadTicket({
    user: req.user,
    userId: req.user.id,
    clientId: canonicalClientId,
    jobId: 'sse-events',
    exportType: 'sse',
  });

  res.json({
    sseTicket: ticketData.ticket,
    expiresIn: ticketData.expiresIn,
    clientId: canonicalClientId,
  });
});

module.exports = router;
