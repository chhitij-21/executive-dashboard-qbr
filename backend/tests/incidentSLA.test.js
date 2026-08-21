// backend/tests/incidentSLA.test.js
// Tests for computeIncidentEnrichment() matching the REAL JFL Excel field names.
// The actual Excel has:  "Actual Resolution Time (min)" and "Total Resolution Time (min)"
// Run: node --test backend/tests/incidentSLA.test.js

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

function computeIncidentEnrichment(inc, slaTargetHours) {
  let resolutionHours = null;

  // P1 - ActualResolutionMin (most accurate - net time excl. hold)
  const actMin = parseFloat(inc.ActualResolutionMin);
  if (!isNaN(actMin) && actMin >= 0) resolutionHours = parseFloat((actMin / 60).toFixed(2));

  // P2 - TotalResolutionMin
  if (resolutionHours === null) {
    const totMin = parseFloat(inc.TotalResolutionMin);
    if (!isNaN(totMin) && totMin >= 0) resolutionHours = parseFloat((totMin / 60).toFixed(2));
  }

  // P3 - Direct hours columns
  if (resolutionHours === null) {
    const durH = parseFloat(inc.DowntimeHours || inc.OutageHours || inc.ResolutionTimeHours);
    if (!isNaN(durH) && durH >= 0) resolutionHours = durH;
  }

  // P4 - Raw Excel serial timestamp diff
  if (resolutionHours === null && inc.OpenTime && inc.ResolvedTime) {
    const openNum = typeof inc.OpenTime === "number" ? inc.OpenTime : parseFloat(inc.OpenTime);
    const resNum  = typeof inc.ResolvedTime === "number" ? inc.ResolvedTime : parseFloat(inc.ResolvedTime);
    if (!isNaN(openNum) && !isNaN(resNum) && resNum >= openNum)
      resolutionHours = parseFloat(((resNum - openNum) * 24).toFixed(2));
  }

  let slaStatus = null;
  if (resolutionHours !== null) {
    slaStatus = resolutionHours <= slaTargetHours ? "SLA Met" : "SLA Breached";
  } else if (inc.ResolutionSLAStatusRaw) {
    const raw = String(inc.ResolutionSLAStatusRaw).trim().toLowerCase();
    if (raw === "sla met" || raw === "met") slaStatus = "SLA Met";
    else if (raw.includes("breach")) slaStatus = "SLA Breached";
  }

  const ticketVal = String(inc.TicketNumber || "").trim();
  const incIdVal  = String(inc.IncidentNumber || "").trim();
  const displayReference = (ticketVal && ticketVal.toLowerCase() !== "n/a")
    ? { type: "Ticket", value: ticketVal }
    : { type: "Incident ID", value: incIdVal || "N/A" };

  return { ...inc, resolution_time_hours: resolutionHours, sla_target_hours: slaTargetHours, sla_status: slaStatus, display_reference: displayReference };
}

const SLA_TARGET = 2; // 2 hours

describe("computeIncidentEnrichment() — real JFL field names", () => {
  it("P1: uses ActualResolutionMin (7.43 min = 0.12h => SLA Met)", () => {
    const r = computeIncidentEnrichment({ ActualResolutionMin: "7.43" }, SLA_TARGET);
    assert.equal(r.sla_status, "SLA Met");
    assert.equal(r.resolution_time_hours, 0.12);
  });

  it("P1: ActualResolutionMin 150 min = 2.5h => SLA Breached", () => {
    const r = computeIncidentEnrichment({ ActualResolutionMin: "150" }, SLA_TARGET);
    assert.equal(r.sla_status, "SLA Breached");
    assert.equal(r.resolution_time_hours, 2.5);
  });

  it("P1 wins over P2 when both present", () => {
    // ActualResolutionMin=7.43 (SLA Met), TotalResolutionMin=14060 (SLA Breached)
    // P1 must win
    const r = computeIncidentEnrichment({ ActualResolutionMin: "7.43", TotalResolutionMin: "14060" }, SLA_TARGET);
    assert.equal(r.sla_status, "SLA Met");
  });

  it("P2: falls back to TotalResolutionMin when no ActualResolutionMin", () => {
    const r = computeIncidentEnrichment({ TotalResolutionMin: "44.68" }, SLA_TARGET);
    assert.equal(r.sla_status, "SLA Met");
    assert.equal(r.resolution_time_hours, 0.74);
  });

  it("P4: computes from raw Excel serial timestamps", () => {
    // 46144.80347 open, 46144.83472 resolved => diff ~0.031 days * 24 = ~0.75h
    const r = computeIncidentEnrichment({ OpenTime: 46144.80347, ResolvedTime: 46144.83472 }, SLA_TARGET);
    assert.equal(r.sla_status, "SLA Met");
    assert.ok(r.resolution_time_hours < 1);
  });

  it("P5: fallback to Excel ResolutionSLAStatusRaw when no timing data", () => {
    const r = computeIncidentEnrichment({ ResolutionSLAStatusRaw: "SLA Met" }, SLA_TARGET);
    assert.equal(r.sla_status, "SLA Met");
    assert.equal(r.resolution_time_hours, null);
  });

  it("P5: fallback maps 'SLA Breached' correctly", () => {
    const r = computeIncidentEnrichment({ ResolutionSLAStatusRaw: "SLA Breached" }, SLA_TARGET);
    assert.equal(r.sla_status, "SLA Breached");
  });

  it("null sla_status when truly no data at all", () => {
    const r = computeIncidentEnrichment({}, SLA_TARGET);
    assert.equal(r.sla_status, null);
    assert.equal(r.resolution_time_hours, null);
  });

  it("display_reference uses Ticket when TicketNumber present", () => {
    const r = computeIncidentEnrichment({ TicketNumber: "PRO/INC/44676" }, SLA_TARGET);
    assert.equal(r.display_reference.type, "Ticket");
    assert.equal(r.display_reference.value, "PRO/INC/44676");
  });

  it("exactly at SLA boundary (2.00h) => SLA Met", () => {
    const r = computeIncidentEnrichment({ ActualResolutionMin: "120" }, SLA_TARGET);
    assert.equal(r.sla_status, "SLA Met");
  });
});
