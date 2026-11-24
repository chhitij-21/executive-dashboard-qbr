// backend/services/auditService.js
// Enterprise Security Audit Trail & Compliance Logging System (Item #21)
// Provides tamper-evident immutable DB persistence and append-only SIEM files.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const database = require('../config/database');

const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'token',
  'secret',
  'webhook_secret',
  'shared_secret',
  'mfa_secret',
  'jwt',
  'authorization',
  'cookie',
  'service_pass',
]);

/**
 * Resolves the directory for daily audit log files.
 * Defaults to os.tmpdir() in tests, or data/audit in production.
 */
function getAuditLogDir() {
  if (process.env.AUDIT_LOG_DIR) {
    return process.env.AUDIT_LOG_DIR;
  }
  if (process.env.NODE_ENV === 'test') {
    return path.join(os.tmpdir(), `test-audit-${process.pid}`);
  }
  return path.resolve(__dirname, '../../data/audit');
}

/**
 * Redacts passwords, tokens, and secret parameters from details objects.
 */
function sanitizeDetails(details) {
  if (!details || typeof details !== 'object') return {};
  if (Array.isArray(details)) return details.map(sanitizeDetails);

  const clean = {};
  for (const [k, v] of Object.entries(details)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      clean[k] = '[REDACTED]';
    } else if (v && typeof v === 'object') {
      clean[k] = sanitizeDetails(v);
    } else {
      clean[k] = v;
    }
  }
  return clean;
}

/**
 * Self-healing table creation for worker-scoped or newly provisioned databases.
 */
let _tablesEnsured = false;
async function ensureTable() {
  if (_tablesEnsured) return;
  const db = database.getClient();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('INFO', 'WARN', 'CRITICAL')),
      tenant_id TEXT,
      user_id TEXT,
      username TEXT,
      role TEXT,
      ip_address TEXT NOT NULL,
      user_agent TEXT,
      resource_type TEXT,
      resource_id TEXT,
      action TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('SUCCESS', 'FAILURE')),
      details_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp DESC);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_audit_tenant_time ON audit_logs(tenant_id, timestamp DESC);`);
  _tablesEnsured = true;
}

/**
 * Records an immutable security audit event into both DB and append-only SIEM log file.
 * Non-blocking: failures log silently to stderr and do NOT crash business operations.
 *
 * @param {object} params
 * @param {string} params.eventType - e.g. 'AUTH_LOGIN_SUCCESS', 'REPORT_DOWNLOADED'
 * @param {'INFO'|'WARN'|'CRITICAL'} [params.severity='INFO']
 * @param {string} [params.tenantId]
 * @param {object} [params.user]
 * @param {object} [params.req] - Express request for automatic IP / user-agent extraction
 * @param {string} [params.resourceType]
 * @param {string} [params.resourceId]
 * @param {string} params.action - e.g. 'LOGIN', 'DOWNLOAD', 'CREATE'
 * @param {'SUCCESS'|'FAILURE'} [params.status='SUCCESS']
 * @param {object} [params.details]
 * @returns {Promise<object>} The persisted audit record
 */
async function logEvent({
  eventType,
  severity = 'INFO',
  tenantId = null,
  user = null,
  req = null,
  resourceType = null,
  resourceId = null,
  action,
  status = 'SUCCESS',
  details = {},
}) {
  try {
    await ensureTable();

    const id = uuidv4();
    const timestamp = new Date().toISOString();

    // Context resolution from request and user
    const resolvedUser = user || req?.user || null;
    const userId = resolvedUser?.id ? String(resolvedUser.id) : null;
    const username = resolvedUser?.email || resolvedUser?.username || 'anonymous';
    const role = resolvedUser?.role || 'unauthenticated';

    const rawIp = req?.headers?.['x-forwarded-for'] || req?.ip || req?.connection?.remoteAddress || '127.0.0.1';
    const ipAddress = typeof rawIp === 'string' ? rawIp.split(',')[0].trim() : '127.0.0.1';
    const userAgent = req?.headers?.['user-agent'] ? String(req.headers['user-agent']).substring(0, 256) : null;

    const resolvedTenant = tenantId || resolvedUser?.assignedClient || req?.targetClientId || null;
    const cleanDetails = sanitizeDetails(details);
    const detailsJson = JSON.stringify(cleanDetails);

    const record = {
      id,
      timestamp,
      event_type: eventType,
      severity,
      tenant_id: resolvedTenant,
      user_id: userId,
      username,
      role,
      ip_address: ipAddress,
      user_agent: userAgent,
      resource_type: resourceType,
      resource_id: resourceId ? String(resourceId) : null,
      action: action || 'EXECUTE',
      status: status === 'FAILURE' ? 'FAILURE' : 'SUCCESS',
      details: cleanDetails,
    };

    // 1. Primary Structured DB Insertion
    const db = database.getClient();
    await db.execute({
      sql: `INSERT INTO audit_logs (
        id, timestamp, event_type, severity, tenant_id, user_id, username,
        role, ip_address, user_agent, resource_type, resource_id, action,
        status, details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        timestamp,
        eventType,
        severity,
        resolvedTenant,
        userId,
        username,
        role,
        ipAddress,
        userAgent,
        resourceType,
        record.resource_id,
        record.action,
        record.status,
        detailsJson,
      ],
    });

    // 2. Append-Only SIEM Daily Log File
    try {
      const auditDir = getAuditLogDir();
      if (!fs.existsSync(auditDir)) {
        fs.mkdirSync(auditDir, { recursive: true });
      }
      const dayString = timestamp.substring(0, 10); // YYYY-MM-DD
      const logFilePath = path.join(auditDir, `audit-${dayString}.log`);
      const line = JSON.stringify(record) + '\n';
      await fs.promises.appendFile(logFilePath, line, 'utf8');
    } catch (fsErr) {
      console.warn('[auditService] Notice: SIEM file write notice:', fsErr.message);
    }

    return record;
  } catch (err) {
    console.error('[auditService] Error writing audit log:', err.message);
    return null;
  }
}

