// frontend/src/config/api.js
// Dynamic API Base URL resolver:
// Uses VITE_API_URL if explicitly provided; otherwise defaults to relative path ("")
// so requests seamlessly target host origin on Localhost, Vercel, or Render.

const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : (typeof process !== 'undefined' && process.env) ? process.env : {};
const rawUrl = env.VITE_API_URL !== undefined && env.VITE_API_URL !== ""
  ? env.VITE_API_URL
  : "";

export const API_BASE_URL = rawUrl ? rawUrl.replace(/\/+$/, "") : "";
export default API_BASE_URL;

// ─── Authenticated Fetch Helper ────────────────────────────────────────────────
// Automatically injects the stored Bearer token into every request.
// Drop-in replacement for fetch() in all frontend components.

export function getAuthHeaders() {
  const token = localStorage.getItem('portal_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Authenticated fetch — wraps native fetch with auth headers.
 * @param {string} url
 * @param {RequestInit} options
 */
export async function apiFetch(url, options = {}) {
  const headers = {
    ...getAuthHeaders(),
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    ...(options.headers || {}),
  };
  let fetchUrl = url;
  if (!options.method || options.method.toUpperCase() === 'GET') {
    const separator = fetchUrl.includes('?') ? '&' : '?';
    fetchUrl = `${fetchUrl}${separator}_t=${Date.now()}`;
  }
  return fetch(fetchUrl, { ...options, headers, cache: 'no-store' });
}
