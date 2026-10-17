// backend/services/ciscoPsirtClient.js
// Official Cisco PSIRT openVuln API Client (v2).
// Implements OAuth2 Client Credentials flow using the updated token endpoint:
// https://id.cisco.com/oauth2/default/v1/token and base URL https://apix.cisco.com.

const TOKEN_URL = 'https://id.cisco.com/oauth2/default/v1/token';
const API_BASE = 'https://apix.cisco.com';

// Fallback credentials if environment variables are not set
const DEFAULT_CLIENT_ID = 'cgbs33f582vsvcxddrs3k9k4';
const DEFAULT_CLIENT_SECRET = '2HCNgV5KRjyxDTEXCBJxX7Te';

// In-memory token cache
let cachedToken = null; // { access_token, expiresAt }
let lastCallTime = 0;
const MIN_CALL_INTERVAL_MS = 250; // Rate limit: max 4-5 req/sec (safely under 5/sec, 60/min)

/**
 * Enforces rate limiting between outbound API calls.
 */
async function throttle(minInterval = MIN_CALL_INTERVAL_MS) {
  const now = Date.now();
  const elapsed = now - lastCallTime;
  if (elapsed < minInterval) {
    const delay = minInterval - elapsed;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  lastCallTime = Date.now();
}

/**
 * Obtains or reuses an OAuth2 client_credentials access token.
 * Token is cached in memory until 60 seconds before expiration.
 *
 * @param {Object} [options]
 * @param {string} [options.clientId]
 * @param {string} [options.clientSecret]
 * @param {boolean} [options.forceRefresh]
 * @returns {Promise<string>} Bearer access token
 */
async function getAccessToken(options = {}) {
  const { clientId, clientSecret, forceRefresh = false } = options;
  const id = process.env.CISCO_CLIENT_ID || clientId || DEFAULT_CLIENT_ID;
  const secret = process.env.CISCO_CLIENT_SECRET || clientSecret || DEFAULT_CLIENT_SECRET;

  const now = Date.now();
  if (!forceRefresh && cachedToken && cachedToken.access_token && cachedToken.expiresAt > now + 60000) {
    return cachedToken.access_token;
  }

  await throttle();

  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', id);
  params.append('client_secret', secret);

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[ciscoPsirtClient] Token acquisition failed (HTTP ${res.status}): ${text}`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`[ciscoPsirtClient] No access_token returned by token endpoint: ${JSON.stringify(data)}`);
  }

  const expiresInSec = parseInt(data.expires_in, 10) || 3600;
  cachedToken = {
    access_token: data.access_token,
    expiresAt: now + expiresInSec * 1000,
  };

  return cachedToken.access_token;
}

/**
 * Makes an authenticated request to the Cisco PSIRT API with automatic 429 backoff and 401 retry.
 */
async function requestWithRetry(url, options = {}, retries = 1) {
  await throttle();
  const token = await getAccessToken();

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
    ...(options.headers || {}),
  };

  const res = await fetch(url, { ...options, headers });

  // Handle 429 Rate Limit
  if (res.status === 429) {
    const retryAfterHeader = res.headers.get('Retry-After');
    const waitSec = retryAfterHeader ? (parseInt(retryAfterHeader, 10) || 2) : 2;
    console.warn(`[ciscoPsirtClient] Rate limited (HTTP 429). Retrying after ${waitSec}s...`);
    await new Promise((resolve) => setTimeout(resolve, waitSec * 1000));
    if (retries > 0) {
      return requestWithRetry(url, options, retries - 1);
    }
    throw new Error(`[ciscoPsirtClient] HTTP 429 Too Many Requests after retries: ${url}`);
  }

  // Handle 401 Expired Token
  if (res.status === 401 && retries > 0) {
    console.warn('[ciscoPsirtClient] HTTP 401 Unauthorized. Refreshing token...');
    cachedToken = null;
    return requestWithRetry(url, options, retries - 1);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[ciscoPsirtClient] API request failed (HTTP ${res.status}): ${text}`);
  }

  return await res.json();
}

/**
 * Fetches the latest N Cisco PSIRT advisories.
 *
 * @param {number} [count=100]
 * @returns {Promise<Array<Object>>} List of advisory objects
 */
async function fetchLatestAdvisories(count = 100) {
  const url = `${API_BASE}/security/advisories/v2/latest/${encodeURIComponent(count)}`;
  const data = await requestWithRetry(url);
  return data.advisories || [];
}

/**
 * Fetches advisories published within a given date range.
 *
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {Promise<Array<Object>>} List of advisory objects
 */
async function fetchAdvisoriesByDateRange(startDate, endDate) {
  const url = `${API_BASE}/security/advisories/v2/lastpublished?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
  const data = await requestWithRetry(url);
  return data.advisories || [];
}

/**
 * Fetches paged advisories.
 *
 * @param {number} [pageIndex=1]
 * @param {number} [pageSize=50]
 * @returns {Promise<Object>}
 */
async function fetchAllAdvisoriesPaged(pageIndex = 1, pageSize = 50) {
  const url = `${API_BASE}/security/advisories/v2/all?pageIndex=${encodeURIComponent(pageIndex)}&pageSize=${encodeURIComponent(pageSize)}`;
  return await requestWithRetry(url);
}

/**
 * Clears in-memory token cache (useful for testing).
 */
function clearTokenCache() {
  cachedToken = null;
  lastCallTime = 0;
}

module.exports = {
  TOKEN_URL,
  API_BASE,
  getAccessToken,
  fetchLatestAdvisories,
  fetchAdvisoriesByDateRange,
  fetchAllAdvisoriesPaged,
  clearTokenCache,
  throttle,
};
