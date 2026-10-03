// backend/services/ai/retryHandler.js

function isRetryable(err) {
  if (!err) return false;

  const status = err.status || err.statusCode || (err.response && err.response.status);
  if (status && [429, 500, 502, 503, 504].includes(Number(status))) {
    return true;
  }

  const msg = String(err.message || '').toLowerCase();
  if (
    msg.includes('rate limit') ||
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('network error') ||
    msg.includes('fetch failed') ||
    msg.includes('overloaded')
  ) {
    return true;
  }

  return false;
}

async function withRetry(fn, options = {}) {
  if (typeof fn !== 'function') {
    throw new Error('withRetry requires a function argument');
  }

  const maxAttempts = typeof options.maxAttempts === 'number' ? options.maxAttempts : 3;
  const baseDelayMs = typeof options.baseDelayMs === 'number' ? options.baseDelayMs : 500;
  const maxDelayMs = typeof options.maxDelayMs === 'number' ? options.maxDelayMs : 4000;

  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt === maxAttempts || !isRetryable(err)) {
        throw err;
      }

      const backoff = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
      // Jitter calculation allowed by rules
      const jitter = Math.floor(Math.random() * 200);
      const delay = backoff + jitter;

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error('Retry limit reached');
}

module.exports = { withRetry, isRetryable };
