// backend/services/authService.js
const crypto = require('crypto');
// Authentication & Role-Based Access Control (RBAC) service.
// Supports Admin and Client User roles out-of-the-box.

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DOWNLOAD_TICKET_TTL_MS = 60 * 1000; // 60 seconds (short-lived single-use)

const isProd = process.env.NODE_ENV === 'production';
const allowDemo = process.env.ALLOW_DEMO_ACCOUNTS === 'true';

// PRODUCTION PASSWORD INTEGRITY ENFORCEMENT
// Fail-fast on startup if required secrets are missing in production.
if (isProd && !allowDemo) {
  const missing = [];
  if (!process.env.ADMIN_PASSWORD) missing.push('ADMIN_PASSWORD');
  if (process.env.ENABLE_CLIENT_ACCOUNTS === 'true') {
    if (!process.env.JFL_PASSWORD) missing.push('JFL_PASSWORD');
    if (!process.env.MMTC_PASSWORD) missing.push('MMTC_PASSWORD');
  }
  if (missing.length > 0) {
    throw new Error(`[FATAL] Production startup halted: Missing required environment secret(s): ${missing.join(', ')}`);
  }
}

const SUPER_ADMIN = {
  id: 'user-super-admin',
  email: 'admin@portal.com',
  username: 'admin',
  password: process.env.ADMIN_PASSWORD || 'admin123', // override via env in production
  name: 'Super Admin',
  role: 'admin',
  assignedClient: 'all',
  avatar: '👑'
};

const USERS = [SUPER_ADMIN];

// BEHAVIORAL NOTE: Interaction between ENABLE_CLIENT_ACCOUNTS and password-based seeding:
// If ENABLE_CLIENT_ACCOUNTS is explicitly 'false', client accounts (JFL & MMTC) are skipped
// even if their passwords are provided. By default (or when 'true'), client user accounts are seeded
// using dedicated env vars in production or safe fixtures in non-production.
if (process.env.ENABLE_CLIENT_ACCOUNTS !== 'false') {
  const jflPassword = process.env.JFL_PASSWORD || (!isProd || allowDemo ? 'jfl123' : null);
  const mmtcPassword = process.env.MMTC_PASSWORD || (!isProd || allowDemo ? 'mmtc123' : null);

  if (jflPassword) {
    USERS.push({
      id: 'user-client-jfl',
      email: 'jfl@portal.com',
      username: 'jfl_user',
      password: jflPassword,
      name: 'JFL Portal User',
      role: 'client_user',
      assignedClient: 'client-jfl',
      avatar: '🍔'
    });
  }

  if (mmtcPassword) {
    USERS.push({
      id: 'user-client-mmtc',
      email: 'mmtc@portal.com',
      username: 'mmtc_user',
      password: mmtcPassword,
      name: 'MMTC Portal User',
      role: 'client_user',
      assignedClient: 'client-mmtcpamp',
      avatar: '🏭'
    });
  }
}

// In-memory token map: token → { session, expiresAt }
const tokens = new Map();

// In-memory download tickets: ticket → { userId, clientId, jobId, exportType, expiresAt }
const downloadTickets = new Map();
// In-memory SSE tickets: ticket → { user, userId, clientId, expiresAt }
const sseTickets = new Map();
const SSE_TICKET_TTL_MS = 60 * 1000; // 60 seconds

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _safeUser(user) {
  if (!user) return null;
  // Never expose password in any outbound object
  const { password, ...safe } = user;
  return safe;
}

function _purgeExpiredTokens() {
  const now = Date.now();
  for (const [tok, data] of tokens.entries()) {
    if (now > data.expiresAt) tokens.delete(tok);
  }
}

// ─── Auth Functions ───────────────────────────────────────────────────────────

function authenticateUser(email, password) {
  if (!email || !password) return null;

  const target = email.toLowerCase().trim();
  const user = USERS.find(
    (u) => (u.email.toLowerCase() === target || (u.username && u.username.toLowerCase() === target)) && u.password === password
  );
  if (!user) return null;

  _purgeExpiredTokens();

  // SECURITY: Use cryptographically secure random token. Never embed user ID or timestamp.
  const token = crypto.randomBytes(32).toString('hex');

  // Guard against unbounded memory growth on long-running servers
  if (tokens.size >= 10000) {
    _purgeExpiredTokens();
    // If still too large after purge, clear oldest 20%
    if (tokens.size >= 9000) {
      const keys = [...tokens.keys()].slice(0, Math.floor(tokens.size * 0.2));
      keys.forEach(k => tokens.delete(k));
    }
  }
  const expiresAt = Date.now() + TOKEN_TTL_MS;

  const session = {
    user: _safeUser(user),
    token,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
  };

  tokens.set(token, { ...session, expiresAt });
  return session;
}

