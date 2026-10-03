// frontend/src/validators/validationRunner.js

import { apiFetch, API_BASE_URL } from '../config/api.js';

export async function runValidationReport(qbrData, options = {}) {
  if (!qbrData || typeof qbrData !== 'object') {
    return {
      success: false,
      report: null,
      error: 'NO_DATA',
    };
  }

  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 15000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `${API_BASE_URL}/api/validate`;
    const res = await apiFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qbrData }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      return {
        success: false,
        report: null,
        error: `HTTP_${res.status}`,
      };
    }

    let json;
    try {
      json = await res.json();
    } catch (e) {
      return {
        success: false,
        report: null,
        error: 'MALFORMED_RESPONSE',
      };
    }

    if (!json || typeof json !== 'object') {
      return {
        success: false,
        report: null,
        error: 'MALFORMED_RESPONSE',
      };
    }

    return {
      success: true,
      report: json,
      error: null,
    };
  } catch (err) {
    clearTimeout(timer);

    if (err && err.name === 'AbortError') {
      return {
        success: false,
        report: null,
        error: 'TIMEOUT',
      };
    }

    return {
      success: false,
      report: null,
      error: 'NETWORK_ERROR',
    };
  }
}
