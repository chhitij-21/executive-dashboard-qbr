// frontend/src/config/api.js
// Dynamic API Base URL resolver:
// 1. If VITE_API_URL is explicitly set, use it.
// 2. In production / deployed environments, default to relative path "" so /api/... routes to the current host on any network.
// 3. In local development (Vite dev mode), default to "http://localhost:3000".

const rawUrl = import.meta.env.VITE_API_URL !== undefined && import.meta.env.VITE_API_URL !== ""
  ? import.meta.env.VITE_API_URL
  : (import.meta.env.PROD ? "" : "http://localhost:3000");

export const API_BASE_URL = rawUrl ? rawUrl.replace(/\/+$/, "") : "";
export default API_BASE_URL;
