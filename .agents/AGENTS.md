# Enterprise AI Engineering System Architecture & Guidelines for Executive QBR Platform

## 1. Core Operating Principles & Architecture
- **Single Source of Truth (SSOT)**:
  - The Executive Dashboard data processing engine (`processData.js`) is the Single Source of Truth (SSOT) for all calculations, site mapping, inventory aggregation, SLA compliance, health scores, and uptime formulas.
  - The PowerPoint Generator (`pptGenerator.js`) is strictly a **presentation layer** that consumes the validated, processed dashboard data model (`qbrData`). It must NEVER recalculate KPIs or process Excel files independently.
- **100% Dashboard & PPT Synchronization**:
  - Every KPI (Total Sites, Devices, Switches, APs, Incident Count, JFL Uptime %, Proactive Uptime %, Health Score, SLA %, RCA Drivers) in the exported PowerPoint MUST match the React Web Portal 100%.
- **Latest Job Resolution**:
  - All API routes (`/api/dashboard`, `/api/dashboard/latest`, `/api/ppt/latest`) MUST query completed reports using reverse scan (`history.slice().reverse().find(...)`) to ensure the user's most recent upload is returned, not the oldest historical report.
- **On-Demand PPT Regeneration**:
  - If a job's pre-generated PPT is missing or points to stale demo files, `index.js` must dynamically regenerate the PPT on-the-fly directly from `dashboard_data.json`.

---

## 2. Date Range & Custom Period Rules (STRICT UNCHANGEABLE RULE)
- **100% Dynamic Custom Date Range Only (NO HARDCODED STATIC DATES)**:
  - The date range displayed on the Web Dashboard header, the "REPORTING PERIOD" KPI card, and all PowerPoint slides MUST read dynamically from the user's selected `start_date` and `end_date` (`report_period.display_label`).
  - Hardcoding static date strings (such as `"13 April 2026 – 13 May 2026"` or `"1 July 2026 – 31 July 2026"`) as fixed values is STRICTLY FORBIDDEN under any condition.
  - Frontend `FileUploader.jsx` presents custom `start_date` and `end_date` inputs only (no preset dropdowns).
  - Max attribute is bound to today's date (`max={today}`) to prevent future dates.
  - Validation requires `start_date <= end_date` and both fields required.
- **Human-Readable Period Labels**:
  - Date ranges are formatted into clean calendar strings (e.g. `1 May 2026 – 1 June 2026`, `13 April 2026 – 13 May 2026`).
  - Raw placeholder text strings like `"User Selected Period"` must NEVER appear on the final rendered web dashboard or PPT slides when valid dates exist.

---

## 3. Uptime Percentage Calculation Rules
- **JFL Switch Uptime % Formula**:
  $$\text{JFL Uptime \%} = \max\left(0, \min\left(100, \frac{\text{Total Available Minutes} - \text{Time on Hold (Minutes)}}{\text{Total Available Minutes}} \times 100\right)\right)$$
- **Proactive Switch Uptime % Formula**:
  $$\text{Proactive Uptime \%} = \max\left(0, \min\left(100, \frac{\text{Total Available Minutes} - \text{Actual Resolution Time (Minutes)}}{\text{Total Available Minutes}} \times 100\right)\right)$$
- **Dynamic Calendar Days**:
  - Available minutes are computed based on actual calendar days in the selected period:
    - February: 28 days (40,320 mins)
    - April, June, September, November: 30 days (43,200 mins)
    - January, March, May, July, August, October, December: 31 days (44,640 mins)
    - Quarterly: Sum of calendar days in quarter (e.g. 90 days = 129,600 mins per device).
- **SLA Target**:
  - The SLA Uptime Target is **99.3%**, read dynamically from `rules.yaml` via `ruleEngine.getSLATarget()`.
  - The value `99.9` is forbidden as a hardcoded fallback.
- **Rounding & Bounds**:
  - All percentages must be rounded to exactly **two decimal places** and bounded between `0.00%` and `100.00%`.

---

## 4. UI/UX & Dashboard Display Rules (Frontend)
- **MTTR Removal**:
  - MTTR (Mean Time To Repair/Resolve) is completely removed from all frontend display components (`App.jsx`, `SiteInspector.jsx`). It is retained in the backend for audit records only.
- **Incident SLA Status**:
  - Incident tables display `sla_status` (`SLA Met`, `SLA Breached`, or `Open`) directly from SSOT. The frontend must NEVER recalculate SLA status.
- **Single Reference Column**:
  - Incident tables consume `display_reference` from SSOT (`{ type: "Ticket" | "Incident ID", value: "..." }`).
  - Displays either `Ticket: {value}` or `Incident ID: {value}` — never both.
- **Separate Primary RCA Cards**:
  - In `SiteInspector.jsx`, `Primary RCA (ALL)` is removed. Two distinct cards are displayed: **Primary RCA (Switches)** (`primaryRcaSwitches`) and **Primary RCA (APs)** (`primaryRcaAPs`).
  - Uses customer-ready fallback **`Stable Operations (No Incidents)`** when zero incidents exist.
- **Table Columns & Clean Layout**:
  - `Primary RCA` column added to Switch & AP SLA details tables displaying `row.RCA`.
  - `Category` and `Open Date` columns removed from all ticket tables (data preserved in SSOT).
  - Rack-wise Switch Uptime table renders a single dynamic column matching `periodLabel` (e.g. `Monthly Uptime %`).

---

## 5. PowerPoint Presentation Formatting Rules (`pptGenerator.js`)
- **Slide 5 Executive Summary Table**:
  `Site | No of devices | Proactive Switch Uptime | JFL Switch Uptime | Primary RCA Driver (Switches) | AP Incidents (Unique) | Primary RCA Driver (AP)`
- **AP Incidents Format**:
  - Render as `Total AP Incidents / Unique Affected APs`, e.g., `12 / 11`.
- **Underline Hyperlink Fix**:
  - Table cell text formatting must set `{ text: [{ text, options: { hyperlink: false } }] }` to prevent PptxGenJS from auto-underlining text runs (e.g. *"Client Side Activity"*).
- **Appendix Pagination**:
  - Appendix tables (Slides 41–44) paginate all devices and raw incidents at **30 rows per page**.

---

## 6. Data Validation & Logging
- **Validation Engine**:
  - `validateAnalytics(qbrData)` checks RCA breakdown sums, SLA status totals, and RCA percentage totals.
  - Inconsistencies log silently as warnings to `qbrData.validationWarnings` without blocking report or PPT generation.
