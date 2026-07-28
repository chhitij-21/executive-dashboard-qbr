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

function getClientById(id) {
  const clients = loadClients();
  return clients.find((c) => c.id === id) || null;
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
    ruleConfigFile: 'rules.yaml',
    locations,
    createdAt: new Date().toISOString(),
    description,
  };

  if (!newClient.locations.includes('All Locations')) {
    newClient.locations.unshift('All Locations');
  }

  clients.push(newClient);
  saveClients(clients);
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

module.exports = {
  getAllClients,
  getClientById,
  createClient,
  updateClient,
  addLocation,
};
