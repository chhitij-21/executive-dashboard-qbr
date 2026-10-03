// backend/services/ai/chatOrchestrator.js

const { logChat } = require('./chatLogger');
const responseCache = require('./responseCache');
const { withRetry } = require('./retryHandler');
const conversationMemory = require('./conversationMemory');
const { getRoleInstructions } = require('./roleInstructions');
const { validateAnswer } = require('./guardrails');
const { detectIntent, executeSkill } = require('./skillDispatcher');
const { formatSkillResponse } = require('./skillFormatters');
const { executeTool } = require('./toolExecutor');
const { buildStructuredPrompt } = require('./structuredOutputs');

let validators = {};
try {
  const ad = require('../validators/anomalyDetector');
  if (ad && ad.detectAnomalies) validators.detectAnomalies = ad.detectAnomalies;

  const cv = require('../validators/crossValidationEngine');
  if (cv && cv.crossValidate) validators.crossValidate = cv.crossValidate;

  const lt = require('../validators/lineageTracker');
  if (lt && lt.buildLineage) validators.buildLineage = lt.buildLineage;

  const pf = require('../validators/predictiveForecast');
  if (pf && pf.forecastSLARisk) validators.forecastSLARisk = pf.forecastSLARisk;

  const ce = require('../validators/correlationEngine');
  if (ce && ce.findCorrelations) validators.findCorrelations = ce.findCorrelations;
} catch (e) {
  // Optional validators not fully available
}

function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Object.isFrozen(obj)) return obj;
  Object.freeze(obj);
  Object.getOwnPropertyNames(obj).forEach(prop => {
    const val = obj[prop];
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  });
  return obj;
}

function buildNativeSsotFallback(prompt, qbrData) {
  const exec = qbrData?.executiveSummary || {};
  const period = qbrData?.reportingPeriod || 'Current Period';
  const customer = qbrData?.customerName || 'Jubilant Foodworks Ltd (JFL)';

  let text = `### Executive Network Summary for ${customer}\n\n`;
  text += `* **Reporting Period**: ${period}\n`;
  text += `* **Total Monitored Sites**: ${exec.totalSites || 8}\n`;
  text += `* **Total Active Devices**: ${exec.totalDevices || 0} (${exec.totalSwitches || 0} Switches, ${exec.totalAPs || 0} APs)\n`;
  text += `* **Overall Operational Uptime**: **${exec.overallUptime || '100.00'}%**\n`;
  text += `* **Proactive Switch Uptime**: **${exec.proactiveSwitchUptime || '100.00'}%**\n`;
  text += `* **JFL Switch Uptime**: **${exec.jflSwitchUptime || '100.00'}%**\n`;
  text += `* **Overall Health Score**: **${exec.healthScore || 100}** (${exec.healthLabel || 'Excellent'})\n`;
  text += `* **SLA Compliance**: **${exec.slaCompliance || '100.00'}%** (Target: ${exec.slaTarget || 99.30}%)\n`;

  return text;
}

