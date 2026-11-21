# Implementation Plan — Item #12: Data Health Panel

**Status**: Waiting for user **APPROVED** before writing code.  
**Roadmap Item**: #12 of 23 (Batch 3: Items #11, #12, #13)  
**Type**: UI & Analytics Feature (SSOT Data Telemetry & Invariant Audit)

---

## 1. Overview & Objectives
The **Data Health Panel** delivers executive-grade observability into the health, completeness, mathematical validity, and operational hygiene of the QBR dataset. It serves as an automated auditor for both NOC engineers and C-level executives, exposing:
1. **Mathematical Invariant Audits**: Continuous verification of physical conservation laws (inventory arithmetic, RCA driver totals, SLA status partitions, uptime boundedness).
2. **Data Completeness & Hygiene with Lazy-Loaded Row Previews**: Identifying missing hardware telemetry (serial numbers, IPs, models) and incident classification gaps (unassigned root causes, missing hold durations). The initial payload remains lightweight; clicking an issue triggers an on-demand fetch to display the exact Excel `sheetName`, `rowNumber`, `rawValue`, and row snapshot.
3. **Multi-Format Export (Excel & PDF) with Event-Loop Safeguards**: High-fidelity export of the Data Health Report in `.xlsx` and `.pdf` formats, protected by a hard 2,000-row limit to prevent blocking the Node.js event loop.
4. **Crash-Free Unicode / Glyph Normalization in PDF**: Full support for emojis and currency symbols (e.g. `⚠️`, `₹`, `🟢`, `🔴`) via a glyph transliteration engine, avoiding "Glyph not found" PDF errors.
5. **Rollover & Duration Telemetry**: Real-time detection of tickets spanning multiple reporting quarters or periods with capped hold time deductions.
6. **Interactive Dashboard Panel**: A high-visibility health indicator in `OverviewDashboard.jsx` leading to an interactive modal with tabbed audit views, quick metric tiles, and row-level drill-downs.

---

## 2. Architecture & Data Flow

```
   ┌─────────────────────────────────────────────────────────────┐
   │                      SSOT (qbrData)                         │
   │   - devices[]            - incidents[]                      │
   │   - siteSummary[]        - executiveSummary                 │
   │   - incidentAnalytics    - slaCompliance                    │
   └──────────────────────────────┬──────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────┐
   │         backend/services/dataHealthService.js               │
   │  1. Invariant Law Validator (Conservation checks)           │
   │  2. Hygiene Auditor (Lightweight issue summaries):          │
   │     - id, type, severity, sheetName, rowNumber, fieldName   │
   │  3. Lazy Row Resolver: getRowSnapshot(issueId, qbrData)     │
   │  4. Score Calculator (Weighted Composite 0-100%)            │
   └──────────────────────────────┬──────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────┐
   │      backend/routes/dataHealthRoutes.js (Tenant-Isolated)   │
   │  - GET /api/data-health (Lightweight Telemetry Payload)     │
   │  - GET /api/data-health/issue/:issueId (Lazy Row Snapshot)  │
   │  - GET /api/data-health/export?format=xlsx (Max 2,000 Rows) │
   │  - GET /api/data-health/export?format=pdf (Unicode Safe)    │
   │  - Validates req.tenantId === job.clientId                  │
   └──────────────────────────────┬──────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────┐
   │       frontend/src/components/DataHealthModal.jsx           │
   │  - Health Gauge: 🟢 98% HEALTHY / 🟡 WARNING / 🔴 CRITICAL  │
   │  - 4 Quick-Stat KPI Cards (Invariants, Completeness, etc.)  │
   │  - Click Issue → Lazy Loads /api/data-health/issue/:issueId │
   │  - Mini Row Preview Table (Offending Cell Highlighted)      │
   │  - Export Buttons: 📊 Export Excel (.xlsx) | 📄 Export PDF (.pdf) │
   └─────────────────────────────────────────────────────────────┘
```

---

## 3. Mathematical Invariants & Health Score Formulation

