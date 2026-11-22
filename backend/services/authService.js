// backend/services/authService.js
// Enterprise Authentication, JWT v2, RBAC, and Token Revocation Service (Item #4)

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const userRepo = require('../repositories/userRepo');

const TOKEN_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours access token lifespan (Item #4 spec)
const LEGACY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours for legacy fallback
const DOWNLOAD_TICKET_TTL_MS = 60 * 1000; // 60 seconds (short-lived single-use)
const SSE_TICKET_TTL_MS = 60 * 1000; // 60 seconds
const MFA_TEMP_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

const isProd = process.env.NODE_ENV === 'production';
const allowDemo = process.env.ALLOW_DEMO_ACCOUNTS === 'true';

/**
 * Validates the JWT_SECRET configuration.
 * In production (NODE_ENV=production), fails fast if missing or < 32 chars.
 */
function assertJwtSecretValid() {
  const secret = process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    if (!secret || typeof secret !== 'string' || secret.trim().length < 32) {
      throw new Error('[FATAL] Production startup halted: Missing or insecure JWT_SECRET (must be >= 32 chars).');
    }
  }
  return secret || 'dev-jwt-secret-at-least-32-characters-long-for-testing';
}

// Fail-fast on startup if required secrets are missing in production
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

// Base seed accounts
const SUPER_ADMIN = {
  id: 'user-super-admin',
  email: 'admin@portal.com',
  username: 'admin',
  password: process.env.ADMIN_PASSWORD || 'admin123',
  name: 'Super Admin',
  role: 'admin',
  assignedClient: 'all',
  avatar: '👑',
};

const USERS = [SUPER_ADMIN];

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
      avatar: '🍔',
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
      avatar: '🏭',
    });
  }
}

const USERS_FILE = path.resolve(__dirname, '../../data/users.json');

// In-memory legacy fallback token map: token -> { session, expiresAt }
const tokens = new Map();

// In-memory tickets
const downloadTickets = new Map();
const sseTickets = new Map();
const mfaTempTokens = new Map();

// In-memory active revocation state (used in test & dev fallback)
const _inMemoryBlocklist = new Map(); // jti -> expiresAtSec
const _inMemoryUserRevokedBefore = new Map(); // userId -> timestampSec
let _simulatedRedisFailure = false;

// In-memory login rate limit map: key -> { count, expiresAtMs }
const _inMemoryLoginRateMap = new Map();

// ─── Atomic File Writing Helper ───────────────────────────────────────────────

function safeWriteJsonSync(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
  const payload = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmp, payload, 'utf8');
  try {
    fs.renameSync(tmp, filePath);
  } catch (_) {
    try {
      fs.copyFileSync(tmp, filePath);
      fs.unlinkSync(tmp);
    } catch (__) {
      fs.writeFileSync(filePath, payload, 'utf8');
      try { fs.unlinkSync(tmp); } catch (___) {}
    }
  }
}

// ─── Persistence & Password Migration ─────────────────────────────────────────

