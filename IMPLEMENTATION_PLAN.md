# Implementation Plan: Item #9 QoQ Compare (Quarter-over-Quarter Analytics Engine, PPT & UI)

## 1. Problem Statement & Architecture
Enterprise executives reviewing quarterly business reviews require longitudinal comparative analytics to evaluate network reliability and SLA progression over time. Currently, reports are stored and viewed in isolation without structured quarterly indexing, period-over-period delta tracking, or PowerPoint comparative reporting. Item #9 delivers a complete end-to-end QoQ capability:
1. **Strict Standard Quarter Validation**: Enforces exact Indian Fiscal Quarter boundaries (Q1: Apr 1–Jun 30, Q2: Jul 1–Sep 30, Q3: Oct 1–Dec 31, Q4: Jan 1–Mar 31). Non-aligned custom ranges (e.g., Aug 15–Nov 15) are tagged `quarter: 'CUSTOM'`, preventing mathematically corrupted delta calculations.
2. **Robust Server Timezone Fallback**: String-based ISO date extraction (`YYYY-MM-DD`), mathematical IST offset (`UTC+05:30`) fallback when `Intl.DateTimeFormat('Asia/Kolkata')` is unavailable in minimal Docker/Alpine environments, and `tzdata` package documentation.
3. **PPT Generation Integration (CRITICAL)**:
   - `processData.js` resolves the previous quarter dataset and injects the computed `qoqComparison` into the single source of truth (`qbrData`) prior to passing it to `generatePPT`.
   - `pptGenerator.js` leverages PptxGenJS to inject a dedicated **"QUARTER-OVER-QUARTER PERFORMANCE"** slide (with directional $\uparrow / \downarrow$ KPI delta cards, site movement table, and RCA shift summary) and injects site-level QoQ callouts into the per-site slide suite.
4. **Site-Level QoQ Inspection (`SiteInspector.jsx`)**:
   - When drilling into a specific site, `SiteInspector.jsx` displays site-level QoQ deltas and an executive narrative (e.g., *"This site's SLA dropped 2.10% vs last quarter"* or *"Uptime increased by +0.35% with 2 fewer incidents vs last quarter"*).
5. **Deterministic QoQ Eligibility & UI Toggle State**:
   - `/api/dashboard` delivers `is_standard_quarter: boolean`, `has_prior_quarter: boolean`, `qoq_disabled_reason: string | null`, and pre-computed `qoqComparison`.
6. **Frontend State Reset on Client Switch**:
   - `OverviewDashboard.jsx` explicitly resets `isQoQEnabled` to `false` whenever `activeClientId` changes, preventing stuck toggle states when switching between customers.
7. **Division-by-Zero Proof RCA Calculations**:
   - `qoqComparisonService.js` explicitly intercepts `priorCount === 0`, returning deterministic labels (`"New Occurrence (+100%)"` or `"Resolved (-100%)"`), strictly preventing `Infinity` or `NaN`.
8. **Inline Delta Badges & Sparklines**:
   - Displays inline $\uparrow / \downarrow$ directional delta badges and mini SVG sparklines on all 5 main KPI cards when enabled.

---

## 2. Fiscal Calendar, Timezone Fallback & Boundary Spec
### A. Server Timezone Fallback Strategy
1. **ISO Calendar String Extraction (Primary)**:
   For inputs like `YYYY-MM-DD`, year, month, and day are extracted directly via integer splitting:
   ```javascript
   const [y, m, d] = dateStr.split('-').map(Number);
   ```
   This is 100% immune to missing system locale or `tzdata` databases.
2. **Mathematical IST Offset Fallback (Secondary)**:
   For epoch timestamps or ISO strings with time components, calculate IST date parts using numerical offset arithmetic:
   ```javascript
   function getISTDateParts(timestamp) {
     try {
       const formatter = new Intl.DateTimeFormat('en-IN', {
         timeZone: 'Asia/Kolkata',
         year: 'numeric', month: 'numeric', day: 'numeric',
       });
       const parts = formatter.formatToParts(new Date(timestamp));
       return {
         year: Number(parts.find(p => p.type === 'year').value),
         month: Number(parts.find(p => p.type === 'month').value),
         day: Number(parts.find(p => p.type === 'day').value),
       };
     } catch (_) {
       const istEpoch = new Date(timestamp).getTime() + (5.5 * 3600 * 1000);
       const istDate = new Date(istEpoch);
       return {
         year: istDate.getUTCFullYear(),
         month: istDate.getUTCMonth() + 1,
         day: istDate.getUTCDate(),
       };
     }
   }
   ```
