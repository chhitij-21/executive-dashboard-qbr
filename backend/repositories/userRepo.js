// backend/repositories/userRepo.js
// Multi-Tenant Relational Repository for User Accounts & Credentials (Item #3)

const { execute } = require('../config/database');

/**
 * Maps a raw database row to a structured user domain object.
 */
function mapRowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    password_hash: row.password_hash,
    password: row.password_hash, // backward compatibility
    name: row.name,
    role: row.role,
    assignedClient: row.assigned_client,
    assigned_client: row.assigned_client,
    avatar: row.avatar || (row.role === 'admin' ? '👑' : '👤'),
    mfaSecret: row.mfa_secret || null,
    mfa_secret: row.mfa_secret || null,
    mfaEnabled: !!row.mfa_enabled,
    mfa_enabled: row.mfa_enabled ? 1 : 0,
    pendingMfaSecret: row.pending_mfa_secret || null,
    pending_mfa_secret: row.pending_mfa_secret || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Creates or updates a user record using ON CONFLICT DO UPDATE (never INSERT OR REPLACE).
 * @param {object} user User profile object
 */
async function createUser(user) {
  const now = new Date().toISOString();
  const sql = `
    INSERT INTO users (
      id, email, username, password_hash, name, role,
      assigned_client, avatar, mfa_secret, mfa_enabled,
      pending_mfa_secret, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email,
      username = excluded.username,
      password_hash = excluded.password_hash,
      name = excluded.name,
      role = excluded.role,
      assigned_client = excluded.assigned_client,
      avatar = excluded.avatar,
      mfa_secret = excluded.mfa_secret,
      mfa_enabled = excluded.mfa_enabled,
      pending_mfa_secret = excluded.pending_mfa_secret,
      updated_at = excluded.updated_at
  `;

  await execute(sql, [
    user.id,
    user.email.toLowerCase().trim(),
    (user.username || user.email.split('@')[0]).toLowerCase().trim(),
    user.password_hash || user.password,
    user.name || 'Portal User',
    user.role || 'client_user',
    user.assigned_client || user.assignedClient || 'client-jfl',
    user.avatar || (user.role === 'admin' ? '👑' : '👤'),
    user.mfa_secret || user.mfaSecret || null,
    user.mfa_enabled || user.mfaEnabled ? 1 : 0,
    user.pending_mfa_secret || user.pendingMfaSecret || null,
    user.created_at || user.createdAt || now,
    user.updated_at || user.updatedAt || now,
  ]);

  return getUserById(user.id);
}

/**
 * Retrieves a user by primary key ID.
 */
async function getUserById(id) {
  if (!id) return null;
  const res = await execute('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
  return res.rows?.length > 0 ? mapRowToUser(res.rows[0]) : null;
}

/**
 * Retrieves a user by email or username (case-insensitive).
 */
async function getUserByEmail(emailOrUsername) {
  if (!emailOrUsername) return null;
  const target = emailOrUsername.toLowerCase().trim();
  const res = await execute(
    'SELECT * FROM users WHERE lower(email) = ? OR lower(username) = ? LIMIT 1',
    [target, target]
  );
  return res.rows?.length > 0 ? mapRowToUser(res.rows[0]) : null;
}

/**
 * Updates a user's password hash and updates updated_at.
 */
async function updatePassword(id, passwordHash) {
  const now = new Date().toISOString();
  await execute(
    'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
    [passwordHash, now, id]
  );
  return getUserById(id);
}

/**
 * Updates MFA credentials for a user.
 */
async function updateMFA(id, { mfaSecret, mfaEnabled, pendingMfaSecret }) {
  const now = new Date().toISOString();
  await execute(
    `UPDATE users SET
       mfa_secret = ?,
       mfa_enabled = ?,
       pending_mfa_secret = ?,
       updated_at = ?
     WHERE id = ?`,
    [mfaSecret, mfaEnabled ? 1 : 0, pendingMfaSecret, now, id]
  );
  return getUserById(id);
}

/**
 * Retrieves all registered users.
 */
async function getAllUsers() {
  const res = await execute('SELECT * FROM users ORDER BY created_at ASC');
  return (res.rows || []).map(mapRowToUser);
}

module.exports = {
  createUser,
  getUserById,
  getUserByEmail,
  updatePassword,
  updateMFA,
  getAllUsers,
};
