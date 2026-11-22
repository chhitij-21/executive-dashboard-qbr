# Implementation Plan — Item #14: API-First (v1 URI Versioning & Deprecation Lifecycle)

**Status**: Waiting for user **APPROVED** before writing code.  
**Roadmap Item**: **#14 API-first (v1 versioning)** (Architectural — Option A)  
**Sequence Context**: Follows **#4 (Real Auth)** and **#3 (Database Layer)**. Freezes the canonical `/api/v1/` contract now that authentication and persistence layers are robust, with zero legacy in-memory auth or unencrypted recipient debt.

---

## 1. Executive Summary & Goals

Item #14 establishes a formal, versioned API boundary (`/api/v1/`) for the Executive Dashboard & QBR Generator platform per **Option A (URI Path Prefix Routing with Transparent Backward-Compatibility)**.

### Core Deliverables:
1. **Consolidated Canonical `/api/v1/` Router Bundle (`backend/routes/v1Router.js`)**:
   - **Removal of all direct `/api/*` mounts from `backend/index.js`**: All existing route mounts (`templateRoutes`, `dataHealthRoutes`, `scheduleRoutes`, `authRoutes`, `reportsRouter`, `jobRoutes`, `inventorySyncRouter`, `vulnerabilities`, `mfa`, and inline business handlers) are removed from `backend/index.js` and consolidated entirely into `backend/routes/v1Router.js`.
   - All platform routes become canonical under `/api/v1/`:
     - `/api/v1/auth/*` (Login, Logout, Revoke, MFA, Session Tickets)
     - `/api/v1/dashboard/*` (Executive KPI aggregations, site inspections, rack health)
     - `/api/v1/upload` & `/api/v1/analyze-excel` (Ingestion pipeline)
     - `/api/v1/jobs/*` (Async processing status and job inspection)
     - `/api/v1/tenants/*` & `/api/v1/clients/*` (Multi-tenant config, branding, and templates)
     - `/api/v1/schedules/*` (Scheduled QBR management and runs)
     - `/api/v1/reports/*` (Tenant-isolated reports, MMTC ticket dual-read)
     - `/api/v1/rules/*` (Dynamic SLA threshold rules)
     - `/api/v1/history/*` (Executive report run history)
     - `/api/v1/lineage/*` (KPI cell traceability)
     - `/api/v1/qoq/*` (Quarter-over-Quarter comparison)
     - `/api/v1/data-health/*` (Audit and data quality anomalies)
     - `/api/v1/vulnerabilities/*` (Cisco PSIRT CVE tracking)
     - `/api/v1/health` & `/api/v1/health/scheduler` (Service and scheduler health)
2. **Transparent Backward Compatibility for Legacy `/api/...` (Zero Frontend Drift)**:
   - Legacy `/api/...` routes remain 100% functional.
   - An Express forwarding / deprecation middleware attaches standard RFC 8594 deprecation headers:
     - `Deprecation: true`
     - `Link: </api/v1${req.path}>; rel="successor-version"`
   - *Nice-to-Have Note*: Sunset header (RFC 8594) TBD — to be added when deprecation timeline is committed.
   - React frontend components, Vite proxy configurations, and existing scripts continue working immediately without modifications.
3. **Middleware Placement Architecture (Single Source of Truth)**:
   - **Inside `v1Router`**: All payload size limits (`express.json({ limit: '2mb' })`), rate limiters (`heavyRateLimit`, login rate limiters), tenant context resolvers, and authentication middleware (`requireAuth`, `requireAdmin`, `requireClientAccess`) live strictly inside `v1Router`.
   - **Inside `backend/index.js`**: Holds top-level cross-cutting concerns (CORS, compression, static files) and the two router mounts:
     - Canonical: `app.use('/api/v1', v1Router);`
     - Legacy alias: `app.use('/api', deprecationNoticeMiddleware, v1Router);`
   - *Guarantees no double-mounting or missing middleware.*
4. **Health & Scheduler Health Endpoint Disposition**:
   - `/api/v1/health/scheduler` is the canonical scheduler health endpoint inside `v1Router`.
   - `/api/health/scheduler` is the legacy alias delegating to `v1Router` with `Deprecation: true` and `Link: </api/v1/health/scheduler>; rel="successor-version"`.
   - `/api/v1/health` returns general server health along with a nested `scheduler` status summary.
