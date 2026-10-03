// backend/services/validators/rolloverHandler.js
// Additive-only. No existing files modified.
// Detects rollover tickets (Status in [On Hold, In Progress, WIP] AND CreatedTime < period.start_date)
// and caps their hold time to the reporting period boundary.
// All fields read strictly from qbrData model. No metric recalculation.

'use strict';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Safely parse an ISO date string to a Date object.
 * Returns null on failure — never throws.
 * @param {*} value
 * @returns {Date|null}
 */
function safeParseDateUTC(value) {
  try {
    if (!value) return null;
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    return d;
  } catch (_) {
    return null;
  }
}

/**
 * Compute the total minutes between two ISO date strings.
 * Returns 0 on any failure.
 * @param {string} startISO
 * @param {string} endISO
 * @returns {number}
 */
function minutesBetween(startISO, endISO) {
  try {
    const s = safeParseDateUTC(startISO);
    const e = safeParseDateUTC(endISO);
    if (!s || !e) return 0;
    const diffMs = e.getTime() - s.getTime();
    if (diffMs <= 0) return 0;
    return Math.floor(diffMs / 60000);
  } catch (_) {
    return 0;
  }
}

// ─── ROLLOVER STATUSES ───────────────────────────────────────────────────────
const ROLLOVER_STATUSES = new Set(['On Hold', 'In Progress', 'WIP']);

// ─── Main Export ─────────────────────────────────────────────────────────────

/**
 * Detect rollover tickets — incidents that were created before the reporting
 * period start date and are still open (Status in [On Hold, In Progress, WIP]).
 *
 * Business rule:
 *   cap hold time at period.start_date — excess belongs to prior period.
 *
 * @param {Array}  incidents  qbrData.incidents (read-only, not mutated)
 * @param {object} period     qbrData.report_period { start_date, end_date, display_label }
 * @returns {{ success: boolean, rollovers: Array, summary: object, error: string|null }}
 */
function detectRollovers(incidents, period) {
  try {
    // ── Validate inputs ────────────────────────────────────────────────────
    if (!Array.isArray(incidents)) {
      return {
        success: false,
        rollovers: [],
        summary: { totalRollovers: 0, totalRawHold: 0, totalCapped: 0, totalExcess: 0 },
        error: 'INVALID_INPUT: incidents must be an array',
      };
    }

    if (!period || typeof period !== 'object') {
      return {
        success: false,
        rollovers: [],
        summary: { totalRollovers: 0, totalRawHold: 0, totalCapped: 0, totalExcess: 0 },
        error: 'INVALID_INPUT: period must be an object',
      };
    }

    const periodStartISO = period.start_date;
    const periodEndISO   = period.end_date;

    const periodStart = safeParseDateUTC(periodStartISO);
    const periodEnd   = safeParseDateUTC(periodEndISO);

    if (!periodStart || !periodEnd) {
      return {
        success: false,
        rollovers: [],
        summary: { totalRollovers: 0, totalRawHold: 0, totalCapped: 0, totalExcess: 0 },
        error: 'INVALID_INPUT: period.start_date and period.end_date must be valid ISO strings',
      };
    }

    const periodMinutes = minutesBetween(periodStartISO, periodEndISO);

    // ── Scan incidents ─────────────────────────────────────────────────────
    const rollovers = [];
    let totalRawHold  = 0;
    let totalCapped   = 0;
    let totalExcess   = 0;

    for (let i = 0; i < incidents.length; i++) {
      try {
        const inc = incidents[i];
        if (!inc || typeof inc !== 'object') continue;

        // Field: Status — must be in rollover set
        const status = typeof inc.Status === 'string' ? inc.Status.trim() : '';
        if (!ROLLOVER_STATUSES.has(status)) continue;

        // Field: CreatedTime — must be before period start
        const createdTime = safeParseDateUTC(inc.CreatedTime);
        if (!createdTime) continue;
        if (createdTime.getTime() >= periodStart.getTime()) continue;

        // Field: HoldTimeMin — read-only, never recalculate
        const rawHoldMin = Number.isFinite(Number(inc.HoldTimeMin))
          ? Math.max(0, Number(inc.HoldTimeMin))
          : 0;

        // Cap to period window (consistent with backend Math.min pattern)
        const cappedHoldMin = Math.min(rawHoldMin, periodMinutes);
        const excessMin     = rawHoldMin - cappedHoldMin;

        // Fields: TicketNumber, SiteID, DeviceID
        const ticketNumber = inc.TicketNumber != null ? String(inc.TicketNumber) : '';
        const siteId       = inc.SiteID       != null ? String(inc.SiteID)       : '';
        const deviceId     = inc.DeviceID     != null ? String(inc.DeviceID)     : '';

        rollovers.push({
          ticketNumber,
          siteId,
          deviceId,
          rawHoldMin,
          cappedHoldMin,
          excessMin,
          reason: 'ROLLOVER_CAPPED',
          recommendation: `${cappedHoldMin} min in this period, ${excessMin} min belongs to prior period`,
        });

        totalRawHold += rawHoldMin;
        totalCapped  += cappedHoldMin;
        totalExcess  += excessMin;
      } catch (_) {
        // Per-incident error: skip and continue
        continue;
      }
    }

    return {
      success: true,
      rollovers,
      summary: {
        totalRollovers: rollovers.length,
        totalRawHold,
        totalCapped,
        totalExcess,
      },
      error: null,
    };
  } catch (err) {
    return {
      success: false,
      rollovers: [],
      summary: { totalRollovers: 0, totalRawHold: 0, totalCapped: 0, totalExcess: 0 },
      error: `INTERNAL_ERROR: ${err && err.message ? err.message : String(err)}`,
    };
  }
}

module.exports = { detectRollovers };
