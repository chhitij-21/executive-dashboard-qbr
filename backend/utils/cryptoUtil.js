// backend/utils/cryptoUtil.js
// AES-256-GCM Cryptographic Protection & Per-Tenant Key Derivation (Item #3)

const crypto = require('crypto');

const DEV_KEY_FALLBACK = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

/**
 * Validates and retrieves the 32-byte master encryption key buffer.
 * In production, fails fast if RECIPIENTS_ENCRYPTION_KEY is missing or invalid.
 */
function getMasterKeyBuffer() {
  const hexKey = process.env.RECIPIENTS_ENCRYPTION_KEY;
  if (!hexKey || typeof hexKey !== 'string' || hexKey.trim().length !== 64) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[FATAL] Missing or invalid RECIPIENTS_ENCRYPTION_KEY in production. Must be exactly 64 hex characters (32 bytes).'
      );
    }
    return Buffer.from(DEV_KEY_FALLBACK, 'hex');
  }
  return Buffer.from(hexKey.trim(), 'hex');
}

/**
 * Derives an isolated 32-byte symmetric key for a specific tenant using RFC 5869 HKDF.
 * @param {string} tenantId Canonical tenant identifier
 * @returns {Buffer} 32-byte derived key
 */
function getTenantKey(tenantId) {
  const masterKey = getMasterKeyBuffer();
  const info = 'executive-dashboard-recipients-v1';
  return Buffer.from(crypto.hkdfSync('sha256', masterKey, tenantId || 'default', info, 32));
}

/**
 * Encrypts an array of recipient emails using AES-256-GCM.
 * @param {string[]} recipientsArray Array of recipient email strings
 * @param {string} tenantId Canonical tenant identifier
 * @returns {string} JSON-serialized envelope containing { v, iv, tag, data }
 */
function encryptRecipients(recipientsArray, tenantId) {
  if (!Array.isArray(recipientsArray)) {
    throw new Error('encryptRecipients requires an array of recipient strings');
  }
  const key = getTenantKey(tenantId);
  const iv = crypto.randomBytes(12); // 96-bit recommended IV for AES-GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const plaintext = JSON.stringify(recipientsArray);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const envelope = {
    v: 1,
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: encrypted.toString('hex'),
  };

  return JSON.stringify(envelope);
}

/**
 * Decrypts an AES-256-GCM encrypted recipient envelope.
 * Returns null (never []) on decryption failure, tampered tag, or corrupted payload
 * to guarantee loud failure and prevent silent alert loss.
 * @param {string|object} envelopeOrJson JSON envelope or parsed object
 * @param {string} tenantId Canonical tenant identifier
 * @returns {string[]|null} Array of recipient emails or null on failure
 */
function decryptRecipients(envelopeOrJson, tenantId) {
  if (!envelopeOrJson) return null;

  let envelope = envelopeOrJson;
  if (typeof envelope === 'string') {
    try {
      envelope = JSON.parse(envelopeOrJson);
    } catch (_) {
      console.error(`[cryptoUtil] RECIPIENTS_DECRYPTION_FAILED: Malformed JSON envelope for tenant '${tenantId}'.`);
      return null;
    }
  }

  if (!envelope || envelope.v !== 1 || !envelope.iv || !envelope.tag || !envelope.data) {
    console.error(`[cryptoUtil] RECIPIENTS_DECRYPTION_FAILED: Invalid envelope structure for tenant '${tenantId}'.`);
    return null;
  }

  try {
    const key = getTenantKey(tenantId);
    const iv = Buffer.from(envelope.iv, 'hex');
    const tag = Buffer.from(envelope.tag, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'hex')),
      decipher.final(),
    ]);

    const parsed = JSON.parse(decrypted.toString('utf8'));
    if (!Array.isArray(parsed)) {
      console.error(`[cryptoUtil] RECIPIENTS_DECRYPTION_FAILED: Decrypted payload for tenant '${tenantId}' is not an array.`);
      return null;
    }
    return parsed;
  } catch (err) {
    console.error(`[cryptoUtil] RECIPIENTS_DECRYPTION_FAILED: Decryption error for tenant '${tenantId}': ${err.message}`);
    return null;
  }
}

module.exports = {
  getMasterKeyBuffer,
  getTenantKey,
  encryptRecipients,
  decryptRecipients,
};
