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
* **Navigation Bar**: Provides instant access to 5 main tabs:
  1. 📤 **Upload & Generate**: Drag-and-drop workbook processor & report generator.
  2. 📈 **Executive Dashboard**: Interactive 7-section CXO analytics dashboard.
  3. 🤖 **AI Excel Audit**: AI Schema & Column Mapping Inspector.
  4. 📜 **Report History**: Output report audit log.
  5. ⚙️ **Client Management**: Multi-client configuration & custom `rules.yaml` editor.

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
* **🔌 Switch Analytics**: Total switches (155), core/non-core uptime, rackwise uptime summary.
* **📶 AP Analytics**: AP average uptime, total AP incidents (250), unique APs with incidents (102), top outage lists.
* **⚠ Incident Analytics**: 363 incidents, MTTR hours, monthly incident volume trends.
* **🔍 RCA Analytics**: Primary Root Cause (*Device Power Issues*), Category Distribution Chart.
* **📈 SLA Analytics**: Overall SLA compliance (84.15% / Target: 99.3%), breaching device breakdown.
* **🤖 AI Excel Audit**: AI Schema & Column Mapping Inspector tab.

---

## 4. 🤖 Complete Backend + Frontend AI Excel Audit Feature

### Backend Endpoint (`POST /api/analyze-excel`)
* Accepts any `.xlsx`, `.xls`, or `.csv` file.
* Scans all worksheets, row counts, column header structures, and detects sheet roles (**Incident Logs**, **Inventory Registries**, **Location Sheets**).
* Auto-maps standard metric fields (`Ticket ID`, `Device Serial`, `Location`, `RCA`, `Resolution Mins`).
* Generates sample 3-row preview and RCA breakdown summary.

### Frontend Component (`ExcelAnalyzer.jsx`)
* Interactive drop-zone for file analysis.
* Metadata cards grid, detected sheet roles display, resolved schema table, RCA distribution preview, and multi-worksheet data inspector.

---

## 5. 📊 AI Forensic Study of Excel & CSV Datasets

### Master File Inventory
1. **`jfl incidents.xlsx`** (0.32 MB): 12 Worksheets (`Raw`, `RCA`, `Device Wise Uptime`, `All Location`, `BLR`, `Grater Noida`, `Guwahati`, `Hyd`, `mohali`, `Mumbai`, `Nagpur`, `Noida`). Contains 363 raw incidents and pre-calculated location uptimes.
2. **`JFL Updated Inventory.xlsx`** (0.09 MB): 9 Worksheets (`Updated inventory`, `Gr._Noida`, `Noida`, `Nagpur`, `Mumbai_DC`, `Mohali`, `Hyderabad`, `Guwahati`, `Bangalore`). 441 total devices (429 active + 12 stock).
3. **`SLA_Compliance_Report.csv`** (0.29 MB): 839 raw ticket records with hold times, actual resolution minutes, and total resolution minutes.

### Root Cause Distribution (363 Tickets)
1. **Device Power Issues**: 191 incidents (52.6%) $\rightarrow$ Primary RCA (All) & Primary RCA for APs (57.3%)
2. **Client Side Activity**: 112 incidents (30.9%)
3. **New Configuration**: 24 incidents (6.6%)
4. **Third Party Device issue**: 13 incidents (3.6%)
5. **Device Boot Issues**: 6 incidents (1.7%)
6. **Others / Software Bugs / Component Failures**: 17 incidents (4.6%)

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
