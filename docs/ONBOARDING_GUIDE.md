# Executive QBR Platform — API & Integrator Onboarding Guide

Welcome to the **Executive Dashboard & Automated QBR Generator Platform API (v1)**.
This guide provides everything platform engineers, SREs, and MSP integrators need to authenticate, enforce multi-tenant isolation, automate QBR generation, query temporal anomalies, and connect real-time Cisco Meraki / Catalyst Center telemetry.

---

## 1. API Versioning & Interactive Documentation

- **Canonical Base Path**: `/api/v1` (all new integrations **must** use `/api/v1/...`)
- **Legacy Alias**: `/api/...` (returns RFC 8594 `Deprecation: true` and `Link: </api/v1/...>; rel="successor-version"` headers)
- **Interactive API Explorer (Swagger-style UI)**: `GET /api/v1/docs` (or `GET /docs`)
- **Machine-Readable Specs**:
  - OpenAPI 3.0.3 JSON: `GET /api/v1/openapi.json`
  - OpenAPI 3.0.3 YAML: `GET /api/v1/openapi.yaml`

---

## 2. Authentication, MFA & Ticket Exchange

### Step 1: Obtain a JWT v2 Bearer Token
```bash
curl -X POST http://localhost:5000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@portal.com","password":"<PASSWORD>"}'
```
- **MFA-enabled accounts** receive `{ "mfaRequired": true, "tempToken": "mfa_tmp_..." }` and complete login via `POST /api/v1/mfa/login-verify`.
- Pass the issued token on all protected requests:
  ```http
  Authorization: Bearer <JWT_TOKEN>
  ```
- **Session Revocation**: Call `POST /api/v1/auth/logout` to revoke your current token (`jti` blocklist), or `POST /api/v1/auth/revoke` (admin only) to terminate all sessions for a target `userId`.

### Step 2: Single-Use Tickets for Binary Downloads & SSE Streams
Tokens must **never** be passed in query strings (`?token=...` returns `401 UNAUTHORIZED`). For browser file downloads (`PPTX`, `CSV`) or `EventSource` SSE connections:
1. Request a 60-second single-use ticket via `POST /api/v1/auth/download-ticket` or `POST /api/v1/auth/sse-ticket` with `{"clientId":"client-jfl"}`.
2. Pass `?ticket=<TICKET>` to `GET /api/v1/ppt/download/{jobId}` or `/api/v1/chat/loop`.

---

## 3. Multi-Tenancy & Role-Based Isolation

Every data endpoint enforces **fail-closed tenant scoping** (`requireClientAccess`):
- **Admins** (`role: "admin"`, `assignedClient: "all"`) can target any tenant via `?clientId=client-jfl` or `?clientId=client-mmtcpamp` (or `x-client-id` header).
- **Client Users** (`role: "client_user"`) are locked to their assigned tenant. Attempting to access another tenant's dashboard, schedules, audit logs, or webhook events returns HTTP `403 CUSTOMER_ACCESS_FORBIDDEN` and records a `SECURITY_ACCESS_DENIED` event.
- Canonical aliases (e.g., `client-mmtc` -> `client-mmtcpamp`) are resolved automatically by the backend.

---

## 4. Automated QBR Processing Pipeline (SSOT)

1. **Upload Workbooks (`POST /api/v1/upload`)**:
   - Multipart form fields: `incidentFile`, `inventoryFile`, `clientId`, `start_date` (`YYYY-MM-DD`), `end_date` (`YYYY-MM-DD`).
   - Enforces strict date validation (`start_date <= end_date <= today`) and file magic-byte inspection.
   - Returns HTTP `202` with `jobId`.
2. **Poll Processing Job (`GET /api/v1/jobs/{jobId}`)**:
   - Track progress from `upload_validation` -> `parsing_excel` -> `completed`.
