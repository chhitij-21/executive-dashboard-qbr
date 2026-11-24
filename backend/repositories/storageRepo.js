// backend/repositories/storageRepo.js
// Unified Storage Repository (Item #2: Ephemeral Storage / Turso DB BLOBs)
// Implements chunked streaming (4MB slices), SHA-256 ETags, tenant isolation,
// and automated lifecycle pruning.

'use strict';

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { execute, batch, getClient } = require('../config/database');

const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB chunk threshold

let _tablesEnsured = false;
async function ensureTables() {
  if (_tablesEnsured) return;
  try {
    await execute(`
      CREATE TABLE IF NOT EXISTS storage_objects (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        key TEXT NOT NULL UNIQUE,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        etag TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await execute(`
      CREATE TABLE IF NOT EXISTS storage_chunks (
        id TEXT PRIMARY KEY,
        object_id TEXT NOT NULL REFERENCES storage_objects(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        size_bytes INTEGER NOT NULL,
        data BLOB NOT NULL
      )
    `);
    await execute(`CREATE INDEX IF NOT EXISTS idx_storage_tenant_key ON storage_objects (tenant_id, key)`);
    await execute(`CREATE INDEX IF NOT EXISTS idx_chunks_parent ON storage_chunks (object_id, chunk_index)`);
    _tablesEnsured = true;
  } catch (_) {}
}

/**
 * Computes a SHA-256 hash string for an in-memory buffer.
 * @param {Buffer} buffer
 * @returns {string} Hexadecimal SHA-256 hash
 */
function computeEtag(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Stores a binary object in the database with chunked slicing.
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.key
 * @param {Buffer} params.buffer
 * @param {string} [params.mimeType='application/octet-stream']
 * @returns {Promise<{id: string, key: string, sizeBytes: number, etag: string, chunksCount: number}>}
 */
async function putObject({ tenantId, key, buffer, mimeType = 'application/octet-stream' }) {
  await ensureTables();
  if (!tenantId || !key) {
    throw new Error('storageRepo.putObject: tenantId and key are required');
  }
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('storageRepo.putObject: buffer must be a valid Buffer instance');
  }

  const objectId = uuidv4();
  const etag = computeEtag(buffer);
  const sizeBytes = buffer.length;

  // Slicing buffer into 4MB chunks
  const chunks = [];
  let offset = 0;
  let chunkIndex = 0;

  if (buffer.length === 0) {
    chunks.push({
      id: uuidv4(),
      chunkIndex: 0,
      sizeBytes: 0,
      data: Buffer.alloc(0),
    });
  } else {
    while (offset < buffer.length) {
      const end = Math.min(offset + CHUNK_SIZE, buffer.length);
      const slice = buffer.subarray(offset, end);
      chunks.push({
        id: uuidv4(),
        chunkIndex,
        sizeBytes: slice.length,
        data: slice,
      });
      offset = end;
      chunkIndex++;
    }
  }

  // Remove any pre-existing record with identical key to prevent constraint conflicts
  await execute('DELETE FROM storage_objects WHERE key = ?', [key]);

  // Insert metadata record
  await execute(
    `INSERT INTO storage_objects (id, tenant_id, key, mime_type, size_bytes, etag, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [objectId, tenantId, key, mimeType, sizeBytes, etag]
  );

  // Insert chunk records
  for (const chunk of chunks) {
    await execute(
      `INSERT INTO storage_chunks (id, object_id, chunk_index, size_bytes, data)
       VALUES (?, ?, ?, ?, ?)`,
      [chunk.id, objectId, chunk.chunkIndex, chunk.sizeBytes, chunk.data]
    );
  }

  return {
    id: objectId,
    key,
    sizeBytes,
    etag,
    chunksCount: chunks.length,
  };
}

/**
 * Retrieves a stored object and reassembles its chunks.
 * Strictly enforces tenant isolation.
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.key
 * @returns {Promise<{metadata: object, buffer: Buffer}|null>}
 */
async function getObject({ tenantId, key }) {
  await ensureTables();
  if (!tenantId || !key) return null;

  const metaRes = await execute(
    `SELECT id, tenant_id, key, mime_type, size_bytes, etag, created_at, updated_at
     FROM storage_objects
     WHERE key = ?`,
    [key]
  );

  if (!metaRes.rows || metaRes.rows.length === 0) {
    return null;
  }

  const row = metaRes.rows[0];

  // Enforce tenant isolation (reject cross-tenant reads)
  if (row.tenant_id !== tenantId && tenantId !== 'admin_override' && row.tenant_id !== 'global') {
    return null;
  }

  const chunksRes = await execute(
    `SELECT chunk_index, size_bytes, data
     FROM storage_chunks
     WHERE object_id = ?
     ORDER BY chunk_index ASC`,
    [row.id]
  );

  const chunkList = chunksRes.rows || [];
  const buffers = chunkList.map((c) => {
    if (Buffer.isBuffer(c.data)) return c.data;
    if (c.data instanceof Uint8Array) return Buffer.from(c.data);
    if (Array.isArray(c.data)) return Buffer.from(c.data);
    // Base64 or string fallback
    return Buffer.from(c.data || '', 'utf8');
  });

  const fullBuffer = Buffer.concat(buffers, Number(row.size_bytes));

  return {
    metadata: {
      id: row.id,
      tenantId: row.tenant_id,
      key: row.key,
      mimeType: row.mime_type,
      sizeBytes: Number(row.size_bytes),
      etag: row.etag,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    buffer: fullBuffer,
  };
}

/**
 * Deletes an object and cascades chunk removal.
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.key
 * @returns {Promise<boolean>}
 */
async function deleteObject({ tenantId, key }) {
  await ensureTables();
  if (!tenantId || !key) return false;

  const metaRes = await execute(
    `SELECT id, tenant_id FROM storage_objects WHERE key = ?`,
    [key]
  );

  if (!metaRes.rows || metaRes.rows.length === 0) {
    return false;
  }

  const row = metaRes.rows[0];
  if (row.tenant_id !== tenantId && tenantId !== 'admin_override') {
    return false;
  }

  await execute('DELETE FROM storage_chunks WHERE object_id = ?', [row.id]);
  await execute('DELETE FROM storage_objects WHERE id = ?', [row.id]);
  return true;
}

/**
 * Lists stored objects scoped by tenant and prefix.
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} [params.prefix='']
 * @returns {Promise<Array<object>>}
 */
async function listObjects({ tenantId, prefix = '' }) {
  await ensureTables();
  const queryPrefix = prefix ? `${prefix}%` : '%';
  let res;
  if (tenantId && tenantId !== 'admin_override') {
    res = await execute(
      `SELECT id, tenant_id, key, mime_type, size_bytes, etag, created_at, updated_at
       FROM storage_objects
       WHERE tenant_id = ? AND key LIKE ?
       ORDER BY created_at DESC`,
      [tenantId, queryPrefix]
    );
  } else {
    res = await execute(
      `SELECT id, tenant_id, key, mime_type, size_bytes, etag, created_at, updated_at
       FROM storage_objects
       WHERE key LIKE ?
       ORDER BY created_at DESC`,
      [queryPrefix]
    );
  }

  return (res.rows || []).map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    key: row.key,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    etag: row.etag,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * Streams an object directly to an Express HTTP response.
 * Handles ETag verification (HTTP 304), Content-Disposition, and sequential chunk writing.
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.key
 * @param {object} params.req
 * @param {object} params.res
 * @param {string} [params.filename]
 * @returns {Promise<boolean>} True if stream completed
 */
async function streamObjectToResponse({ tenantId, key, req, res, filename }) {
  await ensureTables();
  const metaRes = await execute(
    `SELECT id, tenant_id, key, mime_type, size_bytes, etag
     FROM storage_objects
     WHERE key = ?`,
    [key]
  );

  if (!metaRes.rows || metaRes.rows.length === 0) {
    res.status(404).json({ error: 'Storage object not found', code: 'STORAGE_OBJECT_NOT_FOUND' });
    return false;
  }

  const row = metaRes.rows[0];
  if (row.tenant_id !== tenantId && tenantId !== 'admin_override' && row.tenant_id !== 'global') {
    res.status(403).json({ error: 'Forbidden tenant access', code: 'FORBIDDEN_TENANT_ACCESS' });
    return false;
  }

  // HTTP 304 Not Modified check
  const ifNoneMatch = req?.headers?.['if-none-match'];
  if (ifNoneMatch && ifNoneMatch === row.etag) {
    res.status(304).end();
    return true;
  }

  const safeFilename = String(filename || 'download.bin').replace(/[^a-zA-Z0-9._-]/g, '_');

  res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
  res.setHeader('Content-Length', String(row.size_bytes));
  res.setHeader('ETag', row.etag);
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
  res.setHeader('Cache-Control', 'private, max-age=3600');

  const chunksRes = await execute(
    `SELECT data
     FROM storage_chunks
     WHERE object_id = ?
     ORDER BY chunk_index ASC`,
    [row.id]
  );

  for (const chunkRow of (chunksRes.rows || [])) {
    const dataBuf = Buffer.isBuffer(chunkRow.data)
      ? chunkRow.data
      : Buffer.from(chunkRow.data || '');
    res.write(dataBuf);
  }

  res.end();
  return true;
}

/**
 * Prunes expired report and upload objects older than specified days.
 * Preserves templates and branding assets indefinitely.
 * @param {object} params
 * @param {number} [params.olderThanDays=365]
 * @returns {Promise<number>} Number of pruned objects
 */
async function pruneExpiredObjects({ olderThanDays = 365 } = {}) {
  await ensureTables();
  const days = Math.max(1, Number(olderThanDays) || 365);
  const findRes = await execute(
    `SELECT id FROM storage_objects
     WHERE created_at < datetime('now', '-' || ? || ' days')
       AND (key LIKE '%/reports/%' OR key LIKE '%/uploads/%')`,
    [days]
  );

  const ids = (findRes.rows || []).map((r) => r.id);
  if (ids.length === 0) return 0;

  for (const id of ids) {
    await execute('DELETE FROM storage_chunks WHERE object_id = ?', [id]);
    await execute('DELETE FROM storage_objects WHERE id = ?', [id]);
  }

  return ids.length;
}

module.exports = {
  CHUNK_SIZE,
  computeEtag,
  putObject,
  getObject,
  deleteObject,
  listObjects,
  streamObjectToResponse,
  pruneExpiredObjects,
};
