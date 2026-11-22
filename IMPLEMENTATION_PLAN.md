# Implementation Plan — Item #15: Observability (Structured Logging with Pino & Error Tracking with Sentry)

**Status**: Waiting for user **APPROVED** before writing code.  
**Roadmap Item**: **#15 Observability (Pino Structured Logging & Sentry Error Tracking)** (Wave 3 — Trust)  
**Sequence Context**: Follows **#4 (Real Auth)**, **#3 (Database Layer)**, and **#14 (API-First v1 Versioning)**. Lays enterprise-grade telemetry, auditability, and incident tracking across all canonical `/api/v1/` endpoints and background workers before **#16 (Testing & Quality)**.

---

## 1. Acknowledged Carry-Forward Items & Review of #14 Touches

### 1.1 Item #14 Git Diff Review on Files from #3, #11, and #13
A rigorous diff audit was performed on all files touched during Item #14 that originated in #3 (Database), #11 (Templates), and #13 (Scheduling). The findings are:

| File | Change Category | Logic vs Assertion Analysis |
| :--- | :--- | :--- |
| `backend/config/database.js` | **Logic Update** | `getDatabaseUrl()` was hardened for test safety: in `process.env.NODE_ENV === 'test'`, it now rejects remote `libsql://` or `http://` URLs unless `url.startsWith('file:')` or `process.env.TEST_USE_TURSO` is set. This prevents sandboxed test runs from timing out on remote network calls and ensures tests reliably use local `data/test.db`. |
| `backend/db/schema.sql` | **Schema Addition** | Added missing `job_id TEXT` column to `reports_tickets` table definition. Phase 1 MMTC report upload (`reportUpload.js`) associates tickets with a `job_id`, which was expected by T23 in `report.test.js` but had been omitted in the initial SQLite schema. |
| `backend/services/schedulerService.js` | **Logic Update** | Fixed `getSchedulesRaw()`: previously, reading schedules from SQLite hardcoded `templateVersion: 'latest'` and `lastError: null`. It now merges SQLite schedule records with disk metadata from `schedules.json`, ensuring `templateVersion`, `timezone`, `nextRunAt`, and `lastError` are accurately preserved. |
| `backend/services/templateService.js` | **Logic Update** | Aligned template storage path to `data/tenants/{canonicalId}/templates/versions/{storedName}` and synchronized template deletion and activation with SQLite (`templateRepo.deleteVersion` and `templateRepo.setActiveVersion`). |
| `backend/tests/report.test.js` | **Lifecycle Setup** | Added `await migrate();` in `before()` hook to guarantee database tables exist before test execution. No logic changes. |
| `backend/tests/scheduledQbr.test.js` | **Lifecycle Setup** | Added `DELETE FROM schedule_runs WHERE tenant_id = ?` and `DELETE FROM schedules WHERE tenant_id = ?` in `before()`, `beforeEach()`, and `after()` hooks to eliminate cross-suite state leakage. No test assertion changes. |
| `backend/tests/templateVersioning.test.js` | **Lifecycle Setup** | Added `await migrate();` and `DELETE FROM templates WHERE tenant_id = ?` across hooks to guarantee table readiness and prevent template collision. No test assertion changes. |

### 1.2 Carry-Forward Item 1: #16 Priority — Test Isolation
- **Current Reality**: The test suite currently passes 392/392 tests across 49 suites serially using `node --test --test-concurrency=1`.
- **Root Cause**: Tests share a single SQLite database file (`data/test.db`), tenant directories (`data/tenants/`), and in-process singletons (`jobCache.js`, `_authRateMap`). Default parallelism causes SQLite lock contention (`SQLITE_BUSY`) and data collisions.
- **Commitment for #16**: The #16 plan will explicitly design per-worker test isolation (e.g. worker-scoped test databases `data/test-${process.pid}.db` and unique test tenant IDs), or formally document and standardize serial CI execution (`--test-concurrency=1`) as the supported CI execution contract.

