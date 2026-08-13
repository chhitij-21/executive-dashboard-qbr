// backend/services/authService.js
const crypto = require('crypto');
// Authentication & Role-Based Access Control (RBAC) service.
// Supports Admin and Client User roles out-of-the-box.

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

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

// In-memory token map: token → { session, expiresAt }
const tokens = new Map();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _safeUser(user) {
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

  const user = USERS.find(
    (u) => u.email.toLowerCase() === email.toLowerCase() && u.password === password
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

module.exports = {
  authenticateUser,
  registerServiceSession,
  verifyToken,
  invalidateToken,
  getDemoUsers,
};
