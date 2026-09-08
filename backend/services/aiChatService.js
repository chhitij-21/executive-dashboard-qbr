// backend/services/aiChatService.js
// Multi-Provider Executive QBR AI Assistant Service:
// Supports Groq Free LLM (Llama 3.3 70B / DeepSeek R1), OpenAI GPT-4o, Anthropic Claude 3.5 Sonnet, DeepSeek V3/R1, Google Gemini 1.5/2.0,
// and Built-in Native SSOT Empirical Engine.

const ruleEngine = require('./ruleEngine');

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
    const systemContext = buildSystemContext(qbrData);

    // Preferred provider override from env or options: 'groq' | 'openai' | 'anthropic' | 'deepseek' | 'gemini'
    const preferredProvider = (options.provider || process.env.AI_PROVIDER || '').toLowerCase();

    // 1. Groq Free API (Llama 3.3 70B / DeepSeek R1 Distill) - Fast & Free
    const groqKey = process.env.GROQ_API_KEY;
    if ((preferredProvider === 'groq' || (!preferredProvider && groqKey)) && groqKey) {
      try {
        const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
        const ans = await queryGroq(query, systemContext, groqKey, model);
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
        const ans = await queryOpenAI(query, systemContext, openAiKey, model);
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
        const ans = await queryDeepSeek(query, systemContext, deepseekKey, model);
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
 * OpenAI API (GPT-4o) Integration.
 */
async function queryOpenAI(prompt, systemContext, apiKey, model = 'gpt-4o') {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: `You are an Executive AI Analyst for Executive Dashboard QBR. Respond using clear markdown.\n\nSYSTEM CONTEXT & SSOT:\n${systemContext}` },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 1000
    })
  });

  if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return data?.choices?.[0]?.message?.content || null;
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
 * DeepSeek API Integration.
 */
async function queryDeepSeek(prompt, systemContext, apiKey, model = 'deepseek-chat') {
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: `You are an Executive AI Analyst for Executive Dashboard QBR. Respond using clear markdown.\n\nSYSTEM CONTEXT & SSOT:\n${systemContext}` },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 1000
    })
  });

  if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return data?.choices?.[0]?.message?.content || null;
}

/**
 * Groq Free API Integration (Meta Llama 3.3 70B / DeepSeek R1 Distill).
 */
async function queryGroq(prompt, systemContext, apiKey, model = 'llama-3.3-70b-versatile') {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: `You are an Executive AI Analyst for Executive Dashboard QBR. Respond using clear markdown.\n\nSYSTEM CONTEXT & SSOT:\n${systemContext}` },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 1000
    })
  });

  if (!response.ok) throw new Error(`Groq HTTP ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return data?.choices?.[0]?.message?.content || null;
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
 * Builds compact textual SSOT context for LLM prompts.
 */
function buildSystemContext(qbrData) {
  if (!qbrData) return 'No active dataset loaded.';

  const exec = qbrData.executiveSummary || {};
  const reportPeriod = qbrData.report_period?.display_label || qbrData.reportingPeriod || 'N/A';
  const siteList = (qbrData.siteSummary || []).map(s =>
    `- ${s.siteId || 'Unknown Site'}: ${s.deviceCount || 0} devices, JFL Uptime: ${s.jflSwitchUptime || '100.00'}%, Proactive Uptime: ${s.proactiveSwitchUptime || '100.00'}%, Primary Switch RCA: "${s.primaryRcaSwitches || 'Stable Operations'}", AP Incidents: ${s.apIncidents || 0}, Primary AP RCA: "${s.primaryRcaAPs || 'Stable Operations'}"`
  ).join('\n');

  return `
CUSTOMER: ${qbrData.customerName || 'Jubilant Foodworks Ltd'}
REPORTING PERIOD: ${reportPeriod}
SLA TARGET: ${exec.slaTarget || 99.3}%

EXECUTIVE METRICS:
- Total Devices: ${exec.totalDevices || 0} (${exec.totalSites || 0} Sites, ${exec.totalSwitches || 0} Switches, ${exec.totalAPs || 0} APs)
- Overall JFL Switch Uptime: ${exec.jflSwitchUptime || exec.overallUptime || '100.00'}%
- Overall Proactive Switch Uptime: ${exec.proactiveSwitchUptime || '100.00'}%
- Infrastructure Health Score: ${exec.healthScore || 100}/100 (${exec.healthLabel || 'Optimal'})
- Incident-Free Devices: ${exec.incidentFreePercent || '100.00'}%
- SLA Compliance: ${exec.slaCompliance || '100.00'}%
- Primary RCA (Switches): ${exec.primaryRcaSwitches || 'Stable Operations'}
- Primary RCA (APs): ${exec.primaryRcaAPs || 'Stable Operations'}

SITES SUMMARY:
${siteList}

FORMULA RULES:
1. JFL Switch Uptime % = ((Total Available Minutes - Time on Hold) / Total Available Minutes) * 100
2. Proactive Switch Uptime % = ((Total Available Minutes - Proactive Downtime) / Total Available Minutes) * 100
3. For Open/On-Hold tickets, elapsed hold time is calculated from max(OpenTime, Period Start) up to period cutoff (endDate + 23:59:59Z).
4. Proactive uptime falls back to using hold mins deduction for open/on-hold tickets when actual resolution time is 0.
5. Health Score = (0.7 * Overall Uptime) + (0.3 * Incident Free %).
6. SLA Target is 99.3% from rules.yaml.
  `.trim();
}

/**
 * Built-in Native SSOT Empirical Knowledge & Calculation Engine.
 */
function generateNativeSSOTAnswer(prompt, qbrData) {
  const lower = (prompt || '').toLowerCase();
  const exec = qbrData?.executiveSummary || {};
  const sites = Array.isArray(qbrData?.siteSummary) ? qbrData.siteSummary : [];
  const devices = Array.isArray(qbrData?.devices) ? qbrData.devices : [];
  const incidents = Array.isArray(qbrData?.incidents) ? qbrData.incidents : [];
  const period = qbrData?.report_period?.display_label || qbrData?.reportingPeriod || 'Selected Period';

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

