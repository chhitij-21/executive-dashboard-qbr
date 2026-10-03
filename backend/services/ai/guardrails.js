// backend/services/ai/guardrails.js

const FORBIDDEN_PATTERNS = [
  /medical advice|prescription|diagnosis/i,
  /legal opinion|lawsuit|attorney advice/i,
  /password\s*:\s*\S+/i,
  /api_key\s*:\s*\S+/i,
  /sk-[a-zA-Z0-9]{20,}/,
  /gsk_[a-zA-Z0-9]{20,}/,
];

const ALLOWED_NUMBERS = new Set([2024, 2025, 2026, 2027, 0, 1, 2, 3, 100]);

function extractNumbers(text) {
  if (!text || typeof text !== 'string') return [];
  const matches = text.match(/\b\d+(\.\d+)?\b/g);
  if (!matches) return [];
  return matches.map(m => parseFloat(m)).filter(n => Number.isFinite(n));
}

function validateAnswer(answer, systemContext) {
  try {
    if (!answer || typeof answer !== 'string' || !answer.trim()) {
      return {
        valid: false,
        issues: [{ type: 'EMPTY_ANSWER', message: 'Answer string is empty or missing.' }],
      };
    }

    const issues = [];
    const text = answer.trim();

    // Check forbidden patterns
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(text)) {
        issues.push({
          type: 'OUT_OF_SCOPE',
          message: `Answer contains forbidden pattern matching ${pattern.toString()}`,
        });
      }
    }

    // Hallucination check on numbers
    const contextText = String(systemContext || '');
    const contextNumbers = new Set(extractNumbers(contextText));
    const answerNumbers = extractNumbers(text);

    const unverifiedNumbers = [];
    for (const num of answerNumbers) {
      if (ALLOWED_NUMBERS.has(num)) continue;
      // Allow rounded integer/float matches
      const intVal = Math.round(num);
      if (contextNumbers.has(num) || contextNumbers.has(intVal)) continue;

      // Check if number string exists verbatim in context
      if (contextText.includes(String(num))) continue;

      unverifiedNumbers.push(num);
    }

    if (unverifiedNumbers.length > 5) {
      issues.push({
        type: 'POTENTIAL_HALLUCINATION',
        message: `Answer references unverified numeric values not present in dashboard context: ${unverifiedNumbers.slice(0, 5).join(', ')}`,
      });
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  } catch (err) {
    return {
      valid: true,
      issues: [],
    };
  }
}

module.exports = { validateAnswer };
