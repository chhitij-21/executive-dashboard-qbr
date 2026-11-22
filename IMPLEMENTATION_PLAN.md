# Implementation Plan — Item #14: API-First (v1 URI Versioning, Frontend Migration & Deprecation Lifecycle)

**Status**: Waiting for user **APPROVED** before writing code.  
**Roadmap Item**: **#14 API-first (v1 versioning)** (Architectural — Option A with Full Frontend Cutover)  
**Sequence Context**: Follows **#4 (Real Auth)** and **#3 (Database Layer)**. Freezes the canonical `/api/v1/` contract now that authentication and persistence layers are robust, with zero legacy in-memory auth or unencrypted recipient debt.

---

## 1. Executive Summary & Goals

Item #14 establishes a formal, versioned API boundary (`/api/v1/`) for the Executive Dashboard & QBR Generator platform per **Option A (URI Path Prefix Routing with Transparent Backward-Compatibility)**, combined with an immediate frontend cutover to `/api/v1/*`.

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
2. **Frontend Migration to `/api/v1/*` in THIS Item (GAP 1 — Choice A)**:
   - Full migration of all frontend call sites in `frontend/src/` to target `/api/v1/*`.
   - `frontend/src/config/api.js` updated with `API_V1_URL = `${API_BASE_URL}/api/v1`` and all component fetch calls updated from `/api/...` to `/api/v1/...`.
   - Makes `/api/v1/` the genuine, active primary consumer, ensuring the versioned API is actively utilized and verified in production.
3. **Transparent Backward Compatibility for Legacy `/api/...` with Fallthrough Guard (GAP 2)**:
   - Legacy `/api/...` routes remain 100% functional for external scripts, tools, and backward compatibility.
   - An Express forwarding / deprecation middleware attaches standard RFC 8594 deprecation headers:
     - `Deprecation: true`
     - `Link: </api/v1${req.path}>; rel="successor-version"`
   - **Fallthrough Bug Fix**: Deprecation middleware skips if `req.path.startsWith('/v1')` or `req.originalUrl.startsWith('/api/v1')`, preventing duplicate links (`</api/v1/v1/...>`) and false deprecation headers on 404s.
   - *Nice-to-Have Note*: Sunset header (RFC 8594) TBD — to be added when deprecation timeline is committed.
4. **Explicit Express Middleware Ordering (CLARIFICATION 1)**:
   - The middleware and route registration order in `backend/index.js` is strictly enforced:
     1. Global middleware (CORS, compression, body parser)
     2. Static files (`express.static(dist)`)
     3. Canonical v1 router: `app.use('/api/v1', v1Router)`
     4. Legacy alias router: `app.use('/api', deprecationMiddleware, v1Router)`
     5. JSON 404 handler for `/api*` (BEFORE SPA fallback):
        ```javascript
        app.use(['/api', '/api/*'], (req, res) => {
          res.status(404).json({ error: 'API route not found', status: 404, path: req.originalUrl });
        });
        ```
     6. SPA catch-all LAST: `app.get('*', serveIndexHtml)`
   - Guarantees that any unmatched API route returns JSON 404, never leaking SPA HTML.
5. **Health & Scheduler Health Endpoint Disposition**:
   - `/api/v1/health/scheduler` is the canonical scheduler health endpoint inside `v1Router`.
   - `/api/health/scheduler` is the legacy alias delegating to `v1Router` with `Deprecation: true` and `Link: </api/v1/health/scheduler>; rel="successor-version"`.
   - `/api/v1/health` returns general server health along with a nested `scheduler` status summary.
6. **OpenAPI 3.0 Contract Specification Plan (`docs/openapi-v1.yaml`)**:
   - OpenAPI specification maintained as a standalone specification file `docs/openapi-v1.yaml`.
   - Captures request/response schemas for core platform operations (Auth, Upload, Dashboard, Schedules, Data Health).
   - CI validation: Added to plan: `CI validates docs/openapi-v1.yaml via npx @redocly/cli lint (or swagger-cli validate). Fails PR if invalid.`

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
                    │                       deprecationMiddleware
                    │                       - Skip if req.path starts with /v1
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
                                       │
                             (If Route Unmatched)
                                       │
                                       ▼
                             JSON 404 Handler
                    { error: 'API route not found', 404 }
                         (Never leaks SPA index.html)
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
- Inline business routes moved into `v1Router.js`:
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

function deprecationMiddleware(req, res, next) {
  if (req.path.startsWith('/v1') || req.originalUrl.startsWith('/api/v1')) {
    return next();
  }
  res.setHeader('Deprecation', 'true');
  res.setHeader('Link', `</api/v1${req.path}>; rel="successor-version"`);
  next();
}

// 1. Global Middleware (CORS, compression, body parser)
// 2. Static files (dist)
// 3. Canonical API v1
app.use('/api/v1', v1Router);

// 4. Legacy backwards-compatible /api alias
app.use('/api', deprecationMiddleware, v1Router);

// 5. JSON 404 handler for API routes
app.use(['/api', '/api/*'], (req, res) => {
  res.status(404).json({ error: 'API route not found', status: 404, path: req.originalUrl });
});