function loadUserMfaData() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      let raw = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          raw = fs.readFileSync(USERS_FILE, 'utf-8');
          break;
        } catch (e) {
          if (e.code === 'EBUSY' && attempt < 4) {
            const start = Date.now();
            while (Date.now() - start < 25) {}
          } else {
            return;
          }
        }
      }
      if (!raw) return;
      const mfaMap = JSON.parse(raw);
      if (typeof mfaMap === 'object' && mfaMap !== null) {
        for (const user of USERS) {
          const entry =
            mfaMap[user.id] ||
            Object.values(mfaMap).find(
              (e) =>
                e &&
                ((e.id && e.id === user.id) ||
                  (e.email && user.email && e.email.toLowerCase() === user.email.toLowerCase()) ||
                  (e.username && user.username && e.username.toLowerCase() === user.username.toLowerCase()))
            );

          if (entry) {
            user.mfaSecret = entry.mfaSecret || null;
            user.mfaEnabled = !!entry.mfaEnabled;
            user.pendingMfaSecret = entry.pendingMfaSecret || null;
            if (entry.password) user.password = entry.password;
          }
        }

        for (const [key, val] of Object.entries(mfaMap)) {
          if (val && typeof val === 'object' && (val.email || val.id)) {
            const userId = val.id || key;
            const userEmail = val.email ? String(val.email).toLowerCase().trim() : '';
            const exists = USERS.some(
              (u) => u.id === userId || (userEmail && u.email && u.email.toLowerCase() === userEmail)
            );
            if (!exists) {
              USERS.push({
                id: userId,
                email: val.email || `${userId}@portal.com`,
                username: val.username || (userEmail ? userEmail.split('@')[0] : userId),
                password: val.password || null,
                name: val.name || (val.role === 'admin' ? 'Admin User' : 'Portal User'),
                role: val.role || 'client_user',
                assignedClient: val.assignedClient || (val.role === 'admin' ? 'all' : 'client-jfl'),
                avatar: val.avatar || (val.role === 'admin' ? '👑' : '👤'),
                mfaSecret: val.mfaSecret || null,
                mfaEnabled: !!val.mfaEnabled,
                pendingMfaSecret: val.pendingMfaSecret || null,
              });
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('[authService] Warning: Failed to load user data from users.json:', err.message);
  }
}

function saveUserMfaData() {
  try {
    let existingMap = {};
    if (fs.existsSync(USERS_FILE)) {
      try {
        existingMap = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8')) || {};
      } catch (e) {}
    }
    const mfaMap = { ...existingMap };
    for (const user of USERS) {
      if (user.mfaSecret || user.mfaEnabled || user.pendingMfaSecret || existingMap[user.id] || user.password) {
        mfaMap[user.id] = {
          ...(existingMap[user.id] || {}),
          id: user.id,
          email: user.email,
          username: user.username,
          password: user.password || existingMap[user.id]?.password || undefined,
          name: user.name,
          role: user.role,
          assignedClient: user.assignedClient,
          avatar: user.avatar,
          mfaSecret: user.mfaSecret || null,
          mfaEnabled: !!user.mfaEnabled,
          pendingMfaSecret: user.pendingMfaSecret || null,
          updatedAt: new Date().toISOString(),
        };
      }
    }
    safeWriteJsonSync(USERS_FILE, mfaMap);
  } catch (err) {
    console.warn('[authService] Warning: Failed to save user data to users.json:', err.message);
  }
}

function migratePlaintextPasswordsFile(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  let raw = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      raw = fs.readFileSync(filePath, 'utf8');
      break;
    } catch (e) {
      if (e.code === 'EBUSY' && attempt < 4) {
        const start = Date.now();
        while (Date.now() - start < 25) {}
      } else {
        return 0;
      }
    }
  }
  if (!raw) return 0;
  let content;
  try {
    content = JSON.parse(raw);
  } catch (_) {
    return 0;
  }
  let count = 0;
  if (typeof content === 'object' && content !== null) {
    for (const key of Object.keys(content)) {
      const u = content[key];
      if (u && u.password && typeof u.password === 'string' && !u.password.startsWith('$2a$') && !u.password.startsWith('$2b$') && !u.password.startsWith('$2y$')) {
        u.password = bcrypt.hashSync(u.password, 10);
        count++;
      }
    }
  }
  if (count > 0) {
    try {
      safeWriteJsonSync(filePath, content);
    } catch (_) {}
  }
  return count;
}

function migrateAllPasswords() {
  if (process.env.AUTH_V2 === 'false') return;
  let modified = false;
  for (const u of USERS) {
    if (u.password && typeof u.password === 'string' && !u.password.startsWith('$2a$') && !u.password.startsWith('$2b$') && !u.password.startsWith('$2y$')) {
      u.password = bcrypt.hashSync(u.password, 10);
      modified = true;
    }
  }
  if (fs.existsSync(USERS_FILE)) {
    migratePlaintextPasswordsFile(USERS_FILE);
  }
  if (modified) {
    saveUserMfaData();
  }
}

// Perform initialization
loadUserMfaData();
migrateAllPasswords();

// ─── JWT Primitives (RFC 7519 HMAC-SHA256) ───────────────────────────────────

