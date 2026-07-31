# Executive Dashboard & Automated QBR Generator — Comprehensive Memory & System Knowledge

## Project Mission & Core Objective
Build and maintain a production-grade **Executive Dashboard** and **Automated Quarterly Business Review (QBR) Generator** that converts customer Excel data (`Incidents`, `Inventory`, `SLA Compliance CSVs`) into:
1. An interactive executive web portal (`React`, `Node.js`, `Express`).
2. An automated 27-slide PowerPoint presentation matching the master template.

---

## 1. ⚙️ Rules for Frontend and Backend Synchronization

### Single-Source-of-Truth Rule (Backend Rule Engine)
* All business calculation logic (SLA targets, health score formulas, severity mappings, device classifications, stock isolations, RCA categories) is owned exclusively by the **Backend Business Rules Engine (`backend/services/ruleEngine.js` & `backend/config/rules.yaml`)**.
* The frontend never hardcodes metric formulas or customer rules. It dynamically renders the structured data payload returned by `/api/dashboard/latest`.

### Data Integrity & Zero Assumptions Rule
* **Rule 1 (Zero Assumptions)**: Neither backend nor frontend may estimate, fabricate, or guess missing values. If a metric is unavailable, it must be displayed as `"Data Not Available"`.
* **Rule 2 (Triple Validation)**: Before backend JSON data is delivered to the frontend or compiled into a 27-slide PowerPoint (`.pptx`):
  1. **Pass 1**: Direct extraction from source Excel/CSV files.
  2. **Pass 2**: Cross-sheet totals and device count reconciliation.
  3. **Pass 3**: Independent metric recalculation.

### Stock Hardware Isolation Rule
* **Backend Responsibility**: Detects stock/spare hardware (`Rack: STOCK`, `Location: Inventory`) and attaches `__isStock: true`. Stock devices are strictly excluded from SLA penalties, uptime breach counts, and health score calculations.
* **Frontend Responsibility**: Displays stock devices in dedicated **📦 Stock Inventory List** tables and Site Inspector stock KPI cards so spare inventory is fully visible to CXOs.

### Dual Uptime Engine Rule
* Computed across the $129,600 \text{-minute}$ quarter window ($90 \text{ days} \times 24 \text{ hrs} \times 60 \text{ mins}$):
  * **JFL Uptime % (Excluding Hold Time)**: Uses `Actual Resolution Time (min)`.
  * **Proactive Uptime % (Including Hold Time)**: Uses `Total Resolution Time (min)`.
* Both values are synchronized across backend API endpoints, frontend dashboard cards, and slide presentations.

### Frontend State & Tab Visibility Rule
* **Landing State**: Defaults to the Executive Dashboard overview on initial load.
* **Site Inspection**: Site selector pills (`Bangalore`, `Noida`, `Greater Noida`, etc.) filter all KPI cards, device lists, stock tables, and incident logs in real time.
* **Navigation Bar**: Provides instant access to 4 main tabs:
  1. 📤 **Upload & Generate**: Drag-and-drop workbook processor, AI Excel Audit pre-validator, & report generator.
  2. 📈 **Executive Dashboard**: Interactive 7-section CXO analytics dashboard.
  3. 📜 **Report History**: Output report audit log.
  4. ⚙️ **Client Management**: Multi-client configuration & custom `rules.yaml` editor.

---

## 2. 🛡️ Business Rules & Data Synchronization Audit

### Severity Mapping (`incident_severity_values`)
* Raw incident data in `jfl incidents.xlsx` categorizes severity using `"Core"`, `"Non-Core"`, and `"AP"`.
* Configured in `rules.yaml`:
  * **Critical Incidents**: `["P1", "Critical", "CRITICAL", "High", "HIGH", "1", "Core", "CORE"]` $\rightarrow$ 51 Core Incidents
  * **Major Incidents**: `["P2", "Major", "MAJOR", "Medium", "MEDIUM", "2", "Non-Core", "NON-CORE", "Non Core"]` $\rightarrow$ 38 Non-Core Incidents
  * **Minor Incidents**: `["P3", "P4", "Minor", "MINOR", "Low", "LOW", "3", "AP", "Access Point"]` $\rightarrow$ 274 AP Incidents