3. **Consume SSOT Analytics (`GET /api/v1/dashboard?clientId=client-jfl`)**:
   - Single Source of Truth for JFL Switch Uptime %, Proactive Switch Uptime %, SLA target compliance (`99.3%`), duration-weighted RCA impact, and anomalies.
   - Optional `?site=<SiteName>` triggers server-side recalculation without losing `report_period`.
4. **Download Synchronized PPTX (`GET /api/v1/ppt/download/{jobId}`)**:
   - Presentation layer strictly mirrors dashboard KPIs.

---

## 5. Temporal Anomaly Detection & AI Grounding

Query automated infrastructure anomalies without recalculating metrics client-side:
```bash
curl "http://localhost:5000/api/v1/anomalies?clientId=client-jfl&severity=CRITICAL" \
  -H "Authorization: Bearer $TOKEN"
```
Supported anomaly rules include:
- `DEVICE_FLAPPING`: $\ge 3$ incidents in a 72-hour window or $\ge 5$ total incidents.
- `CORRELATED_AP_OUTAGE`: $\ge 2$ distinct Access Points failing at the same site within 15 minutes.
- `EXTENDED_OUTAGE_RESOLUTION`: Actual resolution $> 1440$ minutes or hold time $> 2880$ minutes.
- `INCIDENT_VOLUME_OUTLIER`: Site incident count exceeding $\mu + 2\sigma$ ($\text{count} \ge 5$).

---

## 6. Real-Time IT Connectors (Cisco Meraki & Catalyst Center)

### Step 1: Provision a Connector (Admin Only)
```bash
curl -X POST http://localhost:5000/api/v1/connectors \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"clientId":"client-jfl","provider":"meraki","name":"JFL Store Meraki"}'
```
Save the returned `connector.id` and one-time `connector.webhookSecret` (`whsec_...`). Subsequent `GET /api/v1/connectors` calls return only masked previews (`whsec_...abcd`).

### Step 2: Sign & Send Webhook Payloads
Compute an HMAC-SHA256 hex digest of the exact raw JSON body using `webhookSecret` and send it in `x-meraki-signature` (or `x-catalyst-signature`, optionally prefixed with `sha256=`):
```bash
# POST /api/v1/webhooks/meraki/{connectorId}
# Header: x-meraki-signature: <hmac_sha256_hex>
```
- Meraki `sharedSecret` in the JSON body is also supported using constant-time comparison.
- Retries carrying the same `alertId` / `eventId` return `200 OK` (`duplicate: true`) idempotently.
- Query buffered incidents and live anomaly triggers via `GET /api/v1/webhooks/buffered-incidents?clientId=client-jfl`, and flush via `POST /api/v1/webhooks/flush`.

---

## 7. Security Audit Trail & Compliance

- **Admin-wide query**: `GET /api/v1/audit?tenantId=client-jfl&severity=WARN`
- **Tenant-scoped query**: `GET /api/v1/tenants/{id}/audit`
- **RFC 4180 CSV export**: `GET /api/v1/audit/export` or `GET /api/v1/tenants/{id}/audit/export`

---

## 8. Standard Error Reference

| HTTP Status | Error Code | Meaning |
| --- | --- | --- |
| `400` | `MISSING_CLIENT_ID` / validation error | Required parameter missing or date/input check failed |
| `401` | `UNAUTHORIZED` / `TOKEN_REVOKED` / `INVALID_SIGNATURE` | Missing/expired/revoked JWT or invalid webhook HMAC |
| `403` | `CUSTOMER_ACCESS_FORBIDDEN` / `CONNECTOR_DISABLED` | Cross-tenant isolation violation or disabled connector |
| `404` | `UNKNOWN_CLIENT` / `JOB_NOT_FOUND` / `CONNECTOR_NOT_FOUND` | Requested entity does not exist |
| `429` | `RATE_LIMIT_EXCEEDED` | Brute-force or heavy upload rate limit triggered |
| `503` | `AUTH_SERVICE_UNAVAILABLE` | Downstream dependency degraded |

