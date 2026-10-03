// backend/services/validators/durationBreakdown.js
// Additive-only. No existing files modified.
// Splits an incident duration into calendar-month segments within the reporting period.
// No metric recalculation. Node built-ins only.

'use strict';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Safely parse an ISO date string to a Date (UTC).
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
 * Returns a short month label like "Jan 2026" from a Date.
 * @param {Date} d
 * @returns {string}
 */
function monthLabel(d) {
  try {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  } catch (_) {
    return 'Unknown';
  }
}

/**
 * Returns the first moment of the next calendar month in UTC (as Date).
 * E.g. input = any date in March 2026 → returns 2026-04-01T00:00:00.000Z
 * @param {Date} d
 * @returns {Date}
 */
function startOfNextMonthUTC(d) {
  const year  = d.getUTCFullYear();
  const month = d.getUTCMonth(); // 0-based
  // Incrementing month: JS handles wrap-around automatically
  return new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0));
}

/**
 * Compute minutes between two Dates. Returns 0 if result <= 0.
 * @param {Date} start
 * @param {Date} end
 * @returns {number}
 */
function minutesBetweenDates(start, end) {
  const diffMs = end.getTime() - start.getTime();
  return diffMs > 0 ? Math.floor(diffMs / 60000) : 0;
}

// ─── Main Export ─────────────────────────────────────────────────────────────

/**
 * Split an incident duration [startISO, endISO] by calendar month boundaries,
 * constrained within [periodStart, periodEnd].
 *
 * Each segment represents the portion of the incident falling within one
 * calendar month and within the reporting period.
 *
 * @param {string} startISO     Incident start (ISO string)
 * @param {string} endISO       Incident end   (ISO string)
 * @param {string} periodStart  Period start   (ISO string)
 * @param {string} periodEnd    Period end     (ISO string)
 * @returns {{
 *   success: boolean,
 *   segments: Array<{ monthLabel: string, startDate: string, endDate: string, minutes: number, percentage: number }>,
 *   summary: { totalMinutes: number, segmentCount: number, primaryMonth: string },
 *   error: string|null
 * }}
 */
function breakdownDuration(startISO, endISO, periodStart, periodEnd) {
  try {
    // ── Parse and validate all four dates ─────────────────────────────────
    const incidentStart  = safeParseDateUTC(startISO);
    const incidentEnd    = safeParseDateUTC(endISO);
    const periodStartDt  = safeParseDateUTC(periodStart);
    const periodEndDt    = safeParseDateUTC(periodEnd);

    if (!incidentStart || !incidentEnd) {
      return {
        success: false,
        segments: [],
        summary: { totalMinutes: 0, segmentCount: 0, primaryMonth: '' },
        error: 'INVALID_INPUT: startISO and endISO must be valid ISO date strings',
      };
    }

    if (!periodStartDt || !periodEndDt) {
      return {
        success: false,
        segments: [],
        summary: { totalMinutes: 0, segmentCount: 0, primaryMonth: '' },
        error: 'INVALID_INPUT: periodStart and periodEnd must be valid ISO date strings',
      };
    }

    // ── Clamp to period window ─────────────────────────────────────────────
    const effectiveStart = new Date(Math.max(incidentStart.getTime(), periodStartDt.getTime()));
    const effectiveEnd   = new Date(Math.min(incidentEnd.getTime(),   periodEndDt.getTime()));

    if (effectiveStart.getTime() >= effectiveEnd.getTime()) {
      // Incident falls entirely outside the period
      return {
        success: true,
        segments: [],
        summary: { totalMinutes: 0, segmentCount: 0, primaryMonth: '' },
        error: null,
      };
    }

    // ── Compute total clamped minutes for percentage calculation ───────────
    const totalClamped = minutesBetweenDates(effectiveStart, effectiveEnd);

    // ── Iterate through calendar month boundaries ──────────────────────────
    const segments = [];
    let cursor = new Date(effectiveStart.getTime());

    // Safety: max 120 months to prevent infinite loop on bad data
    let guard = 0;
    const MAX_SEGMENTS = 120;

    while (cursor.getTime() < effectiveEnd.getTime() && guard < MAX_SEGMENTS) {
      guard++;

      const segStart = new Date(cursor.getTime());
      const nextMonth = startOfNextMonthUTC(segStart);
      const segEnd = new Date(Math.min(nextMonth.getTime(), effectiveEnd.getTime()));

      const minutes = minutesBetweenDates(segStart, segEnd);

      if (minutes > 0) {
        const pct = totalClamped > 0
          ? parseFloat(((minutes / totalClamped) * 100).toFixed(2))
          : 0;

        segments.push({
          monthLabel: monthLabel(segStart),
          startDate:  segStart.toISOString(),
          endDate:    segEnd.toISOString(),
          minutes,
          percentage: pct,
        });
      }

      cursor = segEnd;
    }

    // ── Build summary ──────────────────────────────────────────────────────
    let primaryMonth = '';
    let maxMinutes   = -1;
    for (let i = 0; i < segments.length; i++) {
      if (segments[i].minutes > maxMinutes) {
        maxMinutes   = segments[i].minutes;
        primaryMonth = segments[i].monthLabel;
      }
    }

    return {
      success: true,
      segments,
      summary: {
        totalMinutes:  totalClamped,
        segmentCount:  segments.length,
        primaryMonth,
      },
      error: null,
    };
  } catch (err) {
    return {
      success: false,
      segments: [],
      summary: { totalMinutes: 0, segmentCount: 0, primaryMonth: '' },
      error: `INTERNAL_ERROR: ${err && err.message ? err.message : String(err)}`,
    };
  }
}

module.exports = { breakdownDuration };
