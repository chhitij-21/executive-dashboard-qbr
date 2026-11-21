// backend/services/clientService.js
// Client & Location management service.
// Supports multi-client isolation, client-specific metadata, and location routing.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), 'data')
  : path.resolve(__dirname, '..', '..', 'data');
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');
const TENANTS_DIR = path.join(DATA_DIR, 'tenants');

const HEX_COLOR_REGEX = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

// Pre-seeded clients
const DEFAULT_CLIENTS = [
  {
    id: 'client-jfl',
    name: 'Jubilant Foodworks Ltd (JFL)',
    code: 'JFL',
    logo: '🍔',
    status: 'active',
    ruleConfigFile: 'rules.yaml',
    locations: ['All Locations', 'Bangalore', 'Greater Noida', 'Guwahati', 'Hyderabad', 'Mohali', 'Mumbai', 'Nagpur', 'Noida'],
    createdAt: '2026-01-01T00:00:00.000Z',
    description: 'Master QBR client for Jubilant Foodworks Ltd ecosystem.'
  }
];

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadClients() {
  ensureDataDir();
  if (!fs.existsSync(CLIENTS_FILE)) {
    saveClients(DEFAULT_CLIENTS);
    return DEFAULT_CLIENTS;
  }
  try {
    const raw = fs.readFileSync(CLIENTS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) && data.length > 0 ? data : DEFAULT_CLIENTS;
  } catch (err) {
    console.error('[clientService] Error reading clients.json, using defaults:', err.message);
    return DEFAULT_CLIENTS;
  }
}

function saveClients(clients) {
  ensureDataDir();
  fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2), 'utf8');
}

function getAllClients() {
  return loadClients();
}

const CLIENT_ALIASES = {
  'client-mmtc': 'client-mmtcpamp',
  'mmtc': 'client-mmtcpamp',
  'mmtcpamp': 'client-mmtcpamp',
  'jfl': 'client-jfl',
  'client-jfl': 'client-jfl',
};

function resolveCanonicalClientId(id) {
  if (!id || typeof id !== 'string') return null;
  const normalized = id.trim().toLowerCase();
  return CLIENT_ALIASES[normalized] || id.trim();
}

function getClientById(id) {
  if (!id || typeof id !== 'string') return null;
  const canonicalId = resolveCanonicalClientId(id);
  const clients = loadClients();
  return clients.find((c) => c.id.toLowerCase() === canonicalId.toLowerCase()) || null;
}

function createClient(clientData) {
  const clients = loadClients();

  // Allowlist: only accept known, safe fields
  const name = String(clientData.name || '').trim().slice(0, 120);
  const code = String(clientData.code || '').trim().replace(/[^A-Z0-9_-]/gi, '').slice(0, 10).toUpperCase() || 'CLT';
  const logo = String(clientData.logo || '🏢').trim().slice(0, 10);
  const status = ['active', 'inactive'].includes(clientData.status) ? clientData.status : 'active';
  const description = String(clientData.description || '').trim().slice(0, 500);
  const locations = Array.isArray(clientData.locations)
    ? clientData.locations.map((l) => String(l).trim().slice(0, 80)).filter(Boolean)
    : ['All Locations'];

  if (!name) throw new Error('Client name is required.');

  const newClient = {
    id: `client-${uuidv4().substring(0, 8)}`,
    name,
    code,
    logo,
    status,
    description,
    ruleConfigFile: 'rules.yaml',
    locations: locations.includes('All Locations') ? locations : ['All Locations', ...locations],
    createdAt: new Date().toISOString(),
  };

  clients.push(newClient);
  saveClients(clients);

  // Initialize tenant directories immediately
  ensureTenantDirs(newClient.id);

  return newClient;
}

function updateClient(id, updateData) {
  const clients = loadClients();
  const idx = clients.findIndex((c) => c.id === id);
  if (idx === -1) return null;

  const existing = clients[idx];

  // Allowlist: only permit safe, known fields to be updated
  const patch = {};
  if (updateData.name !== undefined)   patch.name        = String(updateData.name).trim().slice(0, 120);
  if (updateData.code !== undefined)   patch.code        = String(updateData.code).replace(/[^A-Z0-9_-]/gi, '').slice(0, 10).toUpperCase();
  if (updateData.logo !== undefined)   patch.logo        = String(updateData.logo).trim().slice(0, 10);
  if (updateData.status !== undefined && ['active', 'inactive'].includes(updateData.status)) {
    patch.status = updateData.status;
  }
  if (updateData.description !== undefined) patch.description = String(updateData.description).trim().slice(0, 500);
  if (Array.isArray(updateData.locations)) {
    patch.locations = updateData.locations.map((l) => String(l).trim().slice(0, 80)).filter(Boolean);
  }

  const updated = { ...existing, ...patch, id: existing.id }; // preserve original ID

  if (updated.locations && !updated.locations.includes('All Locations')) {
    updated.locations.unshift('All Locations');
  }

  clients[idx] = updated;
  saveClients(clients);
  return updated;
}

