// frontend/src/config/api.js
// Dynamic API Base URL resolver & authenticated fetch helper (ESM, Node & Vite compatible).
// Strict TypeScript signatures are declared in frontend/src/config/api.d.ts.

const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : process.env || {};
const rawUrl = env.VITE_API_URL !== undefined && env.VITE_API_URL !== '' ? env.VITE_API_URL : '';

export const API_BASE_URL = rawUrl ? rawUrl.replace(/\/+$/, '') : '';
export const API_V1_BASE = `${API_BASE_URL}/api/v1`;
export default API_BASE_URL;

export function getAuthHeaders() {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('portal_token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiFetch(url, options = {}) {
  const headers = {
    ...getAuthHeaders(),
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache',
    ...(options.headers || {}),
  };

  let fetchUrl = url;
  if (!options.method || options.method.toUpperCase() === 'GET') {
    const separator = fetchUrl.includes('?') ? '&' : '?';
    fetchUrl = `${fetchUrl}${separator}_t=${Date.now()}`;
  }
  return fetch(fetchUrl, { ...options, headers, cache: 'no-store' });
}
