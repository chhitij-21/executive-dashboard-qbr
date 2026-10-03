// backend/tests/ai/guardrails.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateAnswer } = require('../../services/ai/guardrails');

test('guardrails test suite', async (t) => {
  const context = 'JFL QBR Period: 1 August 2026 - 31 August 2026. Total Sites: 8, Overall Uptime: 99.43%, Health Score: 95.06.';

  await t.test('1. Clean answer matching context returns valid true', () => {
    const answer = 'The overall uptime for the 8 sites in August 2026 is 99.43% with a health score of 95.06.';
    const res = validateAnswer(answer, context);
    assert.equal(res.valid, true);
    assert.deepEqual(res.issues, []);
  });

  await t.test('2. Answer with API key in plaintext detected as OUT_OF_SCOPE', () => {
    const answer = 'Here is the key sk-123456789012345678901234567890';
    const res = validateAnswer(answer, context);
    assert.equal(res.valid, false);
    assert.equal(res.issues.some(i => i.type === 'OUT_OF_SCOPE'), true);
  });

  await t.test('3. Answer with many unverified numbers flags POTENTIAL_HALLUCINATION', () => {
    const answer = 'Sites report numbers 888.1, 777.2, 666.3, 555.4, 444.5, 333.6, 222.7, 111.8.';
    const res = validateAnswer(answer, context);
    assert.equal(res.valid, false);
    assert.equal(res.issues.some(i => i.type === 'POTENTIAL_HALLUCINATION'), true);
  });

  await t.test('4. Answer with only allowed standard numbers (2026, 0, 100) returns valid', () => {
    const answer = 'Report for 2026 shows 100% target and 0 breaches.';
    const res = validateAnswer(answer, context);
    assert.equal(res.valid, true);
  });

  await t.test('5. Empty answer returns valid false with EMPTY_ANSWER issue', () => {
    const res1 = validateAnswer('', context);
    assert.equal(res1.valid, false);
    assert.equal(res1.issues[0].type, 'EMPTY_ANSWER');

    const res2 = validateAnswer(null, context);
    assert.equal(res2.valid, false);
    assert.equal(res2.issues[0].type, 'EMPTY_ANSWER');
  });
});
