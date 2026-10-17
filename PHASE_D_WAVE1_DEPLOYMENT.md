# Phase D — Wave 1A: Render Native Node.js Chromium PDF Generation Runbook

## 1. Overview
This deployment runbook documents the architecture and operational procedure for binary PDF generation on Render's Native Node.js runtime without Docker containers, `apt-get` system packages, or paid plan upgrades.

By pairing `@sparticuz/chromium` (serverless Chromium binary packaged with all required Linux shared libraries) with `puppeteer-core`, the platform generates print-ready executive PDFs on Linux while preserving full `puppeteer` for local Windows development.

---

## 2. Render Configuration
- **Environment**: Native Node.js Web Service (unchanged; no Docker required).
- **Service Plan**: Free tier (512 MB RAM / 0.1 CPU).
- **Package Management**: Standard `npm install` and `npm start`.
- **System Dependencies**: Zero OS-level packages or custom Dockerfile builds required.

---

## 3. Environment Variables

### Variables to SET on Render Dashboard
| Variable | Value | Purpose |
| :--- | :--- | :--- |
| `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` | `true` | Prevents the default full Puppeteer post-install hook from downloading a ~170 MB browser archive during `npm install` on Render build servers, saving bandwidth and build time. |

### Variables NOT Needed (Delete if set from previous Docker experiments)
| Variable | Status | Reason |
| :--- | :--- | :--- |
| `PUPPETEER_EXECUTABLE_PATH` | **Remove / Unset** | Code dynamically resolves `@sparticuz/chromium.executablePath()` on Linux. |
| `CHROME_BIN` | **Remove / Unset** | No longer referenced or required. |

---

## 4. Architectural Summary of Code Changes (Wave 1A.3)

In `backend/services/pdfGenerator.js`:
1. **Multi-Mode Browser Resolution (`getBrowserLaunchConfig`)**:
   - Replaced legacy static path search `findChromeExecutable()` with dynamic multi-mode detection.
   - **Mode `sparticuz` (Linux Production)**: Uses `puppeteer-core` with `@sparticuz/chromium` flags, viewport, and auto-extracted executable path.
   - **Mode `custom` (Override)**: Uses `process.env.PUPPETEER_EXECUTABLE_PATH` if explicitly configured and verified on disk.
   - **Mode `local` (Windows Development)**: Falls back to full `puppeteer` for Windows developers without needing serverless shims.
2. **Network Idle Render Guarantee**:
   - Replaced `waitUntil: 'domcontentloaded'` with `waitUntil: 'networkidle0'` and a 60-second timeout to ensure all embedded web fonts, chart canvases, CSS assets, and inline resources are fully settled before snapshotting.
3. **Dual-Mode Import Guards**:
   - Safe `try/catch` require blocks for both `puppeteer` and `puppeteer-core`/`@sparticuz/chromium`.

---

## 5. Execution Lifecycle & Performance
1. **Extraction on Launch**:
   - On the first PDF generation request after a cold boot, `@sparticuz/chromium` decompresses the bundled Chromium binary and shared dependencies into `/tmp`.
   - **First PDF Latency**: ~3 to 5 seconds.
2. **Subsequent Invocations**:
   - The uncompressed binary remains cached in `/tmp` across subsequent report requests for the lifetime of the process instance.
   - **Subsequent PDF Latency**: < 2 seconds.

---

## 6. Memory & Resource Budget
- **Available RAM**: 512 MB (Render Free Tier).
- **Peak Consumption**: ~400 MB during concurrent HTML-to-PDF rendering and buffer serialization.
- **Headroom**: ~112 MB margin.
- **Capacity**: Well within limits for the expected workload of 10–20 executive PDFs per month executed sequentially.

---

## 7. Post-Deployment Verification Steps

After deploying the commit to Render:

1. **Trigger PDF Download**:
   - Log into the Executive Dashboard on Render as an authenticated user.
   - Download an Executive QBR PDF for a completed client report (e.g., JFL or MMTC).

2. **Inspect HTTP Logs in Render Dashboard**:
   - Look for the runtime mode log line:
     ```text
     [pdfGenerator] Launching (mode: sparticuz)
     [pdfGenerator] PDF via sparticuz: /tmp/.../Report.pdf (XXXXXXX bytes)
     ```

3. **Verify Downloaded File**:
   - Confirm file extension is `.pdf` (not `.html`).
   - Validate magic bytes in terminal:
     ```bash
     head -c 4 Executive_QBR_Report.pdf
     ```
     *Expected output:* `%PDF`
   - Confirm size is within normal range: **2.0 MB to 4.0 MB**.

---

## 8. Post-Deploy Troubleshooting

### Issue A: "Could not find Chromium binary" or Headless Shell Error
- **Symptom**: Render runtime logs report failure to locate `chrome-headless-shell` or an error starting Chromium with `headless: 'shell'`.
- **Remedy**:
  In `backend/services/pdfGenerator.js`, locate `getBrowserLaunchConfig()`:
  ```javascript
  // Change line:
  headless: 'shell',
  // To:
  headless: true,
  ```
  Commit and push to trigger an immediate automatic redeploy.

### Issue B: Out-Of-Memory (OOM / Error 137)
- **Symptom**: Render container restarts abruptly during PDF export.
- **Remedy**:
  1. Ensure PDFs are generated sequentially (do not trigger batch parallel exports).
  2. Verify no lingering zombie browser instances exist (handled by `try/finally browser.close()`).
  3. If workload increases significantly beyond 20 PDFs/month, upgrade Render instance (e.g. Standard tier with 2 GB RAM).

---

## 9. Rollback Plan
If unexpected regressions occur on Render:
1. Revert the Wave 1A.3 commit:
   ```bash
   git revert HEAD
   git push origin main
   ```
2. Render will rebuild and deploy the previous commit automatically.
3. System will safely fall back to serving print-ready HTML reports (`.html`).

---

## 10. Local Development Note
The full `puppeteer` package remains installed in `package.json` for Windows local development:
- Detects `process.platform === 'win32'`.
- Executes via `mode: 'local'`.
- Developers on Windows do not need any Linux shims or `@sparticuz/chromium` configuration.
