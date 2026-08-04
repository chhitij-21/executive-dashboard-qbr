# Enterprise AI Engineering System Architecture & Guidelines for Executive QBR Platform

## 1. Core Operating Principles & Architecture
- **Single Source of Truth (SSOT)**:
  - The Executive Dashboard data processing engine (`processData.js`) is the Single Source of Truth (SSOT) for all calculations, site mapping, inventory aggregation, SLA compliance, health scores, and uptime formulas.
  - The PowerPoint Generator (`pptGenerator.js`) is strictly a **presentation layer** that consumes the validated, processed dashboard data model. It must NEVER recalculate KPIs or process Excel files independently.
- **100% Dashboard & PPT Synchronization**:
  - Every KPI (Total Sites, Devices, Switches, APs, Incident Count, JFL Uptime %, Proactive Uptime %, Health Score, SLA %, RCA Drivers) in the exported PowerPoint MUST match the React Web Portal 100%.

---

## 2. Uptime Percentage Calculation Rules
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
- **Rounding & Bounds**:
  - All percentages must be rounded to exactly **two decimal places** and bounded between `0.00%` and `100.00%`.

---

## 3. Executive Table Layout & Formatting Rules
- **Executive Summary Table Layout (Web Dashboard & PowerPoint Slide 5)**:
  `Site | No of devices | Proactive Switch Uptime | JFL Switch Uptime | Primary RCA Driver (Switches) | AP Incidents (Unique) | Primary RCA Driver (AP)`
- **AP Incidents (Unique) Format**:
  - Render as `Total AP Incidents / Unique Affected APs`, e.g., `31 / 23`, `218 / 59`.
- **Customer-Ready Text Fallbacks**:
  - For zero-incident sites or unassigned categories, render professional executive terminology (**`Stable Operations (No Incidents)`**) rather than raw technical fallbacks like `Not case received` or `None`.

---

## 4. UI/UX & Enterprise Design Standards
- **Enterprise Polish**: Designed for C-suite presentation (Cisco, Deloitte, ServiceNow tier). Avoid emojis, consumer dashboards, or unnecessary animations.
- **Executive Storytelling**: Every major KPI and chart includes observation, trend, business impact, and strategic recommendations.
- **Zero Horizontal/Vertical Clutter**: Use responsive scroll wrappers (`minWidth: 1150px`) with ample cell padding and clean typography.
