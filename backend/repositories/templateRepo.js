// backend/repositories/templateRepo.js
// Multi-Tenant Relational Repository for PowerPoint Template Versions (Item #3)

const { execute, batch } = require('../config/database');

/**
 * Maps a raw row to a template version object.
 */
function mapRowToVersion(row) {
  if (!row) return null;
  return {
    version: row.version,
    filename: row.filename,
    storagePath: row.storage_path,
    size: row.file_size_bytes,
    fileSizeBytes: row.file_size_bytes,
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at,
    isActive: !!row.is_active,
  };
}

/**
 * Adds a new template version to the database.
 */
async function addVersion(templateData) {
  const {
    id,
    tenantId,
    version,
    filename,
    storagePath,
    fileSizeBytes,
    uploadedBy,
    uploadedAt,
    isActive,
  } = templateData;

  const sql = `
    INSERT INTO templates (
      id, tenant_id, version, filename, storage_path,
      file_size_bytes, uploaded_by, uploaded_at, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, version) DO UPDATE SET
      filename = excluded.filename,
      storage_path = excluded.storage_path,
      file_size_bytes = excluded.file_size_bytes,
      uploaded_by = excluded.uploaded_by,
      uploaded_at = excluded.uploaded_at,
      is_active = excluded.is_active
  `;

  // If this version is marked active, deactivate other versions first
  if (isActive) {
    await execute('UPDATE templates SET is_active = 0 WHERE tenant_id = ?', [tenantId]);
  }

  await execute(sql, [
    id || `${tenantId}_v${version}`,
    tenantId,
    version,
    filename,
    storagePath,
    fileSizeBytes || 0,
    uploadedBy || 'admin@portal.com',
    uploadedAt || new Date().toISOString(),
    isActive ? 1 : 0,
  ]);

  return getManifest(tenantId);
}

/**
 * Retrieves the template manifest for a tenant.
 */
async function getManifest(tenantId) {
  const res = await execute(
    'SELECT * FROM templates WHERE tenant_id = ? ORDER BY version ASC',
    [tenantId]
  );
  const rows = res.rows || [];
  const versions = rows.map(mapRowToVersion);
  const activeRow = rows.find((r) => r.is_active === 1);
  const activeVersion = activeRow ? activeRow.version : (versions[versions.length - 1]?.version || 1);

  return {
    tenantId,
    activeVersion,
    versions,
  };
}

/**
 * Sets the active template version for a tenant.
 */
async function setActiveVersion(tenantId, version) {
  const targetVersion = parseInt(version, 10);
  const check = await execute(
    'SELECT * FROM templates WHERE tenant_id = ? AND version = ? LIMIT 1',
    [tenantId, targetVersion]
  );
  if (!check.rows || check.rows.length === 0) {
    throw new Error(`Template version ${targetVersion} does not exist for tenant '${tenantId}'`);
  }

  await batch([
    { sql: 'UPDATE templates SET is_active = 0 WHERE tenant_id = ?', args: [tenantId] },
    { sql: 'UPDATE templates SET is_active = 1 WHERE tenant_id = ? AND version = ?', args: [tenantId, targetVersion] },
  ]);

  return getManifest(tenantId);
}

/**
 * Deletes a template version record.
 * Fails if attempting to delete the currently active version.
 */
async function deleteVersion(tenantId, version) {
  const targetVersion = parseInt(version, 10);
  const check = await execute(
    'SELECT * FROM templates WHERE tenant_id = ? AND version = ? LIMIT 1',
    [tenantId, targetVersion]
  );
  if (!check.rows || check.rows.length === 0) {
    return false;
  }
  if (check.rows[0].is_active === 1) {
    throw new Error(`Cannot delete active template version ${targetVersion}`);
  }

  await execute(
    'DELETE FROM templates WHERE tenant_id = ? AND version = ?',
    [tenantId, targetVersion]
  );
  return true;
}

module.exports = {
  addVersion,
  getManifest,
  setActiveVersion,
  deleteVersion,
};