3. **Container Environment Requirement**: Document and add `tzdata` in production Dockerfile (`apk add --no-cache tzdata` or `apt-get install -y tzdata`).

### B. Standard Quarter Boundaries (Indian Corporate FY: April 1 to March 31)
- **Q1**: `start_date` = `YYYY-04-01`, `end_date` = `YYYY-06-30` $\rightarrow$ `quarter: 'Q1'`, `fiscal_year: 'FY' + year`, `is_standard_quarter: true`
- **Q2**: `start_date` = `YYYY-07-01`, `end_date` = `YYYY-09-30` $\rightarrow$ `quarter: 'Q2'`, `fiscal_year: 'FY' + year`, `is_standard_quarter: true`
- **Q3**: `start_date` = `YYYY-10-01`, `end_date` = `YYYY-12-31` $\rightarrow$ `quarter: 'Q3'`, `fiscal_year: 'FY' + year`, `is_standard_quarter: true`
- **Q4**: `start_date` = `YYYY-01-01`, `end_date` = `YYYY-03-31` $\rightarrow$ `quarter: 'Q4'`, `fiscal_year: 'FY' + (year - 1)`, `is_standard_quarter: true`

### C. Custom Range Rejection (NO FORCED QUARTER)
- Any non-aligned range (e.g. `2026-08-15` to `2026-11-15`, or `2026-07-01` to `2026-07-31`):
  - `quarter: 'CUSTOM'`, `is_standard_quarter: false`, `fiscal_year: 'CUSTOM'`
  - `qoq_disabled_reason: 'QoQ comparison is only available for standard quarterly periods.'`
- Preceding Quarter Transition:
  - `Q1 FY{Y}` $\rightarrow$ `Q4 FY{Y-1}`
  - `Q2 FY{Y}` $\rightarrow$ `Q1 FY{Y}`
  - `Q3 FY{Y}` $\rightarrow$ `Q2 FY{Y}`
  - `Q4 FY{Y}` $\rightarrow$ `Q3 FY{Y}`

---

## 3. Detailed Files to Touch (Exact Paths & Scope)

### 1. `backend/services/processData.js`
- Implement `deriveQuarterAndFiscalYear(startDate, endDate, label, timestamp)`.
- Attach `quarter`, `fiscal_year`, and `is_standard_quarter` to `report_period` and root `qbrData`.
- **Pre-PPT QoQ Resolution**:
  - Before step 10 & 11 (saving `dashboard_data.json` and calling `generatePPT`), check if `qbrData.report_period.is_standard_quarter === true`.
  - If standard quarter, invoke `historyService.findPreviousQuarterReport(targetClientId, quarter, fiscalYear)`.
  - When prior dataset exists, run `qoqComparisonService.compareQoQ(qbrData, priorQbrData)`.
  - Inject `qbrData.qoqComparison` and `qbrData.has_prior_quarter = true` directly into `qbrData` so both `dashboard_data.json` and `generatePPT(...)` receive the enriched comparison data.
  - If no prior data: `qbrData.has_prior_quarter = false`, `qbrData.qoq_disabled_reason = 'No previous quarterly data available (Initial QBR).'`.

