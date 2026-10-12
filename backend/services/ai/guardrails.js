// backend/services/ai/guardrails.js
// Enterprise IQ-200 Hallucination-Free Guardrails & Verifier Layer
// Seamlessly delegates to iq200Validator while maintaining 100% backward compatibility.

'use strict';

const {
  auditHallucinations,
  buildSsotGroundTruth,
  groundAndAutoCorrect,
  verifyAndGroundResponse,
} = require('./iq200Validator');

/**
 * Validates an AI answer against forbidden patterns, ungrounded numbers, and SSOT ground truth.
 * Backward compatible with existing signature: validateAnswer(answer, systemContext)
 * Also supports: validateAnswer(answer, systemContext, qbrDataOrOptions)
 */
function validateAnswer(answer, systemContext, extra = {}) {
  const options = typeof extra === 'object' && extra !== null ? { ...extra, systemContext } : { systemContext };
  const qbrData = options.qbrData || (typeof extra === 'object' && extra.siteSummary ? extra : null);

  const audit = auditHallucinations(answer, qbrData, options);

  return {
    valid: audit.valid,
    score: audit.score,
    issues: audit.issues,
    auditTrail: audit.auditTrail,
    unverifiedNumbers: audit.unverifiedNumbers,
  };
}

module.exports = {
  validateAnswer,
  auditHallucinations,
  buildSsotGroundTruth,
  groundAndAutoCorrect,
  verifyAndGroundResponse,
};
