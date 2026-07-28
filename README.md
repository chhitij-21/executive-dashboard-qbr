# Executive Dashboard & Automated QBR Generator

A production-grade system that converts customer Excel data into:
1. A premium real-time executive dashboard
2. A PowerPoint QBR presentation populated from your master template

## Prerequisites
- **Node.js** ≥ 18
- **npm** ≥ 9

## Quick Start

```powershell
# 1. Install all dependencies
npm install

# 2. (Optional) Place your master template
#    Copy master_template.pptx → templates/master_template.pptx

# 3. Start dev server (frontend on :3000, backend on :3001)
npm run dev
```

Then open **http://localhost:3000** in your browser.

## How to Use

1. **Upload** tab → Click or drag-and-drop your Excel workbook (.xlsx / .xls)
2. The system runs **triple validation** and processes your data
3. **Dashboard** tab → KPI cards, uptime chart, RCA breakdown, incident/device tables
4. **Reports** tab → Download the validation report, PowerPoint QBR, and raw JSON

## Excel Workbook Structure

The system auto-detects sheet names containing these keywords:

| Logical Sheet | Detected by | Required columns |
|---|---|---|
| Device Inventory | `device` | `DeviceID`, uptime column |
| Incidents | `incident` | `DeviceID` |
| Sites | `site` | `SiteID` (optional) |
| Metadata | `metadata`, `meta`, `summary` | `Customer`, `Period` (optional) |

### Uptime Column
Any column whose name contains "uptime" is detected automatically.
`#N/A` or blank values with no linked incidents are treated as **100%** per spec.

## PPT Template
Place `master_template.pptx` in the `templates/` folder.
Insert `{{PLACEHOLDER}}` tokens in your slide text boxes.
See `templates/README.md` for the full token list.

## Business Rules (`backend/config/rules.yaml`)
Edit to change:
- SLA uptime target %
- Health score weights
- Severity mapping by device type
- RCA category definitions

## API Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/api/upload` | Upload Excel workbook (multipart/form-data, field: `excel`) |
| GET | `/api/dashboard/:jobId` | Get processed dashboard JSON |
| GET | `/api/ppt/:jobId` | Download generated PowerPoint |
| GET | `/api/report/:jobId` | Download validation report (Markdown) |
| GET | `/api/health` | Health check |

## Accuracy Guarantee
- **Zero assumptions**: every metric traces to workbook → sheet → row → column
- **Triple validation**: structural → cross-sheet → independent recalculation
- Missing data shown as **"Data Not Available"** — never estimated