### 1.3 Carry-Forward Item 2: `v1Router.js` Modular Decomposition Backlog
- **Current Reality**: `backend/routes/v1Router.js` is 2,206 lines, housing consolidated route handlers for auth, dashboard, reports, schedules, templates, rules, and telemetry.
- **Backlog Tracking**: Decomposing `v1Router.js` into modular domain sub-routers (`backend/routes/v1/authRoutes.js`, `backend/routes/v1/dashboardRoutes.js`, `backend/routes/v1/reportRoutes.js`, `backend/routes/v1/scheduleRoutes.js`, etc.) is tracked as a dedicated backlog item (targeted for #16 or post-#16). It is non-blocking for Item #15.

---

## 2. Problem Statement & Objectives for Item #15

### 2.1 Problem Statement
The backend currently relies on 320+ ad-hoc `console.log`, `console.warn`, and `console.error` calls. This poses four critical enterprise operational vulnerabilities:
1. **Zero Correlation & Traceability**: Incoming requests have no unique correlation ID (`X-Request-Id`). Debugging distributed workflows, slow queries, or failed report generations across async queues (BullMQ) requires manual timestamp cross-referencing.
2. **Sensitive Data Exposure Risk**: Raw `console.log` statements risk emitting sensitive headers (Authorization Bearer tokens, `X-Service-Pass`), passwords, API secrets, MFA codes, or recipient email arrays into server logs and aggregators.
3. **No Centralized Exception Tracking**: Unhandled rejections, background queue failures, and scheduled QBR errors fail silently or log unformatted stack traces to stdout without triggering alerts or grouping in an error tracking system.
4. **Unformatted Telemetry**: Log aggregators (Datadog, CloudWatch, Render, ELK) cannot index or alert on unstructured stdout strings. Logs require structured JSON formatting with ISO timestamps, severity levels, PID, and host tags.

### 2.2 Core Deliverables
1. **Pino Structured Logger (`backend/utils/logger.js`)**:
   - High-throughput JSON logging with ISO timestamps, log levels (`fatal`, `error`, `warn`, `info`, `debug`, `trace`), and service metadata.
   - **Automated Field Redaction**: Automatically scrubs `req.headers.authorization`, `req.headers["x-service-pass"]`, `*.password`, `*.token`, `*.mfaCode`, `*.secret`, `*.recipients`, `*.secretKey`, `*.accessToken`, `*.refreshToken`.
   - **Child Logger Factory**: `getChildLogger(moduleName, context)` to support scoped module logging (e.g. `scheduler`, `auth`, `queue`).
   - **Silent Test Mode**: Suppresses log noise during `NODE_ENV === 'test'` unless `LOG_LEVEL` or `ENABLE_TEST_LOGS` is set.
2. **Request Correlation Middleware (`backend/middleware/loggingMiddleware.js`)**:
   - Generates a UUID v4 `X-Request-Id` if not provided, or propagates incoming client/proxy `X-Request-Id`.
   - Attaches `res.setHeader('X-Request-Id', reqId)` and `req.log = logger.child({ reqId, client_id, user_id })`.
   - Logs request start and request completion with method, route, HTTP status code, duration in ms, remote IP, and user-agent.
   - Suppresses high-frequency health probe noise (`/api/v1/health` logged at `debug` level).
3. **Sentry Error Tracking & Graceful Fallback (`backend/utils/sentry.js`)**:
   - Initializes `@sentry/node` if `SENTRY_DSN` is configured.
   - **Graceful No-Op Fallback**: If `SENTRY_DSN` is omitted or in `NODE_ENV === 'test'`, operates in safe mock/no-op mode without throwing or failing startup.
   - Express request and error handler middleware integration.
   - Safe `captureException(err, context)` helper for async background tasks (BullMQ workers, cron jobs) with tenant, job, and module tagging.
   - Process-level unhandled rejection and uncaught exception safety nets.
4. **Centralized JSON 500 Error Handler**:
   - Express error-handling middleware (`(err, req, res, next)`) attached before fallback handlers.
   - Captures error in Sentry, logs via Pino with `req.id`, and returns consistent JSON `{ error: 'Internal Server Error', status: 500, reqId }`. Stack traces are omitted in production.
5. **Observability Health Telemetry**:
   - Updates `/api/v1/health` and legacy `/api/health` to expose observability status (`logger: 'pino'`, `logLevel`, `sentryActive: boolean`, `sentryEnvironment`).

---

## 3. Architecture & Telemetry Data Flow

```
                               Incoming HTTP Request
                                         │
                                         ▼
                             [X-Request-Id Extractor]
                      (Preserve incoming or generate UUID v4)
                                         │
                                         ▼
                                 [Sentry Request]
                            (Trace context & user tags)
                                         │
                                         ▼
                            [Pino Logging Middleware]
                       - Attach req.id & req.log
                       - Set Response Header: X-Request-Id
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
                    ┌────────────────────┴────────────────────┐
                    │ (Success)                               │ (Error / Exception)
                    ▼                                         ▼
          res.on('finish')                         Express Error Middleware
      req.log.info({                                  - sentry.captureException(err)
        method, url, status,                          - req.log.error({ err, reqId })
        durationMs, ip                                - res.status(500).json({
      })                                                  error: 'Internal Server Error',
                                                          reqId
                                                        })
```

---

## 4. Files to Create and Modify

### 4.1 Files to Create:
1. `backend/utils/logger.js`: Root Pino logger instance, redactor configuration, child logger factory, and test-safe stream handling.
2. `backend/middleware/loggingMiddleware.js`: Request correlation ID generation, header propagation, request child logger injection, and duration tracking on `res.finish`.
3. `backend/utils/sentry.js`: Sentry initialization wrapper, Express middleware adapters, safe `captureException` helper with tenant/job tagging, and no-op fallback client.
4. `backend/tests/observability.test.js`: Comprehensive TDD suite verifying redaction, correlation IDs, request timing, Sentry no-op behavior, Express error handling, and health telemetry.

### 4.2 Files to Modify:
1. `package.json` & `backend/package.json`: Add dependencies `pino`, `pino-http`, `@sentry/node`.
2. `backend/index.js`:
   - Initialize Sentry (`sentry.initSentry(app)`).
   - Mount `loggingMiddleware` immediately after CORS and Sentry request handler.
   - Mount `sentry.sentryErrorHandler` and JSON 500 error-handling middleware after route mounts.
   - Add process-level crash safety nets (`unhandledRejection`, `uncaughtException`).
3. `backend/routes/v1Router.js`:
   - Update `GET /health` and `GET /health/scheduler` to expose observability telemetry (`logger`, `logLevel`, `sentryActive`).
4. `backend/services/queueService.js`:
   - Replace raw `console.error` with `sentry.captureException(err, { module: 'queueService', jobId })` and `logger.error`.
5. `backend/services/schedulerService.js`:
   - Replace raw `console.error` with `sentry.captureException(err, { module: 'schedulerService', tenantId, scheduleId })` and `logger.error`.
6. `.env.example`: Add `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE`, `LOG_LEVEL`.

---

## 5. Detailed Specifications

### 5.1 Pino Logger Specification (`backend/utils/logger.js`)
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

const isTest = process.env.NODE_ENV === 'test';
const defaultLevel = isTest
  ? (process.env.LOG_LEVEL || (process.env.ENABLE_TEST_LOGS ? 'info' : 'silent'))
  : (process.env.LOG_LEVEL || 'info');

const logger = pino({
  level: defaultLevel,
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    pid: process.pid,
    service: 'executive-qbr-backend',
  },
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
});