5. **OpenAPI 3.0 Contract Specification Plan (`docs/openapi-v1.yaml`)**:
   - OpenAPI specification maintained as a standalone specification file `docs/openapi-v1.yaml`.
   - Captures request/response schemas for core platform operations (Auth, Upload, Dashboard, Schedules, Data Health).
   - CI validation: Added to plan: `CI validates docs/openapi-v1.yaml via npx @redocly/cli lint (or swagger-cli validate). Fails PR if invalid.`
6. **Contract Stability & Snapshot Verification**:
   - Comprehensive audit verified that zero existing tests in `backend/tests/` perform `deepStrictEqual` or `deepEqual` on response headers (only targeted `res.headers.get(...)` checks). Adding `Deprecation` and `Link` headers will not break any existing tests.
   - In accordance with Section 19 of the directive, comprehensive snapshot tests in `backend/tests/apiV1Contract.test.js` verify that `/api/v1/...` and `/api/...` responses are functionally identical and that no existing keys are mutated.

---

## 2. Architecture & Request Flow

```
                             Incoming HTTP Request
                                       │
                    ┌──────────────────┴──────────────────┐
                    │                                     │
                    ▼                                     ▼
        GET/POST /api/v1/*                       GET/POST /api/* (Legacy)
                    │                                     │
                    │                                     ▼
                    │                       legacyDeprecationMiddleware
                    │                       - Set Header: Deprecation: true
                    │                       - Set Header: Link: </api/v1...>; rel="successor-version"
                    │                                     │
                    └──────────────────┬──────────────────┘
                                       │
                                       ▼
                              v1 Router Bundle
                          (backend/routes/v1Router.js)
                 [express.json(2mb) + Rate Limiters + Auth]
                                       │
       ┌───────────────┬───────────────┼───────────────┬───────────────┐
       ▼               ▼               ▼               ▼               ▼
   authRoutes    dashboardRoutes  scheduleRoutes  tenantRoutes   healthRoutes
```

---

## 3. Detailed Specifications

### 3.1 Route Consolidation & Removal from `backend/index.js`
All direct `/api/*` and unversioned aliases currently mounted on `app` in `backend/index.js` are removed from `index.js` and consolidated into `backend/routes/v1Router.js`:
- Sub-routers imported into `v1Router.js`:
  - `vulnerabilities`
  - `mfa`
  - `inventorySyncRouter`
  - `reportsRouter`
  - `jobRoutes`
  - `templateRoutes`
  - `dataHealthRoutes`
  - `scheduleRoutes`
- Inline business routes moved into `v1Router.js` or domain route modules:
  - Auth: `/auth/login`, `/auth/logout`, `/auth/revoke`, `/auth/me`, `/auth/auto`, `/auth/demo-accounts`, `/auth/download-ticket`, `/auth/sse-ticket`
  - Tenants & Clients: `/clients`, `/clients/:id`, `/clients/:id/locations`, `/tenants`, `/tenants/:id/settings`
  - Rules: `/rules` (GET and PUT)
  - History: `/history`, `/history/:jobId`
  - Ingestion: `/upload`, `/upload-json`, `/analyze-excel`
  - Dashboard: `/dashboard`, `/dashboard/:jobId`
  - Traceability & QoQ: `/lineage`, `/lineage/trace`, `/qoq/compare`
  - AI: `/chat`, `/chat/loop`, `/ai/section-summary`, `/ai/insights`
  - Exports & Downloads: `/ppt/download/:jobId`, `/ppt/:jobId`, `/status/:jobId`, `/report/:jobId`, `/error-report/:jobId`, `/data-quality/:jobId`, `/processing-log/:jobId`
  - Health: `/health`, `/health/scheduler`

In `backend/index.js`, the routing layer reduces to strictly:
```javascript
const v1Router = require('./routes/v1Router');

// Canonical API v1
app.use('/api/v1', v1Router);

// Legacy backwards-compatible /api alias with RFC 8594 deprecation headers
app.use('/api', (req, res, next) => {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Link', `</api/v1${req.path}>; rel="successor-version"`);
  next();
}, v1Router);
```

### 3.2 Health & Scheduler Health Endpoints
- Canonical:
  - `GET /api/v1/health`: Returns `{ status: 'ok', ts: ISOString, version: 'v1', scheduler: schedulerHealth }`.
  - `GET /api/v1/health/scheduler`: Returns full scheduler diagnostic payload `{ status: 'healthy' | 'degraded', runningJobs, lastRun, ... }`.
- Legacy:
  - `GET /api/health` and `GET /api/health/scheduler` delegated via `/api` deprecation middleware with headers `Deprecation: true` and `Link: </api/v1/health...>; rel="successor-version"`.

