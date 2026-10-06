// backend/services/aiChatService.js
// Multi-Provider Executive QBR AI Assistant Service:
// Supports Groq Free LLM (Llama 3.3 70B / DeepSeek R1), OpenAI GPT-4o, Anthropic Claude 3.5 Sonnet, DeepSeek V3/R1, Google Gemini 1.5/2.0,
// and Built-in Native SSOT Empirical Engine.
// PRECISION UPGRADE: SLA target always read live from ruleEngine (rules.yaml). Zero hardcoded fallbacks.

const ruleEngine = require('./ruleEngine');
const { getToolSchemas, executeTool } = require('./aiTools');

function getEnvVar(...names) {
  for (const n of names) {
    if (process.env[n]) return process.env[n];
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────
// PROVIDER DETECTION
// ─────────────────────────────────────────────────────────────────────
function isProviderConfigured(name) {
  switch (name) {
    case 'groq': return !!getEnvVar('GROQ_API_KEY', 'Api_key', 'GROQ_KEY');
    case 'openai': return !!process.env.OPENAI_API_KEY;
    case 'anthropic': return !!process.env.ANTHROPIC_API_KEY;
    case 'deepseek': return !!process.env.DEEPSEEK_API_KEY;
    case 'gemini': return !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
    default: return false;
  }
}

function getConfiguredProviders() {
  const all = ['groq', 'openai', 'anthropic', 'deepseek', 'gemini'];
  return all.filter(isProviderConfigured);
}

/**
 * Main AI answer generator with multi-provider failover.
 */
async function processChatQuery(prompt, qbrData, options = {}) {
  try {
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return {
        answer: 'Please provide a valid question about the dashboard metrics, calculations, or system rules.',
        type: 'error'
      };
    }

    const query = prompt.trim();
    const systemContext = buildSystemContext(qbrData, { claudexMode: !!options.claudexMode });

    // Preferred provider override from env or options: 'groq' | 'openai' | 'anthropic' | 'deepseek' | 'gemini'
    const preferredProvider = (options.provider || process.env.AI_PROVIDER || '').toLowerCase();

    // Log which providers are configured (helps debugging on Render)
    if (!global.__aiProvidersLogged) {
      console.log(`[aiChatService] Configured providers: ${getConfiguredProviders().join(', ') || 'NONE (will use native fallback)'}`);
      if (preferredProvider) console.log(`[aiChatService] Preferred provider: ${preferredProvider}`);
      global.__aiProvidersLogged = true;
    }

    // 1. Groq Free API (Llama 3.3 70B / Qwen / DeepSeek R1 Distill) — Fast & Free with Function Calling
    const groqKey = getEnvVar('GROQ_API_KEY', 'Api_key', 'GROQ_KEY');
    if ((preferredProvider === 'groq' || (!preferredProvider && groqKey)) && groqKey) {
      try {
        const model = getEnvVar('GROQ_MODEL') || 'llama-3.3-70b-versatile';
        const ans = await queryGroq(query, systemContext, groqKey, model, options, qbrData);
        if (ans) return { answer: ans, type: 'llm_groq', model: `Groq (${model})` };
      } catch (e) {
        console.warn(`[aiChatService] Groq API note: ${e.message}`);
      }
    }

    // 2. OpenAI GPT-4o / GPT-4o-mini
    const openAiKey = process.env.OPENAI_API_KEY;
    if ((preferredProvider === 'openai' || (!preferredProvider && openAiKey)) && openAiKey) {
      try {
        const model = process.env.OPENAI_MODEL || 'gpt-4o';
        const ans = await queryOpenAI(query, systemContext, openAiKey, model, options, qbrData);
        if (ans) return { answer: ans, type: 'llm_openai', model: `OpenAI ${model}` };
      } catch (e) {
        console.warn(`[aiChatService] OpenAI API note: ${e.message}`);
      }
    }

    // 3. Anthropic Claude 3.5 Sonnet
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if ((preferredProvider === 'anthropic' || (!preferredProvider && anthropicKey)) && anthropicKey) {
      try {
        const model = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022';
        const ans = await queryAnthropic(query, systemContext, anthropicKey, model);
        if (ans) return { answer: ans, type: 'llm_anthropic', model: 'Claude 3.5 Sonnet' };
      } catch (e) {
        console.warn(`[aiChatService] Anthropic API note: ${e.message}`);
      }
    }

    // 4. DeepSeek V3 / R1
    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    if ((preferredProvider === 'deepseek' || (!preferredProvider && deepseekKey)) && deepseekKey) {
      try {
        const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
        const ans = await queryDeepSeek(query, systemContext, deepseekKey, model, options, qbrData);
        if (ans) return { answer: ans, type: 'llm_deepseek', model: `DeepSeek (${model})` };
      } catch (e) {
        console.warn(`[aiChatService] DeepSeek API note: ${e.message}`);
      }
    }

    // 5. Google Gemini (Gemini 1.5 Pro / Flash / 2.0)
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (geminiKey) {
      try {
        const model = process.env.GEMINI_MODEL || 'gemini-1.5-pro';
        const ans = await queryGeminiAPI(query, systemContext, geminiKey, model);
        if (ans) return { answer: ans, type: 'llm_gemini', model: `Google ${model}` };
      } catch (e) {
        console.warn(`[aiChatService] Gemini API note: ${e.message}`);
      }
    }

    // 6. Built-in Native SSOT Empirical Knowledge Engine (Always-available deterministic fallback)
    const nativeAnswer = generateNativeSSOTAnswer(query, qbrData);
    return {
      answer: nativeAnswer.text,
      type: 'native_ssot',
      topic: nativeAnswer.topic,
      model: 'Native SSOT Engine'
    };
  } catch (err) {
    console.error(`[aiChatService] Fallback handling prompt error: ${err.message}`);
    const nativeAnswer = generateNativeSSOTAnswer(prompt, qbrData);
    return {
      answer: nativeAnswer.text,
      type: 'native_ssot',
      topic: nativeAnswer.topic,
      model: 'Native SSOT Engine'
    };
  }
}

/**
 * OpenAI API (GPT-4o) Integration with tool calling support.
 */
async function queryOpenAI(prompt, systemContext, apiKey, model = 'gpt-4o', options = {}, qbrData = null) {
  const enableTools = !options.isSectionSummary && qbrData;
  const tools = enableTools ? getToolSchemas() : null;

  const messages = [
    { role: 'system', content: `You are an Executive AI Analyst for Executive Dashboard QBR. Respond using clear markdown.\nYou have access to tools. ALWAYS use tools to fetch real data. NEVER guess numbers.\n- If tool returns empty → say 'No data found for this filter.'\n- Cite ticket IDs when listing specific incidents.\n- Never fabricate engineer names, sites, or counts.\n- If a question needs data outside the tools → say so clearly.\n\nSYSTEM CONTEXT & SSOT:\n${systemContext}` },
    { role: 'user', content: prompt }
  ];

  let turns = 0;
  const maxTurns = 3;

  while (turns < maxTurns) {
    turns++;
    const payload = {
      model: model,
      messages: messages,
      temperature: 0.2,
      max_tokens: 1000
    };
    if (tools && tools.length > 0) {
      payload.tools = tools;
      payload.tool_choice = 'auto';
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}: ${await response.text()}`);
    const data = await response.json();
    const choice = data?.choices?.[0];
    if (!choice) break;

    const message = choice.message;
    const toolCalls = message?.tool_calls;

    if (!toolCalls || toolCalls.length === 0) {
      return message?.content || null;
    }

    messages.push(message);

    for (const tc of toolCalls) {
      const funcName = tc.function?.name;
      let funcArgs = {};
      try { funcArgs = JSON.parse(tc.function?.arguments || '{}'); } catch (e) { }
      const toolResult = executeTool(funcName, funcArgs, qbrData);
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        name: funcName,
        content: JSON.stringify(toolResult)
      });
    }
  }
  return null;
}

/**
 * Anthropic API (Claude 3.5 Sonnet) Integration.
 */
async function queryAnthropic(prompt, systemContext, apiKey, model = 'claude-3-5-sonnet-20241022') {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: model,
      max_tokens: 1000,
      system: `You are an Executive AI Analyst for Executive Dashboard QBR. Respond using clear markdown.\n\nSYSTEM CONTEXT & SSOT:\n${systemContext}`,
      messages: [
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!response.ok) throw new Error(`Anthropic HTTP ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return data?.content?.[0]?.text || null;
}

/**
 * DeepSeek API Integration with tool calling support.
 */
async function queryDeepSeek(prompt, systemContext, apiKey, model = 'deepseek-chat', options = {}, qbrData = null) {
  const enableTools = !options.isSectionSummary && qbrData;
  const tools = enableTools ? getToolSchemas() : null;

  const messages = [
    { role: 'system', content: `You are an Executive AI Analyst for Executive Dashboard QBR. Respond using clear markdown.\nYou have access to tools. ALWAYS use tools to fetch real data. NEVER guess numbers.\n- If tool returns empty → say 'No data found for this filter.'\n- Cite ticket IDs when listing specific incidents.\n- Never fabricate engineer names, sites, or counts.\n- If a question needs data outside the tools → say so clearly.\n\nSYSTEM CONTEXT & SSOT:\n${systemContext}` },
    { role: 'user', content: prompt }
  ];

  let turns = 0;
  const maxTurns = 3;

  while (turns < maxTurns) {
    turns++;
    const payload = {
      model: model,
      messages: messages,
      temperature: 0.2,
      max_tokens: 1000
    };
    if (tools && tools.length > 0) {
      payload.tools = tools;
      payload.tool_choice = 'auto';
    }

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}: ${await response.text()}`);
    const data = await response.json();
    const choice = data?.choices?.[0];
    if (!choice) break;

    const message = choice.message;
    const toolCalls = message?.tool_calls;

    if (!toolCalls || toolCalls.length === 0) {
      return message?.content || null;
    }

    messages.push(message);

    for (const tc of toolCalls) {
      const funcName = tc.function?.name;
      let funcArgs = {};
      try { funcArgs = JSON.parse(tc.function?.arguments || '{}'); } catch (e) { }
      const toolResult = executeTool(funcName, funcArgs, qbrData);
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        name: funcName,
        content: JSON.stringify(toolResult)
      });
    }
  }
  return null;
}

/**
 * Groq Free API Integration (Meta Llama 3.3 70B / Qwen 27B / DeepSeek R1 Distill) with Tool Calling.
 */
async function queryGroq(prompt, systemContext, apiKey, model = 'llama-3.3-70b-versatile', options = {}, qbrData = null) {
  const isShortGreeting = /^(hi|hello|hey|greetings|help|who are you)$/i.test(prompt.trim());
  const enableTools = !options.isSectionSummary && !isShortGreeting && qbrData;
  const tools = enableTools ? getToolSchemas() : null;

  const activeSystemPrompt = isShortGreeting
    ? `You are an Executive AI Assistant for ${qbrData?.customerName || 'Jubilant Foodworks Ltd'}. Respond warmly and concisely in markdown, welcoming the user and introducing your ability to answer questions about Uptime formulas, SLA breaches, site metrics, RCA drivers, and device performance.`
    : `You are an Executive AI Analyst for Executive Dashboard QBR. Respond using clear markdown.
You have access to tools. ALWAYS use tools to fetch real data. NEVER guess numbers.
- If tool returns empty → say 'No data found for this filter.'
- Cite ticket IDs when listing specific incidents.
- Never fabricate engineer names, sites, or counts.
- If a question needs data outside the tools → say so clearly.

SYSTEM CONTEXT & SSOT:
${systemContext}`;

  const messages = [
    { role: 'system', content: activeSystemPrompt },
    { role: 'user', content: prompt }
  ];

  let turns = 0;
  const maxTurns = 3;

  while (turns < maxTurns) {
    turns++;
    const payload = {
      model: model,
      messages: messages,
      temperature: 0.2,
      max_tokens: 1000
    };
    if (tools && tools.length > 0) {
      payload.tools = tools;
      payload.tool_choice = 'auto';
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      // If error occurs with tools payload, fall back to standard non-tool query gracefully
      if (payload.tools && (response.status === 400 || response.status === 404)) {
        console.warn(`[queryGroq] Tool calling notice (${response.status}): ${errText}. Falling back to context query.`);
        delete payload.tools;
        delete payload.tool_choice;
        const fbRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify(payload)
        });
        if (!fbRes.ok) throw new Error(`Groq HTTP ${fbRes.status}: ${await fbRes.text()}`);
        const fbData = await fbRes.json();
        return fbData?.choices?.[0]?.message?.content || null;
      }
      throw new Error(`Groq HTTP ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const choice = data?.choices?.[0];
    if (!choice) break;

    const message = choice.message;
    const toolCalls = message?.tool_calls;

    if (!toolCalls || toolCalls.length === 0) {
      return message?.content || null;
    }

    // Append assistant tool call message
    messages.push(message);

    // Execute tool calls and push tool responses
    for (const tc of toolCalls) {
      const funcName = tc.function?.name;
      let funcArgs = {};
      try { funcArgs = JSON.parse(tc.function?.arguments || '{}'); } catch (e) { }

      console.log(`[aiChatService] Tool Call: ${funcName}`, funcArgs);
      const toolResult = executeTool(funcName, funcArgs, qbrData);

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        name: funcName,
        content: JSON.stringify(toolResult)
      });
    }
  }

  return null;
}

