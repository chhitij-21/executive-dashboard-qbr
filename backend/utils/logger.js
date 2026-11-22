// backend/utils/logger.js — Enterprise Pino Structured Logger
const pino = require('pino');

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["x-service-pass"]',
  'req.headers.cookie',
  'password',
  '*.password',
  'token',
  '*.token',
  'mfaCode',
  '*.mfaCode',
  'secret',
  '*.secret',
  'secretKey',
  '*.secretKey',
  'recipients',
  '*.recipients',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
];

const SENSITIVE_KEYS = new Set([
  'authorization',
  'cookie',
  'cookies',
  'x-service-pass',
  'password',
  'token',
  'mfacode',
  'secret',
  'secretkey',
  'recipients',
  'accesstoken',
  'refreshtoken',
]);

/**
 * GAP 3: Pure Functional Body Redactor
 * Handles circular references, nested arrays/objects, depth limit (default 5).
 * Never mutates the input object.
 */
function redactBody(body, options = {}) {
  const maxDepth = options.maxDepth !== undefined ? options.maxDepth : 5;
  const censor = options.censor || '[REDACTED]';

  function _traverse(node, depth, seen) {
    if (node === null || typeof node !== 'object') {
      return node;
    }
    if (depth >= maxDepth) {
      return '[MAX_DEPTH_EXCEEDED]';
    }
    if (seen.has(node)) {
      return '[CIRCULAR]';
    }
    seen.add(node);

    if (Array.isArray(node)) {
      return node.map((item) => _traverse(item, depth + 1, seen));
    }

    const cloned = {};
    for (const [key, value] of Object.entries(node)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        cloned[key] = censor;
      } else {
        cloned[key] = _traverse(value, depth + 1, seen);
      }
    }
    return cloned;
  }

  return _traverse(body, 0, new WeakSet());
}

// ONE-LINER 1: In-memory token bucket capping error-level logs at 100/sec
const ERROR_LOG_LIMIT = 100;
let errorTokens = ERROR_LOG_LIMIT;
let lastRefill = Date.now();
let suppressedErrorCount = 0;

function checkErrorRateLimit() {
  const now = Date.now();
  if (now - lastRefill >= 1000) {
    if (suppressedErrorCount > 0) {
      if (typeof logger !== 'undefined' && logger.warn) {
        logger.warn(`[logger] Rate limit reset: ${suppressedErrorCount} error logs suppressed in the last window.`);
      }
      suppressedErrorCount = 0;
    }
    errorTokens = ERROR_LOG_LIMIT;
    lastRefill = now;
  }
  if (errorTokens > 0) {
    errorTokens -= 1;
    return true;
  }
  suppressedErrorCount += 1;
  return false;
}

const isTest = process.env.NODE_ENV === 'test';
const defaultLevel = isTest
  ? (process.env.LOG_LEVEL || (process.env.ENABLE_TEST_LOGS ? 'info' : 'silent'))
  : (process.env.LOG_LEVEL || 'info');

const serializers = {
  err: pino.stdSerializers.err,     // GAP 1: Extracts type, message, stack
  error: pino.stdSerializers.err,
  req: pino.stdSerializers.req,
  res: pino.stdSerializers.res,
};

const logger = pino({
  level: defaultLevel,
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    pid: process.pid,
    service: 'executive-qbr-backend',
  },
  serializers,
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
  hooks: {
    logMethod(inputArgs, method, level) {
      // 50 = error, 60 = fatal
      if (level >= 50 && !checkErrorRateLimit()) {
        return; // Suppress error log storm
      }
      return method.apply(this, inputArgs);
    },
  },
});

function getChildLogger(moduleName, bindings = {}) {
  return logger.child({ module: moduleName, ...bindings });
}

module.exports = {
  logger,
  getChildLogger,
  serializers,
  redactBody,
  REDACT_PATHS,
  SENSITIVE_KEYS,
  checkErrorRateLimit,
};
