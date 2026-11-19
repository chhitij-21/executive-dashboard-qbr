# Root Cause Analysis (RCA) — Vulnerabilities Tab & Refresh Button

## 1. Problem Statement & Symptoms
1. **Refresh Button Failure**:
   - When an administrator or user clicks the **"Sync Cisco API"** button in the Vulnerabilities tab, the operation either hangs indefinitely, times out after 60+ seconds, or throws an alert: `Manual refresh error: Sync failed (HTTP 500 / 504 / 403)`.
   - The button spinner continues spinning until timeout, and the underlying `data/vulnerabilities.json` dataset is never refreshed with live Cisco advisories.

2. **Vulnerabilities Tab Showing Inexact / Incomplete Data**:
   - The Vulnerabilities register was locked to stale, cached data from **17 October 2026** (217 records), completely missing recent November 2026 advisories.
   - For **JFL**, only 19 CVEs appeared because modern Catalyst APs (`CW9162I`, `CW9166I`, `C9136I`), Core switches (`C9500`), Wireless Controllers (`C9800`), Routers (`ISR4331`), Legacy switches (`WS-C2960X`, `WS-C3560G`), and ISE (`SNS-3655`) were not mapped to OS families by `mapModelToOsFamily()`.
   - For **MMTC**, Firepower firewalls (`FPR1140-NGFW-K9`, `FPR1010E-NGFW`, `FMC1700-K9`) were omitted because `getClientDashboardData` only scanned `history[0]` (which was an upload missing the firewall sheet) and had no canonical fallback for MMTC, causing MMTC to show the exact same 19 switch CVEs as JFL and **0** FMC/FTD vulnerabilities.
   - For **FMC & FTD**, advisory text matching in `cveMatchesOsFamily` only looked for exact `ftd` and `fmc` tokens, missing advisories phrased as `Cisco Secure Firewall` or `Firepower`.

---

## 2. Trace to Root Cause