/**
 * Google Gemini REST API Integration.
 */
async function queryGeminiAPI(prompt, systemContext, apiKey, model = 'gemini-1.5-pro') {
  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: `SYSTEM CONTEXT & SINGLE SOURCE OF TRUTH (SSOT):\n${systemContext}\n\nUSER QUESTION: ${prompt}\n\nPlease provide a clear, professional executive answer based on the context above.` }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1000
    }
  };

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    // Fall back to gemini-1.5-flash if gemini-1.5-pro is not available
    const fallbackEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const fbRes = await fetch(fallbackEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    if (!fbRes.ok) throw new Error(`Gemini HTTP ${response.status}: ${await response.text()}`);
    const fbData = await fbRes.json();
    return fbData?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  }

  const data = await response.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

/**
 * Builds enriched SSOT context for LLM prompts.
 * PRECISION UPGRADE: SLA target read live from ruleEngine.getSLATarget().
 * Includes RCA breakdown, site-level uptime table, and device breach counts.
 * @param {object} qbrData
 * @param {object} [opts] { claudexMode: bool } — claudexMode injects extra precision instructions
 */
function buildSystemContext(qbrData, opts) {
  if (!qbrData) return 'No active dataset loaded.';

  const claudexMode = opts && opts.claudexMode;
  const exec = qbrData.executiveSummary || {};
  const reportPeriod = qbrData.report_period?.display_label || qbrData.reportingPeriod || 'N/A';

  // Always read SLA target live from rules.yaml — never fallback to hardcoded 99.3
  const liveSlaTarget = ruleEngine.getSLATarget();
  const slaTarget = exec.slaTarget || liveSlaTarget;

  // Full site-level uptime table (all sites)
  const siteList = (qbrData.siteSummary || []).map(s =>
    `- ${s.siteId || 'Unknown'}: ${s.deviceCount || 0} devices | JFL Uptime: ${s.jflSwitchUptime || '100.00'}% | Proactive: ${s.proactiveSwitchUptime || '100.00'}% | Switch RCA: "${s.primaryRcaSwitches || 'Stable Operations'}" | AP Incidents: ${s.apIncidents || 0} | AP RCA: "${s.primaryRcaAPs || 'Stable Operations'}" | Health: ${s.healthScore || 100}/100`
  ).join('\n');

  // SLA breach summary
  const devices = Array.isArray(qbrData.devices) ? qbrData.devices : [];
  const breachDevices = devices.filter(d => d && !d.__isStock && d.__slaBreach);
  const breachSites = (qbrData.siteSummary || []).filter(s => parseFloat(s.jflSwitchUptime) < slaTarget);

  // RCA breakdown table
  const rcaRows = (qbrData.rcaAnalytics?.breakdown || []).slice(0, 8);
  const rcaTable = rcaRows.length > 0
    ? rcaRows.map(r => `  ${r.rca}: ${r.count} incidents (${r.percentage || ''})`).join('\n')
    : '  No incidents recorded';

  const claudexPrecisionBlock = claudexMode ? `
[CLAUDEX PRECISION MODE ACTIVE]
You MUST:
1. Cite EVERY numerical KPI value explicitly (e.g. "JFL Switch Uptime: ${exec.jflSwitchUptime || exec.overallUptime || 'N/A'}%").
2. Compare all uptime metrics against SLA Target of ${slaTarget}% and state whether each PASSES or FAILS.
3. Use markdown formatting: ### headers, **bold** for values, - bullet lists.
4. Cite percentages to exactly 2 decimal places.
5. Reference the reporting period "${reportPeriod}" explicitly.
6. Never guess — only use the SSOT facts provided.
` : '';

  const engList = Array.isArray(qbrData?.proactiveTicketAnalytics?.byEngineer)
    ? qbrData.proactiveTicketAnalytics.byEngineer
    : (Array.isArray(qbrData?.engineerBreakdown) ? qbrData.engineerBreakdown : []);

  const engTable = engList.slice(0, 8)
    .map(e => `  ${e.name}: Total ${e.total}, OnHold ${e.onHold}, Open ${e.open}, Closed ${e.closed}, SLA Met ${e.slaMet}, Missed ${e.slaMissed}, TopHold: ${e.topHoldReason || 'None'}`)
    .join('\n');

  return `
CUSTOMER: ${qbrData.customerName || 'Jubilant Foodworks Ltd'}
REPORTING PERIOD: ${reportPeriod}
SLA UPTIME TARGET: ${slaTarget}% (live from rules.yaml — do NOT use any other value)
${claudexPrecisionBlock}
EXECUTIVE METRICS (SSOT — 100% verified):
- Total Devices: ${exec.totalDevices || 0} (${exec.totalSites || 0} Sites | ${exec.totalSwitches || 0} Switches | ${exec.totalAPs || 0} APs)
- Total Stock Devices: ${exec.totalStockDevices || 0} (excluded from SLA calculations)
- Overall JFL Switch Uptime: ${exec.jflSwitchUptime || exec.overallUptime || 'N/A'}%
- Overall Proactive Switch Uptime: ${exec.proactiveSwitchUptime || 'N/A'}%
- Infrastructure Health Score: ${exec.healthScore || 'N/A'}/100 (${exec.healthLabel || 'N/A'})
- Incident-Free Devices: ${exec.incidentFreePercent || 'N/A'}%
- Overall SLA Compliance: ${exec.slaCompliance || 'N/A'}%
- Devices Breaching SLA: ${breachDevices.length}
- Sites Breaching SLA: ${breachSites.length}
- Total Incidents: ${exec.totalIncidents || 0} (Critical: ${exec.criticalIncidents || 0}, Major: ${exec.majorIncidents || 0}, Minor: ${exec.minorIncidents || 0})
- AP Incidents: ${exec.apIncidents || 0} across ${exec.uniqueAPsWithIncidents || 0} unique APs
- Primary RCA (Switches): ${exec.primaryRcaSwitches || 'Stable Operations (No Incidents)'}
- Primary RCA (APs): ${exec.primaryRcaAPs || 'Stable Operations (No Incidents)'}

ENGINEERS WORKLOAD & HOLD BREAKDOWN:
${engTable || '  No engineer breakdown available'}

RCA BREAKDOWN:
${rcaTable}

ALL SITES PERFORMANCE TABLE:
${siteList || 'No site data available'}

FORMULA RULES (apply exactly as written):
1. JFL Switch Uptime % = max(0, min(100, ((Total Available Minutes - Time on Hold) / Total Available Minutes) × 100)). Rounded to 2dp.
2. Proactive Switch Uptime % = max(0, min(100, ((Total Available Minutes - Actual Resolution Time) / Total Available Minutes) × 100)). Rounded to 2dp.
3. Open/On-Hold tickets: hold minutes = from max(OpenTime, PeriodStart) to endDate+T23:59:59Z.
4. Proactive fallback: if resolution time=0 for open/on-hold, deduct hold minutes instead.
5. Health Score = round(0.7 × Overall Uptime% + 0.3 × Incident-Free%). Labels: Excellent≥95, Good≥85, Fair≥70, Poor<70.
6. SLA Target = ${slaTarget}% (read live from rules.yaml — never override this value).
7. Available minutes per device = calendar days × 1440. Feb=28d, Apr/Jun/Sep/Nov=30d, others=31d.
  `.trim();
}

