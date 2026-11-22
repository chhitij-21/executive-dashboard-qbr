// backend/routes/v1/tenantRoutes.js
// Tenant, Client Management, Settings, Locations, and Rules Endpoints (Item #8, #14, #16)

'use strict';

const express = require('express');
const router = express.Router();
const clientService = require('../../services/clientService');
const ruleEngine = require('../../services/ruleEngine');
const { requireAuth, requireAdmin } = require('../../middleware/auth');

// ── Client CRUD Endpoints ───────────────────────────────────────────────────
router.get(['/clients', '/api/clients'], requireAuth, (req, res) => {
  res.json({ clients: clientService.getAllClients() });
});

router.get(['/clients/:id', '/api/clients/:id'], requireAuth, (req, res) => {
  const client = clientService.getClientById(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  res.json({ client });
});

router.post(['/clients', '/api/clients'], requireAuth, requireAdmin, (req, res) => {
  try {
    const newClient = clientService.createClient(req.body);
    res.status(201).json({ client: newClient });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put(['/clients/:id', '/api/clients/:id'], requireAuth, requireAdmin, (req, res) => {
  const updated = clientService.updateClient(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Client not found' });
  res.json({ client: updated });
});

router.post(['/clients/:id/locations', '/api/clients/:id/locations'], requireAuth, requireAdmin, (req, res) => {
  const { location } = req.body;
  if (!location) return res.status(400).json({ error: 'Location name is required' });
  const updated = clientService.addLocation(req.params.id, location);
  if (!updated) return res.status(404).json({ error: 'Client not found' });
  res.json({ client: updated });
});

// ── Tenant Settings, Whitelabel Branding & PPT Template Endpoints (Item #8) ───
router.get(['/tenants', '/api/tenants', '/clients/all-with-settings', '/api/clients/all-with-settings'], requireAuth, (req, res) => {
  const clients = clientService.getAllClients().map((c) => {
    const settings = clientService.getTenantSettings(c.id);
    return { ...c, settings, branding: settings?.branding };
  });
  res.json({ tenants: clients, clients });
});

router.get(['/tenants/:id/settings', '/api/tenants/:id/settings', '/clients/:id/settings', '/api/clients/:id/settings'], requireAuth, (req, res) => {
  const canonicalId = clientService.resolveCanonicalClientId(req.params.id);
  if (!canonicalId) return res.status(404).json({ error: 'Tenant not found' });
  const settings = clientService.getTenantSettings(canonicalId);
  res.json({ tenantId: canonicalId, settings, branding: settings?.branding });
});

router.put(['/tenants/:id/settings', '/api/tenants/:id/settings', '/clients/:id/settings', '/api/clients/:id/settings'], requireAuth, requireAdmin, (req, res) => {
  try {
    const canonicalId = clientService.resolveCanonicalClientId(req.params.id);
    if (!canonicalId) return res.status(404).json({ error: 'Tenant not found' });
    const updated = clientService.updateTenantSettings(canonicalId, req.body);
    res.json({ success: true, tenantId: canonicalId, settings: updated, branding: updated?.branding });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Rules Configuration Endpoints ───────────────────────────────────────────
router.get(['/rules', '/api/rules'], (req, res) => {
  try {
    const rawYaml = ruleEngine.getRulesYaml();
    const parsed = ruleEngine.getRules();
    res.json({ yaml: rawYaml, rules: parsed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put(['/rules', '/api/rules'], requireAuth, requireAdmin, (req, res) => {
  try {
    const { yaml: rawYaml } = req.body;
    if (!rawYaml || typeof rawYaml !== 'string') {
      return res.status(400).json({ error: 'YAML content is required.' });
    }
    // Limit YAML payload size to prevent DoS
    if (rawYaml.length > 50 * 1024) {
      return res.status(413).json({ error: 'YAML content too large. Maximum size is 50KB.' });
    }
    const result = ruleEngine.saveRulesYaml(rawYaml);
    res.json({ success: true, message: 'rules.yaml updated successfully', ...result });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Invalid YAML format' });
  }
});

module.exports = router;
