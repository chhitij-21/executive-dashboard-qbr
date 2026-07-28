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
    locations: ['All Locations', 'Noida', 'Delhi', 'Bangalore', 'Mumbai', 'Gurgaon', 'Hyderabad', 'Pune', 'Kolkata'],
    createdAt: '2026-01-01T00:00:00.000Z',
    description: 'Master QBR client for Jubilant Foodworks Ltd ecosystem.'
  },
  {
    id: 'client-a',
    name: 'Client A (Retail Chain)',
    code: 'CLT-A',
    logo: '🛍️',
    status: 'active',
    ruleConfigFile: 'rules.yaml',
    locations: ['All Locations', 'Bangalore', 'Delhi', 'Mumbai'],
    createdAt: '2026-02-15T00:00:00.000Z',
    description: 'National retail chain with multi-location network requirements.'
  },
  {
    id: 'client-b',
    name: 'Client B (Tech Corp)',
    code: 'CLT-B',
    logo: '🏢',
    status: 'active',
    ruleConfigFile: 'rules.yaml',
    locations: ['All Locations', 'Pune', 'Hyderabad'],
    createdAt: '2026-03-20T00:00:00.000Z',
    description: 'Enterprise IT technology center.'
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
  const newClient = {
    id: `client-${uuidv4().substring(0, 8)}`,
    name: clientData.name || 'New Client',
    code: clientData.code || 'CLT',
    logo: clientData.logo || '🏢',
    status: clientData.status || 'active',
    ruleConfigFile: clientData.ruleConfigFile || 'rules.yaml',
    locations: clientData.locations && clientData.locations.length ? clientData.locations : ['All Locations'],
    createdAt: new Date().toISOString(),
    description: clientData.description || 'Custom multi-location client.'
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
  const updated = {
    ...existing,
    ...updateData,
    id: existing.id // preserve ID
  };

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
