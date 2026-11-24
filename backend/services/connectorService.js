// backend/services/connectorService.js
// Real-Time IT Connectors: Webhook Ingestion Engine with HMAC Verification & Event Buffer (Item #19)

'use strict';

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const database = require('../config/database');
const { normalizeSiteName } = require('./processData');

const VALID_PROVIDERS = new Set(['meraki', 'catalyst_center', 'generic']);
const VALID_SEVERITIES = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']);

let _ensuredClient = null;

/**
 * Self-healing schema initialization for webhook connectors & event buffer tables.
 */
async function ensureTables() {
  const db = database.getClient();
  if (_ensuredClient === db) return;

  await db.execute(`
    CREATE TABLE IF NOT EXISTS webhook_connectors (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      provider TEXT NOT NULL CHECK(provider IN ('meraki', 'catalyst_center', 'generic')),
      name TEXT NOT NULL,
      webhook_secret TEXT NOT NULL,
      shared_secret TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_event_at TEXT,
      event_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS webhook_events (
      id TEXT PRIMARY KEY,
      connector_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      event_id TEXT,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO')),
      device_id TEXT,
      device_serial TEXT,
      device_type TEXT,
      site_id TEXT,
      rca_hint TEXT,
      message TEXT,
      occurred_at TEXT NOT NULL,
      raw_payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'buffered' CHECK(status IN ('buffered', 'processed', 'ignored')),
      signature_verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(connector_id, event_id)
    );
  `);

  await db.execute(`CREATE INDEX IF NOT EXISTS idx_wh_conn_tenant ON webhook_connectors(tenant_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_wh_events_conn_time ON webhook_events(connector_id, occurred_at DESC);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_wh_events_tenant_status ON webhook_events(tenant_id, status, occurred_at DESC);`);

  _ensuredClient = db;
}

function generateWebhookSecret() {
  return `whsec_${crypto.randomBytes(24).toString('hex')}`;
}

function maskSecret(secret) {
  if (!secret || typeof secret !== 'string') return '';
  if (secret.length <= 10) return '****';
  return `${secret.slice(0, 6)}...${secret.slice(-4)}`;
}

