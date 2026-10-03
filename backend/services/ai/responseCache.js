// backend/services/ai/responseCache.js
const crypto = require('crypto');

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 500;

const cacheMap = new Map();

function sha1(str) {
  return crypto.createHash('sha1').update(String(str || '')).digest('hex');
}

function buildKey(prompt, systemContext) {
  const pHash = sha1(prompt);
  const sHash = sha1(systemContext);
  return sha1(`${pHash}|${sHash}`);
}

function get(prompt, systemContext) {
  try {
    const key = buildKey(prompt, systemContext);
    const entry = cacheMap.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      cacheMap.delete(key);
      return null;
    }

    // Refresh LRU order
    cacheMap.delete(key);
    cacheMap.set(key, entry);

    return entry.value;
  } catch (err) {
    return null;
  }
}

function set(prompt, systemContext, value, ttlMs) {
  try {
    if (!prompt || value === undefined || value === null) return;
    const key = buildKey(prompt, systemContext);
    const ttl = typeof ttlMs === 'number' && ttlMs > 0 ? ttlMs : DEFAULT_TTL_MS;

    if (cacheMap.size >= MAX_ENTRIES) {
      const firstKey = cacheMap.keys().next().value;
      if (firstKey) cacheMap.delete(firstKey);
    }

    cacheMap.set(key, {
      value,
      expiresAt: Date.now() + ttl,
    });
  } catch (err) {
    // Fail silently
  }
}

function clear() {
  cacheMap.clear();
}

function stats() {
  return {
    size: cacheMap.size,
    maxEntries: MAX_ENTRIES,
  };
}

module.exports = { get, set, clear, stats };
