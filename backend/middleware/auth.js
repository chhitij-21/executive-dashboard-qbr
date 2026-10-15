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

const clientService = require('../services/clientService');

/**
 * Middleware: validates Bearer token from Authorization header.
 * Attaches req.user on success, returns 401 on failure.
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const session = authService.verifyToken(authHeader);
  if (!session) {
    return res.status(401).json({ error: 'Authorization required — please log in.', code: 'UNAUTHORIZED' });
  }
  req.user = session.user;
  next();
}

/**
 * Fail-closed client access control middleware.
 * Verifies that clientId is present, valid, and that req.user is authorized to access it.
 */
function requireClientAccess(extractClientId) {
  return (req, res, next) => {
    // 1. Extract raw clientId from configured extractor or standard locations
    let rawClientId = null;
    if (typeof extractClientId === 'function') {
      rawClientId = extractClientId(req);
    } else {
      rawClientId = req.query?.clientId || req.headers['x-client-id'] || req.body?.clientId;
    }

    if (!rawClientId || typeof rawClientId !== 'string' || !rawClientId.trim()) {
      return res.status(400).json({ error: 'Customer identifier (clientId) is required.', code: 'MISSING_CLIENT_ID' });
    }

    const trimmedClientId = rawClientId.trim();
    const canonicalClientId = clientService.resolveCanonicalClientId(trimmedClientId);
    const client = clientService.getClientById(canonicalClientId);

    if (!client) {
      return res.status(404).json({ error: `Unknown customer '${trimmedClientId}'.`, code: 'UNKNOWN_CLIENT' });
    }

    req.targetClientId = canonicalClientId;
    req.targetClient = client;

    // 2. FAIL-CLOSED User Authorization Checks
    if (!req.user) {
      return res.status(401).json({ error: 'Authorization required — please log in.', code: 'UNAUTHORIZED' });
    }

    if (!req.user.role || typeof req.user.role !== 'string') {
      return res.status(403).json({ error: 'Invalid user role on authenticated profile.', code: 'INVALID_USER_ROLE' });
    }

    if (!['admin', 'client_user'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Unrecognized user role on authenticated profile.', code: 'UNRECOGNIZED_USER_ROLE' });
    }

    if (!req.user.assignedClient || typeof req.user.assignedClient !== 'string') {
      return res.status(403).json({ error: 'Missing assigned client on authenticated profile.', code: 'MISSING_ASSIGNED_CLIENT' });
    }

    if (!req.user.assignedClient.trim()) {
      return res.status(403).json({ error: 'Invalid assigned client on authenticated profile.', code: 'INVALID_ASSIGNED_CLIENT' });
    }

    // Admin role check: authorized for any valid client
    if (req.user.role === 'admin' && req.user.assignedClient === 'all') {
      return next();
    }

    // Client user role check: strictly restricted to assigned customer
    if (req.user.role === 'client_user') {
      const canonicalAssigned = clientService.resolveCanonicalClientId(req.user.assignedClient);
      const assignedClientObj = clientService.getClientById(canonicalAssigned);

      if (!assignedClientObj) {
        return res.status(403).json({ error: 'Unknown assigned customer on user profile.', code: 'UNKNOWN_ASSIGNED_CLIENT' });
      }

      if (canonicalAssigned !== canonicalClientId) {
        return res.status(403).json({
          error: `Forbidden: You are not authorized to access customer '${client.name || trimmedClientId}'.`,
          code: 'CUSTOMER_ACCESS_FORBIDDEN',
        });
      }

      return next();
    }

    // Default fail-closed fallback
    return res.status(403).json({ error: 'Forbidden: Access denied.', code: 'ACCESS_DENIED' });
  };
}

/**
 * Middleware: requires req.user.role === 'admin'.
 * Must be used AFTER requireAuth.
 */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.', code: 'ADMIN_REQUIRED' });
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
  requireClientAccess,
  handleAutoAuthRoute,
  SERVICE_USER,
};
