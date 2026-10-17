# Implementation Plan — Phase D Wave 3: Visual & Layout Fixes

## 1. Problem Statement
Following the successful completion of Wave 2 uptime fixes and the Render PDF Puppeteer hotfix, PDF and PPT reports correctly mirror 100% of SSOT metrics. However, five P2 visual and layout issues remain: (1) PDF incident tables have overlapping "minmin" and long float text in Hold/Fix Time columns plus occasional single-row page spills, (2) PDF is missing interactive embedded charts for site availability and RCA drivers, (3) PDF multi-site inspector cards spill across page boundaries for large estates like MMTC (21 sites), (4) PPT slide bloat produces 89+ slides for multi-site estates and lacks native PptxGenJS charts on slides 5, 6, and 8, and (5) Frontend Other Activity DataTable is missing Location and Ticket Reference columns. Wave 3 addresses these layout and visual improvements while keeping uptime logic, calculations, and multi-tenant authorization 100% untouched.

---

## 2. Files to Touch (Exact Paths & Line Numbers)

1. `backend/services/pdfGenerator.js`:
   - Lines 170–210: Duration formatting helper `fmtMin` to clean decimals, strip duplicate "min", and safely format 0 / empty values.
   - Lines 233–271: Site inspector card grid generation — split into chunks of 4–6 cards per page with page headers, footers, and CSS `page-break-inside: avoid;`.
   - Lines 669–727 (Appendix C): Format Hold/Fix time with `fmtMin`, adjust column widths to prevent line overflow, and pagination chunk size (20 rows/page).
   - Lines 730–880 (Styles & Head): Include `<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>` (with fallback to local UMD bundle if present) and CSS for `.nowrap`, `.site-inspector-grid`, `.site-inspector-card` with `page-break-inside: avoid`.
   - Lines 990–1055 (Executive Summary): Add canvas containers for Site Availability Bar Chart and RCA Drivers Pareto Bar Chart, plus script block to initialize Chart.js on client render.

2. `backend/services/pptGenerator.js`:
   - Lines 575–622 (`buildPresentation`): 
     - Add `buildSiteUptimeChartSlide` (Slide 5 native Bar chart via `pres.ChartType.bar`).
     - Update `buildInventorySlide` (Slide 6) to add native Doughnut chart (`pres.ChartType.doughnut`).
     - Update `buildRCASlide` (Slide 8) to use `pres.ChartType.bar` with `barDir: 'bar'` instead of `'barH'`.
     - Slide Bloat fix in `targetSites.forEach`: If `targetSites.length > 10`, generate 1 "Overview" slide per site instead of 3 (reduces MMTC from 89 to ~37 slides).

3. `frontend/src/App.jsx`:
   - Lines 1162–1172: Update `otherActivityIncidents` DataTable `columns` to include `'display_reference'` and `'Location'`.
   - Map `rows` to format `display_reference` as `${type}: ${value}` and blank locations as `'—'`.

4. `frontend/src/components/DataTable.jsx`:
   - Lines 120–140: Ensure object values (like `display_reference`) render cleanly without `[object Object]` and blank locations render `'—'`.

---

## 3. Data Flow & Control Flow Changes
- **PDF Rendering**:
  - Raw duration metrics (`HoldTimeMin`, `ActualResolutionMin`) pass through `fmtMin()`, rounding floating points (e.g. `121511.5999999` $\rightarrow$ `121512 min`, `""` $\rightarrow$ `0 min`).
  - Site Inspector cards are chunked into 6 cards per page.
  - Chart.js renders canvases for Site Availability and RCA Drivers during Puppeteer execution (`waitUntil: 'networkidle0'`).
- **PPT Generation**:
  - PptxGenJS builds native chart shapes (`pres.ChartType.bar`, `pres.ChartType.doughnut`) directly from SSOT arrays.
  - If `targetSites.length > 10`, the site loop skips deep dive Switch/AP sub-tables, generating 1 overview slide per site.
- **Frontend Dashboard**:
  - `otherActivityIncidents` displays Reference ticket ID and Site Location (or `'—'` if site-agnostic).

---

## 4. Risks & Edge Cases
1. **Network Sandbox on Render for Chart.js CDN**:
   - *Mitigation*: Fall back to local bundled UMD file if available or gracefully render placeholder if Chart.js fails to load.
2. **Chart Rendering Delay in Puppeteer**:
   - *Mitigation*: Ensure `animation: false` on Chart.js instances so charts render synchronously and are immediately capture-ready for PDF print.
3. **PptxGenJS Chart Options Compatibility**:
   - *Mitigation*: Verified `pres.ChartType.bar` and `pres.ChartType.doughnut` in node environment; use standardized options.
4. **Site-Agnostic Change Requests**:
   - *Mitigation*: Location fallback renders `'—'` per Task 2.6 specification.

---

## 5. Test Cases to Add/Update & Verification
- All 74 existing backend tests (`npm test` in `backend/`) must pass (0 regressions).
- Frontend production build (`npm run build` in `frontend/`) must succeed.
- Local PDF test:
  - Generate JFL PDF: Header is `%PDF`, size > 1 MB, no text overlaps, charts present.
- Local PPT test:
  - Generate MMTC PPT: Slide count < 50 (target ~37), native charts present.

---

## 6. Rollback Plan
- Git checkout / revert Wave 3 commit restores prior visual layout without affecting Wave 2 core data integrity.