### RCA Category Alignment (`rca_category_mapping`)
* Maps raw RCA strings (`Device Power Issues`, `Client Side Activity`, `Third Party Device issue`, `New Configuration`, `Hardware Component Failures`, `Device Boot Issues`) to the 6 standard QBR categories.

### SLA Target Resolution
* Supports both monthly targets (`monthly_uptime_target_percent: 99.9%`) and quarterly targets (`uptime_target_percent: 99.3%`) loaded dynamically via `ruleEngine.js`.

### Synchronized Data Baseline (JFL Q1 FY2026)
* **Total Incidents**: 363
* **Active Operational Devices**: 429 Devices
* **Stock Inventory Devices**: 12 Devices (Excluded from SLA penalties)
* **Overall Uptime %**: 99.40%
* **SLA Compliance %**: 84.15% (68 breaches out of 429 active devices)
* **Health Score**: 85.93 (Label: Good)

---

## 3. 🔬 End-to-End System Verification Report

### Verified Web Portal Routes & Sub-Tabs (`http://localhost:3000`)
* **📋 Executive Summary**: 16 KPI cards fully loaded.
* **🏢 Site Summary & Inspector**: Per-site breakdown across all 8 production sites (`Bangalore`, `Greater Noida`, `Guwahati`, `Hyderabad`, `Mohali`, `Mumbai`, `Nagpur`, `Noida`).
* **🔌 Switch Analytics**: Total switches (155), core/non-core uptime, rackwise uptime summary (Site Name, Monthly Uptime, Quarterly Uptime).
* **📶 AP Analytics**: AP average uptime, total AP incidents (250), unique APs with incidents (102), top outage lists.
* **⚠ Incident Analytics**: 363 incidents, MTTR hours, monthly incident volume trends.
* **🔍 RCA Analytics**: Primary Root Cause (*Device Power Issues*), Category Distribution Chart.
* **📈 SLA Analytics**: Overall SLA compliance (84.15% / Target: 99.3%), breaching device breakdown.

---

## 4. 🤖 Integrated AI Excel Audit & Schema Pre-Validation Engine

### Background Pre-Validation Workflow (`POST /api/analyze-excel`)
* AI Excel Audit runs automatically in the background during file selection in the **`📤 Upload & Generate`** workflow.
* Scans all worksheets, detects sheet roles (**Incident Logs**, **Inventory Registries**), checks column header alignments, and audits for data discrepancies or duplicate ticket conflicts prior to calculation.
* Displays inline **🤖 AI Pre-Validation Audit: Passed** summary badge directly inside the upload dropzone card.

---

## 5. 📊 AI Forensic Study of Excel & CSV Datasets

### Master File Inventory
1. **`jfl incidents.xlsx`** (0.32 MB): 12 Worksheets (`Raw`, `RCA`, `Device Wise Uptime`, `All Location`, `BLR`, `Grater Noida`, `Guwahati`, `Hyd`, `mohali`, `Mumbai`, `Nagpur`, `Noida`). Contains 363 raw incidents and pre-calculated location uptimes.
2. **`JFL Updated Inventory.xlsx`** (0.09 MB): 9 Worksheets (`Updated inventory`, `Gr._Noida`, `Noida`, `Nagpur`, `Mumbai_DC`, `Mohali`, `Hyderabad`, `Guwahati`, `Bangalore`). 441 total devices (429 active + 12 stock).
3. **`SLA_Compliance_Report.csv`** (0.29 MB): 839 raw ticket records with hold times, actual resolution minutes, and total resolution minutes.

---

## 6. ⚙️ How the Raw SLA Compliance File is Processed

