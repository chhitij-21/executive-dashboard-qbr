// backend/services/ai/streamingHandler.js

const http = require('http');
const https = require('https');

async function streamChat(req, res, options = {}) {
  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const provider = String(options.provider || 'groq').toLowerCase();
    const apiKey = options.apiKey || process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY;

    if (!apiKey) {
      const fallbackMsg = JSON.stringify({ content: 'AI streaming API key is not configured on the server. Please verify environment settings.' });
      res.write(`data: ${fallbackMsg}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    let hostname = 'api.groq.com';
    let pathName = '/openai/v1/chat/completions';
    let modelName = options.model || 'llama-3.3-70b-versatile';

    if (provider === 'openai') {
      hostname = 'api.openai.com';
      modelName = options.model || 'gpt-4o-mini';
    } else if (provider === 'deepseek') {
      hostname = 'api.deepseek.com';
      pathName = '/v1/chat/completions';
      modelName = options.model || 'deepseek-chat';
    }

    const payload = JSON.stringify({
      model: modelName,
      messages: options.messages || [
        { role: 'system', content: options.systemContext || 'You are an AI assistant.' },
        { role: 'user', content: 'Provide QBR summary.' }
      ],
      stream: true,
      max_tokens: 1024,
    });

    const reqOpts = {
      hostname,
      port: 443,
      path: pathName,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const apiReq = https.request(reqOpts, (apiRes) => {
      let buffer = '';

      apiRes.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;

          if (trimmed === 'data: [DONE]') {
            res.write('data: [DONE]\n\n');
            continue;
          }

          if (trimmed.startsWith('data: ')) {
            try {
              const jsonStr = trimmed.slice(6);
              const parsed = JSON.parse(jsonStr);
              const deltaContent = parsed.choices?.[0]?.delta?.content || '';
              if (deltaContent) {
                res.write(`data: ${JSON.stringify({ content: deltaContent })}\n\n`);
              }
            } catch (e) {
              // Ignore partial JSON chunks
            }
          }
        }
      });

      apiRes.on('end', () => {
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });

    apiReq.on('error', (err) => {
      res.write(`data: ${JSON.stringify({ error: err.message || 'Streaming network error' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });

    apiReq.write(payload);
    apiReq.end();
  } catch (err) {
    try {
      res.write(`data: ${JSON.stringify({ error: err?.message || 'Streaming error' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (e) {}
  }
}

module.exports = { streamChat };