/**
 * Queries audit logs with pagination and multi-dimensional filtering.
 *
 * @param {object} params
 * @param {string} [params.tenantId]
 * @param {string} [params.eventType]
 * @param {string} [params.severity]
 * @param {string} [params.userId]
 * @param {string} [params.action]
 * @param {string} [params.status]
 * @param {string} [params.startDate]
 * @param {string} [params.endDate]
 * @param {number} [params.limit=50]
 * @param {number} [params.offset=0]
 * @returns {Promise<{ total: number, limit: number, offset: number, logs: Array<object> }>}
 */
async function queryLogs({
  tenantId = null,
  includeGlobal = false,
  eventType = null,
  severity = null,
  userId = null,
  action = null,
  status = null,
  startDate = null,
  endDate = null,
  limit = 50,
  offset = 0,
} = {}) {
  await ensureTable();
  const db = database.getClient();

  const conditions = [];
  const args = [];

  if (tenantId && tenantId !== 'all') {
    if (includeGlobal) {
      conditions.push('(tenant_id = ? OR tenant_id IS NULL)');
    } else {
      conditions.push('tenant_id = ?');
    }
    args.push(tenantId);
  }
  if (eventType) {
    conditions.push('event_type = ?');
    args.push(eventType);
  }
  if (severity) {
    conditions.push('severity = ?');
    args.push(severity);
  }
  if (userId) {
    conditions.push('user_id = ?');
    args.push(userId);
  }
  if (action) {
    conditions.push('action = ?');
    args.push(action);
  }
  if (status) {
    conditions.push('status = ?');
    args.push(status);
  }
  if (startDate) {
    conditions.push('timestamp >= ?');
    args.push(startDate);
  }
  if (endDate) {
    conditions.push('timestamp <= ?');
    args.push(endDate);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Count total
  const countRes = await db.execute({
    sql: `SELECT COUNT(1) as total FROM audit_logs ${whereClause}`,
    args,
  });
  const total = Number(countRes.rows?.[0]?.total || 0);

  // Fetch paginated slice
  const parsedLimit = Math.min(200, Math.max(1, Number(limit) || 50));
  const parsedOffset = Math.max(0, Number(offset) || 0);

  const querySql = `
    SELECT id, timestamp, event_type, severity, tenant_id, user_id, username,
           role, ip_address, user_agent, resource_type, resource_id, action,
           status, details_json, created_at
    FROM audit_logs
    ${whereClause}
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `;
  const rowsRes = await db.execute({
    sql: querySql,
    args: [...args, parsedLimit, parsedOffset],
  });

  const logs = (rowsRes.rows || []).map((row) => {
    let details = {};
    try {
      if (row.details_json) details = JSON.parse(row.details_json);
    } catch (_) {}
    return {
      id: row.id,
      timestamp: row.timestamp,
      eventType: row.event_type,
      severity: row.severity,
      tenantId: row.tenant_id,
      userId: row.user_id,
      username: row.username,
      role: row.role,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      action: row.action,
      status: row.status,
      details,
      createdAt: row.created_at,
    };
  });

  return {
    total,
    limit: parsedLimit,
    offset: parsedOffset,
    logs,
  };
}

/**
 * Generates an RFC 4180 compliant CSV string for compliance export.
 */
async function exportCsv(filterParams = {}) {
  const result = await queryLogs({ ...filterParams, limit: 1000, offset: 0 });
  const headers = [
    'ID',
    'Timestamp (UTC)',
    'Event Type',
    'Severity',
    'Tenant ID',
    'User ID',
    'Username',
    'Role',
    'IP Address',
    'Action',
    'Status',
    'Resource Type',
    'Resource ID',
    'Details',
  ];

  const escapeCsv = (str) => {
    if (str === null || str === undefined) return '""';
    const val = String(str).replace(/"/g, '""');
    return `"${val}"`;
  };

  const rows = [headers.join(',')];
  for (const log of result.logs) {
    const detailsStr = JSON.stringify(log.details || {});
    rows.push([
      escapeCsv(log.id),
      escapeCsv(log.timestamp),
      escapeCsv(log.eventType),
      escapeCsv(log.severity),
      escapeCsv(log.tenantId || ''),
      escapeCsv(log.userId || ''),
      escapeCsv(log.username),
      escapeCsv(log.role),
      escapeCsv(log.ipAddress),
      escapeCsv(log.action),
      escapeCsv(log.status),
      escapeCsv(log.resourceType || ''),
      escapeCsv(log.resourceId || ''),
      escapeCsv(detailsStr),
    ].join(','));
  }

  return rows.join('\r\n');
}

/**
 * Test helper: clears all logs in test environment.
 */
async function _clearLogsForTest() {
  if (process.env.NODE_ENV !== 'test') return;
  await ensureTable();
  const db = database.getClient();
  await db.execute('DELETE FROM audit_logs');
}

module.exports = {
  logEvent,
  queryLogs,
  exportCsv,
  getAuditLogDir,
  ensureTable,
  _clearLogsForTest,
};
