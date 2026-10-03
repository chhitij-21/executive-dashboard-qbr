// backend/services/ai/skillDispatcher.js

function detectIntent(prompt) {
  if (!prompt || typeof prompt !== 'string') return null;
  const str = prompt.toLowerCase().trim();

  if (/\b(anomaly|anomalies|outlier|spike|abnormal|unusual|floor breach)\b/i.test(str)) {
    return 'ANOMALY';
  }
  if (/\b(cross\s*val|cross\s*check|reconcil|audit|integrity|check rules|rule validation)\b/i.test(str)) {
    return 'CROSS_VALIDATION';
  }
  if (/\b(lineage|traceability|source row|where does|how calculated|formula for|provenance)\b/i.test(str)) {
    return 'LINEAGE';
  }
  if (/\b(forecast|predict|risk|trend|future|slope|ols|projected)\b/i.test(str)) {
    return 'FORECAST';
  }
  if (/\b(correlat|pattern|rack issue|simultaneous|recurring|same rca|outage cluster)\b/i.test(str)) {
    return 'CORRELATION';
  }

  return null;
}

async function executeSkill(skill, qbrData, validators = {}) {
  try {
    if (!skill || typeof skill !== 'string') return null;
    if (!qbrData || typeof qbrData !== 'object') return null;

    const targetSkill = skill.toUpperCase();
    const v = validators || {};

    if (targetSkill === 'ANOMALY') {
      if (typeof v.detectAnomalies !== 'function') {
        return { skill: targetSkill, data: { success: false, error: 'VALIDATOR_UNAVAILABLE' } };
      }
      const data = v.detectAnomalies(qbrData);
      return { skill: targetSkill, data };
    }

    if (targetSkill === 'CROSS_VALIDATION') {
      if (typeof v.crossValidate !== 'function') {
        return { skill: targetSkill, data: { success: false, error: 'VALIDATOR_UNAVAILABLE' } };
      }
      const data = v.crossValidate(qbrData);
      return { skill: targetSkill, data };
    }

    if (targetSkill === 'LINEAGE') {
      if (typeof v.buildLineage !== 'function') {
        return { skill: targetSkill, data: { success: false, error: 'VALIDATOR_UNAVAILABLE' } };
      }
      const data = v.buildLineage(qbrData);
      return { skill: targetSkill, data };
    }

    if (targetSkill === 'FORECAST') {
      if (typeof v.forecastSLARisk !== 'function') {
        return { skill: targetSkill, data: { success: false, error: 'VALIDATOR_UNAVAILABLE' } };
      }
      const data = v.forecastSLARisk(qbrData);
      return { skill: targetSkill, data };
    }

    if (targetSkill === 'CORRELATION') {
      if (typeof v.findCorrelations !== 'function') {
        return { skill: targetSkill, data: { success: false, error: 'VALIDATOR_UNAVAILABLE' } };
      }
      const data = v.findCorrelations(qbrData);
      return { skill: targetSkill, data };
    }

    return null;
  } catch (err) {
    return {
      skill,
      data: { success: false, error: err?.message || 'SKILL_EXECUTION_ERROR' },
    };
  }
}

module.exports = { detectIntent, executeSkill };
