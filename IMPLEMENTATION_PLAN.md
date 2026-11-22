# Implementation Plan — Item #15: Observability (Structured Logging with Pino & Error Tracking with Sentry)

**Status**: Waiting for user **APPROVED** before writing code.  
**Roadmap Item**: **#15 Observability (Pino Structured Logging & Sentry Error Tracking)** (Wave 3 — Trust)  
**Sequence Context**: Follows **#4 (Real Auth)**, **#3 (Database Layer)**, and **#14 (API-First v1 Versioning)**. Lays enterprise-grade telemetry, auditability, and incident tracking across all canonical `/api/v1/` endpoints and background workers before **#16 (Testing & Quality)**.

---

## 1. Acknowledged Carry-Forward Items & Review of #14 Touches

### 1.1 Item #14 Git Diff Review on Files from #3, #11, and #13
A line-by-line diff audit of commit `952b3e5` (Item #14) was conducted across the 7 files originating in #3 (Database), #11 (Templates), and #13 (Scheduling):

| File | Change Category | Logic vs Assertion Analysis |
| :--- | :--- | :--- |
| `backend/config/database.js` | **Logic Update** | Hardened `getDatabaseUrl()`: when `NODE_ENV === 'test'`, it now rejects remote `libsql://` or `http://` URLs unless `url.startsWith('file:')` or `TEST_USE_TURSO` is set. This prevents sandboxed test runs from hanging on external network calls and guarantees tests use local `data/test.db`. |
| `backend/db/schema.sql` | **Schema Addition** | Added missing `job_id TEXT` column to `reports_tickets` table definition. Phase 1 MMTC report upload (`reportUpload.js`) associates tickets with a `job_id`, which was expected by T23 in `report.test.js` but had been omitted in the initial SQLite schema. |
| `backend/services/schedulerService.js` | **Logic Update** | Fixed `getSchedulesRaw()`: previously, reading schedules from SQLite hardcoded dummy constants (`templateVersion: 'latest'`, `lastError: null`). It now merges SQLite records with `schedules.json` metadata, ensuring `templateVersion`, `timezone`, `nextRunAt`, and `lastError` are accurately preserved. |
| `backend/services/templateService.js` | **Logic Update** | Aligned template storage path to `data/tenants/{canonicalId}/templates/versions/{storedName}` and synchronized template deletion and activation with SQLite (`templateRepo.deleteVersion` and `templateRepo.setActiveVersion`). |
| `backend/tests/report.test.js` | **Lifecycle Setup** | Added `await migrate();` in `before()` hook to guarantee database tables exist before test execution. No logic or assertion changes. |
| `backend/tests/scheduledQbr.test.js` | **Lifecycle Setup** | Added `DELETE FROM schedule_runs WHERE tenant_id = ?` and `DELETE FROM schedules WHERE tenant_id = ?` in `before()`, `beforeEach()`, and `after()` hooks to eliminate cross-suite state leakage. No test assertion changes. |
| `backend/tests/templateVersioning.test.js` | **Lifecycle Setup** | Added `await migrate();` and `DELETE FROM templates WHERE tenant_id = ?` across hooks to guarantee table readiness and prevent template collision. No test assertion changes. |

### 1.2 Carry-Forward Item 1: #16 Priority — Test Isolation
- **Current State**: The suite passes 392/392 tests across 49 suites serially using `node --test --test-concurrency=1`.
- **Root Cause**: Tests share a single SQLite database file (`data/test.db`), tenant directories (`data/tenants/`), and in-process singletons (`jobCache.js`, `_authRateMap`). Default parallelism causes SQLite lock contention (`SQLITE_BUSY`) and state collision.
- **Commitment for #16**: The #16 plan will explicitly design per-worker test isolation (e.g. worker-scoped test databases `data/test-${process.pid}.db` and isolated tenant directories), or formally document and standardize serial CI execution (`--test-concurrency=1`) as the supported CI execution contract.

### 1.3 Carry-Forward Item 2: `v1Router.js` (2,206 lines) Decomposition Backlog
- **Current State**: `backend/routes/v1Router.js` consolidates all platform routes into a single canonical router.
- **Backlog Tracking**: Decomposing `v1Router.js` into domain sub-routers (`v1/authRoutes.js`, `v1/dashboardRoutes.js`, `v1/reportRoutes.js`, `v1/scheduleRoutes.js`, `v1/tenantRoutes.js`, etc.) is logged as a tracked backlog refactor target for #16 or post-#16. It is non-blocking for Item #15.

---

## 2. Problem Statement & Objectives for Item #15

### 2.1 Problem Statement
The backend currently relies on 320+ ad-hoc `console.log`, `console.warn`, and `console.error` calls. This poses four critical enterprise operational vulnerabilities:
1. **Zero Correlation & Traceability**: Incoming requests have no unique correlation ID (`X-Request-Id`). Debugging distributed workflows, slow queries, or failed report generations across async queues (BullMQ) requires manual timestamp cross-referencing.
2. **Sensitive Data Exposure Risk**: Raw `console.log` statements risk emitting sensitive headers (Authorization Bearer tokens, `X-Service-Pass`), passwords, API secrets, MFA codes, or recipient email arrays into server logs and aggregators.
3. **No Centralized Exception Tracking**: Unhandled rejections, background queue failures, and scheduled QBR errors fail silently or log unformatted stack traces to stdout without triggering alerts or grouping in an error tracking system.
4. **Unformatted Telemetry**: Log aggregators (Datadog, CloudWatch, Render, ELK) cannot index or alert on unstructured stdout strings. Logs require structured JSON formatting with ISO timestamps, severity levels, PID, and host tags.

### 2.2 Core Deliverables
1. **Pino Structured Logger with Standard Serializers & `redactBody` Utility (`backend/utils/logger.js`)**:
   - High-throughput JSON logging with ISO timestamps, log levels (`fatal`, `error`, `warn`, `info`, `debug`, `trace`), and service metadata.
   - **Pino Standard Serializers (GAP 1)**: Configures `serializers: { err: pino.stdSerializers.err, req: pino.stdSerializers.req, res: pino.stdSerializers.res }`. Guarantees `logger.error({ err })` extracts `type`, `message`, and complete `stack` trace instead of empty `{ err: {} }`.
   - **Automated Field Redaction**: Automatically scrubs `req.headers.authorization`, `req.headers["x-service-pass"]`, `*.password`, `*.token`, `*.mfaCode`, `*.secret`, `*.recipients`, `*.secretKey`, `*.accessToken`, `*.refreshToken`.
   - **Bulletproof `redactBody(body, options)` Helper (GAP 3)**:
     - Pure functional cloning (never mutates input).
     - **Circular Reference Protection**: Tracks visited objects using `WeakSet()`; replaces cycles with `'[CIRCULAR]'` to prevent `JSON.stringify` or logger crashes.
     - **Depth Guard**: Strictly limits traversal depth to 5 (configurable); nests deeper than limit return `'[MAX_DEPTH_EXCEEDED]'`.
     - **Full Array & Nested Object Traversal**: Recursively maps through arrays and object hierarchies, matching keys against redacted sensitive patterns.
   - **Error Log Rate Limiting (Token Bucket) (ONE-LINER 1)**: In-memory token bucket capping error-level logs at **100 errors/sec**. Beyond 100/sec, errors are suppressed and counted, emitting a single summary warning when the window resets. Prevents log storms and disk/I/O saturation during cascading failures.
   - **Dev Transport Note (ONE-LINER 2)**: Formatted for human readability via `pino-pretty` in non-production (`NODE_ENV === 'development'`) when available, and pure JSON in `production`. Silent by default in `test` mode (`silent`).
   - **Child Logger Factory**: `getChildLogger(moduleName, context)` to support scoped module logging (e.g. `scheduler`, `auth`, `queue`).
2. **Request Correlation Middleware & Zero-Body Privacy Policy (`backend/middleware/loggingMiddleware.js`)**:
   - **Strict `X-Request-Id` Validation (ONE-LINER 3)**: Incoming header must be $\le 128$ characters and match `/^[a-zA-Z0-9\-_]+$/`. Invalid or missing IDs generate a fresh UUID v4.
   - Sets response header `X-Request-Id` and attaches `req.log = logger.child({ reqId, client_id, user_id })`.
   - **Zero Body Logging Policy (GAP 3)**: Request bodies are **NEVER** logged by default. Only `method`, `url`, `statusCode`, `durationMs`, `contentLength`, `reqId`, `ip`, `userAgent`, and authenticated `userId`/`tenantId` are recorded.
   - **Client Abort & Disconnect Tracking (GAP 1)**: Catches both normal HTTP completions (`res.on('finish')`) and client aborts/socket drops (`res.on('close')` with `!res.writableEnded`). Logs `{ aborted: true, durationMs, reqId, ... }` at `warn` level so client drops are never lost.
   - Suppresses polling noise for health endpoints (logged at `debug` level).
3. **Sentry Error Tracking with `beforeSend` Scrubber & Wires (`backend/utils/sentry.js`)**:
   - Initializes `@sentry/node` if `SENTRY_DSN` is configured.
   - **`tracesSampleRate` Wired from Env (GAP 2)**: Explicitly wires `parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0')` into `Sentry.init({ tracesSampleRate })`. Defaults safely to `0` if omitted.
   - **`beforeSend` Security Scrubber (GAP 2)**: Strips `event.request.headers.authorization`, `event.request.headers.cookie`, and `event.request.headers['x-service-pass']`. Redacts `event.request.data` to `'[REDACTED]'`. Deletes raw `event.request.cookies`.
   - **Data Residency Compliance Note (GAP 2)**: Enterprise tenants subject to EU GDPR or India DPDP mandates MUST configure an EU/regional `SENTRY_DSN` (e.g. `https://xxx@o000.eu.ingest.sentry.io/xxx`) for geographic data isolation.
   - **Graceful No-Op Fallback**: If `SENTRY_DSN` is omitted or in `NODE_ENV === 'test'`, operates in safe mock/no-op mode without throwing or failing startup.
   - Safe `captureException(err, context)` helper for async background tasks (BullMQ workers, cron jobs) with tenant, job, and module tagging.
   - Process-level unhandled rejection and uncaught exception safety nets.
4. **Centralized JSON 500 Error Handler**:
   - Express error-handling middleware (`(err, req, res, next)`) attached before fallback handlers.
   - Invokes `sentry.captureException(err)` (verified via spy in tests), logs via `req.log.error` with `req.id`, and returns consistent JSON `{ error: 'Internal Server Error', status: 500, reqId }`.
5. **Scoped `console.*` Migration (ONE-LINER 4)**:
   - Migrated in this item: `backend/index.js` (boot, shutdown, uncaught exceptions), `backend/services/authService.js` (auth failures, brute force rate-limits), `backend/services/schedulerService.js` (execution failures, recipient alerts), and `backend/services/queueService.js` (worker failures).
   - Backlog: Remaining calculation modules (`processData.js`, `pptGenerator.js`, `aiChatService.js`) remain unchanged and migrate progressively in subsequent quality waves.
6. **Observability Health Telemetry**:
   - Updates `/api/v1/health` and legacy `/api/health` to expose observability status (`logger: 'pino'`, `logLevel`, `sentryActive: boolean`, `sentryEnvironment`).

---

## 3. Architecture & Telemetry Data Flow

```
                               Incoming HTTP Request
                                         │
                                         ▼
                            [X-Request-Id Validator]
             (Must be <= 128 chars & ^[a-zA-Z0-9\-_]+$, else UUID v4)
                                         │
                                         ▼
                                 [Sentry Request]
                            (Trace context & user tags)
                                         │
                                         ▼
                            [Pino Logging Middleware]
                       - Attach req.id & req.log
                       - Set Response Header: X-Request-Id
                       - Zero Body Policy: Never logs req.body
                       - Timer: process.hrtime.bigint()
                                         │
                                         ▼
                     ┌───────────────────┴───────────────────┐
                     ▼                                       ▼
             /api/v1/* (Canonical)                   /api/* (Legacy Alias)
                     │                                       │
                     └───────────────────┬───────────────────┘
                                         ▼
                               [Route / Job Handler]
                          (Uses req.log.info / warn)
                                         │
                    ┌────────────────────┼────────────────────┐
                    │ (Finished)         │ (Client Disconnect)│ (Error / Exception)
                    ▼                    ▼                    ▼
             res.on('finish')     res.on('close')     Express Error Middleware
            req.log.info({       !res.writableEnded     - sentry.captureException(err)
              method, url,        req.log.warn({          [beforeSend scrubs auth/cookies]
              status, durationMs,   aborted: true,      - req.log.error({ err, reqId })
              ip, reqId             method, url,          [pino.stdSerializers.err logs stack]
            })                      durationMs          - res.status(500).json({
                                  })                        error: 'Internal Server Error',
                                                            reqId
                                                          })
```

---

## 4. Files to Create and Modify

### 4.1 Files to Create:
1. `backend/utils/logger.js`: Root Pino logger instance, standard error/req/res serializers, `redactBody` helper with circular/depth/array handling, redactor configuration, error rate limiter token bucket, child logger factory, and test stream handling.
2. `backend/middleware/loggingMiddleware.js`: Request correlation ID validation (regex + 128-char cap), header propagation, request child logger injection, zero-body logging policy, normal completion & client abort (`close`) duration tracking.
3. `backend/utils/sentry.js`: Sentry initialization wrapper, `tracesSampleRate` env binding, `beforeSend` security scrubber (strips auth/cookies/payload), Express middleware adapters, safe `captureException` helper with tenant/job tagging, and no-op fallback client.
4. `backend/tests/observability.test.js`: Comprehensive TDD suite verifying serializers, redaction, `redactBody`, correlation IDs, aborted client logging, zero-body logging, Sentry `beforeSend` scrubbing, `tracesSampleRate` env binding, Express error handling with spy assertion, and health telemetry.

### 4.2 Files to Modify:
1. `package.json` & `backend/package.json`: Add dependencies `pino`, `pino-http`, `@sentry/node`.
2. `backend/index.js`:
   - Initialize Sentry (`sentry.initSentry(app)`).
   - Mount `sentry.sentryRequestHandler` and `loggingMiddleware` before routes.
   - Mount `sentry.sentryErrorHandler` and JSON 500 error-handling middleware after route mounts.
   - Add process-level crash safety nets (`unhandledRejection`, `uncaughtException`).
   - Migrate startup and shutdown logs from `console.*` to `logger.*`.
3. `backend/routes/v1Router.js`:
   - Update `GET /health` and `GET /health/scheduler` to expose observability telemetry (`logger`, `logLevel`, `sentryActive`).
4. `backend/services/authService.js`:
   - Replace critical auth failure and brute force `console.warn`/`console.error` with `logger.warn`/`logger.error`.
5. `backend/services/queueService.js`:
   - Replace raw `console.error` with `sentry.captureException(err, { module: 'queueService', jobId })` and `logger.error`.
6. `backend/services/schedulerService.js`:
   - Replace critical failure `console.error` with `sentry.captureException(err, { module: 'schedulerService', tenantId, scheduleId })` and `logger.error`.
7. `.env.example`: Add `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE`, `LOG_LEVEL`.

---

## 5. Detailed Specifications

### 5.1 Pino Logger & `redactBody` Specification (`backend/utils/logger.js`)
```javascript
const pino = require('pino');

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["x-service-pass"]',
  '*.password',
  '*.token',
  '*.mfaCode',
  '*.secret',
  '*.secretKey',
  '*.recipients',
  '*.accessToken',
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
 * GAP 3: Bulletproof, Pure Functional Body Redactor
 * Handles circular references, nested arrays/objects, depth limit (default 5).
 */
function redactBody(body, options = {}) {
  const maxDepth = options.maxDepth || 5;
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

const isTest = process.env.NODE_ENV === 'test';
const defaultLevel = isTest
  ? (process.env.LOG_LEVEL || (process.env.ENABLE_TEST_LOGS ? 'info' : 'silent'))
  : (process.env.LOG_LEVEL || 'info');

// Error log rate limiting: token bucket capped at 100/sec (ONE-LINER 1)
const ERROR_LOG_LIMIT = 100;
let errorTokens = ERROR_LOG_LIMIT;
let lastRefill = Date.now();
let suppressedErrorCount = 0;

function checkErrorRateLimit() {
  const now = Date.now();
  if (now - lastRefill >= 1000) {
    if (suppressedErrorCount > 0) {
      logger.warn(`[logger] Rate limit reset: ${suppressedErrorCount} error logs suppressed in the last window.`);
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

const logger = pino({
  level: defaultLevel,
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    pid: process.pid,
    service: 'executive-qbr-backend',
  },
  serializers: {
    err: pino.stdSerializers.err,     // GAP 1: Extracts type, message, stack
    error: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
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
  redactBody,
  REDACT_PATHS,
  checkErrorRateLimit,
};
```

### 5.2 Logging & Correlation Middleware (`backend/middleware/loggingMiddleware.js`)
```javascript
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../utils/logger');

const REQUEST_ID_REGEX = /^[a-zA-Z0-9\-_]+$/;

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
  // 1. Correlation ID: validated or newly generated (ONE-LINER 3)
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
```

### 5.3 Sentry Integration & Fallback (`backend/utils/sentry.js`)
```javascript
const Sentry = require('@sentry/node');
const { logger } = require('./logger');

let isSentryInitialized = false;

// GAP 2: Security Scrubber for Sentry Events
function sentryBeforeSend(event, hint) {
  if (event.request) {
    if (event.request.headers) {
      delete event.request.headers.authorization;
      delete event.request.headers.cookie;
      delete event.request.headers['x-service-pass'];
    }
    if (event.request.cookies) {
      delete event.request.cookies;
    }
    if (event.request.data) {
      event.request.data = '[REDACTED]';
    }
  }
  return event;
}

function initSentry(app) {
  const dsn = process.env.SENTRY_DSN;
  const isTest = process.env.NODE_ENV === 'test' && !process.env.ENABLE_TEST_SENTRY;

  if (!dsn || isTest) {
    logger.debug('[sentry] SENTRY_DSN not configured or running in test mode. Operating in mock mode.');
    isSentryInitialized = false;
    return;
  }

  // GAP 2: tracesSampleRate wired directly from env var (default 0)
  const tracesSampleRate = parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0');

  try {
    Sentry.init({
      dsn,
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production',
      release: process.env.npm_package_version || '1.0.0',
      tracesSampleRate,
      beforeSend: sentryBeforeSend,
    });
    isSentryInitialized = true;
    logger.info({ tracesSampleRate }, '[sentry] Sentry error tracking successfully initialized.');
  } catch (err) {
    logger.error({ err }, '[sentry] Failed to initialize Sentry SDK. Operating in fallback mode.');
    isSentryInitialized = false;
  }
}

function captureException(err, context = {}) {
  logger.error({ err, ...context }, context.message || err.message);

  if (!isSentryInitialized) {
    return null;
  }

  return Sentry.captureException(err, {
    tags: {
      tenantId: context.tenantId || 'unknown',
      module: context.module || 'unknown',
      jobId: context.jobId || 'none',
      ...context.tags,
    },
    extra: context.extra || context,
  });
}

function sentryRequestHandler() {
  if (!isSentryInitialized) return (req, res, next) => next();
  return Sentry.Handlers?.requestHandler ? Sentry.Handlers.requestHandler() : (req, res, next) => next();
}

function sentryErrorHandler() {
  if (!isSentryInitialized) return (err, req, res, next) => next(err);
  return Sentry.Handlers?.errorHandler ? Sentry.Handlers.errorHandler() : (err, req, res, next) => next(err);
}

module.exports = {
  initSentry,
  captureException,
  sentryRequestHandler,
  sentryErrorHandler,
  sentryBeforeSend,
  isInitialized: () => isSentryInitialized,
};
```

---

## 6. Test Strategy (TDD)

New comprehensive test suite `backend/tests/observability.test.js` covering:

1. **`logger_serializes_error_with_stack` (GAP 1)**: Asserts logging `{ err: new Error('boom') }` produces serialized object containing `type: 'Error'`, `message: 'boom'`, and full `stack` string (not `{ err: {} }`).
2. **`sentry_beforeSend_scrubsAuthHeader` (GAP 2)**: Asserts `sentryBeforeSend(event)` strips `authorization`, `cookie`, `x-service-pass`, and redacts `request.data` to `'[REDACTED]'`.
3. **`sentry_tracesSampleRate_readsEnv` (GAP 2)**: Asserts `initSentry` reads `process.env.SENTRY_TRACES_SAMPLE_RATE`, parses float, and defaults to `0` when unset.
4. **`loggingMiddleware_doesNotLogRequestBody` (GAP 3)**: Asserts a `POST` request with JSON body `{ password: 'supersecret', token: 'xyz' }` records metadata but strictly does NOT attach or log request body payload.
5. **`redactBody_handlesCircular_nestedArrays_depthLimit` (GAP 3)**: Asserts `redactBody` replaces circular refs with `'[CIRCULAR]'`, handles multi-dimensional arrays, cuts off recursion at depth limit 5 with `'[MAX_DEPTH_EXCEEDED]'`, and does not mutate the input object.
6. **`loggingMiddleware_logsAbortedRequest` (GAP 1)**: Asserts triggering `res.emit('close')` before `res.writableEnded` logs a warning with `{ aborted: true }` and elapsed `durationMs`.
7. **`logger_redacts_sensitive_authorization_and_tokens`**: Asserts redaction paths scrub authorization headers, passwords, secrets, and recipients to `[REDACTED]`.
8. **`correlationId_validation_and_sanitization` (ONE-LINER 3)**:
   - Valid: `custom-trace_123` is preserved and returned in `X-Request-Id`.
   - Invalid: `bad header with spaces!` or string $> 128$ chars is rejected and replaced with a valid UUID v4.
9. **`correlationId_generated_when_missing`**: Asserts incoming request without `X-Request-Id` gets UUID v4 in response header and attached to `req.id`.
10. **`logger_error_rate_limiting_token_bucket` (ONE-LINER 1)**: Asserts error logging is throttled when exceeding 100 calls in a 1-second window and warns on reset.
11. **`sentry_noop_when_dsn_omitted`**: Asserts `initSentry` without `SENTRY_DSN` does not throw and leaves `isInitialized()` as `false`.
12. **`express_error_handler_returns_json_500_and_calls_sentry` (ONE-LINER 5)**: Asserts an error thrown in an Express route triggers the global error handler, sets status 500, returns `{ error: 'Internal Server Error', status: 500, reqId }`, and invokes `captureException` spy with the error.
13. **`health_telemetry_includes_observability`**: Asserts `GET /api/v1/health` returns `{ status: 'ok', version: 'v1', observability: { logger: 'pino', sentryActive: false } }`.
14. **`background_error_capture_enriches_tags`**: Asserts `captureException` passes tenant, module, and jobId tags to Sentry context.

---

## 7. HUMAN ACTION REQUIRED — Observability (Sentry & Pino)

### 1. Dashboard Steps (Click-by-Click)
1. Log into your [Sentry Dashboard](https://sentry.io/).
2. Click **Create Project** $\to$ select **Node.js / Express**.
3. Name the project `executive-qbr-backend`.
4. Copy the generated **DSN URL** (`https://<key>@<org>.ingest.sentry.io/<project-id>`).
5. In your production hosting platform (e.g. Render Dashboard), add the environment variables below.

### 2. Environment Variables to Set
| Variable Name | Example Value (DO NOT use real secrets in code) | Purpose |
| :--- | :--- | :--- |
| `SENTRY_DSN` | `https://examplePublicKey@o000000.ingest.sentry.io/0000000` | Sentry ingestion endpoint (Use EU region if required) |
| `SENTRY_ENVIRONMENT` | `production` | Deployment environment tag |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.1` | Performance APM transaction sample rate (10%, float parsed) |
| `LOG_LEVEL` | `info` | Pino log verbosity (`info`, `debug`, `warn`, `error`) |

> [!IMPORTANT]
> **Data Residency Requirement (GAP 2)**:
> Enterprise customers subject to EU GDPR or India DPDP data localization requirements **MUST** use an EU-region Sentry organization and DSN (e.g. `https://xxx@o000.eu.ingest.sentry.io/xxx`) to ensure error telemetry never leaves the required legal jurisdiction.

### 3. Verification Command
```bash
curl -X GET https://your-deployed-domain.com/api/v1/health
```
Assert the response includes `"observability": { "logger": "pino", "sentryActive": true }`.

### 4. What Breaks if the Human Skips This
- If `SENTRY_DSN` is omitted:
  - The application **will NOT crash** and remains 100% operational.
  - Pino structured JSON logging continues writing to `stdout`.
  - Sentry exception tracking and alerting remain inactive (errors log to stdout only; no email/Slack alerts fire).

---

## 8. Risk Assessment & Rollback

- **Risk Level**: **LOW**.
  - All logging and Sentry utilities are designed with defensive try-catch wrappers and no-op fallbacks.
  - If Sentry or Pino configuration is missing or malformed, the system degrades silently without breaking existing business APIs or report generation.
- **Rollback Path**:
  - Revert commit: `git revert HEAD`. Server resumes previous standard `console.log` logging.