### 2. `backend/services/pptGenerator.js`
- **Slide Builder Update & Safe Fallback Guard (`buildPresentation`)**:
  - Implement strict fallback check:
    ```javascript
    const shouldBuildQoQ = Boolean(
      data.qoqComparison &&
      data.qoqComparison.is_standard_quarter === true &&
      data.qoqComparison.has_prior_quarter === true
    );
    ```
  - **Graceful Fallback**: If `shouldBuildQoQ` is `false` (i.e. `qoqComparison` is null, `has_prior_quarter === false`, or `is_standard_quarter === false`), `buildQoQPerformanceSlide` is **gracefully SKIPPED** (not generated), preventing PPT generation from crashing on null data.
  - If `shouldBuildQoQ` is `true`, generate the new dedicated slide:
    `buildQoQPerformanceSlide(pres, data.qoqComparison, displayPeriod, clientShort, isJFL)`:
    - **Header**: `QUARTER-OVER-QUARTER PERFORMANCE`, `Comparative Reliability & SLA Analytics vs ${qoqComparison.priorPeriod} · ${displayPeriod}`.
    - **KPI Delta Cards**: 5 executive cards matching the web dashboard:
      - Overall Switch Uptime % with $\uparrow / \downarrow$ delta badge
      - JFL Switch Uptime % with $\uparrow / \downarrow$ delta badge
      - Proactive Switch Uptime % with $\uparrow / \downarrow$ delta badge
      - Total Incidents with $\uparrow / \downarrow$ delta badge (green for reduction)
      - SLA Compliance % with $\uparrow / \downarrow$ delta badge
    - **Site Performance Movement Table**:
      - Columns: `Site | Prior Uptime | Current Uptime | Delta | Prior Incidents | Current Incidents | Status`
      - Highlights top improved sites (green) and top degraded sites (red).
    - **RCA Shift Summary Callout**:
      - Lists key incident drivers that improved vs drivers that increased.
  - **Site Overview Slide Enhancement & Fallback (`buildSiteOverviewSlide`)**:
    - Only if `data.qoqComparison?.siteComparisons?.[siteKey]` exists, render site-level QoQ summary block:
      `QoQ vs ${data.qoqComparison.priorPeriod}: ${siteQoQ.narrative}`.
    - If `siteQoQ` is absent, cleanly omit the callout and render standard baseline site slides without throwing.

### 3. `backend/services/historyService.js`
- **Data Migration in `loadHistory()`**:
  - Automatically inspect all historical entries in `reports_metadata.json`. If missing `quarter`, parse dates and backfill `quarter`, `fiscal_year`, and `is_standard_quarter`.
- **Strict Tenant Isolation in `findPreviousQuarterReport(clientId, currentQuarter, currentFiscalYear)`**:
  - Calculates preceding quarter tuple (`Q1 FY{Y}` $\rightarrow$ `Q4 FY{Y-1}`, etc.).
  - **Strict Multi-Tenant Filtering**: Scans completed records filtering strictly by `item.clientId === clientId`. Cross-tenant data leakage is strictly blocked: Tenant A (`client-jfl`) can NEVER match or access Tenant B's (`client-mmtcpamp`) historical data under any circumstance.
  - If `clientId` is missing or no matching tenant record is found, fail closed and return `null`.
  - When a matching report is found, load and return its parsed `dashboard_data.json`.

