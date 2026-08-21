// backend/tests/incidentSLA.test.js
// Tests for computeIncidentEnrichment() logic (SLA status + display_reference)
// Run: node --test backend/tests/incidentSLA.test.js

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

// Mirror computeIncidentEnrichment from processData.js
function computeIncidentEnrichment(inc, slaTargetHours) {
  let resolutionHours = null;
  const durH = parseFloat(
    inc.DowntimeHours || inc.OutageHours || inc.ResolutionTimeHours ||
    inc["Resolution Time (Hrs)"] || inc["Duration Hours"]
  );
  if (!isNaN(durH) && durH >= 0) resolutionHours = durH;

  if (resolutionHours === null) {
    const totMin = parseFloat(inc.TotalResolutionMin || inc["Total Resolution Time (min)"]);
    if (!isNaN(totMin) && totMin >= 0) resolutionHours = parseFloat((totMin / 60).toFixed(2));
  }

  const slaStatus = resolutionHours !== null
    ? (resolutionHours <= slaTargetHours ? "SLA Met" : "SLA Breached")
    : null;

  const ticketVal = String(inc.TicketNumber || "").trim();
  const incIdVal  = String(inc.IncidentNumber || inc.IncidentID || "").trim();
  const displayReference = (ticketVal && ticketVal.toLowerCase() !== "n/a")
    ? { type: "Ticket",      value: ticketVal }
    : { type: "Incident ID", value: incIdVal || "N/A" };

  return { ...inc, resolution_time_hours: resolutionHours, sla_target_hours: slaTargetHours, sla_status: slaStatus, display_reference: displayReference };
}

const SLA_TARGET = 2; // hours

describe("computeIncidentEnrichment()", () => {
  it("marks SLA Met when resolution <= 2h", () => {
    const r = computeIncidentEnrichment({ DowntimeHours: 1.5 }, SLA_TARGET);
    assert.equal(r.sla_status, "SLA Met");
    assert.equal(r.resolution_time_hours, 1.5);
  });

  it("marks SLA Breached when resolution > 2h", () => {
    const r = computeIncidentEnrichment({ DowntimeHours: 3.2 }, SLA_TARGET);
    assert.equal(r.sla_status, "SLA Breached");
  });

  it("marks SLA Met at exactly 2h (boundary)", () => {
    const r = computeIncidentEnrichment({ DowntimeHours: 2.0 }, SLA_TARGET);
    assert.equal(r.sla_status, "SLA Met");
  });

  it("returns null sla_status when no resolution data", () => {
    const r = computeIncidentEnrichment({}, SLA_TARGET);
    assert.equal(r.sla_status, null);
    assert.equal(r.resolution_time_hours, null);
  });

  it("uses minutes column when hours column absent", () => {
    const r = computeIncidentEnrichment({ TotalResolutionMin: 90 }, SLA_TARGET);
    assert.equal(r.sla_status, "SLA Met");
    assert.equal(r.resolution_time_hours, 1.5);
  });

  it("uses Ticket as display_reference when TicketNumber is present", () => {
    const r = computeIncidentEnrichment({ TicketNumber: "TKT-001", IncidentNumber: "INC-001" }, SLA_TARGET);
    assert.equal(r.display_reference.type, "Ticket");
    assert.equal(r.display_reference.value, "TKT-001");
  });

  it("falls back to Incident ID when TicketNumber is absent", () => {
    const r = computeIncidentEnrichment({ IncidentNumber: "INC-101" }, SLA_TARGET);
    assert.equal(r.display_reference.type, "Incident ID");
    assert.equal(r.display_reference.value, "INC-101");
  });

  it("falls back to N/A when neither Ticket nor Incident ID present", () => {
    const r = computeIncidentEnrichment({}, SLA_TARGET);
    assert.equal(r.display_reference.type, "Incident ID");
    assert.equal(r.display_reference.value, "N/A");
  });
});