function verifyToken(authHeader) {
  if (!authHeader) return null;

  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : authHeader.trim();

  if (!token) return null;

  const data = tokens.get(token);
  if (!data) return null;

  // Check expiry
  if (Date.now() > data.expiresAt) {
    tokens.delete(token);
    return null;
  }

  return data;
}

function invalidateToken(authHeader) {
  if (!authHeader) return;
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : authHeader.trim();
  tokens.delete(token);
}

function registerServiceSession(user) {
  const token = 'svc_' + crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const session = {
    user: _safeUser(user),
    token,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
  };
  tokens.set(token, { ...session, expiresAt });
  return session;
}

function getDemoUsers() {
  // Never expose password field
  return USERS.map((u) => ({
    email: u.email,
    name: u.name,
    role: u.role,
    assignedClient: u.assignedClient,
  }));
}

function _purgeExpiredDownloadTickets() {
  const now = Date.now();
  for (const [t, data] of downloadTickets.entries()) {
    if (now > data.expiresAt) downloadTickets.delete(t);
  }
}

function createDownloadTicket({ user, userId, clientId, jobId, exportType }) {
  _purgeExpiredDownloadTickets();
  const ticket = 'dl_' + crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + DOWNLOAD_TICKET_TTL_MS;
  const safeUser = user ? _safeUser(user) : (userId ? _safeUser(USERS.find(u => u.id === userId)) : null);
  downloadTickets.set(ticket, {
    user: safeUser,
    userId: userId || safeUser?.id,
    clientId,
    jobId: jobId || null,
    exportType: exportType || null,
    expiresAt,
  });
  return { ticket, expiresIn: 60 };
}

function verifyAndConsumeDownloadTicket(ticket, requestedClientId, jobId) {
  if (!ticket || typeof ticket !== 'string') return null;
  _purgeExpiredDownloadTickets();
  const data = downloadTickets.get(ticket);
  if (!data) return null;

  // Immediately consume ticket (single-use guarantee)
  downloadTickets.delete(ticket);

  if (Date.now() > data.expiresAt) return null;
  if (requestedClientId && data.clientId && data.clientId !== requestedClientId) return null;
  if (jobId && data.jobId && data.jobId !== 'latest' && jobId !== 'latest' && data.jobId !== jobId) return null;

  return data;
}

function _purgeExpiredSSETickets() {
  const now = Date.now();
  for (const [t, data] of sseTickets.entries()) {
    if (now > data.expiresAt) sseTickets.delete(t);
  }
}

function createSSETicket({ user, userId, clientId, ttlMs }) {
  _purgeExpiredSSETickets();
  const ticket = 'sse_' + crypto.randomBytes(32).toString('hex');
  const ttl = (typeof ttlMs === 'number') ? ttlMs : SSE_TICKET_TTL_MS;
  const expiresAt = Date.now() + ttl;
  const safeUser = user ? _safeUser(user) : (userId ? _safeUser(USERS.find(u => u.id === userId)) : null);
  sseTickets.set(ticket, {
    user: safeUser,
    userId: userId || safeUser?.id,
    clientId,
    expiresAt,
  });
  return { sseTicket: ticket, expiresIn: Math.max(0, Math.round(ttl / 1000)) };
}

function verifyAndConsumeSSETicket(ticket, requestedClientId) {
  if (!ticket || typeof ticket !== 'string') return null;
  _purgeExpiredSSETickets();
  const data = sseTickets.get(ticket);
  if (!data) return null;

  // Immediately consume ticket (single-use guarantee)
  sseTickets.delete(ticket);

  if (Date.now() > data.expiresAt) return null;
  if (requestedClientId && data.clientId && data.clientId !== requestedClientId) return null;

  return data;
}

module.exports = {
  authenticateUser,
  registerServiceSession,
  verifyToken,
  invalidateToken,
  getDemoUsers,
  createDownloadTicket,
  verifyAndConsumeDownloadTicket,
  createSSETicket,
  verifyAndConsumeSSETicket,
};
