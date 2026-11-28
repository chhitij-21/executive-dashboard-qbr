// frontend/src/config/api.d.ts
// Strict TypeScript declarations for frontend/src/config/api.js

export declare const API_BASE_URL: string;
export declare const API_V1_BASE: string;
declare const _default: string;
export default _default;

export declare function getAuthHeaders(): Record<string, string>;
export declare function apiFetch(url: string, options?: RequestInit): Promise<Response>;
