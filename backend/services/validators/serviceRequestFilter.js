// backend/services/validators/serviceRequestFilter.js
// Additive-only. No existing files modified.
// Classifies incidents into uptime-eligible incidents vs. excluded service requests / change requests.
// All fields read strictly from qbrData model. No metric recalculation.

'use strict';

// ─── Classification constants ─────────────────────────────────────────────────
const RE_CHANGE_REQUEST   = /change\s*request/i;
const RE_SERVICE_REQUEST  = /request\s*full?fill?ment/i;

const EXCLUDE_TYPES = Object.freeze({
  CHANGE_REQUEST:  'CHANGE_REQUEST',
  SERVICE_REQUEST: 'SERVICE_REQUEST',
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Safely read a string field. Returns '' on null/undefined.
 * @param {*} v
 * @returns {string}
 */
function safeStr(v) {
  return v != null ? String(v) : '';
}

/**
 * Safely read a numeric field. Returns 0 on null/undefined/NaN.
 * @param {*} v
 * @returns {number}
 */
function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Classify a single incident.
 * Returns 'CHANGE_REQUEST', 'SERVICE_REQUEST', or 'INCIDENT'.
 *
 * Rules (applied in priority order):
 *   1. Category matches /change\s*request/i   → CHANGE_REQUEST
 *   2. IsChangeRequest === true                → CHANGE_REQUEST
 *   3. Category matches /request\s*full?fill?ment/i → SERVICE_REQUEST
 *   4. Priority === 'P4' AND HoldTimeMin === 0 AND ActualResolutionMin === 0 → SERVICE_REQUEST
 *   5. else → INCIDENT
 *
 * @param {object} inc
 * @returns {{ classification: string, reason: string }}
 */
function classifyIncident(inc) {
  try {
    if (!inc || typeof inc !== 'object') {
      return { classification: 'INCIDENT', reason: 'NULL_OR_INVALID_OBJECT' };
    }

    // Field: Category
    const category = safeStr(inc.Category);

    // Rule 1 — Change Request by Category
    if (RE_CHANGE_REQUEST.test(category)) {
      return { classification: EXCLUDE_TYPES.CHANGE_REQUEST, reason: 'Category matches /change\\s*request/i' };
    }

    // Rule 2 — Change Request by flag
    if (inc.IsChangeRequest === true) {
      return { classification: EXCLUDE_TYPES.CHANGE_REQUEST, reason: 'IsChangeRequest === true' };
    }

    // Rule 3 — Service Request by Category
    if (RE_SERVICE_REQUEST.test(category)) {
      return { classification: EXCLUDE_TYPES.SERVICE_REQUEST, reason: 'Category matches /request\\s*full?fill?ment/i' };
    }

    // Rule 4 — P4 with no hold or resolution time
    // Field: Priority, HoldTimeMin, ActualResolutionMin
    const priority            = safeStr(inc.Priority);
    const holdTimeMin         = safeNum(inc.HoldTimeMin);
    const actualResolutionMin = safeNum(inc.ActualResolutionMin);

    if (priority === 'P4' && holdTimeMin === 0 && actualResolutionMin === 0) {
      return { classification: EXCLUDE_TYPES.SERVICE_REQUEST, reason: 'Priority=P4 with no hold or resolution time' };
    }

    return { classification: 'INCIDENT', reason: 'Eligible for uptime calculation' };
  } catch (err) {
    return { classification: 'INCIDENT', reason: `CLASSIFICATION_ERROR: ${err && err.message ? err.message : String(err)}` };
  }
}

// ─── Main Export ─────────────────────────────────────────────────────────────

/**
 * Filter incidents into uptime-eligible incidents and excluded service/change requests.
 *
 * @param {Array} incidents  qbrData.incidents (read-only, not mutated)
 * @returns {{
 *   success: boolean,
 *   uptimeIncidents: Array,
 *   excluded: Array<{ ticket: string, type: string, reason: string }>,
 *   summary: { total: number, uptimeCount: number, excludedCount: number, byType: object },
 *   error: string|null
 * }}
 */
function filterUptimeIncidents(incidents) {
  try {
    if (!Array.isArray(incidents)) {
      return {
        success: false,
        uptimeIncidents: [],
        excluded: [],
        summary: { total: 0, uptimeCount: 0, excludedCount: 0, byType: {} },
        error: 'INVALID_INPUT: incidents must be an array',
      };
    }

    const uptimeIncidents = [];
    const excluded        = [];
    const byType          = {};

    for (let i = 0; i < incidents.length; i++) {
      try {
        const inc = incidents[i];
        if (!inc || typeof inc !== 'object') continue;

        const ticket = inc.TicketNumber != null ? String(inc.TicketNumber) : `idx_${i}`;
        const { classification, reason } = classifyIncident(inc);

        if (classification === 'INCIDENT') {
          uptimeIncidents.push(inc);
        } else {
          excluded.push({ ticket, type: classification, reason });
          byType[classification] = (byType[classification] || 0) + 1;
        }
      } catch (_) {
        continue;
      }
    }

    return {
      success: true,
      uptimeIncidents,
      excluded,
      summary: {
        total: incidents.length,
        uptimeCount: uptimeIncidents.length,
        excludedCount: excluded.length,
        byType,
      },
      error: null,
    };
  } catch (err) {
    return {
      success: false,
      uptimeIncidents: [],
      excluded: [],
      summary: { total: 0, uptimeCount: 0, excludedCount: 0, byType: {} },
      error: `INTERNAL_ERROR: ${err && err.message ? err.message : String(err)}`,
    };
  }
}

module.exports = { filterUptimeIncidents, classifyIncident };
