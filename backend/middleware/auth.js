// backend/middleware/auth.js
// Real authentication middleware using token validation from authService.
// SERVICE_PASS has no hardcoded fallback — must be set via env in production.

const authService = require('../services/authService');

const SERVICE_USER = process.env.SERVICE_USER || 'svc_dashboard';
// SECURITY: No hardcoded fallback — must be set as env var.
// If not set, the auto-auth route will reject all requests.
const SERVICE_PASS = process.env.SERVICE_PASS || null;

if (!SERVICE_PASS) {
  console.warn('[auth] WARNING: SERVICE_PASS env var is not set. /api/auth/auto will be disabled.');
}

/**
 * Middleware: validates Bearer token from Authorization header.
 * Attaches req.user on success, returns 401 on failure.
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const session = authService.verifyToken(authHeader);
  if (!session) {
    return res.status(401).json({ error: 'Authorization required — please log in.' });
  }
  req.user = session.user;
  next();
}

/**
 * Middleware: requires req.user.role === 'admin'.
 * Must be used AFTER requireAuth.
 */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

/**
 * Auto-auth route handler (kept for service-account integrations).
 * Uses SERVICE_USER env var — no hardcoded credentials.
 */
function handleAutoAuthRoute(req, res) {
  // SECURITY: Require X-Service-Pass header matching the SERVER-SIDE env var.
  // This prevents the auto-auth endpoint from being an open backdoor.
  if (!SERVICE_PASS) {
    return res.status(503).json({ error: 'Auto-auth is not configured on this server.' });
  }

  const providedPass = req.headers['x-service-pass'] || req.headers['x-service-token'];
  if (!providedPass || providedPass !== SERVICE_PASS) {
    return res.status(401).json({ error: 'Invalid or missing service credentials.' });
  }

  const session = authService.registerServiceSession({
    id: 'user-svc-001',
    email: `${SERVICE_USER}@proactivedata.com`,
    username: SERVICE_USER,
    name: 'Service Account (Auto)',
    role: 'admin',
    assignedClient: 'all',
    avatar: '🤖',
  });

  res.json({
    success: true,
    user: session.user,
    token: session.token,
    message: 'Auto-login successful using service account credentials',
  });
}

module.exports = {
  requireAuth,
  requireAdmin,
  handleAutoAuthRoute,
  SERVICE_USER,
};