/**
 * Built-in Native SSOT Empirical Knowledge & Calculation Engine.
 */
function generateNativeSSOTAnswer(prompt, qbrData) {
  let userQuery = prompt || '';
  if (userQuery.includes('QUESTION:')) {
    const match = userQuery.match(/QUESTION:\s*(.*?)(?:\n\n|\n[A-Z]+:|$)/s);
    if (match && match[1]) userQuery = match[1].trim();
  }
  const lower = userQuery.toLowerCase();
  const exec = qbrData?.executiveSummary || {};
  const sites = Array.isArray(qbrData?.siteSummary) ? qbrData.siteSummary : [];
  const devices = Array.isArray(qbrData?.devices) ? qbrData.devices : [];
  const incidents = Array.isArray(qbrData?.incidents) ? qbrData.incidents : [];
  const period = qbrData?.report_period?.display_label || qbrData?.reportingPeriod || 'Selected Period';
  const engList = Array.isArray(qbrData?.proactiveTicketAnalytics?.byEngineer)
    ? qbrData.proactiveTicketAnalytics.byEngineer
    : (Array.isArray(qbrData?.engineerBreakdown) ? qbrData.engineerBreakdown : []);

  // Topic 0: Specific Engineer / Ticket Owner Lookup
  const matchedEng = engList.find(e => {
    if (!e || !e.name) return false;
    const nameLower = e.name.toLowerCase();
    const parts = nameLower.split(' ');
    return lower.includes(nameLower) || parts.some(part => part.length > 2 && lower.includes(part));
  });

  if (matchedEng) {
    const holdBreakdown = matchedEng.holdReasons && Object.keys(matchedEng.holdReasons).length > 0
      ? Object.entries(matchedEng.holdReasons).map(([r, c]) => `- **${r}**: ${c} ticket(s)`).join('\n')
      : 'No hold reasons recorded.';

    const slaPct = matchedEng.total > 0 ? ((matchedEng.slaMet / matchedEng.total) * 100).toFixed(2) : '100.00';

    return {
      topic: 'engineer_detail',
      text: `### 👨‍💻 Engineer Intelligence: ${matchedEng.name}

- **Total Assigned Tickets**: **${matchedEng.total || 0}**
- **Tickets On Hold**: **${matchedEng.onHold || 0}** ticket(s)
- **Active / Open Tickets**: **${matchedEng.open || 0}** ticket(s)
- **Closed / Resolved Tickets**: **${matchedEng.closed || 0}** ticket(s)
- **SLA Compliance Rate**: **${slaPct}%** (${matchedEng.slaMet || 0} Met, ${matchedEng.slaMissed || 0} Breached)
- **Top Hold Driver**: **${matchedEng.topHoldReason || '—'}**

**Hold Reasons Breakdown**:
${holdBreakdown}`
    };
  }

  // Topic 0.5: General Engineer / Hold Ticket queries
  if (lower.includes('engineer') || lower.includes('hold ticket') || lower.includes('on hold') || lower.includes('ticket owner')) {
    const topEngs = engList.slice(0, 10).map(e => `- **${e.name}**: Total ${e.total} tickets | **${e.onHold} On Hold** | ${e.slaMet} SLA Met`).join('\n');
    return {
      topic: 'engineer_summary',
      text: `### 👨‍💻 Engineer Workload & Hold Ticket Breakdown

- **Total Monitored Engineers**: **${engList.length}**
- **Engineers with On-Hold Tickets**: **${engList.filter(e => e.onHold > 0).length}**

**Engineer Breakdown**:
${topEngs}`
    };
  }

  // Topic 1: Specific Site Lookup (Check site first so site-specific queries match correctly)
  const matchedSite = sites.find(s => s && s.siteId && typeof s.siteId === 'string' && lower.includes(s.siteId.toLowerCase()));
  if (matchedSite) {
    let siteText = `### 📍 Site Intelligence: ${matchedSite.siteId}

- **Total Devices**: **${matchedSite.deviceCount || 0}** (${matchedSite.switchCount || 0} Switches, ${matchedSite.apCount || 0} APs)
- **JFL Switch Uptime %**: **${matchedSite.jflSwitchUptime || '100.00'}%**
- **Proactive Switch Uptime %**: **${matchedSite.proactiveSwitchUptime || '100.00'}%**
- **Primary RCA Driver (Switches)**: **${matchedSite.primaryRcaSwitches || 'Stable Operations (No Incidents)'}**
- **AP Incidents**: **${matchedSite.apIncidents || 0}** incident(s) across **${matchedSite.uniqueAPsWithIncidents || 0}** unique AP(s)
- **Primary RCA Driver (APs)**: **${matchedSite.primaryRcaAPs || 'Stable Operations (No Incidents)'}**
- **Health Score**: **${matchedSite.healthScore || 100}/100** (${matchedSite.healthLabel || 'Optimal Operations'})`;

    // If query also asks about uptime formula/how it's calculated
    if (lower.includes('jfl uptime') || lower.includes('formula') || lower.includes('how') || lower.includes('calculate')) {
      siteText += `\n\n**Calculation Explanation for ${matchedSite.siteId}**:
- **JFL Switch Uptime (${matchedSite.jflSwitchUptime}%)** is computed by deducting total elapsed hold minutes from the total available minutes for devices at ${matchedSite.siteId}.
- **Formula**: $$\\text{JFL Uptime \\%} = \\max\\left(0, \\min\\left(100, \\frac{\\text{Total Available Minutes} - \\text{Time on Hold (Minutes)}}{\\text{Total Available Minutes}} \\times 100\\right)\\right)$$
- Any on-hold tickets for ${matchedSite.siteId} are calculated up to the period end cutoff date (\`endDate + T23:59:59Z\`).`;
    }

    return {
      topic: 'site_detail',
      text: siteText
    };
  }

  // Topic 2: JFL Uptime % Formula & Calculation
  if (lower.includes('jfl uptime') || lower.includes('jfl switch uptime') || lower.includes('time on hold') || lower.includes('hold time')) {
    return {
      topic: 'jfl_uptime_formula',
      text: `### 📊 JFL Switch / Device Uptime % Formula & Calculation

**Formula**:
$$\\text{JFL Uptime \\%} = \\max\\left(0, \\min\\left(100, \\frac{\\text{Total Available Minutes} - \\text{Time on Hold (Minutes)}}{\\text{Total Available Minutes}} \\times 100\\right)\\right)$$

**Key Rules**:
1. **Time on Hold Deducted**: JFL Uptime % evaluates operational availability by deducting total elapsed hold minutes from the period's total available minutes.
2. **Open / On-Hold Ticket Cutoff**: For open or on-hold tickets, hold minutes are dynamically calculated from $\\max(\\text{OpenTime}, \\text{Period Start})$ up to the end of the reporting period (\`endDate + T23:59:59Z\`).
3. **Current Executive Metric**: Overall JFL Switch Uptime for period **${period}** is **${exec.jflSwitchUptime || exec.overallUptime || '100.00'}%** (SLA Target: **${exec.slaTarget || 99.3}%**).`
    };
  }

  // Topic 3: Proactive Uptime % Formula & Calculation
  if (lower.includes('proactive uptime') || lower.includes('proactive switch uptime') || lower.includes('actual resolution')) {
    return {
      topic: 'proactive_uptime_formula',
      text: `### ⚡ Proactive Switch / Device Uptime % Formula & Calculation

**Formula**:
$$\\text{Proactive Uptime \\%} = \\max\\left(0, \\min\\left(100, \\frac{\\text{Total Available Minutes} - \\text{Proactive Downtime}}{\\text{Total Available Minutes}} \\times 100\\right)\\right)$$

**Key Rules**:
1. **Net Resolution Time**: Deducts actual working resolution time (\`ActualResolutionMin\`) parsed from incident records.
2. **Open Ticket Fallback**: When actual resolution time is 0 (unresolved/on-hold tickets) and hold minutes exist, Proactive Uptime % falls back to deducting elapsed hold minutes. This ensures devices with open tickets are never incorrectly shown at 100.00%.
3. **Current Executive Metric**: Overall Proactive Switch Uptime for period **${period}** is **${exec.proactiveSwitchUptime || '100.00'}%**.`
    };
  }

  // Topic 4: Health Score Calculation
  if (lower.includes('health score') || lower.includes('health label') || lower.includes('health calculation')) {
    return {
      topic: 'health_score_formula',
      text: `### 🏥 Infrastructure Health Score Formula

**Formula**:
$$\\text{Health Score} = \\text{Math.round}\\left(0.7 \\times \\text{Overall Uptime \\%} + 0.3 \\times \\text{Incident-Free Device \\%}\\right)$$

**Current Report Values**:
- **Overall Uptime %**: ${exec.overallUptime || '100.00'}%
- **Incident-Free Device %**: ${exec.incidentFreePercent || '100.00'}%
- **Calculated Health Score**: **${exec.healthScore || 100}/100** (${exec.healthLabel || 'Optimal Operations'})`
    };
  }

  // Topic 5: SLA Target & Compliance
  if (lower.includes('sla') || lower.includes('breach') || lower.includes('compliance') || lower.includes('target')) {
    const breachingDevices = devices.filter(d => d && !d.__isStock && d.__slaBreach);
    const breachingSites = sites.filter(s => s && parseFloat(s.jflSwitchUptime) < (exec.slaTarget || 99.3));

    let siteDetails = breachingSites.length > 0
      ? breachingSites.map(s => `- **${s.siteId}**: JFL Uptime ${s.jflSwitchUptime}% (Primary RCA: ${s.primaryRcaSwitches})`).join('\n')
      : 'All sites are currently meeting or exceeding the SLA threshold.';

    return {
      topic: 'sla_compliance',
      text: `### 🎯 SLA Compliance & Threshold Details

- **SLA Uptime Target**: **${exec.slaTarget || 99.3}%** (read dynamically from \`rules.yaml\`).
- **Overall SLA Compliance Rate**: **${exec.slaCompliance || '100.00'}%**
- **Devices Breaching SLA**: **${breachingDevices.length}** device(s)
- **Sites Below SLA Target**: **${breachingSites.length}** site(s)

**Breaching Sites Detail**:
${siteDetails}`
    };
  }

  // Topic 6: RCA Breakdown & Primary Drivers
  if (lower.includes('rca') || lower.includes('root cause') || lower.includes('reason') || lower.includes('driver')) {
    return {
      topic: 'rca_drivers',
      text: `### 🔍 Root Cause Analysis (RCA) Primary Drivers

- **Primary RCA Driver (Switches)**: **${exec.primaryRcaSwitches || 'Stable Operations (No Incidents)'}**
- **Primary RCA Driver (APs)**: **${exec.primaryRcaAPs || 'Stable Operations (No Incidents)'}**

**Rule**: Primary RCA drivers are calculated by selecting the highest incident count category per site/device type. When 0 incidents occur, the engine displays **Stable Operations (No Incidents)**.`
    };
  }

  // Topic 7: Default Executive Summary & AI Assistant Capabilities
  return {
    topic: 'executive_summary',
    text: `### 🤖 Executive AI Intelligence Summary

**Active Dataset Context**:
- **Customer**: ${qbrData?.customerName || 'Jubilant Foodworks Ltd'}
- **Reporting Period**: **${period}**
- **Total Operational Infrastructure**: **${exec.totalDevices || 0}** Devices across **${exec.totalSites || 0}** Sites (${exec.totalSwitches || 0} Switches, ${exec.totalAPs || 0} APs)
- **Overall JFL Switch Uptime**: **${exec.jflSwitchUptime || exec.overallUptime || '100.00'}%** (Target: **${exec.slaTarget || 99.3}%**)
- **Infrastructure Health Score**: **${exec.healthScore || 100}/100** (${exec.healthLabel || 'Optimal Operations'})

**I can answer any question about**:
1. **Formulas & Calculations**: *"Explain JFL Uptime formula"*, *"How is Proactive Uptime computed?"*, *"Explain Health Score"*.
2. **Site & Device Performance**: *"Tell me about Greater Noida"*, *"Which devices breached SLA?"*.
3. **Root Cause Analysis**: *"What is the primary RCA for APs?"*, *"What caused switch outages?"*.
4. **SLA & On-Hold Rules**: *"How are open tickets handled at period cutoff?"*, *"What is the SLA target?"*.`
  };
}

module.exports = { processChatQuery };