### 4. `backend/services/qoqComparisonService.js` (NEW FILE)
- Pure comparison engine `compareQoQ(currentQbrData, priorQbrData)`:
  - Fails closed if current or prior report is `is_standard_quarter === false`.
  - Calculates high-level KPI deltas: Overall Uptime %, JFL Switch Uptime %, Proactive Switch Uptime %, SLA Compliance %, Total Incidents, Health Score, At Risk Devices.
  - Directional Polarity: Incident reduction = `improved` (green), uptime reduction = `degraded` (red).
  - **RCA Category Normalization (Deduplication & Sanitization)**:
    - Normalizes raw RCA categories using `normalizeRcaCategory(cat)`:
      `cat ? String(cat).trim().toLowerCase().replace(/\s+/g, ' ') : 'unspecified'`
    - Treats `"Power"`, `"power"`, and `"Power "` as the identical canonical bucket, preserving the cleanest display label (Title Case).
    - Prevents casing and whitespace mismatches from triggering false `"New Occurrence (+100%)"` flags.
  - **Safe RCA Shift Analysis (Division-by-Zero Protected)**:
    - `priorCount === 0 && currentCount > 0` $\rightarrow$ `pctChange: 100.0`, `changeLabel: 'New Occurrence (+100%)'`.
    - `priorCount > 0 && currentCount === 0` $\rightarrow$ `pctChange: -100.0`, `changeLabel: 'Resolved (-100%)'`.
    - `priorCount === 0 && currentCount === 0` $\rightarrow$ `pctChange: 0.0`, `changeLabel: 'Unchanged (0%)'`.
    - Standard: `Number((((current - prior) / prior) * 100).toFixed(2))`.
  - **Site-Level Comparison Map (`siteComparisons`)**:
    - For every site in `currentQbrData.siteSummary`:
      - Match against `priorQbrData.siteSummary` via normalized site name.
      - Calculate `uptimeDelta = Number((currUptime - priorUptime).toFixed(2))`.
      - Calculate `incidentDelta = currIncidents - priorIncidents`.
      - Calculate `slaDelta = Number((currSla - priorSla).toFixed(2))`.
      - Generate executive narrative string:
        - If SLA dropped: `"This site's SLA dropped ${Math.abs(slaDelta)}% vs last quarter"`.
        - If uptime increased & incidents reduced: `"Uptime increased by +${uptimeDelta}% with ${Math.abs(incidentDelta)} fewer incidents vs last quarter"`.
        - If incidents increased: `"Incidents increased by +${incidentDelta} vs last quarter"`.
        - If stable: `"Operational performance remained stable vs last quarter"`.
      - Determine site status: `'improved' | 'degraded' | 'stable'`.
  - Sparklines coordinate generator: `[{ period: 'Q1 FY2026', value: 99.5 }, { period: 'Q2 FY2026', value: 99.85 }]`.

### 5. `backend/index.js`
- **Legacy Reports On-the-Fly Computation & Cache Guard in `/api/dashboard`**:
  - Existing legacy reports in `dashboard_data.json` do NOT have `qoqComparison` pre-computed.
  - The `/api/dashboard` handler inspects incoming/loaded `qbrData`:
    1. If `qbrData.report_period` lacks `quarter`, `fiscal_year`, or `is_standard_quarter`, derive them on-the-fly via `deriveQuarterAndFiscalYear(...)`.
    2. If `qbrData.qoqComparison === undefined`:
       - If `qbrData.report_period.is_standard_quarter === true`:
         - Lookup prior quarter via `historyService.findPreviousQuarterReport(qbrData.clientId || 'client-jfl', quarter, fiscalYear)`.
         - If prior dataset exists:
           - Dynamically compute `qoqComparison = qoqComparisonService.compareQoQ(qbrData, priorReport)`.
           - Attach `qbrData.qoqComparison = qoqComparison`, `qbrData.has_prior_quarter = true`.
         - If no prior dataset found:
           - Set `qbrData.qoqComparison = null`, `qbrData.has_prior_quarter = false`, `qbrData.qoq_disabled_reason = 'No previous quarterly data available (Initial QBR).'`.
       - If `is_standard_quarter === false`:
         - Set `qbrData.qoqComparison = null`, `qbrData.has_prior_quarter = false`, `qbrData.qoq_disabled_reason = 'QoQ comparison is only available for standard quarterly periods.'`.
    3. Guarantees that `/api/dashboard` NEVER returns `undefined` for `qoqComparison` or crashes the frontend when viewing legacy reports.
- In `/api/ppt/latest` & `/api/dashboard/latest`: ensure dynamically regenerated PPT files receive `qoqComparison`.
- Endpoint `GET /api/qoq/compare` validates standard quarter boundaries, strictly enforces tenant context from `req.tenantId` / `req.query.clientId`, and returns comparison payload.

### 6. `frontend/src/components/OverviewDashboard.jsx`
- **Client Switch Reset**:
  ```javascript
  useEffect(() => {
    setIsQoQEnabled(false);
  }, [activeClientId, data?.clientId, data?.client_id, data?.customerName]);
  ```
