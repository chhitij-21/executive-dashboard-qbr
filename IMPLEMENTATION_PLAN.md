# Implementation Plan — Item #14: API-First (v1 URI Versioning & Deprecation Lifecycle)

**Status**: Waiting for user **APPROVED** before writing code.  
**Roadmap Item**: **#14 API-first (v1 versioning)** (Architectural — Option A)  
**Sequence Context**: Follows **#4 (Real Auth)** and **#3 (Database Layer)**. Freezes the canonical `/api/v1/` contract now that authentication and persistence layers are robust, with zero legacy in-memory auth or unencrypted recipient debt.

---

## 1. Executive Summary & Goals

Item #14 establishes a formal, versioned API boundary (`/api/v1/`) for the Executive Dashboard & QBR Generator platform per **Option A (URI Path Prefix Routing with Transparent Backward-Compatibility)**.

### Core Deliverables:
1. **Canonical `/api/v1/` Versioned Sub-App**:
   - All core platform endpoints are canonically mounted under `/api/v1/`:
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
     - `/api/v1/health` (Service and scheduler health)
2. **Transparent Backward Compatibility for `/api/...` (Zero Frontend Drift)**:
   - Legacy `/api/...` routes remain 100% functional.
   - An Express forwarding / deprecation middleware attaches standard RFC 8594 deprecation headers:
     - `Deprecation: true`
     - `Link: </api/v1${req.path}>; rel="successor-version"`
   - React frontend components, Vite proxy configurations, and existing scripts continue working immediately without modifications.
3. **OpenAPI 3.0 Contract Specification Plan**:
   - OpenAPI specification maintained as a standalone specification file `docs/openapi-v1.yaml`.
   - Captures request/response schemas for core platform operations (Auth, Upload, Dashboard, Schedules, Data Health).
   - Documented as an external consumer specification ready for third-party webhook and CI/CD integration.
4. **Contract Stability & Snapshot Verification**:
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
                                       │
       ┌───────────────┬───────────────┼───────────────┬───────────────┐
       ▼               ▼               ▼               ▼               ▼
   authRoutes    dashboardRoutes  scheduleRoutes  tenantRoutes   healthRoutes
```

---

## 3. Detailed Specifications

### 3.1 Route Mapping & Handler Canonicalization
To avoid code duplication between `/api/v1` and legacy `/api`, routes will be structured into a unified Express router:
- **`backend/routes/v1Router.js`**:
  Aggregates sub-routers (`vulnerabilities`, `mfa`, `inventorySync`, `reports`, `jobRoutes`, `templateRoutes`, `dataHealthRoutes`, `scheduleRoutes`) and core business route handlers (`auth`, `clients/tenants`, `rules`, `history`, `upload`, `analyze-excel`, `dashboard`, `lineage`, `qoq`, `ppt`, `ai`, `health`).
- **Mount Configuration in `backend/index.js`**:
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

### 3.2 Frontend/Backend Contract Stability (Section 19 Compliance)
- **Frontend Audit**: Every frontend fetch in `frontend/src/` currently queries `${API_BASE_URL}/api/...`.
- **Zero Breaking Changes**: Because the legacy `/api` alias forwards seamlessly to `v1Router`, no frontend code requires changing in this item.
- **Contract Freeze Guarantee**: Field additions in `/api/v1/` are strictly additive. No existing keys in `/api/dashboard`, `/api/jobs`, or `/api/reports` will be deleted or renamed.

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

---

## 4. Test Strategy (TDD)

New test suite `backend/tests/apiV1Contract.test.js` covering:
1. **`v1_healthEndpoint_returns200`**: `GET /api/v1/health` returns `{ status: 'ok', version: 'v1' }`.
2. **`v1_deprecationHeaders_attachedOnLegacy`**: `GET /api/health` returns identical payload plus `Deprecation: true` and `Link: </api/v1/health>; rel="successor-version"`.
3. **`v1_authLogin_returnsToken`**: `POST /api/v1/auth/login` issues valid JWT v2 session identical to legacy `/api/auth/login`.
4. **`v1_dashboard_jsonContractMatch`**: `GET /api/v1/dashboard` payload keys match `GET /api/dashboard` 100%.
5. **`v1_tenants_settings_roundtrip`**: `GET /api/v1/tenants` and `GET /api/v1/tenants/:id/settings` return valid tenant configuration.
6. **`v1_schedules_crud_parity`**: `GET /api/v1/tenants/:id/schedules` correctly queries schedule repo.
7. **`v1_dataHealth_parity`**: `GET /api/v1/data-health` returns valid data health metrics.
8. **`v1_vulnerabilities_parity`**: `GET /api/v1/vulnerabilities` returns filtered inventory CVEs.
9. **`v1_uploadSecurity_rateLimit_inherited`**: Rate limits and payload size guards apply uniformly to `/api/v1/upload`.
10. **`v1_tenantIsolation_enforced`**: Tenant boundaries apply identically across `/api/v1/` routes.

---

## 5. Risk Assessment & Rollback

- **Risk Level**: **LOW**.
  - Route handlers are consolidated and shared between `/api/v1` and `/api`. No data schemas or calculations are altered.
  - Legacy routes continue to answer all frontend requests with zero regressions.
- **Rollback Path**:
  - Revert single commit: `git revert HEAD`. Server resumes previous mounting without `/api/v1` prefix.