function sanitizeConnectorRow(row, includeSecret = false) {
  if (!row) return null;
  const base = {
    id: row.id,
    tenantId: row.tenant_id,
    provider: row.provider,
    name: row.name,
    secretPreview: maskSecret(row.webhook_secret),
    hasSharedSecret: Boolean(row.shared_secret),
    enabled: Boolean(row.enabled),
    lastEventAt: row.last_event_at || null,
    eventCount: Number(row.event_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (includeSecret) {
    base.webhookSecret = row.webhook_secret;
  }
  return base;
}

function safeTimingEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Cryptographic verification supporting HMAC-SHA256 headers and Meraki sharedSecret.
 */
function verifyWebhookSignature({ rawBody, parsedBody, headers = {}, connector }) {
  if (!connector || !connector.webhook_secret) {
    return { verified: false, method: 'none', reason: 'Missing connector secret' };
  }

  // Normalize headers to lowercase keys
  const normHeaders = {};
  for (const [k, v] of Object.entries(headers || {})) {
    normHeaders[k.toLowerCase()] = v;
  }

  const sigHeader =
    normHeaders['x-meraki-signature'] ||
    normHeaders['x-catalyst-signature'] ||
    normHeaders['x-hub-signature-256'] ||
    normHeaders['x-webhook-signature'];

  if (sigHeader && typeof sigHeader === 'string') {
    const cleanSig = sigHeader.trim().replace(/^sha256=/i, '').toLowerCase();
    const payloadBuf = Buffer.isBuffer(rawBody)
      ? rawBody
      : Buffer.from(typeof rawBody === 'string' ? rawBody : JSON.stringify(parsedBody || {}), 'utf8');

    const expectedHex = crypto
      .createHmac('sha256', connector.webhook_secret)
      .update(payloadBuf)
      .digest('hex')
      .toLowerCase();

    const matched = safeTimingEqual(cleanSig, expectedHex);
    return {
      verified: matched,
      method: 'hmac-sha256',
      reason: matched ? null : 'HMAC-SHA256 signature mismatch',
    };
  }

  // Fallback for Meraki sharedSecret payload verification (timing-safe)
  if (parsedBody && typeof parsedBody.sharedSecret === 'string' && parsedBody.sharedSecret.trim()) {
    const incomingSecret = parsedBody.sharedSecret.trim();
    const targetSecret = connector.shared_secret || connector.webhook_secret;
    const matched = safeTimingEqual(incomingSecret, targetSecret);
    return {
      verified: matched,
      method: 'shared-secret',
      reason: matched ? null : 'sharedSecret mismatch',
    };
  }

  return {
    verified: false,
    method: 'none',
    reason: 'Missing cryptographic signature header or sharedSecret',
  };
}

function inferDeviceType(modelOrType, text = '') {
  const combined = `${modelOrType || ''} ${text || ''}`.trim();
  if (/^ms\d+/i.test(modelOrType || '') || /\bswitch\b|^sw$|catalyst\s*9\d{3}|nexus/i.test(combined)) {
    return 'Switch';
  }
  if (/^mr\d+|^cw\d+/i.test(modelOrType || '') || /\bap\b|access[\s_-]*point|wireless|aironet/i.test(combined)) {
    return 'AP';
  }
  if (/^mx\d+|^z\d+/i.test(modelOrType || '') || /firewall|appliance|sd-wan|security/i.test(combined)) {
    return 'Firewall';
  }
  return 'Switch';
}

function inferRcaHint(text = '') {
  const lower = String(text || '').toLowerCase();
  if (/power|ups|psu|battery|poe budget|voltage|unreachable.*power/.test(lower)) {
    return 'Device Power Issues';
  }
  if (/isp|wan|uplink|carrier|bgp|vpn|cellular|packet loss|latency|connectivity lost/.test(lower)) {
    return 'ISP Issues';
  }
  if (/hardware|rma|fan|temp|thermal|cpu|memory|flash|faulty|hardware failure/.test(lower)) {
    return 'Hardware Failure';
  }
  if (/config|vlan|firmware|rogue|stp|loop|dhcp|dns|auth|radius/.test(lower)) {
    return 'Configuration Issues';
  }
  if (/cable|port|client|duplex|mismatch|interface down|flapping/.test(lower)) {
    return 'Client Side Issues';
  }
  return 'Unknown';
}

function mapSeverity(raw) {
  const s = String(raw || '').trim().toUpperCase();
  if (['CRITICAL', 'P1', '1', 'EMERGENCY', 'ALERT'].includes(s)) return 'CRITICAL';
  if (['HIGH', 'P2', '2', 'WARNING', 'WARN', 'MAJOR', 'ERROR'].includes(s)) return 'HIGH';
  if (['MEDIUM', 'P3', '3', 'MINOR'].includes(s)) return 'MEDIUM';
  if (['LOW', 'P4', '4'].includes(s)) return 'LOW';
  if (['INFO', 'INFORMATIONAL', 'OK', 'CLEARED', 'RESOLVED'].includes(s)) return 'INFO';
  return 'HIGH';
}

function normalizeMerakiPayload(payload = {}) {
  const alertType = String(payload.alertType || payload.alertTypeId || 'Meraki Alert').trim();
  const alertDataStr = payload.alertData ? JSON.stringify(payload.alertData) : '';
  const deviceModel = String(payload.deviceModel || '').trim();
  const deviceSerial = String(payload.deviceSerial || '').trim();
  const deviceId = String(payload.deviceName || deviceSerial || payload.deviceMac || 'Unknown').trim();
  const rawSite = String(payload.networkName || payload.networkId || payload.organizationName || 'Unknown').trim();
  const siteId = normalizeSiteName(rawSite);
  const occurredAt = payload.occurredAt ? new Date(payload.occurredAt).toISOString() : new Date().toISOString();

  let eventType = alertType.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (/unreachable|went down|offline|disconnected/i.test(alertType)) {
    const dType = inferDeviceType(deviceModel, alertType);
    eventType = dType === 'AP' ? 'AP_DOWN' : 'DEVICE_DOWN';
  } else if (/came back up|online|restored/i.test(alertType)) {
    eventType = 'DEVICE_UP';
  } else if (/port.*down|port.*flap|cable/i.test(alertType)) {
    eventType = 'PORT_FLAP';
  }

  const deviceType = inferDeviceType(deviceModel, `${alertType} ${deviceId}`);
  const rcaHint = inferRcaHint(`${alertType} ${alertDataStr}`);
  const severity = mapSeverity(payload.alertLevel || (eventType === 'DEVICE_UP' ? 'INFO' : 'HIGH'));

  return {
    eventId: payload.alertId ? String(payload.alertId) : null,
    eventType: eventType || 'MERAKI_ALERT',
    severity,
    deviceId,
    deviceSerial: deviceSerial || deviceId,
    deviceType,
    siteId,
    rcaHint,
    message: `${alertType}: ${deviceId} (${deviceModel || deviceType}) at ${siteId}`,
    occurredAt,
  };
}

function normalizeCatalystPayload(payload = {}) {
  const issue = payload.enrichmentInfo?.issueDetails?.issue?.[0] || {};
  const details = payload.details || {};
  const tags = Array.isArray(payload.tags) ? payload.tags.join(' ') : '';

  const issueTitle = String(
    issue.issueName ||
    issue.issueSummary ||
    details.issueTitle ||
    details['Issue Name'] ||
    payload.category ||
    payload.eventType ||
    'Catalyst Center Alert'
  ).trim();

  const deviceId = String(
    issue.deviceRole ||
    details.hostname ||
    details.deviceName ||
    details['Device'] ||
    issue.entityValue ||
    payload.deviceId ||
    'Unknown'
  ).trim();

  const deviceSerial = String(
    details.deviceSerialNumber ||
    details.serialNumber ||
    issue.entityId ||
    deviceId
  ).trim();

  const rawSite = String(
    details.site ||
    details.Site ||
    issue.issueLocation ||
    payload.site ||
    'Unknown'
  ).trim();

  const siteId = normalizeSiteName(rawSite);
  const rawTs = issue.timestamp || payload.timestamp || payload.occurredAt;
  const occurredAt = rawTs
    ? new Date(typeof rawTs === 'number' && rawTs < 1e12 ? rawTs * 1000 : rawTs).toISOString()
    : new Date().toISOString();

  const probableCause = String(issue.probableCause || details.probableCause || '').trim();
  const combinedContext = `${issueTitle} ${probableCause} ${tags}`;

  let eventType = 'CATALYST_ISSUE';
  if (/unreachable|down|disconnect/i.test(combinedContext)) {
    const dt = inferDeviceType(details.deviceType || '', combinedContext);
    eventType = dt === 'AP' ? 'AP_DOWN' : 'SWITCH_DOWN';
  } else if (/flap|interface|link/i.test(combinedContext)) {
    eventType = 'PORT_FLAP';
  } else if (/clear|resolved|up/i.test(String(issue.status || details.status || ''))) {
    eventType = 'DEVICE_UP';
  }

  return {
    eventId: String(payload.eventId || payload.instanceId || issue.issueId || '') || null,
    eventType,
    severity: mapSeverity(issue.issueSeverity || details.severity || payload.severity || payload.category),
    deviceId,
    deviceSerial,
    deviceType: inferDeviceType(details.deviceType || details.platformId || '', combinedContext),
    siteId,
    rcaHint: inferRcaHint(combinedContext),
    message: `${issueTitle}${probableCause ? ` — ${probableCause}` : ''} (${deviceId} at ${siteId})`,
    occurredAt,
  };
}

function normalizeGenericPayload(payload = {}) {
  const eventType = String(payload.eventType || payload.type || 'CUSTOM_EVENT').trim().toUpperCase();
  const deviceId = String(payload.deviceId || payload.device || 'Unknown').trim();
  const siteId = normalizeSiteName(payload.siteId || payload.site || 'Unknown');
  const message = String(payload.message || `${eventType} on ${deviceId} at ${siteId}`).trim();

  return {
    eventId: payload.eventId ? String(payload.eventId) : null,
    eventType,
    severity: mapSeverity(payload.severity || 'HIGH'),
    deviceId,
    deviceSerial: String(payload.deviceSerial || deviceId).trim(),
    deviceType: inferDeviceType(payload.deviceType || '', message),
    siteId,
    rcaHint: payload.rcaHint || inferRcaHint(message),
    message,
    occurredAt: payload.occurredAt ? new Date(payload.occurredAt).toISOString() : new Date().toISOString(),
  };
}

function normalizeWebhookPayload(provider, payload) {
  if (provider === 'meraki') return normalizeMerakiPayload(payload);
  if (provider === 'catalyst_center') return normalizeCatalystPayload(payload);
  return normalizeGenericPayload(payload);
}

// ── Connector CRUD ──────────────────────────────────────────────────────────

async function createConnector({ tenantId, provider, name, sharedSecret = null, webhookSecret = null }) {
  await ensureTables();
  if (!tenantId || !VALID_PROVIDERS.has(provider)) {
    throw new Error(`Invalid connector parameters. Provider must be one of: ${Array.from(VALID_PROVIDERS).join(', ')}`);
  }
  const cleanName = String(name || `${provider} connector`).trim();
  if (!cleanName) throw new Error('Connector name is required');

  const id = uuidv4();
  const secret = webhookSecret && String(webhookSecret).trim().length >= 16
    ? String(webhookSecret).trim()
    : generateWebhookSecret();
  const cleanShared = sharedSecret ? String(sharedSecret).trim() : null;
  const now = new Date().toISOString();

  const db = database.getClient();
  await db.execute({
    sql: `
      INSERT INTO webhook_connectors (id, tenant_id, provider, name, webhook_secret, shared_secret, enabled, event_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
    `,
    args: [id, tenantId, provider, cleanName, secret, cleanShared, now, now],
  });

  const res = await db.execute({ sql: `SELECT * FROM webhook_connectors WHERE id = ?`, args: [id] });
  return sanitizeConnectorRow(res.rows[0], true);
}

async function listConnectors(tenantId) {
  await ensureTables();
  const db = database.getClient();
  const res = await db.execute({
    sql: `SELECT * FROM webhook_connectors WHERE tenant_id = ? ORDER BY created_at DESC`,
    args: [tenantId],
  });
  return res.rows.map(r => sanitizeConnectorRow(r, false));
}

async function getConnectorById(connectorId, { includeRawSecret = false } = {}) {
  await ensureTables();
  const db = database.getClient();
  const res = await db.execute({
    sql: `SELECT * FROM webhook_connectors WHERE id = ?`,
    args: [connectorId],
  });
  if (!res.rows || res.rows.length === 0) return null;
  return includeRawSecret ? res.rows[0] : sanitizeConnectorRow(res.rows[0], false);
}

async function updateConnector(connectorId, tenantId, { enabled, name, rotateSecret, sharedSecret } = {}) {
  await ensureTables();
  const db = database.getClient();
  const existing = await db.execute({
    sql: `SELECT * FROM webhook_connectors WHERE id = ? AND tenant_id = ?`,
    args: [connectorId, tenantId],
  });
  if (!existing.rows || existing.rows.length === 0) return null;

  const current = existing.rows[0];
  const nextEnabled = typeof enabled === 'boolean' ? (enabled ? 1 : 0) : current.enabled;
  const nextName = name && String(name).trim() ? String(name).trim() : current.name;
  const nextSecret = rotateSecret ? generateWebhookSecret() : current.webhook_secret;
  const nextShared = sharedSecret !== undefined ? (sharedSecret ? String(sharedSecret).trim() : null) : current.shared_secret;
  const now = new Date().toISOString();

  await db.execute({
    sql: `
      UPDATE webhook_connectors
      SET name = ?, enabled = ?, webhook_secret = ?, shared_secret = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `,
    args: [nextName, nextEnabled, nextSecret, nextShared, now, connectorId, tenantId],
  });

  const updatedRes = await db.execute({ sql: `SELECT * FROM webhook_connectors WHERE id = ?`, args: [connectorId] });
  return sanitizeConnectorRow(updatedRes.rows[0], Boolean(rotateSecret));
}

async function deleteConnector(connectorId, tenantId) {
  await ensureTables();
  const db = database.getClient();
  const res = await db.execute({
    sql: `DELETE FROM webhook_connectors WHERE id = ? AND tenant_id = ?`,
    args: [connectorId, tenantId],
  });
  return (res.rowsAffected || 0) > 0;
}

// ── Event Ingestion & Buffer ────────────────────────────────────────────────

async function ingestWebhookEvent({ connectorId, providerHint, rawBody, parsedBody, headers }) {
  await ensureTables();
  const connector = await getConnectorById(connectorId, { includeRawSecret: true });
  if (!connector) {
    return { status: 404, error: 'Connector not found', code: 'CONNECTOR_NOT_FOUND' };
  }

  if (!connector.enabled) {
    return {
      status: 403,
      error: 'Connector is disabled',
      code: 'CONNECTOR_DISABLED',
      connector: sanitizeConnectorRow(connector, false),
    };
  }

  if (providerHint && providerHint !== 'generic' && connector.provider !== 'generic' && providerHint !== connector.provider) {
    return {
      status: 400,
      error: `Provider mismatch: connector is configured for '${connector.provider}', received '${providerHint}'`,
      code: 'PROVIDER_MISMATCH',
      connector: sanitizeConnectorRow(connector, false),
    };
  }

  const sigCheck = verifyWebhookSignature({ rawBody, parsedBody, headers, connector });
  if (!sigCheck.verified) {
    return {
      status: 401,
      error: sigCheck.reason || 'Invalid webhook signature',
      code: 'INVALID_SIGNATURE',
      method: sigCheck.method,
      connector: sanitizeConnectorRow(connector, false),
    };
  }

  const normalized = normalizeWebhookPayload(connector.provider, parsedBody);
  const db = database.getClient();

  // Idempotency check if provider supplied an eventId
  if (normalized.eventId) {
    const dupRes = await db.execute({
      sql: `SELECT * FROM webhook_events WHERE connector_id = ? AND event_id = ?`,
      args: [connector.id, normalized.eventId],
    });
    if (dupRes.rows && dupRes.rows.length > 0) {
      return {
        status: 200,
        duplicate: true,
        method: sigCheck.method,
        connector: sanitizeConnectorRow(connector, false),
        event: formatEventRow(dupRes.rows[0]),
      };
    }
  }

  const id = uuidv4();
  const now = new Date().toISOString();
  const rawJson = JSON.stringify(parsedBody || {});

  await db.execute({
    sql: `
      INSERT INTO webhook_events (
        id, connector_id, tenant_id, provider, event_id, event_type, severity,
        device_id, device_serial, device_type, site_id, rca_hint, message,
        occurred_at, raw_payload_json, status, signature_verified, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'buffered', 1, ?)
    `,
    args: [
      id,
      connector.id,
      connector.tenant_id,
      connector.provider,
      normalized.eventId,
      normalized.eventType,
      VALID_SEVERITIES.has(normalized.severity) ? normalized.severity : 'HIGH',
      normalized.deviceId,
      normalized.deviceSerial,
      normalized.deviceType,
      normalized.siteId,
      normalized.rcaHint,
      normalized.message,
      normalized.occurredAt,
      rawJson,
      now,
    ],
  });

  await db.execute({
    sql: `UPDATE webhook_connectors SET event_count = event_count + 1, last_event_at = ?, updated_at = ? WHERE id = ?`,
    args: [normalized.occurredAt, now, connector.id],
  });

  const inserted = await db.execute({ sql: `SELECT * FROM webhook_events WHERE id = ?`, args: [id] });
  return {
    status: 202,
    duplicate: false,
    method: sigCheck.method,
    connector: sanitizeConnectorRow(connector, false),
    event: formatEventRow(inserted.rows[0]),
  };
}

function formatEventRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    connectorId: row.connector_id,
    tenantId: row.tenant_id,
    provider: row.provider,
    eventId: row.event_id,
    eventType: row.event_type,
    severity: row.severity,
    deviceId: row.device_id,
    deviceSerial: row.device_serial,
    deviceType: row.device_type,
    siteId: row.site_id,
    rcaHint: row.rca_hint,
    message: row.message,
    occurredAt: row.occurred_at,
    status: row.status,
    signatureVerified: Boolean(row.signature_verified),
    createdAt: row.created_at,
  };
}