function base64UrlEncode(strOrBuffer) {
  return Buffer.from(strOrBuffer)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  return Buffer.from(base64, 'base64').toString('utf8');
}

function signJwt(payload, secret = assertJwtSecretValid()) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();
  const encodedSignature = base64UrlEncode(signature);
  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

function decodeJwt(token) {
  const parts = (token || '').split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(base64UrlDecode(parts[0]));
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    return { header, payload, signature: parts[2] };
  } catch (_) {
    return null;
  }
}

function verifyJwtSignature(token, secret = assertJwtSecretValid()) {
  const decoded = decodeJwt(token);
  if (!decoded) return { valid: false, error: 'MALFORMED_TOKEN' };
  const parts = token.split('.');
  const expectedSig = base64UrlEncode(
    crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest()
  );

  const sigBuf = Buffer.from(parts[2]);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return { valid: false, error: 'INVALID_TOKEN' };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (decoded.payload.exp && nowSec > decoded.payload.exp) {
    return { valid: false, error: 'TOKEN_EXPIRED', payload: decoded.payload };
  }

  return { valid: true, payload: decoded.payload };
}

// ─── Redis & In-Memory Active Revocation ───────────────────────────────────────

function setSimulatedRedisFailure(flag) {
  _simulatedRedisFailure = !!flag;
}

function resetRevocationState() {
  _inMemoryBlocklist.clear();
  _inMemoryUserRevokedBefore.clear();
}

function getRedisClient() {
  if (_simulatedRedisFailure) {
    return { status: 'failed' };
  }
  try {
    const queueService = require('./queueService');
    if (queueService.redisClient && queueService.redisClient.status === 'ready') {
      return queueService.redisClient;
    }
  } catch (_) {}
  return null;
}

async function revokeToken(jti, expSec) {
  if (!jti) return;
  const nowSec = Math.floor(Date.now() / 1000);
  const ttlSec = expSec ? Math.max(1, expSec - nowSec) : 4 * 3600;

  const redis = getRedisClient();
  if (process.env.NODE_ENV === 'production' && (!redis || redis.status !== 'ready')) {
    const err = new Error('Authentication validation service temporarily unavailable.');
    err.statusCode = 503;
    err.code = 'AUTH_SERVICE_UNAVAILABLE';
    throw err;
  }

  if (redis && redis.status === 'ready') {
    await redis.set(`blocklist:${jti}`, '1', 'EX', ttlSec);
  } else {
    _inMemoryBlocklist.set(jti, nowSec + ttlSec);
  }
}

async function revokeAllUserTokens(userId) {
  if (!userId) return;
  const nowSec = Math.floor(Date.now() / 1000);
  const redis = getRedisClient();

  if (process.env.NODE_ENV === 'production' && (!redis || redis.status !== 'ready')) {
    const err = new Error('Authentication validation service temporarily unavailable.');
    err.statusCode = 503;
    err.code = 'AUTH_SERVICE_UNAVAILABLE';
    throw err;
  }

  if (redis && redis.status === 'ready') {
    await redis.set(`user_revoked_before:${userId}`, String(nowSec), 'EX', 4 * 3600);
  } else {
    _inMemoryUserRevokedBefore.set(userId, nowSec);
  }
}