// 6. SPA catch-all fallback LAST
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDistPath, 'index.html'));
});
```

### 3.2 Frontend Call Site Migration to `/api/v1/*`
The following frontend files will be updated to point directly to `/api/v1/*`:
1. `frontend/src/config/api.js`: Add `export const API_V1_BASE = `${API_BASE_URL}/api/v1`;`.
2. `frontend/src/App.jsx`: `/api/dashboard` → `/api/v1/dashboard`, `/api/auth/download-ticket` → `/api/v1/auth/download-ticket`, `/api/${exportType}` → `/api/v1/${exportType}`.
3. `frontend/src/context/AuthContext.jsx`: `/api/auth/me` → `/api/v1/auth/me`, `/api/clients` → `/api/v1/clients`, `/api/auth/login` → `/api/v1/auth/login`, `/api/mfa/login-verify` → `/api/v1/mfa/login-verify`, `/api/auth/logout` → `/api/v1/auth/logout`.
4. `frontend/src/components/FileUploader.jsx`: `/api/analyze-excel` → `/api/v1/analyze-excel`, `/api/upload` → `/api/v1/upload`, `/api/jobs/` → `/api/v1/jobs/`, `/api/status/` → `/api/v1/status/`.
5. `frontend/src/components/DataHealthModal.jsx`: `/api/data-health` → `/api/v1/data-health`.
6. `frontend/src/components/ScheduleManagerModal.jsx`: `/api/tenants/.../schedules` → `/api/v1/tenants/.../schedules`, `/api/tenants/.../templates` → `/api/v1/tenants/.../templates`, `/api/ppt/download/` → `/api/v1/ppt/download/`.
7. `frontend/src/components/ClientManager.jsx`: `/api/rules` → `/api/v1/rules`, `/api/tenants/` → `/api/v1/tenants/`, `/api/clients` → `/api/v1/clients`.
8. `frontend/src/components/VulnerabilitiesPage.jsx`: `/api/v1/vulnerabilities`.
9. `frontend/src/components/ReportHistory.jsx`: `/api/v1/history`, `/api/v1/auth/download-ticket`.
10. `frontend/src/components/ReportsView.jsx`: `/api/v1/reports/mmtc/latest`.
11. `frontend/src/components/AIChatbot.jsx`, `AISectionSummary.jsx`, `EnterpriseInsightCard.jsx`: `/api/v1/chat`, `/api/v1/ai/...`.
12. `frontend/src/components/InventorySyncPage.jsx`: `/api/v1/inventory/...`.
13. `frontend/src/components/MFASetup.jsx`: `/api/v1/mfa/...`.
14. Frontend test mocks in `frontend/src/__tests__/`: update url assertions to match `/api/v1/`.

### 3.3 OpenAPI 3.0 Contract Specification (`docs/openapi-v1.yaml`)
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
4. **`apiV1UnmatchedRoute_noDeprecationHeaders` (GAP 2)**: `GET /api/v1/nonexistent-route-xyz` returns HTTP 404, does NOT attach `Deprecation` or `Link` headers, and does NOT produce double `/v1/v1` in links.
5. **`apiUnmatchedReturns404Json_notHtml` (CLARIFICATION 1)**: `GET /api/nonexistent-route-xyz` returns HTTP 404 with JSON `{ error: 'API route not found' }`, never leaking SPA HTML.
6. **`legacyDirectMountsAbsent` (CLARIFICATION 2)**: Asserts old direct mounts in `backend/index.js` are truly removed and `app._router.stack` contains no duplicate legacy route handlers.
7. **`apiV1CorsPreflight` (CLARIFICATION 3)**: `OPTIONS /api/v1/auth/login` and `OPTIONS /api/auth/login` return 204 with `Access-Control-Allow-*` headers.
8. **`v1_authLogin_returnsToken`**: `POST /api/v1/auth/login` issues valid JWT v2 session identical to legacy `/api/auth/login`.
9. **`v1_dashboard_jsonContractMatch`**: `GET /api/v1/dashboard` payload keys match `GET /api/dashboard` 100%.
10. **`v1_tenants_settings_roundtrip`**: `GET /api/v1/tenants` and `GET /api/v1/tenants/:id/settings` return valid tenant configuration.
11. **`v1_schedules_crud_parity`**: `GET /api/v1/tenants/:id/schedules` correctly queries schedule repo.
12. **`v1_dataHealth_parity`**: `GET /api/v1/data-health` returns valid data health metrics.
13. **`v1_vulnerabilities_parity`**: `GET /api/v1/vulnerabilities` returns filtered inventory CVEs.
14. **`v1_uploadSecurity_rateLimit_inherited`**: Rate limits and payload size guards apply uniformly to `/api/v1/upload`.
15. **`v1_tenantIsolation_enforced`**: Tenant boundaries apply identically across `/api/v1/` routes.

---

## 5. Risk Assessment & Rollback

- **Risk Level**: **LOW**.
  - Route handlers are consolidated and shared between `/api/v1` and `/api`. No data schemas or calculations are altered.
  - Legacy routes continue to answer external requests with zero regressions.
- **Rollback Path**:
  - Revert single commit: `git revert HEAD`. Server resumes previous mounting without `/api/v1` prefix.