- Read `data.is_standard_quarter`, `data.has_prior_quarter`, and `data.qoq_disabled_reason`.
- Toggle switch disabled when `qoq_disabled_reason !== null`, showing title tooltip:
  - If custom: `"QoQ comparison is only available for standard quarterly periods."`
  - If initial: `"No previous quarterly data available (Initial QBR)."`
- When enabled and toggled ON, render inline $\uparrow / \downarrow$ delta badges and mini SVG sparklines under each KPI card.

### 7. `frontend/src/components/SiteInspector.jsx`
- Extract `siteQoQ = data?.qoqComparison?.siteComparisons?.[siteId]`.
- When `siteQoQ` exists:
  - Render a prominent **QoQ Operational Progression Banner** right beneath the site header:
    - Display prior period label, uptime delta badge, incident delta badge, SLA status progression.
    - Highlight the dynamic narrative (e.g., *"This site's SLA dropped 2% vs last quarter"*).
  - Attach inline delta badges to the site's KPI cards (`Incident Free %`, `Health Score`, `Active Operational Devices`).

### 8. `frontend/src/components/KpiCard.jsx`
- Accept optional `sparklineData` array and `deltaBadge` object (`{ value, percent, direction, label }`).

### 9. `frontend/src/components/QoQCompareModal.jsx` (NEW FILE)
- Full side-by-side comparative modal. If opened for a `CUSTOM` period, displays informational alert explaining the requirement for standard quarters.
- **RCA Category Shift Visual Table & Graceful Empty State**:
  - Explicitly renders an RCA Shift table/cards showing:
    - `Category Name` (canonical normalized title)
    - `Prior Quarter Incidents`
    - `Current Quarter Incidents`
    - `Shift Delta` with visual arrows ($\uparrow$ increase / red, $\downarrow$ reduction / green, $\leftrightarrow$ unchanged / gray)
    - `Percentage Change` (`-50.0%`, `+100% (New Occurrence)`, `Resolved (-100%)`, `0%`)
  - **Graceful Empty State**: If no RCA categories shifted or `rcaShifts.length === 0`, display a prominent executive callout:
    `"No significant RCA shifts detected between ${priorPeriod} and ${currentPeriod}. Root cause distribution remained consistent."`
    Prevents empty table shells or broken UI layouts.

### 10. `frontend/src/components/Topbar.jsx`
- Add `<BarChart3 size={16} />` icon and `"QoQ Compare"` button (UTF-8 safe).

### 11. Frontend Test Infrastructure Setup & Component Test (`frontend/src/__tests__/OverviewDashboard.test.jsx`)
- **Frontend Test Environment Setup**:
  - Install devDependencies in `frontend/`: `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`.
  - Create `frontend/vitest.config.js` configuring jsdom test environment and `@testing-library/jest-dom` matchers.
  - Add `"test": "vitest run"` script to `frontend/package.json` and add `"test:frontend": "cd frontend && npm test"` to root `package.json`.
- **Real React Component Integration Test (`frontend/src/__tests__/OverviewDashboard.test.jsx`)**:
  - Renders `<OverviewDashboard />` with mock dashboard data and `activeClientId="client-jfl"`.
  - Simulates user clicking QoQ toggle to turn it ON (`isQoQEnabled = true`).
  - Re-renders with changed prop `activeClientId="client-mmtcpamp"`.
  - Verifies that `isQoQEnabled` automatically resets to `false` (toggle unchecked), ensuring real component-level verification in a simulated DOM environment.

### 12. `backend/tests/qoqComparison.test.js` (NEW FILE)
- TDD unit tests covering exact boundary validation, `CUSTOM` tagging for non-standard ranges, timezone math fallback, `historyService` migration, exact preceding quarter transitions, delta math, directional polarity, RCA category normalization, RCA division-by-zero protection, site-level delta calculations, and PPT presentation integration.

---