async function isTokenRevoked(jti, userId, iatSec) {
  if (process.env.AUTH_V2 === 'false') return { revoked: false };

  const isProd = process.env.NODE_ENV === 'production';
  const redis = getRedisClient();

  if (isProd && (!redis || redis.status !== 'ready')) {
    const err = new Error('Authentication validation service temporarily unavailable.');
    err.statusCode = 503;
    err.code = 'AUTH_SERVICE_UNAVAILABLE';
    throw err;
  }

  if (redis && redis.status === 'ready') {
    if (jti) {
      const isBlocked = await redis.get(`blocklist:${jti}`);
      if (isBlocked) return { revoked: true, reason: 'TOKEN_REVOKED' };
    }
    if (userId) {
      const revokedBefore = await redis.get(`user_revoked_before:${userId}`);
      if (revokedBefore && iatSec <= parseInt(revokedBefore, 10)) {
        return { revoked: true, reason: 'USER_SESSION_TERMINATED' };
      }
    }
    return { revoked: false };
  }

  // In-memory fallback (test / local non-prod)
  const nowSec = Math.floor(Date.now() / 1000);
  if (jti && _inMemoryBlocklist.has(jti)) {
    const exp = _inMemoryBlocklist.get(jti);
    if (nowSec <= exp) return { revoked: true, reason: 'TOKEN_REVOKED' };
    _inMemoryBlocklist.delete(jti);
  }
  if (userId && _inMemoryUserRevokedBefore.has(userId)) {
    const revokedBefore = _inMemoryUserRevokedBefore.get(userId);
    if (iatSec <= revokedBefore) {
      return { revoked: true, reason: 'USER_SESSION_TERMINATED' };
    }
  }

  return { revoked: false };
}

// ─── Login Rate Limiting ───────────────────────────────────────────────────────

function resetRateLimits() {
  _inMemoryLoginRateMap.clear();
}

async function checkLoginRateLimit(ip, username) {
  const normalizedUser = (username || '').toLowerCase().trim();
  const key = `login_attempt:${ip}:${normalizedUser}`;
  const redis = getRedisClient();

  if (redis && redis.status === 'ready') {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 900);
    if (count > 5) {
      const ttl = await redis.ttl(key);
      return { allowed: false, retryAfter: Math.max(1, ttl) };
    }
    return { allowed: true };
  }

  // In-memory fallback
  const now = Date.now();
  let entry = _inMemoryLoginRateMap.get(key);
  if (!entry || now > entry.expiresAtMs) {
    entry = { count: 0, expiresAtMs: now + 900 * 1000 };
  }
  entry.count += 1;
  _inMemoryLoginRateMap.set(key, entry);

  if (entry.count > 5) {
    const retryAfter = Math.max(1, Math.ceil((entry.expiresAtMs - now) / 1000));
    return { allowed: false, retryAfter };
  }
  return { allowed: true };
}

async function clearLoginRateLimit(ip, username) {
  const normalizedUser = (username || '').toLowerCase().trim();
  const key = `login_attempt:${ip}:${normalizedUser}`;
  const redis = getRedisClient();
  if (redis && redis.status === 'ready') {
    await redis.del(key);
  } else {
    _inMemoryLoginRateMap.delete(key);
  }
}

// ─── Session Issuance ─────────────────────────────────────────────────────────

function _safeUser(user) {
  if (!user) return null;
  const { password, mfaSecret, pendingMfaSecret, ...safe } = user;
  return {
    ...safe,
    mfaEnabled: !!user.mfaEnabled,
  };
}

function _purgeExpiredTokens() {
  const now = Date.now();
  for (const [tok, data] of tokens.entries()) {
    if (now > data.expiresAt) tokens.delete(tok);
  }
  for (const [t, data] of mfaTempTokens.entries()) {
    if (now > data.expiresAt) mfaTempTokens.delete(t);
  }
}

function issueSessionForUserLegacy(user) {
  _purgeExpiredTokens();
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + LEGACY_TOKEN_TTL_MS;
  const session = {
    user: _safeUser(user),
    token,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
  };
  tokens.set(token, { ...session, expiresAt });
  return session;
}

function issueSessionForUserV2(user) {
  let nowSec = Math.floor(Date.now() / 1000);
  const revokedBefore = _inMemoryUserRevokedBefore.get(user?.id);
  if (revokedBefore && nowSec <= revokedBefore) {
    nowSec = revokedBefore + 1;
  }
  const expSec = nowSec + 4 * 3600; // Exactly 4 hours
  const jti = crypto.randomUUID();

  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    assignedClient: user.assignedClient,
    jti,
    iat: nowSec,
    exp: expSec,
  };

  const token = signJwt(payload);
  const session = {
    user: _safeUser(user),
    token,
    payload,
    createdAt: new Date(nowSec * 1000).toISOString(),
    expiresAt: new Date(expSec * 1000).toISOString(),
  };

  // Also maintain in-memory map for fast sync lookups if needed
  tokens.set(token, { ...session, expiresAt: expSec * 1000 });
  return session;
}

