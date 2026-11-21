// backend/middleware/tenantContext.js
// Tenant Context Resolution & Physical Directory Isolation Middleware (Item #8)

const clientService = require('../services/clientService');

function resolveTenantContext(req, res, next) {
  try {
    // 1. Resolve raw identifier from multiple sources
    const rawId = req.params?.tenantId ||
                  req.params?.clientId ||
                  req.query?.clientId ||
                  req.query?.tenantId ||
                  req.body?.clientId ||
                  req.headers?.['x-tenant-id'] ||
                  req.headers?.['x-client-id'] ||
                  (req.user && req.user.assignedClient && req.user.assignedClient !== '*' ? req.user.assignedClient : null) ||
                  'client-jfl';

    // 2. Resolve canonical identifier
    const canonicalId = clientService.resolveCanonicalClientId(rawId);
    if (!canonicalId) {
      return res.status(400).json({
        error: 'Invalid or missing client identifier.',
        code: 'INVALID_CLIENT_ID',
      });
    }

    // 3. Fail-Closed Tenant Access Authorization
    if (req.user) {
      const userRole = req.user.role || 'client';
      const assignedClient = req.user.assignedClient;

      if (userRole !== 'admin') {
        const canonicalAssigned = clientService.resolveCanonicalClientId(assignedClient);
        if (canonicalAssigned !== canonicalId) {
          return res.status(403).json({
            error: `Customer isolation violation: You are not authorized to access customer '${canonicalId}'.`,
            code: 'CUSTOMER_ISOLATION_VIOLATION',
          });
        }
      }
    }

    // 4. Ensure partitioned directory structure
    const dirs = clientService.ensureTenantDirs(canonicalId);
    const settings = clientService.getTenantSettings(canonicalId);
    const client = clientService.getClientById(canonicalId) || {
      id: canonicalId,
      name: canonicalId === 'client-jfl' ? 'Jubilant Foodworks Ltd (JFL)' : (canonicalId === 'client-mmtcpamp' ? 'MMTC' : canonicalId),
      code: canonicalId === 'client-jfl' ? 'JFL' : (canonicalId === 'client-mmtcpamp' ? 'MMTC' : 'CLT'),
    };

    // 5. Attach isolated tenant context to request
    req.tenant = {
      id: canonicalId,
      name: client.name,
      code: client.code,
      rootDir: dirs.rootDir,
      reportsDir: dirs.reportsDir,
      templatesDir: dirs.templatesDir,
      templatePath: clientService.getTenantTemplatePath(canonicalId),
      rulesPath: clientService.getTenantRulesPath(canonicalId),
      settings,
      branding: settings?.branding || {
        logo: '',
        primaryColor: '#1e3a8a',
        secondaryColor: '#3b82f6',
        accentColor: '#10b981',
      },
    };

    // Backward compatibility for existing handlers expecting req.targetClientId
    req.targetClientId = canonicalId;
    req.targetClient = client;

    if (typeof next === 'function') {
      next();
    }
  } catch (err) {
    console.error('[tenantContext] Error resolving tenant context:', err.message);
    return res.status(500).json({
      error: 'Failed to resolve tenant context.',
      code: 'TENANT_RESOLUTION_ERROR',
    });
  }
}

module.exports = {
  resolveTenantContext,
};
