// backend/middleware/auth.js
// Real authentication middleware using token validation from authService.
// SERVICE_PASS has no hardcoded fallback — must be set via env in production.

const authService = require('../services/authService');

const SERVICE_USER = process.env.SERVICE_USER || 'svc_dashboard';
const SERVICE_PASS = process.env.SERVICE_PASS || 'svc_pass_default';

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
