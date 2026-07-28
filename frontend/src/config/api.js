// frontend/src/config/api.js
// Dynamic API Base URL resolver:
// Uses VITE_API_URL if explicitly provided; otherwise defaults to relative path ("")
// so requests seamlessly target host origin on Localhost, Vercel, or Render.

const rawUrl = import.meta.env.VITE_API_URL !== undefined && import.meta.env.VITE_API_URL !== ""
  ? import.meta.env.VITE_API_URL
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
    ...(options.headers || {}),
  };
  return fetch(url, { ...options, headers });
}