function issueSessionForUser(user) {
  if (process.env.AUTH_V2 === 'false') {
    return issueSessionForUserLegacy(user);
  }
  return issueSessionForUserV2(user);
}

// ─── User Authentication & Profile Lookups ────────────────────────────────────

function getUserById(id) {
  return USERS.find((u) => u.id === id) || null;
}

function getUserByEmail(email) {
  if (!email) return null;
  const target = email.toLowerCase().trim();
  return (
    USERS.find(
      (u) => u.email.toLowerCase() === target || (u.username && u.username.toLowerCase() === target)
    ) || null
  );
}

async function updateUserPassword(userId, newPassword) {
  const user = getUserById(userId);
  if (!user) throw new Error(`User not found: ${userId}`);
  user.password = bcrypt.hashSync(newPassword, 10);
  saveUserMfaData();
  try {
    await userRepo.updatePassword(userId, user.password);
  } catch (_) {}
  await revokeAllUserTokens(userId);
  return true;
}

function authenticateUser(email, password) {
  if (!email || !password) return null;

  const target = email.toLowerCase().trim();
  const user = USERS.find(
    (u) => u.email.toLowerCase() === target || (u.username && u.username.toLowerCase() === target)
  );
  if (!user || !user.password) return null;

  let isMatch = false;
  if (
    user.password.startsWith('$2a$') ||
    user.password.startsWith('$2b$') ||
    user.password.startsWith('$2y$')
  ) {
    isMatch = bcrypt.compareSync(password, user.password);
  } else {
    // Plaintext legacy verification with lazy upgrade
    isMatch = (user.password === password);
    if (isMatch && process.env.AUTH_V2 !== 'false') {
      user.password = bcrypt.hashSync(password, 10);
      saveUserMfaData();
    }
  }

  if (!isMatch) return null;

  if (user.mfaEnabled) {
    const tempToken = createMFATempToken(user);
    return {
      mfaRequired: true,
      tempToken,
      user: _safeUser(user),
    };
  }

  return issueSessionForUser(user);
}

// ─── Token Verification & Invalidation ────────────────────────────────────────

async function verifyToken(authHeader) {
  if (!authHeader) return null;

  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : authHeader.trim();

  if (!token) return null;

  // Legacy fallback if explicitly disabled
  if (process.env.AUTH_V2 === 'false') {
    const data = tokens.get(token);
    if (!data) return null;
    if (Date.now() > data.expiresAt) {
      tokens.delete(token);
      return null;
    }
    return data;
  }

  // Standard JWT (contains 2 dots)
  if (token.split('.').length === 3) {
    const verifyResult = verifyJwtSignature(token);
    if (!verifyResult.valid) {
      const err = new Error(
        verifyResult.error === 'TOKEN_EXPIRED'
          ? 'Token expired.'
          : 'Invalid authentication token.'
      );
      err.code = verifyResult.error;
      throw err;
    }

    const { payload } = verifyResult;
    const revocation = await isTokenRevoked(payload.jti, payload.sub, payload.iat);
    if (revocation.revoked) {
      const err = new Error('Token has been revoked.');
      err.code = revocation.reason || 'TOKEN_REVOKED';
      throw err;
    }

    const user = getUserById(payload.sub) || {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      assignedClient: payload.assignedClient,
    };

    return {
      user: _safeUser(user),
      token,
      payload,
      createdAt: new Date(payload.iat * 1000).toISOString(),
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    };
  }

  // Fallback for service tokens (svc_...) or legacy tokens
  const data = tokens.get(token);
  if (!data) return null;
  if (Date.now() > data.expiresAt) {
    tokens.delete(token);
    return null;
  }
  return data;
}

async function invalidateToken(authHeader) {
  if (!authHeader) return;
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : authHeader.trim();
  if (!token) return;

  tokens.delete(token);

  if (process.env.AUTH_V2 !== 'false' && token.split('.').length === 3) {
    const decoded = decodeJwt(token);
    if (decoded?.payload?.jti) {
      await revokeToken(decoded.payload.jti, decoded.payload.exp);
    }
  }
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
  return USERS.map((u) => ({
    email: u.email,
    name: u.name,
    role: u.role,
    assignedClient: u.assignedClient,
  }));
}