### A. Core Mathematical Invariant Rules (Zero-Tolerance)
| Invariant | Formulation | Verification Condition |
|---|---|---|
| **R1: Inventory Conservation** | $\text{Active Switches} + \text{Active APs} + \text{Stock} = \text{Total Devices}$ | Exact integer match |
| **R2: RCA Summation** | $\sum \text{RCA counts} = \text{Total Incidents}$ | Exact integer match |
| **R3: SLA Status Partition** | $\text{SLA Met} + \text{SLA Breached} + \text{Open} = \text{Total Incidents}$ | Exact integer match |
| **R4: Uptime Boundedness** | $\forall d \in \text{devices}: 0.00\% \le d.\text{uptime} \le 100.00\%$ | No NaN, no out-of-range values |
| **R5: Site Device Allocation** | $\sum_{s \in \text{sites}} s.\text{deviceCount} = \text{Total Active Devices}$ | Exact integer match |

### B. Composite Health Score (0 – 100%)
$$\text{Health Score} = 0.35 \times I_{\text{invariants}} + 0.25 \times C_{\text{inventory}} + 0.25 \times H_{\text{incidents}} + 0.15 \times A_{\text{anomalies}}$$
- $I_{\text{invariants}}$: Ratio of passed invariant mathematical laws (e.g., $5/5 = 1.0$). If any critical invariant fails, score is penalized.
- $C_{\text{inventory}}$: Percentage of devices possessing valid Hostname, IP, and Serial Number.
- $H_{\text{incidents}}$: Percentage of incidents with classified Root Cause (non-Unknown) and valid hold duration.
- $A_{\text{anomalies}}$: Absence factor for multi-period rollovers and negative or excessive hold times.

### C. Health Status Thresholds
- **🟢 HEALTHY**: Score $\ge 90\%$ (All mathematical invariants pass)
- **🟡 WARNING / NEEDS ATTENTION**: $70\% \le \text{Score} < 90\%$ (Hygiene or completeness warnings, all invariants pass)
- **🔴 CRITICAL**: $\text{Score} < 70\%$ OR any core mathematical invariant fails

---

## 4. Backend Implementation Plan

### 4.1. `backend/services/dataHealthService.js`
- Export `calculateDataHealth(qbrData)`:
  - Deep-freezes `qbrData` so validation logic never mutates dashboard state.
  - Runs all 5 mathematical invariant assertions.
  - **Lightweight Issue Summary**: Each issue in the main response contains:
    ```javascript
    {
      id: "issue_dev_3_serial",
      type: "DEVICE_MISSING_SERIAL",
      severity: "HIGH",
      message: "Device is missing hardware Serial Number.",
      sheetName: d.__sheet || "Updated Inventory -139",
      rowNumber: d.__rowNum || idx + 2,
      fieldName: "SerialNo",
      rawValue: d.SerialNo || null,
      recommendation: "Update the asset inventory with hardware serial number."
      // rowSnapshot is intentionally OMITTED here for performance
    }
    ```
- Export `getIssueRowSnapshot(qbrData, issueId)`:
  - Resolves the specific record by parsed `issueId` (e.g. device index or incident ticket).
  - Returns the full key-value dictionary `rowSnapshot` on-demand when requested by the UI.

### 4.2. `backend/services/dataHealthExporter.js`
- **Hard Limit & Event-Loop Safeguard**:
  - `MAX_EXPORT_ISSUES = 2000`.
  - If issues count > 2,000 and `?strict=true`, returns HTTP 413 Payload Too Large (`{ error: "Payload too large: issue count exceeds safety threshold (2,000 max). Please filter or truncate your request.", code: "PAYLOAD_TOO_LARGE" }`).
  - Otherwise, caps export to top 2,000 most critical issues (CRITICAL > HIGH > MEDIUM > LOW) and prepends an audit notice: `"Notice: Export capped to top 2,000 issues out of N total issues for event-loop safety."`.
- **Excel (.xlsx) Exporter**:
  - Uses `xlsx` (SheetJS) to construct a workbook with 3 styled sheets: `Overview & Invariants`, `Data Hygiene Issues` (capped at 2,000 rows), and `Rollovers & Anomalies`.
