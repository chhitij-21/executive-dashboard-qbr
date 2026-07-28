// frontend/src/config/api.js
// Dynamic API Base URL resolver:
// Always point to the live Render backend unless VITE_API_URL is explicitly set.

const RENDER_BACKEND_URL = "https://qbr-dashboard-backend.onrender.com";

const rawUrl = import.meta.env.VITE_API_URL !== undefined && import.meta.env.VITE_API_URL !== ""
  ? import.meta.env.VITE_API_URL
  : RENDER_BACKEND_URL;

export const API_BASE_URL = rawUrl ? rawUrl.replace(/\/+$/, "") : "";
export default API_BASE_URL;
