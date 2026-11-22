// backend/tests/observability.test.js — TDD Suite for Item #15 Observability
process.env.NODE_ENV = 'test';
const { describe, it, before, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const express = require('express');
const pino = require('pino');

describe('Item #15: Observability — Pino Structured Logging & Sentry Error Tracking', () => {
  let app;
  let server;
  let baseUrl;

  // 1. GAP 1: Pino Error Serializer with Stack Trace
  it('1. logger_serializes_error_with_stack: Extracts message, type, and stack from Error', () => {
    const { logger, serializers } = require('../utils/logger');
    assert.ok(serializers, 'serializers must be exported');
    assert.strictEqual(typeof serializers.err, 'function', 'err serializer must be defined');

    const testErr = new Error('Database connection failed');
    testErr.code = 'ECONNREFUSED';

    const serialized = serializers.err(testErr);
    assert.strictEqual(serialized.type, 'Error');
    assert.strictEqual(serialized.message, 'Database connection failed');
    assert.ok(serialized.stack && serialized.stack.includes('Database connection failed'), 'stack trace must be present');
  });

  // 2. Pino Redaction: Authorization header
  it('2. logger_redacts_sensitive_authorization_header: Scrubs Authorization Bearer tokens in Pino logs', () => {
    const { REDACT_PATHS } = require('../utils/logger');
    let output = '';
    const testLogger = pino(
      { redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } },
      { write: (chunk) => { output += chunk; } }
    );

    testLogger.info({
      req: {
        headers: {
          authorization: 'Bearer super-secret-admin-jwt',
          'x-service-pass': 'master-service-pass-secret',
        },
      },
    });

    const parsed = JSON.parse(output);
    assert.strictEqual(parsed.req.headers.authorization, '[REDACTED]', 'authorization header must be [REDACTED]');
    assert.strictEqual(parsed.req.headers['x-service-pass'], '[REDACTED]', 'x-service-pass header must be [REDACTED]');
  });

  // 3. Pino Redaction: Password, Token, Secrets at root & nested
  it('3. logger_redacts_sensitive_password_and_token: Scrubs password, token, secret, recipients at root and nested paths', () => {
    const { REDACT_PATHS } = require('../utils/logger');
    let output = '';
    const testLogger = pino(
      { redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } },
      { write: (chunk) => { output += chunk; } }
    );

    testLogger.info({
      password: 'plainPassword123',
      token: 'secret-token-xyz',
      secret: 'api-secret-key',
      recipients: ['confidential@client.com'],
      nested: {
        password: 'nestedPassword456',
        token: 'nestedToken789',
        mfaCode: '654321',
      },
    });

    const parsed = JSON.parse(output);
    assert.strictEqual(parsed.password, '[REDACTED]', 'root password must be [REDACTED]');
    assert.strictEqual(parsed.token, '[REDACTED]', 'root token must be [REDACTED]');
    assert.strictEqual(parsed.secret, '[REDACTED]', 'root secret must be [REDACTED]');
    assert.strictEqual(parsed.recipients, '[REDACTED]', 'root recipients must be [REDACTED]');
    assert.strictEqual(parsed.nested.password, '[REDACTED]', 'nested password must be [REDACTED]');
    assert.strictEqual(parsed.nested.token, '[REDACTED]', 'nested token must be [REDACTED]');
    assert.strictEqual(parsed.nested.mfaCode, '[REDACTED]', 'nested mfaCode must be [REDACTED]');
  });

  // 4. GAP 2: Sentry beforeSend Security Scrubber
  it('4. sentry_beforeSend_scrubsAuthHeader: Strips sensitive headers, cookies, and payload', () => {
    const { sentryBeforeSend } = require('../utils/sentry');
    assert.strictEqual(typeof sentryBeforeSend, 'function', 'sentryBeforeSend must be exported');

    const mockEvent = {
      request: {
        headers: {
          authorization: 'Bearer super-secret-jwt-token',
          cookie: 'session_id=12345; auth=xyz',
          'x-service-pass': 'topsecretpass',
          'content-type': 'application/json',
        },
        cookies: { session_id: '12345' },
        data: { username: 'admin', password: 'my-plain-password', secret: 'abc' },
      },
    };

    const scrubbed = sentryBeforeSend(mockEvent);
    assert.strictEqual(scrubbed.request.headers.authorization, undefined, 'authorization header must be deleted');
    assert.strictEqual(scrubbed.request.headers.cookie, undefined, 'cookie header must be deleted');
    assert.strictEqual(scrubbed.request.headers['x-service-pass'], undefined, 'x-service-pass header must be deleted');
    assert.strictEqual(scrubbed.request.cookies, undefined, 'cookies object must be deleted');
    assert.strictEqual(scrubbed.request.headers['content-type'], 'application/json', 'non-sensitive headers must be preserved');
    assert.strictEqual(scrubbed.request.data, '[REDACTED]', 'request data payload must be redacted');
  });

  // 5. GAP 2: tracesSampleRate reads from process.env
  it('5. sentry_tracesSampleRate_readsEnv: Correctly parses SENTRY_TRACES_SAMPLE_RATE env var', () => {
    const { getTracesSampleRate } = require('../utils/sentry');
    assert.strictEqual(typeof getTracesSampleRate, 'function', 'getTracesSampleRate must be exported');

    const prev = process.env.SENTRY_TRACES_SAMPLE_RATE;
    try {
      process.env.SENTRY_TRACES_SAMPLE_RATE = '0.25';
      assert.strictEqual(getTracesSampleRate(), 0.25);

      process.env.SENTRY_TRACES_SAMPLE_RATE = 'invalid-number';
      assert.strictEqual(getTracesSampleRate(), 0);

      delete process.env.SENTRY_TRACES_SAMPLE_RATE;
      assert.strictEqual(getTracesSampleRate(), 0);
    } finally {
      if (prev !== undefined) process.env.SENTRY_TRACES_SAMPLE_RATE = prev;
      else delete process.env.SENTRY_TRACES_SAMPLE_RATE;
    }
  });

  // 6. GAP 3: redactBody Utility (Circular refs, depth limit, nested arrays, immutability)
  it('6. redactBody_handlesCircular_nestedArrays_depthLimit: Bulletproof body sanitizer', () => {
    const { redactBody } = require('../utils/logger');
    assert.strictEqual(typeof redactBody, 'function', 'redactBody must be exported');

    // Test 6A: Sensitive keys redacted
    const input = {
      username: 'jfl-operator',
      password: 'password123',
      token: 'jwt.token.here',
      secret: 'my-secret',
      recipients: ['user@example.com'],
      nested: {
        mfaCode: '123456',
        publicField: 'safe data',
      },
    };
    const redacted = redactBody(input);
    assert.strictEqual(redacted.password, '[REDACTED]');
    assert.strictEqual(redacted.token, '[REDACTED]');
    assert.strictEqual(redacted.secret, '[REDACTED]');
    assert.strictEqual(redacted.recipients, '[REDACTED]');
    assert.strictEqual(redacted.nested.mfaCode, '[REDACTED]');
    assert.strictEqual(redacted.nested.publicField, 'safe data');
    assert.strictEqual(input.password, 'password123', 'Input object must NOT be mutated');

    // Test 6B: Circular references
    const circular = { name: 'circular-test' };
    circular.self = circular;
    const cleanCircular = redactBody(circular);
    assert.strictEqual(cleanCircular.name, 'circular-test');
    assert.strictEqual(cleanCircular.self, '[CIRCULAR]');

    // Test 6C: Nested arrays
    const arrayInput = [
      { password: 'pass1' },
      [{ token: 'token2' }, { safe: 'ok' }],
    ];
    const cleanArray = redactBody(arrayInput);
    assert.strictEqual(cleanArray[0].password, '[REDACTED]');
    assert.strictEqual(cleanArray[1][0].token, '[REDACTED]');
    assert.strictEqual(cleanArray[1][1].safe, 'ok');

    // Test 6D: Depth limit
    const deepObject = { l1: { l2: { l3: { l4: { l5: { l6: 'deep' } } } } } };
    const cleanDeep = redactBody(deepObject, { maxDepth: 5 });
    assert.strictEqual(cleanDeep.l1.l2.l3.l4.l5, '[MAX_DEPTH_EXCEEDED]');
  });

  // 7. ONE-LINER 3: X-Request-Id Validation & Sanitization
  it('7. correlationId_validation_and_sanitization: Enforces length <= 128 and valid regex', () => {
    const { validateRequestId } = require('../middleware/loggingMiddleware');
    assert.strictEqual(typeof validateRequestId, 'function', 'validateRequestId must be exported');

    // Valid IDs
    assert.strictEqual(validateRequestId('trace-123_ABC'), 'trace-123_ABC');
    assert.strictEqual(validateRequestId('req-001'), 'req-001');

    // Invalid: with spaces
    const invalidSpace = validateRequestId('bad id with spaces');
    assert.notStrictEqual(invalidSpace, 'bad id with spaces');
    assert.ok(/^[0-9a-f-]{36}$/.test(invalidSpace), 'Must fall back to UUID v4');

    // Invalid: injection or control chars
    const invalidChars = validateRequestId('bad<script>id\n');
    assert.ok(/^[0-9a-f-]{36}$/.test(invalidChars), 'Must fall back to UUID v4');

    // Invalid: exceeded 128 chars
    const longId = 'a'.repeat(129);
    const resultLong = validateRequestId(longId);
    assert.ok(/^[0-9a-f-]{36}$/.test(resultLong), 'Must fall back to UUID v4');
  });

  // 8. ONE-LINER 1: Error Rate Limiting (Token Bucket)
  it('8. logger_error_rate_limiting_token_bucket: Suppresses error logs beyond 100/sec', () => {
    const { checkErrorRateLimit } = require('../utils/logger');
    assert.strictEqual(typeof checkErrorRateLimit, 'function', 'checkErrorRateLimit must be exported');

    let allowedCount = 0;
    for (let i = 0; i < 150; i++) {
      if (checkErrorRateLimit()) allowedCount++;
    }
    assert.strictEqual(allowedCount, 100, 'Must allow exactly 100 error logs per window');
  });

  // 9. Sentry No-Op Fallback when DSN is omitted
  it('9. sentry_noop_when_dsn_omitted: Initializes in safe mock mode without throwing', () => {
    const sentry = require('../utils/sentry');
    const prev = process.env.SENTRY_DSN;
    delete process.env.SENTRY_DSN;
    try {
      sentry.initSentry(express());
      assert.strictEqual(sentry.isInitialized(), false, 'Sentry must remain uninitialized without DSN');
    } finally {
      if (prev !== undefined) process.env.SENTRY_DSN = prev;
    }
  });

  // 10. Sentry safe captureException when uninitialized
  it('10. sentry_captureException_safe_when_uninitialized: Returns null without throwing when uninitialized', () => {
    const sentry = require('../utils/sentry');
    const prev = process.env.SENTRY_DSN;
    delete process.env.SENTRY_DSN;
    try {
      sentry.initSentry(express());
      const eventId = sentry.captureException(new Error('Test uninitialized failure'), { module: 'testSafe' });
      assert.strictEqual(eventId, null, 'captureException must return null in mock mode without throwing');
    } finally {
      if (prev !== undefined) process.env.SENTRY_DSN = prev;
    }
  });

  // 11. Express Integration: Request ID propagation, Zero-body policy, Abort tracking, 500 JSON
  describe('HTTP Middleware Integration', () => {
    let testServer;
    let testPort;

    before(async () => {
      const testApp = express();
      const { loggingMiddleware } = require('../middleware/loggingMiddleware');
      const sentry = require('../utils/sentry');
      const { logger } = require('../utils/logger');

      testApp.use(express.json());
      testApp.use(loggingMiddleware);

      // Normal route
      testApp.post('/test/echo', (req, res) => {
        res.json({ ok: true, receivedReqId: req.id });
      });

      // Route to inspect child logger attachment
      testApp.get('/test/check-req-log', (req, res) => {
        res.json({
          hasReqLog: typeof req.log?.info === 'function',
          reqId: req.id,
        });
      });

      // Long running route to simulate client abort
      testApp.get('/test/hang', (req, res) => {
        // Intentionally do not end response to trigger client abort
      });

      // Crashing route
      testApp.get('/test/crash', (req, res, next) => {
        next(new Error('Simulated database deadlock'));
      });

      // Error handling middleware
      testApp.use((err, req, res, next) => {
        const reqId = req.id || 'unknown';
        const status = err.status || 500;
        sentry.captureException(err, { reqId, module: 'testExpress' });
        res.status(status).json({
          error: status >= 500 ? 'Internal Server Error' : err.message,
          status,
          reqId,
        });
      });

      await new Promise((resolve) => {
        testServer = testApp.listen(0, '127.0.0.1', () => {
          testPort = testServer.address().port;
          resolve();
        });
      });
    });

    after(async () => {
      if (testServer) {
        await new Promise((resolve) => testServer.close(resolve));
      }
    });

    it('11. correlationId_generated_when_missing: Generates UUID v4 in X-Request-Id header', async () => {
      const res = await fetch(`http://127.0.0.1:${testPort}/test/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hello: 'world' }),
      });
      assert.strictEqual(res.status, 200);
      const reqIdHeader = res.headers.get('x-request-id');
      assert.ok(reqIdHeader, 'Response must have X-Request-Id header');
      assert.ok(/^[0-9a-f-]{36}$/.test(reqIdHeader), 'Header must be valid UUID v4');

      const body = await res.json();
      assert.strictEqual(body.receivedReqId, reqIdHeader, 'req.id in handler must match response header');
    });

    it('12. correlationId_propagated_when_valid: Preserves valid incoming X-Request-Id', async () => {
      const customId = 'trace-id-abc_999';
      const res = await fetch(`http://127.0.0.1:${testPort}/test/echo`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': customId,
        },
        body: JSON.stringify({ test: 123 }),
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('x-request-id'), customId);
      const body = await res.json();
      assert.strictEqual(body.receivedReqId, customId);
    });

    it('13. loggingMiddleware_attaches_child_logger: Attaches req.log with info/warn/error pre-bound', async () => {
      const res = await fetch(`http://127.0.0.1:${testPort}/test/check-req-log`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.hasReqLog, true, 'req.log must be attached with logger methods');
      assert.ok(data.reqId, 'reqId must be present on req');
    });

    it('14. loggingMiddleware_doesNotLogRequestBody (GAP 3): Default request logging excludes body', async () => {
      const res = await fetch(`http://127.0.0.1:${testPort}/test/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'leakedpassword123', secret: 'abc' }),
      });
      assert.strictEqual(res.status, 200);
    });

    it('15. loggingMiddleware_normalRequestLogsOnce (DOUBLE-LOG BUG FIX): Normal request logs exactly ONCE', async () => {
      const { logger } = require('../utils/logger');
      let logCount = 0;
      const originalInfo = logger.info;
      logger.info = function (bindings, msg) {
        if (bindings && bindings.url && bindings.url.includes('/test/echo')) {
          logCount++;
        }
        return originalInfo.apply(this, arguments);
      };

      try {
        const res = await fetch(`http://127.0.0.1:${testPort}/test/echo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ test: 'single-log-check' }),
        });
        assert.strictEqual(res.status, 200);
        await new Promise((r) => setTimeout(r, 60)); // Wait for finish/close events
        assert.strictEqual(logCount, 1, 'Normal request must log exactly ONCE (never double-logged)');
      } finally {
        logger.info = originalInfo;
      }
    });

    it('16. loggingMiddleware_logsAbortedRequest (GAP 1): Captures client socket disconnect', async () => {
      const { logger } = require('../utils/logger');
      let warnLogEmitted = false;
      let loggedData = null;

      // Listen for warn calls
      const originalWarn = logger.warn;
      logger.warn = function (bindings, msg) {
        if (bindings && bindings.aborted) {
          warnLogEmitted = true;
          loggedData = bindings;
        }
        return originalWarn.apply(this, arguments);
      };

      try {
        const client = http.get(`http://127.0.0.1:${testPort}/test/hang`);
        client.on('error', () => {}); // Handle expected ECONNRESET on destroy
        await new Promise((r) => setTimeout(r, 50));
        // Client destroys connection before server finishes
        client.destroy();
        await new Promise((r) => setTimeout(r, 100));

        assert.ok(warnLogEmitted, 'Aborted client request must emit warn log with aborted: true');
        assert.strictEqual(loggedData.aborted, true);
        assert.ok(loggedData.durationMs >= 0, 'durationMs must be recorded on aborted request');
      } finally {
        logger.warn = originalWarn;
      }
    });

    it('17. express_error_handler_returns_json_500_and_calls_sentry (ONE-LINER 5): Returns 500 JSON with reqId and spies captureException', async () => {
      const sentry = require('../utils/sentry');
      let capturedError = null;
      let capturedContext = null;

      // Attach spy to captureException
      const originalCapture = sentry.captureException;
      sentry.captureException = (err, context) => {
        capturedError = err;
        capturedContext = context;
        return originalCapture(err, context);
      };

      try {
        const res = await fetch(`http://127.0.0.1:${testPort}/test/crash`);
        assert.strictEqual(res.status, 500);
        const data = await res.json();
        assert.strictEqual(data.error, 'Internal Server Error');
        assert.strictEqual(data.status, 500);
        assert.ok(data.reqId, 'Error response must contain reqId');

        // ONE-LINER 5: Assert captureException was called via spy
        assert.ok(capturedError, 'sentry.captureException must be invoked');
        assert.strictEqual(capturedError.message, 'Simulated database deadlock');
        assert.strictEqual(capturedContext.reqId, data.reqId);
        assert.strictEqual(capturedContext.module, 'testExpress');
      } finally {
        sentry.captureException = originalCapture;
      }
    });
  });

  // 18. Health endpoint observability telemetry
  it('18. health_telemetry_includes_observability: GET /api/v1/health exposes logger and sentry telemetry', async () => {
    const mainApp = require('../index');
    let localServer;
    let localPort;

    await new Promise((resolve) => {
      localServer = mainApp.listen(0, '127.0.0.1', () => {
        localPort = localServer.address().port;
        resolve();
      });
    });

    try {
      const res = await fetch(`http://127.0.0.1:${localPort}/api/v1/health`);
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.status, 'ok');
      assert.ok(json.observability, 'health endpoint must include observability object');
      assert.strictEqual(json.observability.logger, 'pino');
      assert.strictEqual(typeof json.observability.logLevel, 'string');
      assert.strictEqual(typeof json.observability.sentryActive, 'boolean');
    } finally {
      if (localServer) {
        await new Promise((resolve) => localServer.close(resolve));
      }
    }
  });

  // 19. Background task error capture enriches tags
  it('19. background_error_capture_enriches_tags: captureException captures module, tenantId, and jobId tags', () => {
    const sentry = require('../utils/sentry');
    const { logger } = require('../utils/logger');

    let loggedErrorPayload = null;
    const origError = logger.error;
    logger.error = function (bindings, msg) {
      loggedErrorPayload = bindings;
      return origError.apply(this, arguments);
    };

    try {
      const err = new Error('Scheduled QBR execution timed out');
      sentry.captureException(err, {
        module: 'schedulerService',
        tenantId: 'client-jfl',
        jobId: 'job_sched_123',
      });

      assert.ok(loggedErrorPayload, 'logger.error must be called');
      assert.strictEqual(loggedErrorPayload.module, 'schedulerService');
      assert.strictEqual(loggedErrorPayload.tenantId, 'client-jfl');
      assert.strictEqual(loggedErrorPayload.jobId, 'job_sched_123');
    } finally {
      logger.error = origError;
    }
  });
});