// ─── MFA Primitives ───────────────────────────────────────────────────────────

function setUserMFA(userId, { mfaSecret, mfaEnabled, pendingMfaSecret } = {}) {
  const user = getUserById(userId);
  if (!user) return false;
  if (mfaSecret !== undefined) user.mfaSecret = mfaSecret;
  if (mfaEnabled !== undefined) user.mfaEnabled = !!mfaEnabled;
  if (pendingMfaSecret !== undefined) user.pendingMfaSecret = pendingMfaSecret;
  saveUserMfaData();
  try {
    userRepo.updateMFA(userId, { mfaSecret, mfaEnabled, pendingMfaSecret }).catch(() => {});
  } catch (_) {}
  return true;
}

function resetUserMFA(userId) {
  const user = getUserById(userId);
  if (!user) return false;
  user.mfaSecret = null;
  user.mfaEnabled = false;
  user.pendingMfaSecret = null;
  saveUserMfaData();
  try {
    userRepo.updateMFA(userId, { mfaSecret: null, mfaEnabled: 0, pendingMfaSecret: null }).catch(() => {});
  } catch (_) {}
  return true;
}

function createMFATempToken(user) {
  _purgeExpiredTokens();
  const tempToken = 'mfa_tmp_' + crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + MFA_TEMP_TOKEN_TTL_MS;
  mfaTempTokens.set(tempToken, {
    userId: user.id,
    expiresAt,
  });
  return tempToken;
}

function verifyMFATempToken(tempToken) {
  if (!tempToken || typeof tempToken !== 'string') return null;
  _purgeExpiredTokens();
  const entry = mfaTempTokens.get(tempToken);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    mfaTempTokens.delete(tempToken);
    return null;
  }
  return getUserById(entry.userId);
}

function consumeMFATempToken(tempToken) {
  if (tempToken) mfaTempTokens.delete(tempToken);
}

// ─── Single-Use Download & SSE Tickets ────────────────────────────────────────

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
  const safeUser = user ? _safeUser(user) : userId ? _safeUser(USERS.find((u) => u.id === userId)) : null;
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
  const ttl = typeof ttlMs === 'number' ? ttlMs : SSE_TICKET_TTL_MS;
  const expiresAt = Date.now() + ttl;
  const safeUser = user ? _safeUser(user) : userId ? _safeUser(USERS.find((u) => u.id === userId)) : null;
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

  sseTickets.delete(ticket);

  if (Date.now() > data.expiresAt) return null;
  if (requestedClientId && data.clientId && data.clientId !== requestedClientId) return null;

  return data;
}

module.exports = {
  assertJwtSecretValid,
  base64UrlEncode,
  base64UrlDecode,
  signJwt,
  decodeJwt,
  verifyJwtSignature,
  issueSessionForUserV2,
  issueSessionForUserLegacy,
  issueSessionForUser,
  revokeToken,
  revokeAllUserTokens,
  isTokenRevoked,
  setSimulatedRedisFailure,
  resetRevocationState,
  checkLoginRateLimit,
  clearLoginRateLimit,
  resetRateLimits,
  migratePlaintextPasswordsFile,
  migrateAllPasswords,
  updateUserPassword,
  authenticateUser,
  registerServiceSession,
  verifyToken,
  invalidateToken,
  getDemoUsers,
  createDownloadTicket,
  verifyAndConsumeDownloadTicket,
  createSSETicket,
  verifyAndConsumeSSETicket,
  getUserById,
  getUserByEmail,
  getUserFromDb: (id) => userRepo.getUserById(id),
  userRepo,
  setUserMFA,
  resetUserMFA,
  createMFATempToken,
  verifyMFATempToken,
  consumeMFATempToken,
  loadUserMfaData,
  loadUserData: loadUserMfaData,
  saveUserMfaData,
  USERS,
};