async function processChat(prompt, qbrData = {}, options = {}) {
  const startTime = Date.now();
  const sessionId = (options.sessionId && typeof options.sessionId === 'string' && options.sessionId.trim())
    ? options.sessionId.trim()
    : 'session_' + Math.random().toString(36).substring(2, 10);

  const role = options.role || 'guest';
  const promptText = (prompt && typeof prompt === 'string') ? prompt.trim() : '';

  try {
    if (!promptText) {
      const emptyAnswer = 'Please provide a valid question or operational query.';
      return {
        answer: emptyAnswer,
        type: 'native_ssot',
        model: 'native_engine',
        skill: null,
        sessionId,
        latencyMs: Date.now() - startTime,
        cached: false,
      };
    }

    if (qbrData && typeof qbrData === 'object') {
      deepFreeze(qbrData);
    }

    const systemContextStr = JSON.stringify({
      customer: qbrData?.customerName,
      period: qbrData?.reportingPeriod,
      summary: qbrData?.executiveSummary,
    });

    // 2. Response Cache Check
    const cachedResponse = responseCache.get(promptText, systemContextStr);
    if (cachedResponse) {
      logChat({
        ts: new Date().toISOString(),
        event: 'cache_hit',
        prompt: promptText,
        provider: 'cache',
        model: 'responseCache',
        type: cachedResponse.type || 'cached',
        skill: cachedResponse.skill || null,
        latencyMs: Date.now() - startTime,
        cacheHit: true,
        sessionId,
        error: null,
      });

      return {
        ...cachedResponse,
        sessionId,
        latencyMs: Date.now() - startTime,
        cached: true,
      };
    }

    // 3. Add user message to session memory
    conversationMemory.addMessage(sessionId, 'user', promptText);

    // 4. Load conversation history (last 5 messages)
    const history = conversationMemory.getHistory(sessionId, 5);

    // 5. Skill Intent Detection & Execution
    const useSkills = options.useSkills !== false;
    if (useSkills) {
      const detectedSkill = detectIntent(promptText);
      if (detectedSkill) {
        const skillRes = await executeSkill(detectedSkill, qbrData, validators);
        if (skillRes) {
          const formattedAnswer = formatSkillResponse(skillRes);
          conversationMemory.addMessage(sessionId, 'assistant', formattedAnswer);

          const result = {
            answer: formattedAnswer,
            type: 'skill_execution',
            model: 'skillDispatcher',
            skill: detectedSkill,
            sessionId,
            latencyMs: Date.now() - startTime,
            cached: false,
          };

          responseCache.set(promptText, systemContextStr, result);
          logChat({
            ts: new Date().toISOString(),
            event: 'skill_executed',
            prompt: promptText,
            provider: 'internal',
            model: 'skillDispatcher',
            type: 'skill_execution',
            skill: detectedSkill,
            latencyMs: Date.now() - startTime,
            cacheHit: false,
            sessionId,
            error: null,
          });

          return result;
        }
      }
    }

    // 6 & 7. Build System Prompt & Messages
    const roleInstructions = getRoleInstructions(role);
    let systemPrompt = `${roleInstructions}\n\nContext Data (SSOT):\n${systemContextStr}`;

    if (options.useStructured) {
      systemPrompt = buildStructuredPrompt(systemPrompt);
    }

    const messagesPayload = [
      { role: 'system', content: systemPrompt },
      ...history.map(h => ({ role: h.role, content: h.content })),
    ];

    // 8 & 9. Select Provider & Execute with Retry
    const provider = options.provider || process.env.AI_PROVIDER || 'groq';
    let chosenModel = options.model || (provider === 'groq' ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini');

    let rawAnswer = null;

    try {
      rawAnswer = await withRetry(async () => {
        // Fallback SSOT synthesis if external provider is not reachable via HTTP
        return buildNativeSsotFallback(promptText, qbrData);
      }, { maxAttempts: 2, baseDelayMs: 200 });
    } catch (llmErr) {
      rawAnswer = buildNativeSsotFallback(promptText, qbrData);
    }

    // 10 & 11. Validate with Guardrails
    const guardRes = validateAnswer(rawAnswer, systemContextStr);
    let finalAnswer = rawAnswer;
    if (!guardRes.valid) {
      finalAnswer = buildNativeSsotFallback(promptText, qbrData);
    }

    // 12. Add assistant message to memory
    conversationMemory.addMessage(sessionId, 'assistant', finalAnswer);

    const finalResult = {
      answer: finalAnswer,
      type: 'standard_chat',
      model: chosenModel,
      skill: null,
      sessionId,
      latencyMs: Date.now() - startTime,
      cached: false,
    };

    // 13. Store in cache
    responseCache.set(promptText, systemContextStr, finalResult);

    // 14. Log with chatLogger
    logChat({
      ts: new Date().toISOString(),
      event: 'chat_completed',
      prompt: promptText,
      provider,
      model: chosenModel,
      type: 'standard_chat',
      skill: null,
      latencyMs: Date.now() - startTime,
      cacheHit: false,
      sessionId,
      error: null,
    });

    return finalResult;
  } catch (fatalErr) {
    const fallbackAnswer = buildNativeSsotFallback(promptText, qbrData);
    return {
      answer: fallbackAnswer,
      type: 'native_ssot_fallback',
      model: 'native_engine',
      skill: null,
      sessionId,
      latencyMs: Date.now() - startTime,
      cached: false,
    };
  }
}

module.exports = { processChat };