## 4. Frontend Control Flow & Disabled State Matrix
| Scenario | `is_standard_quarter` | `has_prior_quarter` | Toggle State | Tooltip Message |
| :--- | :---: | :---: | :---: | :--- |
| **Custom Date Range (e.g. 15 Aug – 15 Nov)** | `false` | `false` | **Disabled** | *"QoQ comparison is only available for standard quarterly periods."* |
| **Single Month (e.g. 1 Jul – 31 Jul)** | `false` | `false` | **Disabled** | *"QoQ comparison is only available for standard quarterly periods."* |
| **First Standard Quarter Upload (No Prior Data)** | `true` | `false` | **Disabled** | *"No previous quarterly data available (Initial QBR)."* |
| **Standard Quarter with Prior Quarter on Record** | `true` | `true` | **Enabled** | *"Compare performance against preceding quarter."* |

---

## 5. Risks and Edge Cases
- **Legacy Reports Missing Pre-Computed QoQ Data**:
  - *Risk*: Reports generated before Item #9 lack `qoqComparison` in their `dashboard_data.json`. Directly reading this in `/api/dashboard` would return `undefined` and crash the UI.
  - *Mitigation*: On-the-fly lazy fallback in `/api/dashboard` detects missing comparison data on legacy reports and computes it via `historyService` before returning the response.
- **RCA Shift Table Empty Shells**:
  - *Risk*: When no categories shift between consecutive quarters, an empty table or broken UI shell is displayed.
  - *Mitigation*: Graceful empty state alert in `QoQCompareModal.jsx` explaining that root cause distributions remained consistent.
- **Frontend Test Runner Absence**:
  - *Risk*: Absence of a DOM/Component test harness prevents testing real React state lifecycles and hook behaviors.
  - *Mitigation*: Formal installation of `vitest`, `jsdom`, and `@testing-library/react` in `frontend/` to run genuine DOM component tests.
- **RCA Category Fragmentation & False New Occurrences**:
  - *Risk*: Discrepancies in casing or whitespace (e.g., `"Power"` vs `"power "` vs `"POWER"`) could falsely segment identical root causes, skewing pareto charts and producing false `"New Occurrence (+100%)"` flags.
  - *Mitigation*: Mandatory `normalizeRcaCategory` trimming and case-folding in `qoqComparisonService.js` before grouping and diffing categories across quarters.
- **Multi-Tenant Cross-Contamination**:
  - *Risk*: A multi-tenant environment could leak Tenant B's uptime or incidents into Tenant A's QoQ comparison if history searches are unconstrained.
  - *Mitigation*: Strict tenant filtering in `historyService.findPreviousQuarterReport` asserting exact `clientId` equality. Fail closed if tenant is missing.
- **Performance Degradation & Computational Overhead**:
  - *Risk*: Unconditionally running deep multi-site delta comparisons on every `/api/dashboard` request could degrade server latency.
  - *Mitigation*: Lazy computation guard: only calculate `qoqComparison` when `has_prior_quarter === true`. Skip computation entirely for initial or custom quarter runs.
- **PPT Slide Fallback & Crash Prevention (Missing / Custom Quarters)**:
  - *Risk*: A client running their initial QBR report or using a custom date range has `qoqComparison: null` or `has_prior_quarter: false`. Dereferencing missing properties during presentation building will crash the PPT generator and corrupt export downloads.
  - *Mitigation*: Strict Boolean guard `shouldBuildQoQ` in `pptGenerator.js`. If false, `buildQoQPerformanceSlide` is gracefully skipped, and per-site slides render standard baseline metrics with zero exceptions.
- **PPT Slide Synchronization**:
  - *Risk*: Pre-generated PPT does not include QoQ slide if generated before comparison completes.
  - *Mitigation*: Comparison is computed directly inside `processData.js` *prior* to `generatePPT` invocation, ensuring 100% synchronization between dashboard JSON and PPT deck.
- **Site-Level Name Mismatches**:
  - *Risk*: A site might be named slightly differently across quarters (e.g. "Greater Noida" vs "GNoida").
  - *Mitigation*: Site-level comparison in `qoqComparisonService.js` leverages canonical `normalizeSiteName` to ensure consistent entity resolution.
- **Client Switch State Stagnation**:
  - *Mitigation*: Explicit `useEffect` resets `isQoQEnabled` to `false` whenever `activeClientId` or `data.clientId` changes.
