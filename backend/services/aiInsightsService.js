// backend/services/aiInsightsService.js
// Enterprise AI Engine for Executive Intelligence Briefing
// Virtual CTO AI Engine providing executive summaries, business risks, and action items.

'use strict';

const ruleEngine = require('./ruleEngine');

function getEnvVar(...names) {
  for (const n of names) {
    if (process.env[n]) return process.env[n];
  }
  return undefined;
}

/**
 * Attempts to call configured LLM (Groq, OpenAI, Gemini, Anthropic)
 */
async function callLLM(systemPrompt, userPrompt) {
  const groqKey = getEnvVar('GROQ_API_KEY', 'Api_key', 'GROQ_KEY');
  const openAiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  // 1. Groq
  if (groqKey) {
    try {
      const model = getEnvVar('GROQ_MODEL') || 'llama-3.3-70b-versatile';
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groqKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.2,
          max_tokens: 600,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        const content = json.choices?.[0]?.message?.content;
        if (content) return JSON.parse(content);
      }
    } catch (e) {
      console.warn(`[aiInsightsService] Groq call failed: ${e.message}`);
    }
  }

  // 2. OpenAI
  if (openAiKey) {
    try {
      const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openAiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.2,
          max_tokens: 600,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        const content = json.choices?.[0]?.message?.content;
        if (content) return JSON.parse(content);
      }
    } catch (e) {
      console.warn(`[aiInsightsService] OpenAI call failed: ${e.message}`);
    }
  }

  // 3. Gemini
  if (geminiKey) {
    try {
      const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${systemPrompt}\n\nInput Data:\n${userPrompt}` }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            maxOutputTokens: 600,
            temperature: 0.2
          },
        }),
      });
      if (res.ok) {
        const json = await res.json();
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return JSON.parse(text);
      }
    } catch (e) {
      console.warn(`[aiInsightsService] Gemini call failed: ${e.message}`);
    }
  }

  // 4. Anthropic
  if (anthropicKey) {
    try {
      const model = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022';
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 600,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });
      if (res.ok) {
        const json = await res.json();
        const raw = json.content?.[0]?.text;
        if (raw) {
          const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
          return JSON.parse(cleaned);
        }
      }
    } catch (e) {
      console.warn(`[aiInsightsService] Anthropic call failed: ${e.message}`);
    }
  }

  return null;
}

/**
 * Generates deterministic CTO-grade enterprise insights based directly on validated SSOT data.
 */
function generateFallbackInsights(section, data) {
  const customer = data?.customerName || 'Jubilant Foodworks Ltd (JFL)';
  const period = data?.report_period?.display_label || data?.reportingPeriod || 'the reporting period';
  const exec = data?.executiveSummary || {};
  const slaAnalytics = data?.slaAnalytics || {};
  const pro = data?.proactiveTicketAnalytics || {};

  const slaTarget = Number(slaAnalytics.slaTarget ?? exec.slaTarget ?? ruleEngine?.getSLATarget?.() ?? 0);
  const slaCompliance = Number(exec.slaCompliance ?? exec.slaComplianceRate ?? (pro.overall ? pro.overall.slaPercent : 100));
  const healthScore = Number(exec.healthScore ?? 100);
  const healthLabel = exec.healthLabel || (healthScore >= 90 ? 'Optimal' : healthScore >= 80 ? 'Good' : 'Degraded');
  const switchUptime = Number(exec.jflSwitchUptime ?? exec.overallUptime ?? 100);
  const proactiveUptime = Number(exec.proactiveSwitchUptime ?? 100);
  const totalDevices = Number(exec.totalDevices || (data?.devices ? data.devices.filter(d => !d.__isStock).length : 0));
  const totalSwitches = Number(exec.totalSwitches ?? 0);
  const totalAPs = Number(exec.totalAPs ?? 0);
  const totalSites = Number(exec.totalSites || (data?.siteSummary ? data.siteSummary.length : 0));
  const totalIncidents = Number(exec.totalIncidents ?? (pro.overall ? pro.overall.total : (data?.incidents ? data.incidents.length : 0)));
  const criticalIncidents = Number(exec.criticalIncidents ?? (data?.incidents ? data.incidents.filter(i => /p1|critical/i.test(i.Priority || i.Severity || '')).length : 0));
  const majorIncidents = Number(exec.majorIncidents ?? (data?.incidents ? data.incidents.filter(i => /p2|major/i.test(i.Priority || i.Severity || '')).length : 0));
  const apIncidents = Number(exec.apIncidents ?? 0);
  const switchRCA = exec.primaryRcaSwitches || 'Stable Operations (No Incidents)';
  const apRCA = exec.primaryRcaAPs || 'Stable Operations (No Incidents)';

  const normalizedSection = (section || 'overview').toLowerCase();

  let summary = '';
  const risks = [];
  const actions = [];

  // General SLA risk evaluation
  if (slaCompliance < slaTarget) {
    risks.push(`SLA breach risk: Current SLA compliance (${slaCompliance}%) is below the contractual target (${slaTarget}%).`);
  }

  switch (normalizedSection) {
    case 'switches':
      summary = `The core switch infrastructure achieved ${switchUptime}% JFL availability across ${totalSwitches} active devices during ${period}. Outage impact was predominantly driven by ${switchRCA}, with field engineering maintaining resolution within acceptable thresholds.`;
      if (switchUptime < slaTarget) {
        risks.push(`Switch availability risk: Fleet availability of ${switchUptime}% fell below the ${slaTarget}% operational target.`);
      }
      if (switchRCA !== 'Stable Operations (No Incidents)') {
        risks.push(`Outage concentration risk: Core switch downtime was primarily impacted by ${switchRCA}.`);
      }
      if (risks.length === 0) {
        risks.push('Switch hardware lifecycle: Routine aging on edge switches requires regular health monitoring.');
      }
      actions.push(`Execute preventative inspection on switches impacted by ${switchRCA}.`);
      actions.push('Audit switch uplink redundancies and verify auto-negotiation stability across core distribution layers.');
      break;

    case 'aps':
      summary = `Wireless operations maintained stable coverage across ${totalAPs} active Access Points with ${apIncidents} total incidents recorded throughout ${period}. Primary disruptions were associated with ${apRCA}, with isolated impacts on local store operations.`;
      if (apIncidents > 0) {
        risks.push(`Wireless connectivity risk: ${apIncidents} AP incidents impacted localized store coverage and mobile ordering devices.`);
      }
      if (apRCA !== 'Stable Operations (No Incidents)') {
        risks.push(`Access point hold exposure: Ticket resolution delays on APs were predominantly linked to ${apRCA}.`);
      }
      if (risks.length === 0) {
        risks.push('RF interference variance: High-density peak dining hours introduce temporary channel utilization spikes.');
      }
      actions.push('Optimize dynamic channel allocation and transmit power on APs in high-density store zones.');
      actions.push('Verify PoE power budget allocation on upstream switches to prevent unexpected AP reboots.');
      break;

    case 'incidents':
      summary = `A total of ${totalIncidents} incidents were handled during ${period}, with ${criticalIncidents} critical (P1) and ${majorIncidents} major (P2) tickets logged. Operational response maintained an overall SLA compliance rate of ${slaCompliance}%.`;
      if (criticalIncidents > 0) {
        risks.push(`High-severity ticket risk: ${criticalIncidents} critical (P1) incidents caused immediate business disruption during this reporting window.`);
      }
      if (majorIncidents > 0) {
        risks.push(`Major incident volume: ${majorIncidents} P2 tickets contributed to cumulative resolution backlog.`);
      }
      if (risks.length === 0) {
        risks.push('Incident velocity risk: Sudden spikes in edge carrier outages could strain tier-1 NOC response times.');
      }
      actions.push('Implement automated tier-1 ticket dispatch to reduce mean time to acknowledge (MTTA).');
      actions.push('Conduct formal Post-Incident Reviews (PIR) for all P1 and breached tickets to prevent repeat occurrences.');
      break;

    case 'rca':
      summary = `Root Cause Analysis indicates that switch outages were primarily driven by ${switchRCA}, while AP disruptions were led by ${apRCA}. Targeted engineering mitigation on these primary categories represents the highest-leverage path to zero-downtime operations.`;
      if (switchRCA !== 'Stable Operations (No Incidents)') {
        risks.push(`Systemic switch root cause: Recurring incidents under '${switchRCA}' expose infrastructure vulnerabilities.`);
      }
      if (apRCA !== 'Stable Operations (No Incidents)') {
        risks.push(`Wireless failure clustering: Persistent failures under '${apRCA}' degrade user terminal experience.`);
      }
      if (risks.length === 0) {
        risks.push('Residual root cause risk: Unclassified edge issues require ongoing ticket categorization audits.');
      }
      actions.push(`Formulate dedicated remediation workflow addressing root causes associated with ${switchRCA}.`);
      actions.push('Align with facility engineering and external carriers to mitigate utility-dependent failure modes.');
      break;

    case 'sla':
      summary = `Network operations achieved an overall SLA compliance rate of ${slaCompliance}% against the contractual benchmark of ${slaTarget}%. The engineering teams resolved the majority of tickets within standard response parameters, minimizing business impact.`;
      if (slaCompliance < slaTarget) {
        risks.push(`Contractual SLA risk: Service level compliance (${slaCompliance}%) fell below contractual threshold (${slaTarget}%).`);
      } else {
        risks.push('SLA buffer vulnerability: Narrow margin above contractual target leaves little room for catastrophic multi-site outages.');
      }
      actions.push('Establish automated threshold alerts at 75% elapsed SLA resolution time to prevent ticket breaches.');
      actions.push('Standardize on-hold categorization protocols to ensure external dependencies are appropriately classified.');
      break;

    case 'sites':
      summary = `Store network infrastructure encompasses ${totalSites} monitored locations supporting ${totalDevices} active operational assets across the enterprise. Operational performance across core locations demonstrated high resilience with localized variations in power reliability.`;
      if (healthScore < 90) {
        risks.push(`Multi-site health variance: Overall enterprise network health score is at ${healthScore}/100 (${healthLabel}).`);
      }
      risks.push('Edge environment variability: Inconsistent utility power and local thermal conditions impact edge equipment lifespan.');
      actions.push('Deploy remote UPS battery diagnostics and proactive environmental alerts across all high-incident sites.');
      actions.push('Standardize emergency replacement hardware inventory at regional logistics hubs to accelerate on-site restoration.');
      break;

    case 'other':
      summary = `Planned maintenance windows and client-side operational activities were tracked with minimal disruption to live store transactions during ${period}. Rigorous adherence to change management windows prevented unscheduled customer downtime.`;
      risks.push('Change window spillover risk: Complex firmware updates risk exceeding authorized maintenance windows.');
      risks.push('Uncoordinated client modifications: Local store refurbishment or electrical works conducted without NOC notification.');
      actions.push('Enforce strict Change Advisory Board (CAB) review protocols prior to executing any core network updates.');
      actions.push('Require 48-hour pre-notification for all on-site third-party electrical or cabling modifications.');
      break;

    case 'overview':
    case 'executive':
    default:
      summary = `Enterprise network operations for ${customer} achieved a Health Score of ${healthScore}/100 (${healthLabel}) and ${slaCompliance}% SLA compliance across ${totalDevices} devices in ${period}. Fleet switch uptime reached ${switchUptime}%, with primary downtime drivers effectively isolated to ${switchRCA}.`;
      if (healthScore < 90) {
        risks.push(`Infrastructure health risk: Enterprise health score (${healthScore}/100) indicates elevated operational risk.`);
      }
      if (switchUptime < slaTarget) {
        risks.push(`Switch uptime deviation: JFL switch availability (${switchUptime}%) is operating below the ${slaTarget}% target.`);
      }
      if (criticalIncidents > 0) {
        risks.push(`High-severity incident exposure: ${criticalIncidents} critical (P1) outages recorded in this period.`);
      }
      if (risks.length === 0) {
        risks.push('Operational complacency risk: Sustained high availability requires continuous monitoring of edge assets.');
      }
      actions.push(`Initiate preventative maintenance targeting top outage driver (${switchRCA}).`);
      actions.push(`Maintain rigorous weekly SLA review to ensure performance remains above the ${slaTarget}% threshold.`);
      actions.push('Conduct quarterly disaster recovery drills and configuration backup verification on all core assets.');
      break;
  }

  // Deduplicate and ensure at least 1 risk and 1 action
  const cleanRisks = Array.from(new Set(risks.filter(Boolean)));
  const cleanActions = Array.from(new Set(actions.filter(Boolean)));

  return {
    executive_summary: summary,
    business_risks: cleanRisks.length > 0 ? cleanRisks : ['Operational monitoring must continue to anticipate edge degradation.'],
    action_items: cleanActions.length > 0 ? cleanActions : ['Maintain proactive surveillance across all critical store assets.']
  };
}

/**
 * Main entry point: generate enterprise CTO insights for a given section and dashboard data.
 * Adheres strictly to the schema:
 * {
 *   executive_summary: string (2 sentences),
 *   business_risks: string[],
 *   action_items: string[]
 * }
 */
async function generateEnterpriseInsights({ section, data, options = {} }) {
  const normalizedSection = section || 'overview';

  // Construct System Prompt as strictly requested:
  const systemPrompt = `You are a Chief Technology Officer. Given this network JSON for the ${normalizedSection} tab, return a strict JSON object: { 'executive_summary': '2 sentences', 'business_risks': ['risk 1'], 'action_items': ['action 1'] }. Keep tone professional and data-driven.`;

  // Prepare concise data payload for LLM
  const compactData = {
    section: normalizedSection,
    customerName: data?.customerName,
    reportingPeriod: data?.report_period?.display_label || data?.reportingPeriod,
    executiveSummary: data?.executiveSummary,
    slaAnalytics: data?.slaAnalytics,
    siteCount: data?.siteSummary?.length || data?.executiveSummary?.totalSites,
    incidentsCount: data?.incidents?.length || data?.executiveSummary?.totalIncidents,
  };

  const userPrompt = JSON.stringify(compactData);

  // 1. Try LLM if configured
  try {
    const llmResult = await callLLM(systemPrompt, userPrompt);
    if (
      llmResult &&
      typeof llmResult.executive_summary === 'string' &&
      Array.isArray(llmResult.business_risks) &&
      Array.isArray(llmResult.action_items) &&
      llmResult.executive_summary.trim().length > 0
    ) {
      return {
        executive_summary: llmResult.executive_summary.trim(),
        business_risks: llmResult.business_risks.map(r => String(r).trim()).filter(Boolean),
        action_items: llmResult.action_items.map(a => String(a).trim()).filter(Boolean),
      };
    }
  } catch (err) {
    console.warn(`[aiInsightsService] LLM execution skipped/failed: ${err.message}`);
  }

  // 2. High-rigor deterministic fallback
  return generateFallbackInsights(normalizedSection, data);
}

module.exports = {
  generateEnterpriseInsights,
  generateFallbackInsights,
};
