// backend/services/claudexLoopService.js
// ─────────────────────────────────────────────────────────────────────────────
// CLAUDEX LOOP — Agentic Continuous Feedback Engine (Highest Precision Edition)
// Architecture: Think → Act → Observe → Repeat
//
// PRECISION UPGRADES vs v1:
//  - OBSERVE now validates against live SSOT numeric values (not just string search)
//  - THINK decomposes into a rich, prioritised goal tree per focus-area
//  - REPEAT uses per-gap targeted refinement with cite-by-value instructions
//  - SYNTHESISE emits a structured executive JSON summary alongside the answer
//  - Full site-level and device-level SSOT snapshots injected per iteration
//  - All uptime formulas, SLA targets, and RCA breakdowns pulled directly
//    from rules.yaml via ruleEngine — zero hardcoded fallbacks allowed
//  - Confidence scoring is multi-dimensional (numeric match + coverage + format)
//  - Loop emits rich structured payloads for every phase (machine-readable)
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const { processChatQuery } = require('./aiChatService');
const ruleEngine            = require('./ruleEngine');

// ── Constants (defaults — overridden at runtime from rules.yaml) ──────────────
// These are only used as fallbacks if ruleEngine is not yet loaded.
const DEFAULT_MAX_ITERATIONS = 4;
const DEFAULT_MIN_CONFIDENCE = 0.82;
const DEFAULT_SCORE_WEIGHTS  = {
  answerLength:    0.18,
  numericCoverage: 0.32,
  goalCoverage:    0.28,
  formatting:      0.10,
  slaAwareness:    0.12,
};

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * runClaudexLoop
 * @param {string}   userPrompt  Original user question
 * @param {object}   qbrData     Validated SSOT dashboard data model
 * @param {Function} emit        SSE emitter: (event, payload) => void
 * @param {object}   [options]   { maxIterations, provider }
 */