function addLocation(clientId, locationName) {
  const clients = loadClients();
  const client = clients.find((c) => c.id === clientId);
  if (!client) return null;

  const trimmed = String(locationName).trim();
  if (trimmed && !client.locations.includes(trimmed)) {
    client.locations.push(trimmed);
    saveClients(clients);
  }
  return client;
}

// ── Physical Filesystem Partitioning & Tenant Isolation (Item #8) ────────────

function validateHexColor(hex, fieldName = 'Color') {
  if (!hex || typeof hex !== 'string') return;
  const trimmed = hex.trim();
  if (!HEX_COLOR_REGEX.test(trimmed)) {
    throw new Error(`INVALID_HEX_COLOR: ${fieldName} must be a valid hex color code (e.g. #1e3a8a). Received: "${hex}"`);
  }
}

function getTenantDir(tenantId) {
  const canonicalId = resolveCanonicalClientId(tenantId) || 'client-default';
  return path.join(TENANTS_DIR, canonicalId);
}

function ensureTenantDirs(tenantId) {
  const canonicalId = resolveCanonicalClientId(tenantId) || 'client-default';
  const rootDir = getTenantDir(canonicalId);
  const reportsDir = path.join(rootDir, 'reports');
  const templatesDir = path.join(rootDir, 'templates');
  const inventoryDir = path.join(rootDir, 'inventory');
  const settingsFile = path.join(rootDir, 'settings.json');

  [rootDir, reportsDir, templatesDir, inventoryDir].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  if (!fs.existsSync(settingsFile)) {
    const defaultSettings = {
      tenantId: canonicalId,
      slaTarget: 99.3,
      branding: {
        logo: '',
        primaryColor: '#1e3a8a',
        secondaryColor: '#3b82f6',
        accentColor: '#10b981',
      },
      locations: ['All Locations'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(settingsFile, JSON.stringify(defaultSettings, null, 2), 'utf8');
  }

  return {
    rootDir,
    reportsDir,
    templatesDir,
    inventoryDir,
    settingsFile,
  };
}

function getTenantSettings(tenantId) {
  const { settingsFile } = ensureTenantDirs(tenantId);
  try {
    const raw = fs.readFileSync(settingsFile, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (err) {
    console.error(`[clientService] Error reading settings for tenant ${tenantId}:`, err.message);
    return {
      tenantId,
      slaTarget: 99.3,
      branding: {
        logo: '',
        primaryColor: '#1e3a8a',
        secondaryColor: '#3b82f6',
        accentColor: '#10b981',
      },
    };
  }
}

function updateTenantSettings(tenantId, patch = {}) {
  const { settingsFile } = ensureTenantDirs(tenantId);
  const current = getTenantSettings(tenantId);

  if (patch.slaTarget !== undefined) {
    const num = Number(patch.slaTarget);
    if (isNaN(num) || num < 0 || num > 100) {
      throw new Error('INVALID_SLA_TARGET: Must be a number between 0 and 100.');
    }
    current.slaTarget = Number(num.toFixed(2));
  }

  if (patch.branding && typeof patch.branding === 'object') {
    current.branding = current.branding || {};
    if (patch.branding.primaryColor !== undefined) {
      validateHexColor(patch.branding.primaryColor, 'Primary Color');
      current.branding.primaryColor = patch.branding.primaryColor.trim();
    }
    if (patch.branding.secondaryColor !== undefined) {
      validateHexColor(patch.branding.secondaryColor, 'Secondary Color');
      current.branding.secondaryColor = patch.branding.secondaryColor.trim();
    }
    if (patch.branding.accentColor !== undefined) {
      validateHexColor(patch.branding.accentColor, 'Accent Color');
      current.branding.accentColor = patch.branding.accentColor.trim();
    }
    if (patch.branding.logo !== undefined) {
      current.branding.logo = String(patch.branding.logo).trim();
    }
  }

  if (Array.isArray(patch.locations)) {
    current.locations = patch.locations.map((l) => String(l).trim()).filter(Boolean);
  }

  current.updatedAt = new Date().toISOString();
  fs.writeFileSync(settingsFile, JSON.stringify(current, null, 2), 'utf8');
  return current;
}

function getTenantTemplatePath(tenantId) {
  const { templatesDir } = ensureTenantDirs(tenantId);
  const tenantCandidate = path.join(templatesDir, 'master.pptx');
  if (fs.existsSync(tenantCandidate)) {
    return tenantCandidate;
  }
  return path.resolve(__dirname, '..', '..', 'templates', 'master_template.pptx');
}

function getTenantRulesPath(tenantId) {
  const { rootDir } = ensureTenantDirs(tenantId);
  const tenantCandidate = path.join(rootDir, 'rules.yaml');
  if (fs.existsSync(tenantCandidate)) {
    return tenantCandidate;
  }
  return path.resolve(__dirname, '..', 'config', 'rules.yaml');
}

module.exports = {
  getAllClients,
  getClientById,
  resolveCanonicalClientId,
  createClient,
  updateClient,
  addLocation,
  // Tenant isolation & partitioning
  getTenantDir,
  ensureTenantDirs,
  getTenantSettings,
  updateTenantSettings,
  getTenantTemplatePath,
  getTenantRulesPath,
};
