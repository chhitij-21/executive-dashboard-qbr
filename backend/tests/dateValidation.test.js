// backend/tests/dateValidation.test.js
// Tests for validateDateRange() — mirrors index.js implementation exactly.
// Run: node --test backend/tests/dateValidation.test.js

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

function validateDateRange(startDate, endDate) {
  const errors = [];
  if (!startDate || typeof startDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(startDate.trim()))
    errors.push("Start date is required and must be in YYYY-MM-DD format.");
  if (!endDate || typeof endDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(endDate.trim()))
    errors.push("End date is required and must be in YYYY-MM-DD format.");
  if (errors.length > 0) return { valid: false, errors };

  const sd = new Date(startDate.trim() + "T00:00:00Z");
  const ed = new Date(endDate.trim()   + "T23:59:59Z");
  if (isNaN(sd.getTime())) errors.push("Invalid start date: " + startDate);
  if (isNaN(ed.getTime())) errors.push("Invalid end date: " + endDate);
  if (errors.length > 0) return { valid: false, errors };

  const todayEnd = new Date();
  todayEnd.setUTCHours(23, 59, 59, 999);
  if (sd > todayEnd) errors.push("Start date " + startDate + " is in the future.");
  if (ed > todayEnd) errors.push("End date " + endDate + " is in the future.");
  if (sd > ed)       errors.push("Start date must be on or before end date.");
  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

describe("validateDateRange()", () => {
  it("accepts a valid past date range", () => {
    assert.equal(validateDateRange("2026-01-01", "2026-07-31").valid, true);
  });
  it("accepts same-day range", () => {
    const today = new Date().toISOString().slice(0, 10);
    assert.equal(validateDateRange(today, today).valid, true);
  });
  it("rejects missing start_date", () => {
    const r = validateDateRange("", "2026-07-31");
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes("Start date")));
  });
  it("rejects missing end_date", () => {
    const r = validateDateRange("2026-01-01", "");
    assert.equal(r.valid, false);
  });
  it("rejects non-ISO format dates", () => {
    assert.equal(validateDateRange("01-Jan-2026", "31/07/2026").valid, false);
  });
  it("rejects future start_date", () => {
    const r = validateDateRange("2099-01-01", "2099-12-31");
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes("future")));
  });
  it("rejects start_date > end_date", () => {
    const r = validateDateRange("2026-07-31", "2026-01-01");
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes("on or before")));
  });
  it("rejects null inputs", () => {
    const r = validateDateRange(null, null);
    assert.equal(r.valid, false);
    assert.ok(r.errors.length >= 2);
  });
});