function getChildLogger(moduleName, bindings = {}) {
  return logger.child({ module: moduleName, ...bindings });
}

module.exports = {
  logger,
  getChildLogger,
  REDACT_PATHS,
};
```

### 5.2 Logging & Correlation Middleware (`backend/middleware/loggingMiddleware.js`)
```javascript
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../utils/logger');

function loggingMiddleware(req, res, next) {
  // 1. Correlation ID: propagate or generate
  const reqId = req.headers['x-request-id'] || uuidv4();
  req.id = reqId;
  res.setHeader('X-Request-Id', reqId);

  // 2. Child logger bound to request context
  req.log = logger.child({
    reqId,
    ip: req.ip || req.connection?.remoteAddress,
  });

  // 3. Track request duration
  const startTime = process.hrtime.bigint();

  res.on('finish', () => {
    const elapsedNs = process.hrtime.bigint() - startTime;
    const durationMs = Number(elapsedNs / 1000000n);

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
    };

    // Suppress noise for polling health endpoints
    if (req.path.endsWith('/health') || req.path.endsWith('/health/scheduler')) {
      req.log.debug(logData, 'HTTP Request Completed');
      return;
    }

    if (res.statusCode >= 500) {
      req.log.error(logData, 'HTTP Request Failed (Server Error)');
    } else if (res.statusCode >= 400) {
      req.log.warn(logData, 'HTTP Request Failed (Client Error)');
    } else {
      req.log.info(logData, 'HTTP Request Completed');
    }
  });

  next();
}