async function listConnectorEvents({ connectorId, tenantId, status, severity, limit = 50, offset = 0 }) {
  await ensureTables();
  const db = database.getClient();
  const conditions = ['connector_id = ?', 'tenant_id = ?'];
  const args = [connectorId, tenantId];

  if (status) {
    conditions.push('status = ?');
    args.push(status);
  }
  if (severity) {
    conditions.push('severity = ?');
    args.push(String(severity).toUpperCase());
  }

  const safeLimit = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  const safeOffset = Math.max(0, parseInt(offset, 10) || 0);

  const countRes = await db.execute({
    sql: `SELECT COUNT(*) AS cnt FROM webhook_events WHERE ${conditions.join(' AND ')}`,
    args,
  });
  const total = Number(countRes.rows[0]?.cnt || 0);

  const rowsRes = await db.execute({
    sql: `SELECT * FROM webhook_events WHERE ${conditions.join(' AND ')} ORDER BY occurred_at DESC LIMIT ? OFFSET ?`,
    args: [...args, safeLimit, safeOffset],
  });

  return {
    total,
    limit: safeLimit,
    offset: safeOffset,
    events: rowsRes.rows.map(formatEventRow),
  };
}

/**
 * Converts buffered webhook events into SSOT-compatible incident objects
 * so the QBR anomaly engine and dashboard can consume live telemetry seamlessly.
 */
