// backend/services/ai/feedbackService.js

const fs = require('fs');
const path = require('path');

async function recordFeedback(sessionId, messageId, rating, comment) {
  try {
    const feedbackDir = path.resolve('data', 'feedback');
    if (!fs.existsSync(feedbackDir)) {
      fs.mkdirSync(feedbackDir, { recursive: true });
    }

    const feedbackFile = path.join(feedbackDir, 'feedback.jsonl');
    const numericRating = Number(rating) === 1 ? 1 : -1;

    const record = {
      ts: new Date().toISOString(),
      sessionId: String(sessionId || 'anonymous'),
      messageId: String(messageId || 'unknown'),
      rating: numericRating,
      comment: String(comment || '').slice(0, 500),
    };

    fs.appendFileSync(feedbackFile, JSON.stringify(record) + '\n', 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err?.message || 'FEEDBACK_WRITE_ERROR' };
  }
}

async function getPopularQuestions() {
  try {
    const logDir = path.resolve('data', 'logs');
    if (!fs.existsSync(logDir)) {
      return { questions: [] };
    }

    const files = fs.readdirSync(logDir).filter(f => f.startsWith('chat-') && f.endsWith('.jsonl'));
    const questionCounts = new Map();

    files.slice(-30).forEach(file => {
      try {
        const content = fs.readFileSync(path.join(logDir, file), 'utf8');
        const lines = content.split('\n');
        lines.forEach(line => {
          if (!line.trim()) return;
          try {
            const parsed = JSON.parse(line);
            if (parsed.prompt && parsed.prompt.trim()) {
              const q = parsed.prompt.trim();
              questionCounts.set(q, (questionCounts.get(q) || 0) + 1);
            }
          } catch (e) {}
        });
      } catch (e) {}
    });

    const sorted = Array.from(questionCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(entry => entry[0]);

    return { questions: sorted };
  } catch (err) {
    return { questions: [] };
  }
}

module.exports = { recordFeedback, getPopularQuestions };
