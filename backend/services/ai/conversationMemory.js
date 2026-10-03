// backend/services/ai/conversationMemory.js

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_MESSAGES = 10;
const MAX_SESSIONS = 200;

const sessionsMap = new Map();

function cleanStaleSessions() {
  const now = Date.now();
  sessionsMap.forEach((sess, key) => {
    if (now - sess.lastAccess > SESSION_TTL_MS) {
      sessionsMap.delete(key);
    }
  });
}

function getOrCreate(sessionId) {
  try {
    const sId = (sessionId && typeof sessionId === 'string' && sessionId.trim()) ? sessionId.trim() : 'anonymous';
    cleanStaleSessions();

    let sess = sessionsMap.get(sId);
    if (!sess) {
      if (sessionsMap.size >= MAX_SESSIONS) {
        const firstKey = sessionsMap.keys().next().value;
        if (firstKey) sessionsMap.delete(firstKey);
      }
      sess = {
        id: sId,
        messages: [],
        lastAccess: Date.now(),
      };
      sessionsMap.set(sId, sess);
    } else {
      sess.lastAccess = Date.now();
    }

    return sess;
  } catch (err) {
    return { id: 'anonymous', messages: [], lastAccess: Date.now() };
  }
}

function addMessage(sessionId, role, content) {
  try {
    const sess = getOrCreate(sessionId);
    const text = String(content || '').trim();
    const truncatedContent = text.length > 2000 ? text.slice(0, 2000) + '...' : text;

    sess.messages.push({
      role: ['user', 'assistant', 'system'].includes(role) ? role : 'user',
      content: truncatedContent,
      ts: new Date().toISOString(),
    });

    if (sess.messages.length > MAX_MESSAGES) {
      sess.messages = sess.messages.slice(-MAX_MESSAGES);
    }
  } catch (err) {
    // Fail silently
  }
}

function getHistory(sessionId, limit) {
  try {
    const sess = getOrCreate(sessionId);
    const maxLimit = typeof limit === 'number' && limit > 0 ? limit : MAX_MESSAGES;
    return sess.messages.slice(-maxLimit);
  } catch (err) {
    return [];
  }
}

function clear(sessionId) {
  if (sessionId && typeof sessionId === 'string') {
    sessionsMap.delete(sessionId.trim());
  } else {
    sessionsMap.clear();
  }
}

function stats() {
  cleanStaleSessions();
  return {
    activeSessions: sessionsMap.size,
  };
}

module.exports = { getOrCreate, addMessage, getHistory, clear, stats };