async function getBufferedIncidentsForTenant(tenantId, { site = null, status = 'buffered' } = {}) {
  await ensureTables();
  const db = database.getClient();
  const conditions = ['tenant_id = ?'];
  const args = [tenantId];

  if (status) {
    conditions.push('status = ?');
    args.push(status);
  }
  if (site && site !== 'ALL') {
    conditions.push('LOWER(site_id) = ?');
    args.push(normalizeSiteName(site).toLowerCase());
  }

  const res = await db.execute({
    sql: `SELECT * FROM webhook_events WHERE ${conditions.join(' AND ')} ORDER BY occurred_at DESC LIMIT 500`,
    args,
  });

  return res.rows.map((ev) => {
    const priorityMap = {
      CRITICAL: 'P1 - Critical',
      HIGH: 'P2 - Major',
      MEDIUM: 'P3 - Minor',
      LOW: 'P4 - Low',
      INFO: 'Informational',
    };
    const incRef = ev.event_id || `WH-${ev.id.slice(0, 8).toUpperCase()}`;
    return {
      IncidentNumber: incRef,
      display_reference: { type: 'Incident ID', value: incRef },
      DeviceID: ev.device_id || 'Unknown',
      SerialNo: ev.device_serial || ev.device_id || 'Unknown',
      DeviceType: ev.device_type || 'Switch',
      SiteID: ev.site_id || 'Unknown',
      Location: ev.site_id || 'Unknown',
      RCA: ev.rca_hint || 'Unknown',
      Priority: priorityMap[ev.severity] || 'P2 - Major',
      Severity: ev.severity,
      Status: ev.event_type === 'DEVICE_UP' ? 'Closed' : 'Open',
      'Created Time': ev.occurred_at,
      Subject: ev.message,
      sla_status: ev.event_type === 'DEVICE_UP' ? 'SLA Met' : 'Open',
      source: `webhook:${ev.provider}`,
      webhookEventId: ev.id,
    };
  });
}

async function flushBufferedEvents(tenantId, eventIds = null) {
  await ensureTables();
  const db = database.getClient();
  if (Array.isArray(eventIds) && eventIds.length > 0) {
    const placeholders = eventIds.map(() => '?').join(',');
    const res = await db.execute({
      sql: `UPDATE webhook_events SET status = 'processed' WHERE tenant_id = ? AND status = 'buffered' AND id IN (${placeholders})`,
      args: [tenantId, ...eventIds],
    });
    return { flushed: res.rowsAffected || 0 };
  }

  const res = await db.execute({
    sql: `UPDATE webhook_events SET status = 'processed' WHERE tenant_id = ? AND status = 'buffered'`,
    args: [tenantId],
  });
  return { flushed: res.rowsAffected || 0 };
}

module.exports = {
  ensureTables,
  verifyWebhookSignature,
  normalizeMerakiPayload,
  normalizeCatalystPayload,
  normalizeGenericPayload,
  normalizeWebhookPayload,
  createConnector,
  listConnectors,
  getConnectorById,
  updateConnector,
  deleteConnector,
  ingestWebhookEvent,
  listConnectorEvents,
  getBufferedIncidentsForTenant,
  flushBufferedEvents,
};
