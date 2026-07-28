// frontend/src/config/api.js
// Dynamic API Base URL resolver:
// 1. If VITE_API_URL environment variable is set, use it.
// 2. In production, default to relative path "" (current domain).
// 3. Fallback to live Render backend: https://qbr-dashboard-backend.onrender.com

const RENDER_BACKEND_URL = "https://qbr-dashboard-backend.onrender.com";

const rawUrl = import.meta.env.VITE_API_URL !== undefined && import.meta.env.VITE_API_URL !== ""
  ? import.meta.env.VITE_API_URL
  : (import.meta.env.PROD ? "" : RENDER_BACKEND_URL);

export const API_BASE_URL = rawUrl ? rawUrl.replace(/\/+$/, "") : "";
export default API_BASE_URL;
