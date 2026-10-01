---
name: ssot-reconciler
description: Extract metrics from a human-authored PDF report and compare
  them against the dashboard JSON output. Reports per-metric divergences
  with page and slide references. Use after generating a new PPT/PDF, or
  whenever the dashboard numbers appear to disagree with the client report.
---

# ssot-reconciler

Compares the human-authored PDF (ground truth) against the machine-generated
`dashboard_data.json` (suspect output). Every discrepancy is reported with
the exact page/slide where it appears.

## When to invoke

- After every PPT/PDF generation
- Before sending a report to the client
- When the dashboard shows numbers that disagree with the human report
- Whenever a stakeholder questions a specific metric

## Inputs

- `humanPdf` — path to the human-authored PDF (required)
- `dashboardJson` — path to `dashboard_data.json` (default:
  `data/dashboard_data.json`)

Usage:

    node scripts/ssot-reconciler.js <humanPdf> [dashboardJson]

## Workflow

1. Extract text from the human PDF, page by page.
2. Parse the Executive Summary table (typically Page 2) into rows:
   Site | No of devices | Proactive Switch Uptime | JFL Switch Uptime |
   Primary RCA Driver (Switches) | AP Incidents (Unique) |
   Primary RCA Driver (AP)
3. Load `dashboard_data.json`.
4. For each site, compare:
   - deviceCount
   - proactiveSwitchUptime
   - jflSwitchUptime
   - apIncidents / uniqueAPsWithIncidents (as "X / Y")
   - primaryRcaSwitches
   - primaryRcaAPs
5. Emit one row per (site, metric):

   | Site | Metric | Human | Dashboard | Delta | Match |

6. Verdict rules:
   - Numeric values: exact match at shown precision. Tolerance 0.
   - Text values (RCA drivers): case-insensitive exact match.
   - "0 / 0" vs "0/0": normalize whitespace before comparison.
   - Any mismatch is a FAIL.

## Rules

- The human PDF is ALWAYS authoritative. Never suggest revising the PDF.
- Never modify `dashboard_data.json`. Report only.
- If a site appears in the PDF but not the JSON (or vice versa), report
  it under "Coverage gap" rather than as a metric mismatch.
- If the PDF is unreadable (scanned image, not text), report
  "PDF NOT PARSEABLE" and stop. Do not attempt OCR.

## Companion script

    node scripts/ssot-reconciler.js path/to/human-report.pdf

Requires `pdf-parse`. If missing, the script prints the install command
and exits with code 2.

Exit code: 0 = all metrics match, 1 = at least one mismatch, 2 = setup error.
