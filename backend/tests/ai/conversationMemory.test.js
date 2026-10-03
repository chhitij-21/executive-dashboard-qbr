// backend/tests/ai/conversationMemory.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const memory = require('../../services/ai/conversationMemory');

test('conversationMemory test suite', async (t) => {
  await t.test('1. getOrCreate("s1") returns fresh session object', () => {
    memory.clear('s1');
    const sess = memory.getOrCreate('s1');
    assert.ok(sess);
    assert.equal(sess.id, 's1');
    assert.deepEqual(sess.messages, []);
  });

  await t.test('2. addMessage then getHistory returns added message', () => {
    memory.clear('s2');
    memory.addMessage('s2', 'user', 'Hello AI');
    const history = memory.getHistory('s2');
    assert.equal(history.length, 1);
    assert.equal(history[0].role, 'user');
    assert.equal(history[0].content, 'Hello AI');
  });

  await t.test('3. History is capped at 10 messages max', () => {
    memory.clear('s3');
    for (let i = 1; i <= 15; i++) {
      memory.addMessage('s3', 'user', `Message ${i}`);
    }
    const history = memory.getHistory('s3');
    assert.equal(history.length, 10);
    assert.equal(history[0].content, 'Message 6');
    assert.equal(history[9].content, 'Message 15');
  });

  await t.test('4. clear("s1") removes the session', () => {
    memory.addMessage('s1', 'user', 'test');
    assert.equal(memory.getHistory('s1').length, 1);
    memory.clear('s1');
    assert.equal(memory.getHistory('s1').length, 0);
  });

  await t.test('5. Unknown sessionId returns empty history without throwing', () => {
    const history = memory.getHistory('unknown_session_xyz_999');
    assert.deepEqual(history, []);
  });

  await t.test('6. LRU eviction maintains max session limit', () => {
    memory.clear();
    for (let i = 0; i < 205; i++) {
      memory.getOrCreate(`sess_lru_${i}`);
    }
    const stats = memory.stats();
    assert.ok(stats.activeSessions <= 200);
  });
});