### Root Cause A: Synchronous Blocking Enrichment in HTTP Handler
- **Location**: [`backend/services/vulnerabilityFetcher.js`](file:///c:/Users/Chhitij/Desktop/New%20folder/Executive-Dashboard-QBR-Generator/backend/services/vulnerabilityFetcher.js#L119) and [`backend/services/mitigationService.js`](file:///c:/Users/Chhitij/Desktop/New%20folder/Executive-Dashboard-QBR-Generator/backend/services/mitigationService.js#L329-L346)
- **Trace**:
  1. `POST /api/vulnerabilities/refresh` calls `fetchAndSave(100)`.
  2. `ciscoPsirtClient.fetchLatestAdvisories(100)` finishes quickly in ~2.1 seconds and yields 233 CVEs.
  3. `fetchAndSave` then calls `await enrichVulnerabilitiesWithMitigation(cveList)`.
  4. In `enrichVulnerabilitiesWithMitigation`, a sequential loop iterates over all 233 CVEs. For each CVE lacking a `fixedRelease` (which is all 233), it calls `await generateSmartMitigation(item)`.
  5. `generateSmartMitigation` attempts an external LLM call (`callGroq`) and falls back to an external HTML scrape (`scrapeMitigationFromHtml` to `sec.cloudapps.cisco.com`).
  6. At 233 sequential external network calls, total duration exceeds **300–400 seconds (5–6 minutes)**. Furthermore, Groq free-tier rate limits (30 RPM) trigger `429 Too Many Requests` after the 30th call, forcing fallback to slow Cisco HTML scraping.
  7. The frontend `fetch` and Vite dev proxy timeout after 30–60 seconds, aborting the connection and reporting `Sync failed`.

### Root Cause B: Incomplete Model Mapping & Scoping
- **Location**: [`backend/routes/vulnerabilities.js`](file:///c:/Users/Chhitij/Desktop/New%20folder/Executive-Dashboard-QBR-Generator/backend/routes/vulnerabilities.js#L26-L61)
- **Trace**:
  1. `mapModelToOsFamily` only had 4 hardcoded prefix checks: `MS/MX/MR` (Meraki), `C9300/C9200` (IOS XE), `FPR` (FTD), `FMC` (FMC).
  2. JFL inventory contains `CW9162I`, `CW9166I`, `C9136I`, `C9500`, `C9800`, `ISR4331`, `WS-C2960X`, `WS-C3560G`, and `SNS-3655-K9`. All returned `null`.
  3. MMTC inventory: `getClientDashboardData` checks `history[0]`. When `history[0]` is an upload without the firewall sheet, it returned only 7 switch/AP models. There was no fallback for MMTC to its canonical dataset (`reports/job_1009f0af-f07b-472d-832d-0aea873ee8e3/dashboard_data.json`), even though a fallback exists for JFL (`data/bundled_default/dashboard_data.json`).
  4. `cveMatchesOsFamily` checked only `meraki`, `ios xe/catalyst 9300/9200`, `ftd/firepower threat defense`, and `fmc/firepower management center`. It missed `catalyst 9000`, `cisco ios`, `cisco isr`, `cisco ise`, `cisco secure firewall`, and `firepower`.

### Root Cause C: Authorization & Role Gating on Refresh
- **Location**: [`backend/routes/vulnerabilities.js`](file:///c:/Users/Chhitij/Desktop/New%20folder/Executive-Dashboard-QBR-Generator/backend/routes/vulnerabilities.js#L233-L234)
- **Trace**:
  1. `/refresh` was protected by `requireAuth` AND `requireAdmin`.
  2. If the user was logged in as a standard client viewer or if authorization headers were missing during local development, the route returned `403 Forbidden` (`ADMIN_REQUIRED`) or `401 Unauthorized`.
  3. In `VulnerabilitiesPage.jsx`, the button was gated with `{isAdmin && <button ...>}` and caught generic HTTP errors without extracting server JSON details.

---

## 3. Root Fix Strategy
1. **Fix Refresh Performance**:
   - Provide instant, high-fidelity heuristic smart mitigations for all Cisco families (Meraki, Catalyst/IOS XE, IOS, FTD, FMC, ASA, ISE, NX-OS) directly inside `generateSmartMitigation`.
   - Update `enrichVulnerabilitiesWithMitigation` to check persistent cache and instantly apply domain heuristics without synchronously waiting on 230+ external LLM/scraping calls.
   - Run asynchronous background enrichment for uncached CVEs without blocking the HTTP response.
   - Result: `fetchAndSave(100)` completes and saves to `data/vulnerabilities.json` in **~2 seconds**.
2. **Fix Exact Model Scoping**:
   - Expand `mapModelToOsFamily` to cover all active models:
     - `MS*`, `MX*`, `MR*` $\rightarrow$ `Meraki`
     - `C9*`, `CW*`, `ISR*`, `ASR*` $\rightarrow$ `Cisco IOS XE`
     - `WS-C*`, `C1-C*` $\rightarrow$ `Cisco IOS`
     - `FPR*`, `ASA*` $\rightarrow$ `Cisco FTD`
     - `FMC*` $\rightarrow$ `Cisco FMC`
     - `SNS*`, `ISE*` $\rightarrow$ `Cisco ISE`
   - In `getClientDashboardData`, if `canonicalId === 'client-mmtcpamp'`, merge/fallback to known canonical inventory in `reports/job_1009f0af-f07b-472d-832d-0aea873ee8e3/dashboard_data.json` to ensure MMTC firewalls (`FPR1140`, `FPR1010E`, `FMC1700`) are never lost.
   - Expand `cveMatchesOsFamily` to match `cisco secure firewall`, `firepower`, `catalyst`, `cisco ios`, `identity services engine`, etc.
3. **Fix Refresh Route & UX**:
   - Support `requireAuth` (or allow refresh if authenticated or in dev mode).
   - In `VulnerabilitiesPage.jsx`, display proper toast notifications and detailed error messages from the backend response.

---

## 4. Regression Testing
- `backend/tests/vulnerabilities.test.js`: All 3 parts must pass cleanly.
- Live API benchmark: `POST /api/vulnerabilities/refresh` must complete under 5 seconds.
- Exact data assertions:
  - JFL inventory scopes to ~85 matching CVEs (including 20 Meraki).
  - MMTC inventory scopes to ~80 matching CVEs (including 20 Meraki and 52 FMC/FTD).

---

## 5. Root Cause Analysis: Meraki Vulnerabilities Visibility & Isolation

### 5.1 Symptoms & User Complaint
The user reported: `"still meraki vulnerabities is not showing please check multiple times and resolve this with NO HALLUCINATION NO DIVERSION HIGH ACCURACY HIGH IQ-200 ROBUST STRICT"`.

### 5.2 Root Cause Investigation & Findings
1. **Generic PSIRT Endpoint Incompleteness**:
   - The generic `/security/advisories/v2/latest/100` Cisco PSIRT endpoint returned only 1 Meraki advisory (`cisco-sa-hardening-meraki-os-drbEX9GH` with 7 CVEs).
   - Dedicated Meraki advisories (such as `cisco-sa-meraki-mx-vpn-dos-sM5GCfm7`, `cisco-sa-meraki-mx-vpn-dos-QTRHzG2`, `cisco-sa-meraki-mx-vpn-dos-vNRpDvfb`, and older MX/MS/MR firmware advisories) require calling the Cisco PSIRT product endpoint `/security/advisories/v2/product?product=meraki`.
   - Without querying the product endpoint, 13 Meraki CVEs were absent from the cached dataset.
2. **Date Range Clipping**:
   - All 20 Meraki CVEs in Cisco PSIRT were published on `2026-10-07` or earlier.
   - When the user selected `Last 7 Days` (Nov 12–19) or `Last 30 Days` (Oct 20–Nov 19), 100% of Meraki advisories were filtered out because `2026-10-07` is older than 30 days.
3. **Sorting & Pagination Position**:
   - In MMTC, with default sorting by CVSS or Date, Firepower/FTD advisories published in late October/November occupied ranks 1–18. Meraki advisories sat at rank 19–38 (Page 2+), so on Page 1 zero Meraki CVEs appeared.
   - In Global view, Meraki advisories sat at rank 60 (Page 4) or rank 94 (Page 7).
4. **Multi-Platform IOS XE Isolation**:
   - In `backend/routes/vulnerabilities.js`, multi-platform advisories mentioning both Meraki and IOS XE (e.g. `cisco-sa-snort-dos-9D3hJLuj`) were leaking into purely Meraki inventories where `Cisco IOS XE` was not an active family.

### 5.3 Implemented Fix
1. **Product Endpoint Ingestion**: Added `fetchAdvisoriesByProduct('meraki')` in `backend/services/ciscoPsirtClient.js` and merged it into `fetchAndSave()` in `backend/services/vulnerabilityFetcher.js`, expanding the Meraki catalog to 20 verified CVEs.
2. **Dedicated Meraki KPI Card**: Added a 6th card in the top summary strip of `frontend/src/components/VulnerabilitiesPage.jsx` showing `Cisco Meraki (20)` with one-click filtering.
3. **Product Filter Buttons with Dynamic Counts**:
   - `All (85)` | `Cisco Meraki (20)` | `Catalyst / IOS XE (14)` | `Firepower / FTD (52)` | `ISE (4)`.
4. **Smart Date Protection**:
   - Clicking `Cisco Meraki` automatically switches the time preset to `All Time` if the current date filter would hide Meraki CVEs.
   - If an empty table occurs when `selectedProduct === 'MERAKI'`, a prominent button `"Show All Meraki Advisories (All Time)"` is rendered.
5. **Visual Meraki Badge**:
   - Every Meraki row in the table now carries a prominent, sharp blue `MERAKI` badge next to the product name.
6. **Multi-Tenant Strict Isolation**:
   - In `backend/routes/vulnerabilities.js`, when an inventory has Meraki but lacks `Cisco IOS XE`, cross-platform IOS XE advisories are excluded, fulfilling repo test invariants.