- **PDF (.pdf) Exporter with Unicode Glyph Transliteration**:
  - Dedicated zero-dependency Node.js PDF 1.4 document builder (`dataHealthPdfExporter` — ensuring `backend/services/pdfGenerator.js` is NEVER created, strictly preserving the `speedOptimization.test.js` invariant).
  - **Unicode Normalizer**: Before embedding strings in Type 1 Helvetica font streams, transliterates non-WinAnsi glyphs:
    - `⚠️` $\to$ `[!]`
    - `🟢` $\to$ `[PASS]`
    - `🔴` $\to$ `[FAIL]`
    - `🟡` $\to$ `[WARN]`
    - `₹` $\to$ `INR `
    - `✓` $\to$ `[OK]`
    - `✗` $\to$ `[X]`
    - All other characters outside `[\x20-\x7E\xA0-\xFF]` are safely stripped or transliterated to ASCII, completely preventing "Glyph not found" crashes.

### 4.3. `backend/routes/dataHealthRoutes.js`
- Mount endpoints:
  - `GET /api/data-health`: Computes data health for the latest canonical dataset or active tenant (lightweight payload).
  - `GET /api/data-health/latest`: Alias for `/api/data-health`.
  - `GET /api/data-health/:jobId`: Computes data health for a specific historical job report.
  - `GET /api/data-health/issue/:issueId`: Lazy-loads `rowSnapshot` for a single clicked issue (supports `?jobId=...`).
  - `GET /api/data-health/export?format=xlsx` (and `?format=pdf`): Downloads the generated Excel or PDF report with 2,000-row cap and tenant isolation.
- Enforces tenant isolation: Verifies `req.tenantId === report.clientId`.

### 4.4. `backend/index.js`
- Mount `app.use(['/api/data-health', '/data-health'], dataHealthRoutes)`.

---

## 5. Frontend UI/UX Plan

### 5.1. `frontend/src/components/DataHealthModal.jsx`
- Clean, accessible modal dialog:
  - **Top Health Banner**: Large score display (e.g. `98%`), Status Badge (`🟢 EXCELLENT HEALTH`), and last evaluated timestamp.
  - **Action Header with Export Buttons**:
    - `📊 Export Excel (.xlsx)` button: triggers download from `/api/data-health/export?format=xlsx`.
    - `📄 Export PDF (.pdf)` button: triggers download from `/api/data-health/export?format=pdf`.
  - **4 Top KPI Cards**:
    1. Invariant Rules: `5 / 5 Passed` (100%)
    2. Device Completeness: e.g. `98.6%` (143/145 Complete)
    3. Incident Hygiene: e.g. `100%` (0 Unclassified)
    4. Rollovers & Anomalies: `0 Active`
  - **Tab Navigation**:
    1. **Rules & Invariants Tab**: Table showing each invariant, formula, expected vs actual values, status (`PASS` in green, `FAIL` in red).
    2. **Device & Incident Hygiene Tab with Lazy-Loaded Row Previews**:
       - List of all issues with Severity pills, Sheet Name, Row Number, and Field.
       - **Clicking an issue initiates an on-demand fetch to `/api/data-health/issue/:issueId`**:
         - Displays loading spinner while fetching.
         - Once loaded, renders the **Mini Row Preview Table**:
           - Header: `📍 Source: Sheet "${issue.sheetName}", Row #${issue.rowNumber}`.
           - Highlights the offending cell in red/amber with a `⚠️ Invalid Value: [${issue.rawValue}]` badge.
           - Shows all columns from `issue.rowSnapshot` in a neat, responsive table.
           - Includes "Copy Row JSON" button for fast operational handoffs.
           - Caches fetched snapshots locally in React state to avoid redundant network calls.
    3. **Rollovers & Durations Tab**: Detailed breakdown of cross-period tickets, hold durations, and period boundaries.
    4. **Recommendations Tab**: Action checklist for operations/NOC teams (e.g., "Assign serial numbers to 2 switches in Bangalore").

### 5.2. `frontend/src/components/OverviewDashboard.jsx`
- In the top toolbar (alongside QoQ controls), add the **Data Health Status Button**:
  - Displays dynamic badge: `🏥 Data Health: 98% (Healthy)` with color coding (Green/Amber/Red).
  - Clicking button sets `isDataHealthOpen(true)`.

---

## 6. Risks, Edge Cases & Safeguards