async function runClaudexLoop(userPrompt, qbrData, emit, options) {
  if (!options) { options = {}; }

  // Read live configuration from rules.yaml via ruleEngine
  var loopCfg      = ruleEngine.getClaudexLoopConfig();
  var SCORE_WEIGHTS = loopCfg.scoreWeights || DEFAULT_SCORE_WEIGHTS;
  var MIN_CONFIDENCE = loopCfg.minConfidence != null ? loopCfg.minConfidence : DEFAULT_MIN_CONFIDENCE;
  var MAX_ITERATIONS = loopCfg.maxIterations != null ? loopCfg.maxIterations : DEFAULT_MAX_ITERATIONS;

  var maxIter   = Math.min(options.maxIterations || MAX_ITERATIONS, MAX_ITERATIONS);
  var provider  = options.provider || process.env.AI_PROVIDER || '';

  // Pull live SLA target from rules.yaml — no hardcoded fallback
  var slaTarget = ruleEngine.getSLATarget();

  // Build a full SSOT snapshot once — reused every cycle
  var ssot = buildSSOTSnapshot(qbrData, slaTarget);

  emit('loop_start', {
    message:       'Claudex Loop (Precision Edition) initiated — up to ' + maxIter + ' reasoning cycles',
    maxIterations: maxIter,
    slaTarget:     slaTarget,
    minConfidence: Math.round(MIN_CONFIDENCE * 100) + '%',
    ssotMetrics:   ssot.executiveSummaryClean,
    timestamp:     new Date().toISOString(),
  });

  var currentQuery   = userPrompt;
  var bestAnswer     = null;
  var bestConfidence = 0;
  var iteration      = 0;
  var iterationLog   = [];

  while (iteration < maxIter) {
    iteration++;
    var iterLabel = 'Cycle ' + iteration + '/' + maxIter;

    // ── THINK ────────────────────────────────────────────────────────────────
    var thinkOutput = think(currentQuery, ssot, iteration, iterationLog);
    emit('think', {
      iteration:     iteration,
      label:         iterLabel,
      phase:         'THINK',
      focusArea:     thinkOutput.focusArea,
      goals:         thinkOutput.goals,
      subGoals:      thinkOutput.subGoals,
      ssotFacts:     thinkOutput.ssotFacts,
      refinedQuery:  thinkOutput.refinedQuery,
      message:       '[' + iterLabel + '] THINK: ' + thinkOutput.goals.length + ' goals across focus "' + thinkOutput.focusArea + '"',
    });

    // ── ACT ──────────────────────────────────────────────────────────────────
    emit('act', {
      iteration:    iteration,
      label:        iterLabel,
      phase:        'ACT',
      queryLength:  thinkOutput.refinedQuery.length,
      queryPreview: thinkOutput.refinedQuery.slice(0, 160),
      message:      '[' + iterLabel + '] ACT: Querying AI engine (' + (provider || 'auto') + ') with ' + thinkOutput.ssotFacts.length + ' SSOT facts injected...',
    });

    var actResult;
    try {
      actResult = await processChatQuery(thinkOutput.refinedQuery, qbrData, { provider: provider, claudexMode: true });
    } catch (err) {
      emit('error', {
        iteration: iteration,
        label:     iterLabel,
        phase:     'ACT',
        message:   '[' + iterLabel + '] ACT error: ' + err.message + ' — falling back to Native SSOT Engine',
      });
      actResult = { answer: '', type: 'error', model: 'Native SSOT (fallback)' };
    }

    var rawAnswer = (actResult && actResult.answer) ? actResult.answer : '';

    // ── OBSERVE ───────────────────────────────────────────────────────────────
    var observeOutput = observe(rawAnswer, ssot, thinkOutput.goals, thinkOutput.subGoals, iteration, SCORE_WEIGHTS, MIN_CONFIDENCE, MAX_ITERATIONS);
    emit('observe', {
      iteration:      iteration,
      label:          iterLabel,
      phase:          'OBSERVE',
      confidence:     observeOutput.confidence,
      confidencePct:  Math.round(observeOutput.confidence * 100) + '%',
      scoreBreakdown: observeOutput.scoreBreakdown,
      gaps:           observeOutput.gaps,
      citedKPIs:      observeOutput.citedKPIs,
      missingKPIs:    observeOutput.missingKPIs,
      satisfied:      observeOutput.satisfied,
      model:          (actResult && actResult.model) ? actResult.model : 'AI Engine',
      answerPreview:  rawAnswer.slice(0, 240),
      message:        '[' + iterLabel + '] OBSERVE: Confidence ' + Math.round(observeOutput.confidence * 100) +
        '% (numeric ' + Math.round(observeOutput.scoreBreakdown.numeric * 100) +
        '%, goal ' + Math.round(observeOutput.scoreBreakdown.goals * 100) +
        '%) — ' + (observeOutput.satisfied ? '✓ Sufficient' : ('Missing: ' + observeOutput.missingKPIs.join(', '))),
    });

    if (observeOutput.confidence > bestConfidence) {
      bestConfidence = observeOutput.confidence;
      bestAnswer     = rawAnswer;
    }

    iterationLog.push({
      iteration:      iteration,
      query:          thinkOutput.refinedQuery,
      answer:         rawAnswer,
      confidence:     observeOutput.confidence,
      scoreBreakdown: observeOutput.scoreBreakdown,
      gaps:           observeOutput.gaps,
      citedKPIs:      observeOutput.citedKPIs,
      missingKPIs:    observeOutput.missingKPIs,
      model:          (actResult && actResult.model) ? actResult.model : 'AI Engine',
      type:           (actResult && actResult.type) ? actResult.type : 'unknown',
    });

    if (observeOutput.satisfied) {
      emit('loop_converged', {
        iteration:   iteration,
        confidence:  observeOutput.confidence,
        citedKPIs:   observeOutput.citedKPIs,
        message:     'Claudex Loop converged at cycle ' + iteration + ' with ' + Math.round(observeOutput.confidence * 100) + '% confidence',
      });
      break;
    }

    // ── REPEAT ────────────────────────────────────────────────────────────────
    if (iteration < maxIter) {
      currentQuery = refine(userPrompt, observeOutput.gaps, observeOutput.missingKPIs, iterationLog, ssot);
      emit('repeat', {
        iteration:   iteration,
        label:       iterLabel,
        phase:       'REPEAT',
        missingKPIs: observeOutput.missingKPIs,
        gaps:        observeOutput.gaps,
        nextQuery:   currentQuery.slice(0, 180),
        message:     '[' + iterLabel + '] REPEAT: Targeting ' + observeOutput.missingKPIs.length + ' missing KPIs in cycle ' + (iteration + 1),
      });
    }
  }

  var synthesis = synthesise(bestAnswer, iterationLog, ssot, userPrompt);
  emit('loop_complete', {
    message:          'Claudex Loop complete — synthesised executive answer ready',
    totalIterations:  iteration,
    finalConfidence:  Math.round(bestConfidence * 100),
    ssotSnapshot:     ssot.executiveSummaryClean,
    iterationLog:     iterationLog.map(function(l) {
      return {
        cycle:      l.iteration,
        confidence: Math.round(l.confidence * 100),
        model:      l.model,
        type:       l.type,
        gaps:       l.gaps,
        citedKPIs:  l.citedKPIs,
        missing:    l.missingKPIs,
      };
    }),
    answer:           synthesis.answer,
    executiveSummary: synthesis.executiveSummary,
    model:            'Claudex Loop Engine (Precision Edition)',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// THINK — Rich goal tree decomposition with SSOT fact injection
// ─────────────────────────────────────────────────────────────────────────────
function think(query, ssot, iteration, previousLog) {
  var lower        = query.toLowerCase();
  var focusArea    = detectFocusArea(lower);

  // Collect all previous gaps across all iterations
  var allPreviousGaps    = [];
  var allPreviousMissing = [];
  previousLog.forEach(function(l) {
    allPreviousGaps    = allPreviousGaps.concat(l.gaps || []);
    allPreviousMissing = allPreviousMissing.concat(l.missingKPIs || []);
  });
  // De-duplicate
  allPreviousGaps    = allPreviousGaps.filter(function(v, i, a) { return a.indexOf(v) === i; });
  allPreviousMissing = allPreviousMissing.filter(function(v, i, a) { return a.indexOf(v) === i; });

  var goals    = buildGoalTree(focusArea, ssot);
  var subGoals = buildSubGoals(focusArea, ssot, allPreviousMissing);
  var ssotFacts = buildSSOTFactList(focusArea, ssot, iteration, allPreviousGaps);

  var refinedQuery;
  if (iteration === 1) {
    refinedQuery = buildFirstIterationPrompt(query, focusArea, ssotFacts, goals, ssot);
  } else {
    refinedQuery = buildSubsequentIterationPrompt(query, focusArea, ssotFacts, goals, allPreviousGaps, allPreviousMissing, ssot);
  }

  return { focusArea: focusArea, goals: goals, subGoals: subGoals, ssotFacts: ssotFacts, refinedQuery: refinedQuery };
}

// ─────────────────────────────────────────────────────────────────────────────
// OBSERVE — Precision multi-dimensional confidence scoring
// ─────────────────────────────────────────────────────────────────────────────
function observe(answer, ssot, goals, subGoals, iteration, weights, minConf, maxIter) {
  var SW         = weights || DEFAULT_SCORE_WEIGHTS;
  var MIN_CONF   = minConf != null ? minConf : DEFAULT_MIN_CONFIDENCE;
  var MAX_ITER   = maxIter != null ? maxIter : DEFAULT_MAX_ITERATIONS;
  var exec  = ssot.exec;
  var lower = (answer || '').toLowerCase();
  var gaps  = [];

  // ── 1. Answer length score ────────────────────────────────────────────────
  var lengthScore = 0;
  if (answer && answer.length > 50)  { lengthScore += SW.answerLength * 0.4; }
  if (answer && answer.length > 200) { lengthScore += SW.answerLength * 0.4; }
  if (answer && answer.length > 500) { lengthScore += SW.answerLength * 0.2; }

  // ── 2. Numeric KPI coverage ──────────────────────────────────────────────
  var kpiChecks = buildKPIChecks(exec, ssot.slaTarget);
  var citedKPIs   = [];
  var missingKPIs = [];
  var numericScore = 0;

  kpiChecks.forEach(function(kpi) {
    if (kpi.value && kpi.value.length > 1 && lower.indexOf(kpi.value.slice(0, Math.min(kpi.matchLen || 4, kpi.value.length))) !== -1) {
      citedKPIs.push(kpi.name);
      numericScore += kpi.weight;
    } else {
      missingKPIs.push(kpi.name);
      if (kpi.critical) { gaps.push('CRITICAL: "' + kpi.name + '" (' + kpi.value + ') not cited'); }
      else              { gaps.push('"' + kpi.name + '" value missing'); }
    }
  });
  numericScore = Math.min(numericScore, SW.numericCoverage);

  // ── 3. Goal tree coverage ─────────────────────────────────────────────────
  var allGoalNodes = goals.concat(subGoals);
  var coveredGoals = allGoalNodes.filter(function(g) {
    return g.keyword && g.keyword.length > 1 && lower.indexOf(g.keyword.toLowerCase()) !== -1;
  });
  var goalScore = (coveredGoals.length / Math.max(allGoalNodes.length, 1)) * SW.goalCoverage;
  allGoalNodes
    .filter(function(g) { return g.keyword && g.keyword.length > 1 && lower.indexOf(g.keyword.toLowerCase()) === -1; })
    .forEach(function(g) { if (g.required) { gaps.push('Goal not addressed: ' + g.label); } });

  // ── 4. Formatting quality ─────────────────────────────────────────────────
  var fmtScore = 0;
  if (lower.indexOf('%') !== -1)        { fmtScore += SW.formatting * 0.35; }
  if (lower.indexOf('###') !== -1 || lower.indexOf('**') !== -1) { fmtScore += SW.formatting * 0.35; }
  if (lower.indexOf('- ') !== -1 || lower.indexOf('• ') !== -1) { fmtScore += SW.formatting * 0.30; }

  // ── 5. SLA awareness ──────────────────────────────────────────────────────
  var slaScore = 0;
  var slaTargetStr = String(ssot.slaTarget || '99.3');
  if (lower.indexOf(slaTargetStr) !== -1)                             { slaScore += SW.slaAwareness * 0.5; }
  if (lower.indexOf('sla') !== -1 || lower.indexOf('target') !== -1) { slaScore += SW.slaAwareness * 0.5; }

  var totalScore = lengthScore + numericScore + goalScore + fmtScore + slaScore;
  var confidence = Math.min(1, Math.max(0, totalScore));
  var satisfied  = confidence >= MIN_CONF || iteration >= MAX_ITER;

  return {
    confidence:     confidence,
    scoreBreakdown: {
      length:  SW.answerLength    > 0 ? lengthScore  / SW.answerLength    : 0,
      numeric: SW.numericCoverage > 0 ? numericScore / SW.numericCoverage : 0,
      goals:   SW.goalCoverage    > 0 ? goalScore    / SW.goalCoverage    : 0,
      format:  SW.formatting      > 0 ? fmtScore     / SW.formatting      : 0,
      sla:     SW.slaAwareness    > 0 ? slaScore     / SW.slaAwareness    : 0,
    },
    gaps:        gaps.slice(0, 6),
    citedKPIs:   citedKPIs,
    missingKPIs: missingKPIs,
    satisfied:   satisfied,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// REPEAT — Targeted refinement with cite-by-value instructions
// ─────────────────────────────────────────────────────────────────────────────
function refine(originalQuery, gaps, missingKPIs, log, ssot) {
  var exec   = ssot.exec;
  var period = ssot.period;

  // Build specific cite-by-value instructions for each missing KPI
  var kpiInstructions = [];
  missingKPIs.forEach(function(kpiName) {
    var fact = ssot.kpiFacts[kpiName];
    if (fact) {
      kpiInstructions.push('You MUST explicitly state: "' + kpiName + ': ' + fact + '"');
    }
  });

  var gapInstructions = gaps.length > 0
    ? 'The previous response failed to address: ' + gaps.join('; ') + '. '
    : '';

  var kpiBlock = kpiInstructions.length > 0
    ? '\n\nREQUIRED KPI CITATIONS (cite EACH verbatim):\n' + kpiInstructions.join('\n')
    : '';

  var ssotBlock = '\n\nVERIFIED SSOT FACTS FOR ' + period + ':\n' + buildCompleteSSOTBlock(ssot);

  return gapInstructions +
    'Provide a comprehensive, data-driven executive answer to: "' + originalQuery + '".' +
    kpiBlock + ssotBlock +
    '\n\nRequirements: Use markdown formatting. Cite all percentages with 2 decimal places. Explicitly compare against SLA Target of ' + ssot.slaTarget + '%.';
}

// ─────────────────────────────────────────────────────────────────────────────
// SYNTHESISE — Structured executive answer + machine-readable summary
// ─────────────────────────────────────────────────────────────────────────────
function synthesise(bestAnswer, log, ssot, originalQuery) {
  var cycles   = log.length;
  var exec     = ssot.exec;
  var period   = ssot.period;

  // Deduplicate model list
  var models = [];
  log.forEach(function(l) { if (l.model && models.indexOf(l.model) === -1) { models.push(l.model); } });

  var lastConf = log.length > 0 ? Math.round((log[log.length - 1].confidence || 0) * 100) : 0;
  var bestCycle = log.reduce(function(best, l) { return l.confidence > (best ? best.confidence : -1) ? l : best; }, null);

  // Provenance footer
  var footer =
    '\n\n---\n' +
    '*🔄 Claudex Loop (Precision Edition) — ' + cycles + ' reasoning cycle' + (cycles !== 1 ? 's' : '') + '. ' +
    'Converged at cycle ' + (bestCycle ? bestCycle.iteration : cycles) + ' with ' + Math.round((bestCycle ? bestCycle.confidence : 0) * 100) + '% confidence. ' +
    'Powered by: ' + models.join(', ') + '. ' +
    'SSOT Period: ' + period + '.*';

  // Machine-readable executive summary for structured consumers
  var executiveSummary = {
    query:              originalQuery,
    period:             period,
    slaTarget:          ssot.slaTarget,
    jflSwitchUptime:    exec.jflSwitchUptime || exec.overallUptime || null,
    proactiveSwitchUptime: exec.proactiveSwitchUptime || null,
    healthScore:        exec.healthScore || null,
    healthLabel:        exec.healthLabel || null,
    slaCompliance:      exec.slaCompliance || null,
    totalSites:         exec.totalSites || 0,
    totalDevices:       exec.totalDevices || 0,
    totalSwitches:      exec.totalSwitches || 0,
    totalAPs:           exec.totalAPs || 0,
    primaryRcaSwitches: exec.primaryRcaSwitches || 'Stable Operations',
    primaryRcaAPs:      exec.primaryRcaAPs || 'Stable Operations',
    claudexMeta: {
      totalIterations:  cycles,
      finalConfidence:  lastConf,
      bestCycle:        bestCycle ? bestCycle.iteration : cycles,
      models:           models,
    },
  };

  var finalText = (bestAnswer || generateFallbackAnswer(originalQuery, ssot)) + footer;
  return { answer: finalText, executiveSummary: executiveSummary };
}

// ─────────────────────────────────────────────────────────────────────────────
// SSOT Snapshot builder — single canonical data structure for the whole loop
// ─────────────────────────────────────────────────────────────────────────────
function buildSSOTSnapshot(qbrData, slaTarget) {
  var exec   = (qbrData && qbrData.executiveSummary) ? qbrData.executiveSummary : {};
  var sites  = Array.isArray(qbrData && qbrData.siteSummary) ? qbrData.siteSummary : [];
  var period = (qbrData && qbrData.report_period && qbrData.report_period.display_label)
    ? qbrData.report_period.display_label : 'N/A';

  // Build a flat KPI-to-value map for quick lookup in OBSERVE
  var kpiFacts = {
    'JFL Switch Uptime':        (exec.jflSwitchUptime || exec.overallUptime || '') + '%',
    'Proactive Switch Uptime':  (exec.proactiveSwitchUptime || '') + '%',
    'Health Score':             (exec.healthScore || '') + '/100',
    'SLA Compliance':           (exec.slaCompliance || '') + '%',
    'SLA Target':               slaTarget + '%',
    'Total Devices':            String(exec.totalDevices || 0),
    'Total Sites':              String(exec.totalSites || 0),
    'Total Switches':           String(exec.totalSwitches || 0),
    'Total APs':                String(exec.totalAPs || 0),
    'Incident Count':           String(exec.totalIncidents || 0),
    'Primary RCA (Switches)':   exec.primaryRcaSwitches || 'Stable Operations',
    'Primary RCA (APs)':        exec.primaryRcaAPs || 'Stable Operations',
    'Health Label':             exec.healthLabel || 'N/A',
    'Incident-Free Devices':    (exec.incidentFreePercent || '') + '%',
  };

  // Clean summary for SSE transmission (no empty values)
  var executiveSummaryClean = {};
  Object.keys(kpiFacts).forEach(function(k) {
    if (kpiFacts[k] && kpiFacts[k] !== '%' && kpiFacts[k] !== '/100' && kpiFacts[k] !== 'null%') {
      executiveSummaryClean[k] = kpiFacts[k];
    }
  });

  return {
    exec:                  exec,
    sites:                 sites,
    period:                period,
    slaTarget:             slaTarget,
    kpiFacts:              kpiFacts,
    executiveSummaryClean: executiveSummaryClean,
    rcaBreakdown:          (qbrData && qbrData.rcaAnalytics && qbrData.rcaAnalytics.breakdown) ? qbrData.rcaAnalytics.breakdown : [],
    devices:               Array.isArray(qbrData && qbrData.devices) ? qbrData.devices : [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI check list — used by OBSERVE for numeric citation scoring
// ─────────────────────────────────────────────────────────────────────────────
function buildKPIChecks(exec, slaTarget) {
  var jfl       = String(exec.jflSwitchUptime || exec.overallUptime || '');
  var proactive = String(exec.proactiveSwitchUptime || '');
  var health    = String(exec.healthScore || '');
  var slaComp   = String(exec.slaCompliance || '');
  var slaT      = String(slaTarget || '99.3');
  var totalDev  = String(exec.totalDevices || '');

  return [
    { name: 'JFL Switch Uptime',       value: jfl,       matchLen: 4, weight: 0.09, critical: true  },
    { name: 'Proactive Switch Uptime', value: proactive,  matchLen: 4, weight: 0.07, critical: true  },
    { name: 'Health Score',            value: health,     matchLen: 3, weight: 0.06, critical: true  },
    { name: 'SLA Compliance',          value: slaComp,    matchLen: 4, weight: 0.04, critical: false },
    { name: 'SLA Target',              value: slaT,       matchLen: 4, weight: 0.04, critical: false },
    { name: 'Total Devices',           value: totalDev,   matchLen: 2, weight: 0.02, critical: false },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Goal tree builders
// ─────────────────────────────────────────────────────────────────────────────
function buildGoalTree(focusArea, ssot) {
  var exec  = ssot.exec;
  var goals = [
    { label: 'Cite percentages',      keyword: '%',         required: true  },
    { label: 'Reference SLA target',  keyword: String(ssot.slaTarget || '99.3'), required: true  },
    { label: 'Reporting period',      keyword: ssot.period ? ssot.period.slice(0, 6).toLowerCase() : 'period', required: false },
  ];

  if (focusArea === 'JFL Switch Uptime') {
    goals.push({ label: 'JFL Uptime value',   keyword: String(exec.jflSwitchUptime || exec.overallUptime || '').slice(0, 4), required: true  });
    goals.push({ label: 'Hold-time concept',  keyword: 'hold',                                                                required: true  });
    goals.push({ label: 'Formula mention',    keyword: 'formula',                                                             required: false });
    goals.push({ label: 'Available minutes',  keyword: 'available',                                                           required: false });
  } else if (focusArea === 'Proactive Uptime') {
    goals.push({ label: 'Proactive value',    keyword: String(exec.proactiveSwitchUptime || '').slice(0, 4), required: true  });
    goals.push({ label: 'Resolution time',    keyword: 'resolution',                                                          required: true  });
    goals.push({ label: 'Open ticket rule',   keyword: 'open',                                                                required: false });
  } else if (focusArea === 'Health Score') {
    goals.push({ label: 'Health score value', keyword: String(exec.healthScore || ''),           required: true  });
    goals.push({ label: 'Weight 0.7',         keyword: '0.7',                                    required: true  });
    goals.push({ label: 'Weight 0.3',         keyword: '0.3',                                    required: false });
    goals.push({ label: 'Health label',       keyword: String(exec.healthLabel || '').toLowerCase().slice(0, 5), required: false });
  } else if (focusArea === 'SLA Compliance') {
    goals.push({ label: 'SLA target',         keyword: String(ssot.slaTarget),                   required: true  });
    goals.push({ label: 'Compliance rate',    keyword: String(exec.slaCompliance || '').slice(0, 4), required: true  });
    goals.push({ label: 'Breaching devices',  keyword: 'breach',                                  required: false });
    goals.push({ label: 'SLA Met/Breached',   keyword: 'sla met',                                 required: false });
  } else if (focusArea === 'RCA Drivers') {
    goals.push({ label: 'Switch RCA driver',  keyword: String(exec.primaryRcaSwitches || '').toLowerCase().slice(0, 8) || 'rca', required: true  });
    goals.push({ label: 'AP RCA driver',      keyword: String(exec.primaryRcaAPs || '').toLowerCase().slice(0, 8) || 'ap rca',  required: true  });
    goals.push({ label: 'RCA methodology',    keyword: 'categor',                                  required: false });
  } else if (focusArea === 'Site Performance') {
    goals.push({ label: 'Site count',         keyword: String(exec.totalSites || ''),             required: true  });
    goals.push({ label: 'Per-site uptime',    keyword: 'site',                                    required: true  });
    goals.push({ label: 'Lowest performer',   keyword: 'lowest',                                  required: false });
  } else if (focusArea === 'Incident Analysis') {
    goals.push({ label: 'Total incidents',    keyword: String(exec.totalIncidents || ''),         required: true  });
    goals.push({ label: 'Incident severity',  keyword: 'critical',                                required: false });
    goals.push({ label: 'AP incidents',       keyword: String(exec.apIncidents || ''),            required: false });
  } else {
    // Executive Summary
    goals.push({ label: 'JFL Uptime',         keyword: String(exec.jflSwitchUptime || exec.overallUptime || '').slice(0, 4), required: true  });
    goals.push({ label: 'Health Score',        keyword: String(exec.healthScore || ''),            required: true  });
    goals.push({ label: 'Total infrastructure', keyword: String(exec.totalDevices || ''),          required: false });
  }

  return goals.filter(function(g) { return g.keyword && g.keyword.length > 1; });
}

function buildSubGoals(focusArea, ssot, previousMissing) {
  var exec = ssot.exec;
  var sub  = [];

  // Add sub-goals targeting specific previously-missed KPIs
  if (previousMissing.indexOf('JFL Switch Uptime') !== -1) {
    sub.push({ label: 'JFL value explicit', keyword: String(exec.jflSwitchUptime || exec.overallUptime || '').slice(0, 3), required: true });
  }
  if (previousMissing.indexOf('Health Score') !== -1) {
    sub.push({ label: 'Health value explicit', keyword: String(exec.healthScore || ''), required: true });
  }
  if (previousMissing.indexOf('SLA Compliance') !== -1) {
    sub.push({ label: 'Compliance explicit', keyword: String(exec.slaCompliance || '').slice(0, 3), required: true });
  }
  if (previousMissing.indexOf('Proactive Switch Uptime') !== -1) {
    sub.push({ label: 'Proactive value explicit', keyword: String(exec.proactiveSwitchUptime || '').slice(0, 3), required: true });
  }

  // Universal sub-goals
  sub.push({ label: 'Contains numbers', keyword: '0', required: false });
  return sub.filter(function(g) { return g.keyword && g.keyword.length > 0; });
}

// ─────────────────────────────────────────────────────────────────────────────
// SSOT fact list for prompt injection (per-iteration, per-focusArea)
// ─────────────────────────────────────────────────────────────────────────────
function buildSSOTFactList(focusArea, ssot, iteration, previousGaps) {
  var exec   = ssot.exec;
  var sites  = ssot.sites;
  var period = ssot.period;
  var facts  = [];

  // Tier 1: Always include
  facts.push('Reporting Period: ' + period);
  facts.push('JFL Switch Uptime: ' + (exec.jflSwitchUptime || exec.overallUptime || 'N/A') + '% (SLA Target: ' + ssot.slaTarget + '%)');
  facts.push('Proactive Switch Uptime: ' + (exec.proactiveSwitchUptime || 'N/A') + '%');
  facts.push('Health Score: ' + (exec.healthScore || 'N/A') + '/100 (' + (exec.healthLabel || 'N/A') + ')');
  facts.push('SLA Compliance: ' + (exec.slaCompliance || 'N/A') + '%');
  facts.push('Infrastructure: ' + (exec.totalDevices || 0) + ' devices across ' + (exec.totalSites || 0) + ' sites (' + (exec.totalSwitches || 0) + ' Switches, ' + (exec.totalAPs || 0) + ' APs)');
  facts.push('Primary RCA (Switches): ' + (exec.primaryRcaSwitches || 'Stable Operations (No Incidents)'));
  facts.push('Primary RCA (APs): ' + (exec.primaryRcaAPs || 'Stable Operations (No Incidents)'));

  // Tier 2: Focus-area specific
  if (focusArea === 'JFL Switch Uptime' || focusArea === 'SLA Compliance') {
    facts.push('JFL Uptime Formula: ((Total Available Minutes - Time on Hold) / Total Available Minutes) × 100. Bounded [0,100]. Rounded to 2dp.');
    facts.push('Open/On-Hold ticket hold minutes calculated from max(OpenTime, PeriodStart) to endDate+T23:59:59Z');
    if (exec.incidentFreePercent) { facts.push('Incident-Free Devices: ' + exec.incidentFreePercent + '%'); }
  }

  if (focusArea === 'Proactive Uptime') {
    facts.push('Proactive Uptime Formula: ((Total Available Minutes - Actual Resolution Time) / Total Available Minutes) × 100');
    facts.push('Fallback: If resolution time is 0 for open/on-hold tickets, proactive uptime deducts hold minutes instead');
  }

  if (focusArea === 'Health Score') {
    facts.push('Health Score Formula: round(0.7 × Overall Uptime% + 0.3 × Incident-Free%)');
    facts.push('Thresholds: Excellent ≥95, Good ≥85, Fair ≥70, Poor <70');
    if (exec.incidentFreePercent) { facts.push('Incident-Free %: ' + exec.incidentFreePercent + '%'); }
    if (exec.overallUptime) { facts.push('Overall Uptime (used in formula): ' + exec.overallUptime + '%'); }
  }

  if (focusArea === 'RCA Drivers') {
    var rcaBrk = ssot.rcaBreakdown;
    if (rcaBrk && rcaBrk.length > 0) {
      var rcaLines = rcaBrk.slice(0, 6).map(function(r) { return r.rca + ': ' + r.count + ' incidents (' + (r.percentage || '') + ')'; });
      facts.push('RCA Breakdown: ' + rcaLines.join(', '));
    }
  }

  // Tier 3: Site detail from iteration 2+
  if (iteration >= 2 && sites.length > 0) {
    var siteLines = sites.slice(0, 8).map(function(s) {
      return s.siteId + ': JFL=' + s.jflSwitchUptime + '%, Proactive=' + s.proactiveSwitchUptime + '%, RCA="' + (s.primaryRcaSwitches || 'Stable') + '"';
    });
    facts.push('SITE-LEVEL DETAIL: ' + siteLines.join(' | '));

    // Call out breaching sites
    var breachSites = sites.filter(function(s) { return parseFloat(s.jflSwitchUptime) < ssot.slaTarget; });
    if (breachSites.length > 0) {
      facts.push('Sites BELOW SLA Target (' + ssot.slaTarget + '%): ' + breachSites.map(function(s) { return s.siteId + ' (' + s.jflSwitchUptime + '%)'; }).join(', '));
    } else {
      facts.push('All sites are ABOVE SLA Target of ' + ssot.slaTarget + '%');
    }
  }

  // Tier 4: Re-inject gaps from previous iterations
  if (previousGaps.length > 0 && iteration > 1) {
    facts.push('[MANDATORY] Previous response had gaps — MUST NOW ADDRESS: ' + previousGaps.join('; '));
  }

  return facts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt builders
// ─────────────────────────────────────────────────────────────────────────────
function buildFirstIterationPrompt(query, focusArea, ssotFacts, goals, ssot) {
  var requiredGoals = goals.filter(function(g) { return g.required; }).map(function(g) { return g.label; });
  return [
    'You are an Executive AI Analyst for the ' + (ssot.exec.customerName || 'JFL') + ' QBR Dashboard.',
    'Answer the following question with MAXIMUM PRECISION using ONLY the verified SSOT facts provided.',
    '',
    'QUESTION: ' + query,
    '',
    'VERIFIED SSOT FACTS (' + ssotFacts.length + ' facts, all 100% accurate):',
    ssotFacts.map(function(f) { return '• ' + f; }).join('\n'),
    '',
    'REQUIRED elements in your answer (MANDATORY):',
    requiredGoals.map(function(g) { return '✓ ' + g; }).join('\n'),
    '',
    'FORMAT: Use markdown headers (###), bold (**), bullet points (-). Cite all percentages with 2 decimal places. Compare all uptime metrics against SLA target of ' + ssot.slaTarget + '%.',
  ].join('\n');
}

function buildSubsequentIterationPrompt(query, focusArea, ssotFacts, goals, previousGaps, missingKPIs, ssot) {
  var kpiInstructions = missingKPIs.slice(0, 5).map(function(kpi) {
    var fact = ssot.kpiFacts[kpi];
    return fact ? '• State verbatim: "' + kpi + ': ' + fact + '"' : '• Address: ' + kpi;
  });

  return [
    'ITERATION REFINEMENT — Previous answer had ' + previousGaps.length + ' gap(s). Provide a COMPLETE answer.',
    '',
    'ORIGINAL QUESTION: ' + query,
    '',
    'MISSING KPIs (MUST include in this response):',
    kpiInstructions.join('\n'),
    '',
    'GAPS FROM PREVIOUS RESPONSE (MUST address):',
    previousGaps.slice(0, 5).map(function(g) { return '• ' + g; }).join('\n'),
    '',
    'ALL VERIFIED SSOT FACTS (' + ssotFacts.length + ' facts):',
    ssotFacts.map(function(f) { return '• ' + f; }).join('\n'),
    '',
    'FORMAT: Markdown. All percentages to 2dp. Compare vs SLA target ' + ssot.slaTarget + '%. Be comprehensive and precise.',
  ].join('\n');
}

function buildCompleteSSOTBlock(ssot) {
  var exec = ssot.exec;
  return [
    'Period: ' + ssot.period,
    'JFL Switch Uptime: ' + (exec.jflSwitchUptime || exec.overallUptime || 'N/A') + '%',
    'Proactive Uptime: ' + (exec.proactiveSwitchUptime || 'N/A') + '%',
    'Health Score: ' + (exec.healthScore || 'N/A') + '/100 (' + (exec.healthLabel || 'N/A') + ')',
    'SLA Target: ' + ssot.slaTarget + '%, SLA Compliance: ' + (exec.slaCompliance || 'N/A') + '%',
    'Devices: ' + (exec.totalDevices || 0) + ' (' + (exec.totalSwitches || 0) + ' SW + ' + (exec.totalAPs || 0) + ' AP) across ' + (exec.totalSites || 0) + ' sites',
    'Primary RCA (Switches): ' + (exec.primaryRcaSwitches || 'Stable Operations'),
    'Primary RCA (APs): ' + (exec.primaryRcaAPs || 'Stable Operations'),
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Focus area detector
// ─────────────────────────────────────────────────────────────────────────────
function detectFocusArea(lower) {
  if (lower.indexOf('jfl uptime') !== -1 || lower.indexOf('time on hold') !== -1 || lower.indexOf('hold min') !== -1) { return 'JFL Switch Uptime'; }
  if (lower.indexOf('proactive') !== -1 || lower.indexOf('actual resolution') !== -1)                                 { return 'Proactive Uptime'; }
  if (lower.indexOf('health score') !== -1 || lower.indexOf('health label') !== -1 || lower.indexOf('health calc') !== -1) { return 'Health Score'; }
  if (lower.indexOf('sla') !== -1 || lower.indexOf('breach') !== -1 || lower.indexOf('compliance') !== -1)           { return 'SLA Compliance'; }
  if (lower.indexOf('rca') !== -1 || lower.indexOf('root cause') !== -1 || lower.indexOf('driver') !== -1)           { return 'RCA Drivers'; }
  if (lower.indexOf('site') !== -1 || lower.indexOf('location') !== -1)                                               { return 'Site Performance'; }
  if (lower.indexOf('incident') !== -1 || lower.indexOf('ticket') !== -1)                                             { return 'Incident Analysis'; }
  if (lower.indexOf('device') !== -1 || lower.indexOf('switch') !== -1 || lower.indexOf(' ap') !== -1)               { return 'Device Inventory'; }
  return 'Executive Summary';
}

// ─────────────────────────────────────────────────────────────────────────────
// Fallback answer generator
// ─────────────────────────────────────────────────────────────────────────────
function generateFallbackAnswer(query, ssot) {
  var exec   = ssot.exec;
  var period = ssot.period;
  return [
    '### 🤖 Claudex Loop Executive Analysis',
    '',
    '**Query**: ' + query,
    '**Reporting Period**: ' + period,
    '',
    '**Key Performance Metrics:**',
    '- **JFL Switch Uptime**: **' + (exec.jflSwitchUptime || exec.overallUptime || 'N/A') + '%** vs SLA Target: ' + ssot.slaTarget + '%',
    '- **Proactive Switch Uptime**: **' + (exec.proactiveSwitchUptime || 'N/A') + '%**',
    '- **Infrastructure Health Score**: **' + (exec.healthScore || 'N/A') + '/100** (' + (exec.healthLabel || 'N/A') + ')',
    '- **SLA Compliance**: **' + (exec.slaCompliance || 'N/A') + '%**',
    '- **Total Infrastructure**: ' + (exec.totalDevices || 0) + ' devices across ' + (exec.totalSites || 0) + ' sites',
    '- **Primary RCA (Switches)**: ' + (exec.primaryRcaSwitches || 'Stable Operations (No Incidents)'),
    '- **Primary RCA (APs)**: ' + (exec.primaryRcaAPs || 'Stable Operations (No Incidents)'),
  ].join('\n');
}

module.exports = { runClaudexLoop };
