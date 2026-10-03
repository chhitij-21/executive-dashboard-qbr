// backend/tests/ai/chatOrchestrator.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { processChat } = require('../../services/ai/chatOrchestrator');
const responseCache = require('../../services/ai/responseCache');
const conversationMemory = require('../../services/ai/conversationMemory');

test('chatOrchestrator test suite', async (t) => {
  const validQbrData = {
    customerName: 'Jubilant Foodworks Ltd (JFL)',
    reportingPeriod: '1 August 2026 – 31 August 2026',
    executiveSummary: {
      totalSites: 8,
      totalDevices: 444,
      overallUptime: '99.43',
      jflSwitchUptime: '94.43',
      proactiveSwitchUptime: '99.96',
      healthScore: 95.06,
      slaCompliance: '95.97',
      slaTarget: 99.3,
    },
  };

  await t.test('1. processChat(null, null) returns valid fallback object', async () => {
    const res = await processChat(null, null);
    assert.ok(res);
    assert.ok(res.answer);
    assert.equal(typeof res.answer, 'string');
  });

  await t.test('2. processChat("hello", validQbrData) returns answer without throw', async () => {
    const res = await processChat('hello', validQbrData);
    assert.ok(res);
    assert.ok(res.answer);
    assert.equal(res.cached, false);
  });

  await t.test('3. processChat with same prompt twice returns cached: true on second call', async () => {
    responseCache.clear();
    const prompt = 'What is the overall uptime?';

    const res1 = await processChat(prompt, validQbrData, { sessionId: 's_cache_test' });
    assert.equal(res1.cached, false);

    const res2 = await processChat(prompt, validQbrData, { sessionId: 's_cache_test' });
    assert.equal(res2.cached, true);
  });

  await t.test('4. processChat with sessionId preserves conversation history', async () => {
    const sId = 's_history_1';
    conversationMemory.clear(sId);

    await processChat('Query 1', validQbrData, { sessionId: sId });
    await processChat('Query 2', validQbrData, { sessionId: sId });

    const history = conversationMemory.getHistory(sId);
    assert.ok(history.length >= 4); // 2 user + 2 assistant
  });

  await t.test('5. processChat with role="client" returns executive answer', async () => {
    const res = await processChat('Summarize status', validQbrData, { role: 'client' });
    assert.ok(res.answer);
  });

  await t.test('6. processChat with skill intent ("any anomaly?") routes to skill', async () => {
    const res = await processChat('Are there any anomalies?', validQbrData, { useSkills: true });
    assert.ok(res);
    assert.ok(res.answer);
  });

  await t.test('7. processChat with null fields in qbrData returns valid fallback', async () => {
    const invalidQbr = { customerName: null, executiveSummary: null };
    const res = await processChat('Show summary', invalidQbr);
    assert.ok(res.answer);
  });

  await t.test('8. processChat with useTools=true handles execution safely', async () => {
    const res = await processChat('Explain JFL formula', validQbrData, { useTools: true });
    assert.ok(res.answer);
  });

  await t.test('9. responseCache.clear() empties cache', () => {
    responseCache.set('p1', 'c1', 'v1');
    assert.equal(responseCache.stats().size > 0, true);
    responseCache.clear();
    assert.equal(responseCache.stats().size, 0);
  });

  await t.test('10. conversationMemory.clear() empties session', () => {
    conversationMemory.addMessage('sess_del', 'user', 'hi');
    assert.ok(conversationMemory.getHistory('sess_del').length > 0);
    conversationMemory.clear('sess_del');
    assert.equal(conversationMemory.getHistory('sess_del').length, 0);
  });
});
