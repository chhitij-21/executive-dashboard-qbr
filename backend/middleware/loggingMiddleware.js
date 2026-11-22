// backend/middleware/loggingMiddleware.js — Request Correlation & Lifecycle Logging
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../utils/logger');

const REQUEST_ID_REGEX = /^[a-zA-Z0-9\-_]+$/;

/**
 * ONE-LINER 3: Strict Request ID Validation
 * Allows up to 128 characters matching ^[a-zA-Z0-9\-_]+$.
 * Disallows spaces, newlines, injection chars; falls back to UUID v4.
 */
function validateRequestId(incomingId) {
  if (
    typeof incomingId === 'string' &&
    incomingId.length > 0 &&
    incomingId.length <= 128 &&
    REQUEST_ID_REGEX.test(incomingId)
  ) {
    return incomingId;
  }
  return uuidv4();
}

function loggingMiddleware(req, res, next) {
  // 1. Correlation ID: validated or newly generated
  const reqId = validateRequestId(req.headers['x-request-id']);
  req.id = reqId;
  res.setHeader('X-Request-Id', reqId);

  // 2. Child logger bound to request context
  req.log = logger.child({
    reqId,
    ip: req.ip || req.connection?.remoteAddress,
  });

  // 3. Track request duration
  const startTime = process.hrtime.bigint();
  let logEmitted = false;

  function emitRequestLog(aborted = false) {
    if (logEmitted) return;
    logEmitted = true;

    const elapsedNs = process.hrtime.bigint() - startTime;
    const durationMs = Number(elapsedNs / 1000000n);

    // GAP 3: ZERO BODY LOGGING POLICY
    // Request bodies are strictly omitted from default request logs
    const logData = {
      reqId,
      method: req.method,
      url: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs,
      contentLength: res.getHeader('content-length'),
      userAgent: req.headers['user-agent'],
      userId: req.user?.id || req.user?.username,
      tenantId: req.user?.tenantId || req.tenantId,
      ...(aborted ? { aborted: true } : {}),
    };

    // Suppress noise for polling health endpoints
    if (req.path.endsWith('/health') || req.path.endsWith('/health/scheduler')) {
      req.log.debug(logData, 'HTTP Request Completed');
      return;
    }

    // GAP 1: Log aborted requests at warn level
    if (aborted) {
      req.log.warn(logData, 'HTTP Request Aborted by Client');
    } else if (res.statusCode >= 500) {
      req.log.error(logData, 'HTTP Request Failed (Server Error)');
    } else if (res.statusCode >= 400) {
      req.log.warn(logData, 'HTTP Request Failed (Client Error)');
    } else {
      req.log.info(logData, 'HTTP Request Completed');
    }
  }

  // Normal completion
  res.on('finish', () => emitRequestLog(false));

  // GAP 1: Client socket disconnect before finish
  res.on('close', () => {
    if (!res.writableEnded) {
      emitRequestLog(true);
    }
  });

  next();
}

module.exports = {
  loggingMiddleware,
  validateRequestId,
};