module.exports = loggingMiddleware;
```

### 5.3 Sentry Integration & Fallback (`backend/utils/sentry.js`)
```javascript
const Sentry = require('@sentry/node');
const { logger } = require('./logger');

let isSentryInitialized = false;

function initSentry(app) {
  const dsn = process.env.SENTRY_DSN;
  const isTest = process.env.NODE_ENV === 'test' && !process.env.ENABLE_TEST_SENTRY;

  if (!dsn || isTest) {
    logger.debug('[sentry] SENTRY_DSN not configured or running in test mode. Sentry initialized in no-op mock mode.');
    isSentryInitialized = false;
    return;
  }

  try {
    Sentry.init({
      dsn,
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production',
      release: process.env.npm_package_version || '1.0.0',
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
    });
    isSentryInitialized = true;
    logger.info('[sentry] Sentry error tracking successfully initialized.');
  } catch (err) {
    logger.error({ err }, '[sentry] Failed to initialize Sentry SDK. Operating in fallback mode.');
    isSentryInitialized = false;
  }
}

function captureException(err, context = {}) {
  // Always log error via structured logger
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
  if (!isSentryInitialized) {
    return (req, res, next) => next();
  }
  return Sentry.Handlers?.requestHandler ? Sentry.Handlers.requestHandler() : (req, res, next) => next();
}

function sentryErrorHandler() {
  if (!isSentryInitialized) {
    return (err, req, res, next) => next(err);
  }
  return Sentry.Handlers?.errorHandler ? Sentry.Handlers.errorHandler() : (err, req, res, next) => next(err);
}