- **RCA Division by Zero**:
  - *Mitigation*: Guard clauses explicitly intercept `priorCount === 0`, returning deterministic labels and percentages without `Infinity` or `NaN`.
- **Missing `tzdata` in Docker/Node**:
  - *Mitigation*: Pure string splitting on `YYYY-MM-DD` and numerical offset math (`+5.5h`) guarantees zero reliance on operating system locale databases.

---

## 6. Test Cases to Add / Update
1. `backend/tests/qoqComparison.test.js`:
   - Test 1: Standard Quarter Validation: `2026-04-01` to `2026-06-30` tags `Q1 FY2026` with `is_standard_quarter: true`.
   - Test 2: Custom Period Validation: `2026-08-15` to `2026-11-15` tags `CUSTOM` with `is_standard_quarter: false` and disabled reason.
   - Test 3: Monthly Range Validation: `2026-07-01` to `2026-07-31` tags `CUSTOM` with `is_standard_quarter: false`.
   - Test 4: Timezone offset math fallback converts UTC boundary without `Intl` exception.
   - Test 5: `historyService` legacy migration: backfills `quarter`, `fiscal_year`, and `is_standard_quarter` on unmigrated records.
   - Test 6: `findPreviousQuarterReport` accurately finds preceding quarter (`Q1 FY26` $\rightarrow$ `Q4 FY25`, `Q2 FY26` $\rightarrow$ `Q1 FY26`) and refuses search if current is `CUSTOM`.
   - Test 7: **Strict Multi-Tenant Isolation Test**: Verifies `findPreviousQuarterReport` for Tenant B (`client-mmtcpamp`) never returns Tenant A's (`client-jfl`) historical report even if Tenant A has data for that quarter.
   - Test 8: `compareQoQ` calculates exact KPI deltas and directional polarity (`improved` vs `degraded`).
   - Test 9: **RCA Normalization Test**: Proves that `"Power"`, `"power"`, and `"Power "` coalesce into a single category bucket without producing false "New Occurrence" records.
   - Test 10: **RCA Division-by-Zero Test**: Prior count 0 $\rightarrow$ new occurrence (+100%), count drop to 0 $\rightarrow$ resolved (-100%), both 0 $\rightarrow$ 0% (no NaN or Infinity).
   - Test 11: **Site-Level QoQ Calculation Test**: Computes site uptime delta, incident delta, and produces exact narrative (e.g. SLA drop).
   - Test 12: `compareQoQ` generates sparkline coordinate series for all KPIs.
   - Test 13: **Lazy Computation Performance Guard Test**: Verifies that `/api/dashboard` and QoQ engine skip heavy computation when `has_prior_quarter === false`.
   - Test 14: **PPT Generation Integration Test**: Verifies `buildPresentation` with `qoqComparison` outputs the QoQ slide and site delta callouts cleanly without PptxGenJS errors.
   - Test 15: **PPT Fallback Test for Missing / Initial / Custom Quarters**: Verifies that generating a PPT for a client with NO prior quarter (`qoqComparison: null`, `has_prior_quarter: false`, or `is_standard_quarter: false`) does not throw an error, gracefully skips the QoQ slide, and completes presentation generation successfully.
   - Test 16: **Legacy Dataset On-the-Fly QoQ Computation Test**: Simulates loading an older `dashboard_data.json` without `qoqComparison`. Verifies `/api/dashboard` computes and returns valid comparison data on-the-fly without returning `undefined`.
   - Test 17: API endpoint `GET /api/qoq/compare` returns 200 with structured comparison, site comparisons, sparklines, and disabled reasons.
2. `frontend/src/__tests__/OverviewDashboard.test.jsx`:
   - Test 18: **Real React Component Toggle Reset Test**: Renders `<OverviewDashboard />` using `@testing-library/react`. Toggles QoQ ON, triggers `activeClientId` prop change, and asserts the toggle state resets to `false`.
3. Master regression:
   - Ensure all 260+ existing tests pass, frontend Vitest tests pass, and frontend production build succeeds with 0 errors.

---

## 7. Rollback Plan
- Revert via `git checkout HEAD -- backend/ frontend/` back to commit `5b1267c`.
