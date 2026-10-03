// backend/services/ai/chatLogger.js
const fs = require('fs');
const path = require('path');

function logChat(entry) {
  try {
    if (!entry || typeof entry !== 'object') return;

    const logDir = path.resolve('data', 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const logFile = path.join(logDir, `chat-${todayStr}.jsonl`);

    const promptText = String(entry.prompt || '');
    const truncatedPrompt = promptText.length > 200 ? promptText.slice(0, 200) + '...' : promptText;

    const record = {
      ts: entry.ts || new Date().toISOString(),
      event: entry.event || 'chat_processed',
      prompt: truncatedPrompt,
      provider: entry.provider || 'unknown',
      model: entry.model || 'unknown',
      type: entry.type || 'standard',
      skill: entry.skill || null,
      latencyMs: typeof entry.latencyMs === 'number' ? entry.latencyMs : 0,
      cacheHit: Boolean(entry.cacheHit),
      sessionId: entry.sessionId || 'anonymous',
      error: entry.error || null,
    };

    const line = JSON.stringify(record) + '\n';
    fs.appendFileSync(logFile, line, 'utf8');
    console.log(`[CHAT_LOG] ${record.event} | ${record.provider}:${record.model} | ${record.latencyMs}ms | ${record.sessionId}`);
  } catch (err) {
    // Silent fail guard to prevent unhandled disk I/O crashes
  }
}

module.exports = { logChat };