module.exports = {
  initSentry,
  captureException,
  sentryRequestHandler,
  sentryErrorHandler,
  isInitialized: () => isSentryInitialized,
};
```

### 5.4 Centralized JSON 500 Express Middleware (`backend/index.js`)
```javascript
// Mounted after routes, after Sentry error handler, before static files:
app.use((err, req, res, next) => {
  const reqId = req.id || req.headers['x-request-id'] || 'unknown';
  const status = err.status || err.statusCode || 500;

  if (req.log?.error) {
    req.log.error({ err, status, reqId }, err.message);
  } else {
    logger.error({ err, status, reqId }, err.message);
  }

  res.status(status).json({
    error: status >= 500 ? 'Internal Server Error' : err.message,
    status,
    reqId,
  });
});
```

---

## 6. Test Strategy (TDD)

New comprehensive test suite `backend/tests/observability.test.js` covering:

1. **`logger_redacts_sensitive_authorization_header`**: Asserts `req.headers.authorization` is scrubbed to `[REDACTED]`.
2. **`logger_redacts_sensitive_password_and_token`**: Asserts objects with keys `password`, `token`, `secret`, `recipients` have values scrubbed to `[REDACTED]`.
3. **`correlationId_generated_when_missing`**: `GET /api/v1/health` without `X-Request-Id` returns 200 and attaches a valid UUID v4 `X-Request-Id` response header.
4. **`correlationId_propagated_when_present`**: `GET /api/v1/health` with `X-Request-Id: trace-custom-999` echoes `X-Request-Id: trace-custom-999` in response headers.
5. **`loggingMiddleware_attaches_child_logger`**: Asserts route handlers receive `req.log` pre-bound with `reqId`.
6. **`sentry_noop_when_dsn_omitted`**: Asserts `initSentry` without `SENTRY_DSN` does not throw and leaves `isInitialized()` as `false`.
7. **`sentry_captureException_safe_when_uninitialized`**: Asserts `captureException(new Error('fail'), { module: 'test' })` returns `null` without crashing.
8. **`express_error_handler_returns_json_500_with_reqId`**: Asserts an error thrown in an Express route triggers the global error handler, sets status 500, and returns `{ error: 'Internal Server Error', status: 500, reqId }`.
9. **`health_telemetry_includes_observability`**: Asserts `GET /api/v1/health` returns `{ status: 'ok', version: 'v1', observability: { logger: 'pino', sentryActive: false } }`.
10. **`background_error_capture_enriches_tags`**: Asserts `captureException` passes tenant, module, and jobId tags to Sentry context.

---

## 7. HUMAN ACTION REQUIRED — Observability (Sentry & Pino)

Per Section 10 of SYSTEM DIRECTIVE:

### 1. Dashboard Steps (Click-by-Click)
1. Log into your [Sentry Dashboard](https://sentry.io/).
2. Click **Create Project** $\to$ select **Node.js / Express**.
3. Set project name: `executive-qbr-backend`.
4. Copy the generated **DSN URL** (format: `https://<key>@<org>.ingest.sentry.io/<project-id>`).
5. Open your deployment platform (e.g. Render Dashboard $\to$ Environment Variables).

### 2. Environment Variables to Set
| Variable Name | Example Value (DO NOT use real secrets in code) | Purpose |
| :--- | :--- | :--- |
| `SENTRY_DSN` | `https://examplePublicKey@o000000.ingest.sentry.io/0000000` | Sentry ingestion endpoint |
| `SENTRY_ENVIRONMENT` | `production` | Deployment environment tag |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.1` | Performance APM transaction sample rate (10%) |
| `LOG_LEVEL` | `info` | Pino log verbosity (`info`, `debug`, `warn`, `error`) |

### 3. Verification Command
To verify Sentry connectivity in production:
```bash
curl -X GET https://your-deployed-domain.com/api/v1/health
```
Assert response contains `"observability": { "logger": "pino", "sentryActive": true }`.

### 4. What Breaks if the Human Skips This
- If `SENTRY_DSN` is omitted:
  - The application **will NOT crash** and remains 100% functional.
  - Pino structured JSON logging continues writing to `stdout`.
  - Sentry exception tracking and alerting remain inactive (errors log to stdout only; no email/Slack alerts fire).

---

## 8. Risk Assessment & Rollback

- **Risk Level**: **LOW**.
  - All logging and Sentry utilities are designed with defensive try-catch wrappers and no-op fallbacks.
  - If Sentry or Pino configuration is missing or malformed, the system degrades silently without breaking existing business APIs or report generation.
- **Rollback Path**:
  - Revert commit: `git revert HEAD`. Server resumes previous standard `console.log` logging.
