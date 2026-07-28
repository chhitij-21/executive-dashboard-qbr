// frontend/src/config/api.js
// Dynamic API Base URL resolver:
// Uses VITE_API_URL if explicitly provided; otherwise defaults to relative path ("")
// so requests seamlessly target host origin on Localhost, Vercel, or Render.

const rawUrl = import.meta.env.VITE_API_URL !== undefined && import.meta.env.VITE_API_URL !== ""
  ? import.meta.env.VITE_API_URL
  : "";

export const API_BASE_URL = rawUrl ? rawUrl.replace(/\/+$/, "") : "";
export default API_BASE_URL;