### Processing Pipeline Logic
1. **Header Normalization & Ticket Extraction**:
   * Extracts `Ticket Number` or `Ticket ID` (e.g. `PRO/INC/44676`).
   * Normalizes `Device Serial` and resolves site name via `Location` or hostname.
2. **Hardware Swap Resolution**:
   * Scans `Replaced Serial` and `New Serial` columns. Swapped replacement hardware inherits SLA tracking history from original devices.
3. **Stock Device Auto-Isolation**:
   * Scans `Location`, `Rack`, `Hostname`, `DeviceID`, and `DeviceType` for `/stock|inventory|spare|warehouse/i`. Isolated from SLA breach penalties.
4. **Dual Uptime Computation (129,600-Minute Quarter Window)**:
   * **JFL Uptime % (Excl. Hold Time)**: Uses `Actual Resolution Time (min)`.
   * **Proactive Uptime % (Incl. Hold Time)**: Uses `Total Resolution Time (min)`.
5. **SLA Breach Assessment**:
   * Compares effective uptime against target ($99.3\%$). If uptime $< 99.3\%$, flags `__slaBreach = true`.
6. **Triple-Pass Validation**:
   * Validates row counts, cross-checks total device counts across sheets, and recalculates independent metrics prior to dashboard and PPT generation.

---

## 7. 🎯 Multi-Client Account Name Filtering Logic (JFL 424 Incidents)

### Multi-Client Account Isolation Rule
* In multi-client CSV files (`SLA_Compliance_Report.csv` containing 839 rows across `Jubilant Foodworks Ltd (JFL)`, `MMTC`, `Fabtech`, `PNB MetLife`), incident rows must be filtered strictly by `Account Name`.
* When target customer is JFL, raw incident rows are filtered using `/jubilant|jfl/i`.
* **Filtered JFL Incidents Baseline**: **424 Incidents** (423 ticket rows).
* Tickets belonging to other corporate accounts (`MMTC`, `Fabtech`, `PNB MetLife`) are automatically excluded from JFL KPI calculations.

---

## 8. 🏷️ Serial-to-Hostname Mapping Rule

### Serial Number to Hostname Resolution Rule
* Every device serial number is cross-referenced with `JFL Updated Inventory.xlsx` and `SLA_Compliance_Report.csv` to map to its corresponding **`Hostname`** (e.g. `JFL-Guwahati-CORE-02`, `JFL-MOHALI-ACC-SW-02`).
* **Fallback Behavior**: If a device has **no Hostname** (or `Hostname` is empty / N/A), `DeviceID` cleanly falls back to its **Serial Number** (e.g. `FTX240212AB`).
* **Implementation**: Executed automatically in `buildSerialToHostnameMap` in `excelParser.js` and `processData.js` during every file processing pass.

---

## 9. 🤖 Integrated AI Pre-Validation & Excel Audit Workflow Rule

### Workflow Integration Rule
* The AI Excel Audit pass is **not displayed as a separate standalone navigation tab**.
* Instead, it operates automatically as a pre-validation step inside the **`📤 Upload & Generate`** workflow.
* Performs schema validation, discrepancy auditing, duplicate conflict detection, and sheet role verification prior to processing data.

---

## 10. 🚫 Change Request Exclusion & Site Summary Layout Rules

### Change Request Exclusion Rule
* **Change Requests** (`Category`, `RCA`, `Description` containing `/change|change\s*request|^cr$/i`) are **strictly excluded** from Incident Analytics, RCA Analytics, and Incident Counts.
* Change Requests are not classified as operational incidents.

### Rack-wise Switch Uptime Summary Layout Rule
* Display columns: `Site Name`, `Rack Number`, `Switch Count`, `Monthly Uptime %`, `Quarterly Uptime %`.
* `Min Uptime %` and `Max Uptime %` are **removed** per executive specification.