### 3.3 Middleware Placement Architecture
- **Inside `v1Router.js`**:
  - `v1Router.use(express.json({ limit: '2mb' }));`
  - Rate limiters (`heavyRateLimit`, login rate limiters) applied directly to sensitive endpoints inside `v1Router`.
  - Auth checks (`requireAuth`, `requireAdmin`, `requireClientAccess`) applied directly inside `v1Router`.
- **Inside `backend/index.js`**:
  - Global CORS configuration.
  - Compression middleware.
  - Static file serving (`express.static(dist)`).
  - Single unversioned `/api` deprecation wrapper delegating to `v1Router`.

### 3.4 Frontend/Backend Contract Stability (Section 19 Compliance)
- **Frontend Audit**: Frontend calls in `frontend/src/` query `${API_BASE_URL}/api/...`.
- **Zero Breaking Changes**: The legacy `/api` alias forwards seamlessly to `v1Router`, preserving 100% of existing behavior and response shapes.
- **Contract Freeze Guarantee**: Field additions in `/api/v1/` are strictly additive. No existing keys in `/api/dashboard`, `/api/jobs`, or `/api/reports` will be deleted or renamed.

### 3.5 OpenAPI 3.0 Contract Specification (`docs/openapi-v1.yaml`)
- Authored as a formal schema file documenting:
  - Info: Title: `Executive Dashboard & QBR Generator API`, Version: `1.0.0`
  - Servers: `/api/v1`
  - Paths:
    - `/auth/login`, `/auth/logout`, `/auth/revoke`, `/auth/me`
    - `/dashboard`, `/dashboard/{jobId}`
    - `/upload`, `/upload-json`, `/analyze-excel`
    - `/jobs/{jobId}`
    - `/tenants/{id}/settings`, `/tenants/{id}/schedules`, `/tenants/{id}/templates`
    - `/data-health`, `/data-health/export`
    - `/health`, `/health/scheduler`
  - Components: Security schemes (`BearerAuth`), Data models (`DashboardSummary`, `HealthStatus`, `LoginResponse`, etc.).
- **CI Validation Plan**: Added to CI checks: `npx @redocly/cli lint docs/openapi-v1.yaml` (or `swagger-cli validate`). Fails PR if invalid.

---

## 4. Test Strategy (TDD)

New test suite `backend/tests/apiV1Contract.test.js` covering:
1. **`v1_healthEndpoint_returns200`**: `GET /api/v1/health` returns `{ status: 'ok', version: 'v1' }`.
2. **`v1_schedulerHealth_parity`**: `GET /api/v1/health/scheduler` returns scheduler health state; `GET /api/health/scheduler` returns identical state plus `Deprecation: true` and `Link: </api/v1/health/scheduler>; rel="successor-version"`.
3. **`v1_deprecationHeaders_attachedOnLegacy`**: `GET /api/health` returns identical payload plus `Deprecation: true` and `Link: </api/v1/health>; rel="successor-version"`.
4. **`v1_authLogin_returnsToken`**: `POST /api/v1/auth/login` issues valid JWT v2 session identical to legacy `/api/auth/login`.
5. **`v1_dashboard_jsonContractMatch`**: `GET /api/v1/dashboard` payload keys match `GET /api/dashboard` 100%.
6. **`v1_tenants_settings_roundtrip`**: `GET /api/v1/tenants` and `GET /api/v1/tenants/:id/settings` return valid tenant configuration.
7. **`v1_schedules_crud_parity`**: `GET /api/v1/tenants/:id/schedules` correctly queries schedule repo.
8. **`v1_dataHealth_parity`**: `GET /api/v1/data-health` returns valid data health metrics.
9. **`v1_vulnerabilities_parity`**: `GET /api/v1/vulnerabilities` returns filtered inventory CVEs.
10. **`v1_uploadSecurity_rateLimit_inherited`**: Rate limits and payload size guards apply uniformly to `/api/v1/upload`.
11. **`v1_tenantIsolation_enforced`**: Tenant boundaries apply identically across `/api/v1/` routes.
12. **`v1_noLegacyRoutesDirectlyOnApp`**: Verifies that `backend/index.js` does NOT register individual `/api/*` mounts directly outside `v1Router`.

---

## 5. Risk Assessment & Rollback

- **Risk Level**: **LOW**.
  - Route handlers are consolidated and shared between `/api/v1` and `/api`. No data schemas or calculations are altered.
  - Legacy routes continue to answer all frontend requests with zero regressions.
- **Rollback Path**:
  - Revert single commit: `git revert HEAD`. Server resumes previous mounting without `/api/v1` prefix.