| Risk / Edge Case | Safeguard |
|---|---|
| **Large Payload Freezing UI** | Omit `rowSnapshot` from initial `GET /api/data-health`. Lazy-load individual row snapshots via `GET /api/data-health/issue/:issueId` only on user click. |
| **Event Loop Blocking on Export** | Enforce a hard cap of 2,000 issues on Excel/PDF exports. If `?strict=true` and count > 2,000, reject with HTTP 413 Payload Too Large. Otherwise, cap to top 2,000 issues with a visible notice banner. |
| **PDF Unicode "Glyph Not Found" Error** | Transliterate symbols and currency characters (`⚠️` $\to$ `[!]`, `₹` $\to$ `INR `) before writing to the PDF font stream. Strips unmapped non-Latin1 chars. |
| **`speedOptimization.test.js` Invariant Violation** | Invariant asserts `backend/services/pdfGenerator.js` must NEVER exist. Name the PDF exporter `dataHealthPdfExporter.js` or include it in `dataHealthExporter.js`. Never create `backend/services/pdfGenerator.js`. |
| **Missing Lineage on Parsed Rows** | Fallback to `idx + 2` for `rowNumber` and generic sheet names if `__sheet` or `__rowNum` are omitted in legacy data. |
| **Cross-Tenant Telemetry Leak** | Enforce `req.tenantId === report.clientId` on `/api/data-health/:jobId`, `/api/data-health/issue/:issueId`, and `/api/data-health/export`. Client users cannot inspect other tenant reports. |
| **SSOT Mutation Risk** | Read-only analysis. Object is deep-frozen or treated immutably; zero mutations to `qbrData`. |

---

## 7. Test Plan & Invariants

### A. Backend Test Suite (`backend/tests/dataHealth.test.js`)
1. **Clean Dataset**: Verifies 100% score, `HEALTHY` status, and all 5 invariant checks pass.
2. **Broken Physical Inventory Arithmetic**: Deliberately mismatches active switches + APs + stock vs total devices; asserts Invariant R1 fails and health status drops to `CRITICAL`.
3. **Broken RCA Breakdown Sum**: Injects an extra uncounted incident; asserts Invariant R2 fails and reports discrepancy.
4. **Lightweight Issue Summary**: Asserts main `GET /api/data-health` returns issues with `sheetName`, `rowNumber`, `fieldName`, and `rawValue`, but `rowSnapshot` is `undefined`.
5. **Lazy Row Snapshot Endpoint**: Calls `GET /api/data-health/issue/:issueId`; verifies 200 OK and returns complete `rowSnapshot` object with highlighted row attributes.
6. **Excel Export (.xlsx) with 2,000 Cap**: Requests `GET /api/data-health/export?format=xlsx`; verifies response status 200, Content-Type `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, and valid PK magic bytes (`0x50 0x4B 0x03 0x04`).
7. **PDF Export (.pdf) with Unicode Transliteration**: Requests `GET /api/data-health/export?format=pdf` on a dataset containing `⚠️` and `₹`; verifies 200 OK, Content-Type `application/pdf`, valid PDF magic bytes (`%PDF-1.4`), and absence of glyph errors.
8. **Export Limit 413 Protection**: Calls `GET /api/data-health/export?format=xlsx&strict=true` on synthetic dataset with 3,000 issues; asserts 413 Payload Too Large.
9. **Tenant Isolation**: Verifies client user receives HTTP 403 when requesting data health, issue snapshot, or export for another tenant's job ID.
10. **Empty / Minimal Dataset**: Verifies safe handling of empty dataset without division-by-zero or NaN errors.

### B. Frontend Verification
- Verify `DataHealthModal.jsx` renders all 4 tabs cleanly.
- Verify clicking a warning triggers on-demand fetch and displays the Mini Row Preview Table with the highlighted cell.
- Verify clicking Excel and PDF export buttons initiates file downloads.
- `npm --prefix frontend test` passes 100%.
- `npm --prefix frontend run build` completes with 0 errors.

---

## 8. Rollback Plan
If any issue occurs, `DataHealthModal` and `dataHealthRoutes` can be unmounted without affecting core report generation or dashboard viewing.

---

**Status**: Waiting for user **APPROVED** before proceeding to implementation.