### Site Summary & Inspector Layout Rules
* **Overall Uptime** column is **removed** from `SiteSummaryTable` and Site Inspector KPI cards.
* **Persistent All Sites Table**: Clicking any individual site pill highlights that site row in the main `SiteSummaryTable` while preserving all other site rows in view. Detailed inspection cards and logs render immediately below the main table.

---

## 11. 📊 Board-Level Executive QBR PowerPoint Generation Rules

### Executive Presentation Benchmark & Design Philosophy
* Benchmarked against consulting presentations (Cisco, Deloitte, Accenture, ServiceNow, Microsoft Power BI).
* **Presentation Format**: 45-slide wide-format presentation (`13.33 x 7.5` inches).
* **Strict Visual Standards**:
  - Zero emojis in slides — clean text labels and executive badges only.
  - No plain dashboard dumps or raw long tables. Main deck uses Top 10 summaries, KPI cards, charts, Pareto bars, heatmaps, and ranking scorecards.
  - Full raw lists (complete device inventory, complete switch inventory, complete AP inventory, master raw incident audit trail) are moved exclusively to the **Appendix** slides (Slides 40–44).
  - Every slide includes a consistent navy header bar, gold accent strip, subtitle, reporting period, confidential footer, slide number, and logo.

### 45-Slide Presentation Structure
* **Slide 1**: Cover Page (Gold accent bar, customer branding, classification label, preparation metadata)
* **Slide 2**: Table of Contents (8 structured sections with numbered indices and slide numbers)
* **Slide 3**: Executive Summary (8 KPI cards + AI-generated executive narrative + Top RCA bar chart)
* **Slide 4**: Overall Network Health (Health score display + per-site health score bar charts)
* **Slide 5**: Infrastructure Summary (Devices/Switches/APs per site allocation breakdown table)
* **Slide 6**: Inventory Summary (Active vs. Stock inventory analysis, SLA penalty exclusion notes)
* **Slide 7**: Incident Overview (Incidents by site bar chart + priority distribution breakdown + AI findings)
* **Slide 8**: RCA Pareto Analysis (Horizontal Pareto bar chart + RCA frequency table + remediation recommendations)
* **Slide 9**: RCA Incident Heatmap (Sites × RCA category matrix with color-coded intensity)
* **Slide 10**: SLA Dashboard (SLA compliance score, site-wise SLA compliance table)
* **Slide 11**: Ticket Analytics (KPIs + Top 10 longest/highest priority tickets table + AI resolution insights)
* **Slide 12**: Site Health Ranking (All 8 sites ranked healthiest → critical with status medals)
* **Slide 13**: Risk Assessment (Traffic-light risk classification LOW/MODERATE/ELEVATED/HIGH with recommendations)
* **Slides 14–37 (8 Sites × 3 Slides)**:
  - **Slide 1**: Site Overview (KPI cards + Key Highlights + Key Risks + AI Site Summary narrative)
  - **Slide 2**: Operational Analytics (Switch uptime report, Top 10 switches table, site RCA distribution)
  - **Slide 3**: Incident & Ticket Review (Ticket KPIs, Top 10 incident tickets table, recommended actions)
* **Slide 38**: AI-Generated Recommendations (High / Medium / Low priority remediation plan)
* **Slide 39**: Action Plan Tracker (Priority / Action / Owner / Timeline / Status table)
* **Slides 40–44 (Appendix Section)**:
  - **Slide 40**: Appendix Cover
  - **Slide 41**: Complete Device Inventory Table
  - **Slide 42**: Complete Switch Inventory Table
  - **Slide 43**: Complete Access Point (AP) Inventory Table
  - **Slide 44**: Master Raw Incident Audit Log
* **Slide 45**: Thank You Slide (Corporate closing slide with logo & confidentiality statement)

### Dynamic AI Narrative Engine Rule
* Every major slide ends with a dynamically computed narrative (pure JS, calculated from live data without hardcoding or external APIs).
* Answers: *What happened?*, *Why did it happen?*, *Business impact*, and *What should be done next?*.

