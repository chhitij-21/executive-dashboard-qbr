# Implementation Plan: Fix Vulnerabilities Tab Exact Data & Refresh Button

## Problem Statement
The Vulnerabilities tab displays outdated and inexact data because hardware-to-OS family mapping in `backend/routes/vulnerabilities.js` ignores Catalyst APs, Core switches, WLCs, ISRs, and Firepower firewalls, while MMTC inventory lacks fallback to canonical firewall records. Furthermore, clicking "Sync Cisco API" fails or times out because `fetchAndSave()` triggers over 230 synchronous sequential external LLM and web-scraping calls in `mitigationService.js`, exceeding API rate limits and proxy timeouts.

---

## Files to Touch
1. [`backend/services/mitigationService.js`](file:///c:/Users/Chhitij/Desktop/New%20folder/Executive-Dashboard-QBR-Generator/backend/services/mitigationService.js): Lines 247–346
   - Implement fast, high-accuracy domain heuristic mitigations for all Cisco families (Meraki, IOS XE, Catalyst, IOS, FTD, FMC, ASA, ISE, NX-OS).
   - In `enrichVulnerabilitiesWithMitigation`, apply cache and heuristic mitigations synchronously in < 5ms, and dispatch LLM enrichment asynchronously in the background.
2. [`backend/routes/vulnerabilities.js`](file:///c:/Users/Chhitij/Desktop/New%20folder/Executive-Dashboard-QBR-Generator/backend/routes/vulnerabilities.js): Lines 18–160, 233–235
   - Expand `mapModelToOsFamily` to match all models: `CW*`, `C9*`, `ISR*`, `WS-C*`, `C1-C*`, `FPR*`, `FMC*`, `SNS*`.
   - Update `getClientDashboardData` to support canonical fallback for MMTC (`reports/job_1009f0af-f07b-472d-832d-0aea873ee8e3/dashboard_data.json`).
   - Broaden `cveMatchesOsFamily` to match `cisco secure firewall`, `firepower`, `catalyst`, `cisco ios`, `identity services engine`.
   - Allow authenticated users or dev sessions on `/refresh` with graceful status reporting.
3. [`frontend/src/components/VulnerabilitiesPage.jsx`](file:///c:/Users/Chhitij/Desktop/New%20folder/Executive-Dashboard-QBR-Generator/frontend/src/components/VulnerabilitiesPage.jsx): Lines 110–126, 300–312
   - Ensure the refresh button is visible to all authenticated users.
   - Parse error messages from `res.json()` on non-200 responses.
   - Add success banner/feedback upon sync completion.
4. [`backend/tests/vulnerabilities.test.js`](file:///c:/Users/Chhitij/Desktop/New%20folder/Executive-Dashboard-QBR-Generator/backend/tests/vulnerabilities.test.js):
   - Add comprehensive tests for expanded OS family mapping (CW, C9500, FPR, FMC, SNS) and fast refresh performance (< 5s).

---

## Data Flow & Control Flow Changes
1. **Sync / Refresh Flow**:
   `User clicks Sync` $\rightarrow$ `POST /api/vulnerabilities/refresh` $\rightarrow$ `ciscoPsirtClient.fetchLatestAdvisories(100)` (~2s) $\rightarrow$ `transformAdvisoriesToCveList` $\rightarrow$ `enrichVulnerabilitiesWithMitigation` (instant heuristic + cache lookup) $\rightarrow$ atomic write to `data/vulnerabilities.json` $\rightarrow$ immediate `200 OK` return $\rightarrow$ Frontend re-fetches `/api/vulnerabilities?clientId=...` and renders updated table immediately.
2. **Client Scoping Flow**:
   - `GET /api/vulnerabilities?clientId=client-jfl`: Identifies Meraki + Catalyst + IOS XE + IOS + ISE. Returns 72 matching advisories.
   - `GET /api/vulnerabilities?clientId=client-mmtcpamp`: Identifies Meraki + Catalyst + FTD + FMC. Returns 67 matching advisories (including 51 FMC/FTD CVEs).

---

## Risks and Edge Cases
- **Risk**: Groq rate limits or Cisco network latency blocking the HTTP response.
  - **Mitigation**: Purely heuristic baseline applied synchronously. Zero blocking HTTP calls during mitigation enrichment.
- **Risk**: Tenant isolation regression.
  - **Mitigation**: Models are strictly isolated per client from each client's canonical inventory. Windows or non-Cisco advisories remain 100% excluded.
- **Risk**: Existing 3/3 tests breaking.
  - **Mitigation**: Existing test expectations (e.g. `MX68CW-WW` returns Meraki and excludes IOS XE/Windows) are strictly preserved.

---

## Test Cases to Add / Update
1. **Test Expanded OS Mapping**:
   - `CW9162I` $\rightarrow$ `Cisco IOS XE`
   - `C9500-40X` $\rightarrow$ `Cisco IOS XE`
   - `WS-C2960X` $\rightarrow$ `Cisco IOS`
   - `FPR1140-NGFW-K9` $\rightarrow$ `Cisco FTD`
   - `FMC1700-K9` $\rightarrow$ `Cisco FMC`
   - `SNS-3655-K9` $\rightarrow$ `Cisco ISE`
2. **Test MMTC FMC / FTD Scoping**:
   - Verify `GET /api/vulnerabilities?clientId=client-mmtcpamp` returns FMC and FTD CVEs.
3. **Test Refresh Speed & Reliability**:
   - Verify `fetchAndSave` finishes in < 5 seconds.

---

## Rollback Plan
- Revert changes via `git checkout -- backend/services/mitigationService.js backend/routes/vulnerabilities.js frontend/src/components/VulnerabilitiesPage.jsx`.
