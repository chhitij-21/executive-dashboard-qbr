# Executive Dashboard & Automated QBR Generator — Agent Guidelines & Memory

## Project Mission & Core Objective
Build and maintain a production-grade **Executive Dashboard** and **Automated Quarterly Business Review (QBR) Generator** that converts customer Excel data (`Incidents`, `Inventory`, `SLA Compliance CSVs`) into:
1. An interactive executive web portal (`React`, `Node.js`, `Express`).
2. An automated 27-slide PowerPoint presentation matching the master template.

---

## Mandated Core Principles

### Rule 1 — Zero Assumptions & 100% Data Integrity
* Accuracy Target is **100%**. Speed is secondary.
* No generated, estimated, or hardcoded metrics allowed. Every number must originate from uploaded customer Excel/CSV files.
* Missing data must be displayed as `"Data Not Available"` or flagged for user review.

### Rule 2 — Triple Validation
Before any value reaches the Dashboard or PPT:
1. **Pass 1**: Read directly from source Excel/CSV.
2. **Pass 2**: Cross-compare with related sheets (totals, device counts, site breakdowns).
3. **Pass 3**: Recalculate independently to confirm metric consistency.

### Rule 3 — Active vs. Stock Device Isolation
* Stock/spare devices (`Rack: STOCK`, `Location: Inventory`) must be isolated from SLA breach calculations and health score penalties.
* Stock devices are tracked under Stock Inventory lists.

### Rule 4 — Configurable Business Rules Engine (`rules.yaml`)
* All SLA targets, RCA category mappings, severity splits (`Core` -> Critical, `Non-Core` -> Major, `AP` -> Minor), health score weights, and device type patterns must be managed dynamically in `backend/config/rules.yaml`.

### Rule 5 — Dual Uptime Calculation Engine
* **JFL Uptime % (Excluding Hold Time)**:
  $$\text{JFL Uptime \%} = \max\left(0, \frac{129,600 - \text{Actual Resolution Mins}}{129,600} \times 100\right)$$
* **Proactive Uptime % (Including Hold Time)**:
  $$\text{Proactive Uptime \%} = \max\left(0, \frac{129,600 - \text{Total Resolution Mins}}{129,600} \times 100\right)$$
