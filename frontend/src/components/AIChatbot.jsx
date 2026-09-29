import React, { useState, useRef, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../config/api';

// ─────────────────────────────────────────────────────────────────────────────
// AIChatbot — Executive QBR AI Assistant with Claudex Loop (Precision Edition)
//
// Two modes:
//   Standard → Single-shot /api/chat  query
//   Claudex  → SSE-streamed /api/chat/loop with live Think→Act→Observe→Repeat
//              + precision confidence breakdown per cycle
//              + cited KPIs and missing KPI badges
//              + downloadable loop trace JSON
// ─────────────────────────────────────────────────────────────────────────────

const PHASE_META = {
  loop_start:     { emoji: '🔄', color: '#6366f1', bg: 'rgba(99,102,241,0.08)',  label: 'Loop Started'   },
  think:          { emoji: '🧠', color: '#0ea5e9', bg: 'rgba(14,165,233,0.08)', label: 'THINK'          },
  act:            { emoji: '⚡', color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', label: 'ACT'            },
  observe:        { emoji: '🔍', color: '#10b981', bg: 'rgba(16,185,129,0.08)', label: 'OBSERVE'        },
  repeat:         { emoji: '🔁', color: '#8b5cf6', bg: 'rgba(139,92,246,0.08)', label: 'REPEAT'         },
  loop_converged: { emoji: '✅', color: '#22c55e', bg: 'rgba(34,197,94,0.08)',  label: 'Converged'      },
  loop_complete:  { emoji: '🎯', color: '#0284c7', bg: 'rgba(2,132,199,0.08)',  label: 'Complete'       },
  error:          { emoji: '⚠️', color: '#ef4444', bg: 'rgba(239,68,68,0.08)',  label: 'Error'          },
};

// ─────────────────────────────────────────────────────────────────────────────
// Mini sub-components
// ─────────────────────────────────────────────────────────────────────────────

function ConfidenceBar({ value, label, color }) {
  const pct = Math.round((value || 0) * 100);
  return (
    <div style={{ marginBottom: '3px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: '#64748b', marginBottom: '2px' }}>
        <span>{label}</span>
        <span style={{ fontWeight: '600', color: pct >= 75 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444' }}>{pct}%</span>
      </div>
      <div style={{ height: '3px', background: '#e2e8f0', borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: pct + '%',
          background: pct >= 75 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444',
          transition: 'width 0.6s ease',
          borderRadius: '2px',
        }} />
      </div>
    </div>
  );
}

function KPIBadge({ name, cited }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '3px',
      padding: '2px 7px', borderRadius: '12px', fontSize: '0.66rem', fontWeight: '600',
      background: cited ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.10)',
      color:      cited ? '#16a34a' : '#dc2626',
      border:     cited ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(239,68,68,0.25)',
      marginRight: '4px', marginBottom: '4px',
      flexShrink: 0,
    }}>
      {cited ? '✓' : '✗'} {name}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function AIChatbot({ jobId }) {
  const [isOpen,      setIsOpen]      = useState(false);
  const [prompt,      setPrompt]      = useState('');
  const [loading,     setLoading]     = useState(false);
  const [claudexMode, setClaudexMode] = useState(false);
  const [messages,    setMessages]    = useState([{
    sender: 'ai',
    text: '### 🤖 Welcome to Executive QBR AI Assistant!\n\nI can answer questions about dashboard metrics, site uptimes, device SLA breaches, primary RCA drivers, and backend calculation formulas.\n\nActivate **Claudex Loop** for deep multi-step agentic analysis — each cycle refines the answer against live SSOT data with precision confidence scoring.',
  }]);

  const messagesEndRef = useRef(null);
  const eventSourceRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (isOpen) { scrollToBottom(); }
  }, [messages, isOpen, scrollToBottom]);

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) { eventSourceRef.current.close(); }
    };
  }, []);

  // ── Standard single-shot chat ─────────────────────────────────────────────
  const handleStandardSend = useCallback(async (text) => {
    if (!text.trim() || loading) { return; }
    setMessages((p) => [...p, { sender: 'user', text }]);
    setLoading(true);
    try {
      const res  = await fetch(`${API_BASE_URL}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text, jobId }),
      });
      if (!res.ok) { throw new Error('HTTP ' + res.status); }
      const data = await res.json();
      setMessages((p) => [...p, { sender: 'ai', text: data.answer || 'No answer returned.', model: data.model || null }]);
    } catch (err) {
      setMessages((p) => [...p, { sender: 'ai', text: '⚠️ **Error**: ' + err.message }]);
    } finally {
      setLoading(false);
    }
  }, [loading, jobId]);

  // ── Claudex Loop SSE chat ─────────────────────────────────────────────────
  const handleClaudexSend = useCallback((text) => {
    if (!text.trim() || loading) { return; }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setMessages((p) => [...p, { sender: 'user', text }]);
    setLoading(true);

    const loopMsgId = Date.now();
    setMessages((p) => [...p, {
      sender: 'ai', isClaudexMsg: true, loopMsgId,
      claudexSteps: [], finalAnswer: null, executiveSummary: null,
      traceLog: [], model: 'Claudex Loop Engine (Precision Edition)',
    }]);

    const params = new URLSearchParams({ prompt: text, jobId: jobId || 'latest', maxIterations: 4 });
    const es     = new EventSource(`${API_BASE_URL}/api/chat/loop?${params}`);
    eventSourceRef.current = es;

    const ALL_EVENTS = ['loop_start','think','act','observe','repeat','loop_converged','loop_complete','error'];
    ALL_EVENTS.forEach((evtName) => {
      es.addEventListener(evtName, (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (evtName === 'loop_complete') {
            setMessages((p) => p.map((m) => {
              if (!m.isClaudexMsg || m.loopMsgId !== loopMsgId) { return m; }
              return {
                ...m,
                claudexSteps:    [...(m.claudexSteps || []), { event: evtName, payload }],
                finalAnswer:     payload.answer || null,
                executiveSummary: payload.executiveSummary || null,
                totalIterations: payload.totalIterations,
                finalConfidence: payload.finalConfidence,
                ssotSnapshot:    payload.ssotSnapshot || null,
                traceLog:        payload.iterationLog  || [],
              };
            }));
            setLoading(false);
            es.close();
            eventSourceRef.current = null;
          } else {
            setMessages((p) => p.map((m) => {
              if (!m.isClaudexMsg || m.loopMsgId !== loopMsgId) { return m; }
              return { ...m, claudexSteps: [...(m.claudexSteps || []), { event: evtName, payload }] };
            }));
            if (evtName === 'error') { setLoading(false); es.close(); eventSourceRef.current = null; }
          }
        } catch (_) {}
      });
    });

    es.onerror = () => {
      setLoading(false);
      es.close();
      eventSourceRef.current = null;
    };
  }, [loading, jobId]);

  const handleSend = useCallback((customText) => {
    const text = customText || prompt;
    if (!text.trim()) { return; }
    if (!customText) { setPrompt(''); }
    claudexMode ? handleClaudexSend(text) : handleStandardSend(text);
  }, [claudexMode, prompt, handleClaudexSend, handleStandardSend]);

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // Download loop trace as JSON
  const downloadTrace = useCallback((msg) => {
    const payload = {
      query:      msg.text,
      timestamp:  new Date().toISOString(),
      traceLog:   msg.traceLog || [],
      claudexSteps: (msg.claudexSteps || []).map((s) => ({ event: s.event, message: s.payload?.message })),
      executiveSummary: msg.executiveSummary,
      ssotSnapshot: msg.ssotSnapshot,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'claudex_loop_trace_' + Date.now() + '.json';
    a.click(); URL.revokeObjectURL(url);
  }, []);

  const quickPrompts = [
    { label: '📊 JFL Uptime Formula',  text: 'Explain JFL Switch Uptime calculation formula and hold mins rules' },
    { label: '⚡ Proactive Uptime',     text: 'How is Proactive Switch Uptime calculated for open and resolved tickets?' },
    { label: '🎯 SLA Compliance',       text: 'Which sites or devices breached the 99.3% SLA target?' },
    { label: '🏥 Health Score',         text: 'Explain how the Infrastructure Health Score is computed' },
    { label: '🔍 RCA Drivers',          text: 'What are the primary RCA drivers for Switches and APs?' },
  ];

  // ── Markdown renderer ─────────────────────────────────────────────────────
  const formatMd = (text) => {
    if (!text) { return ''; }
    let f = text;
    f = f.replace(/^### (.*$)/gim, '<h4 style="margin:6px 0;color:#0284c7;font-size:0.93rem;font-weight:700;">$1</h4>');
    f = f.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    f = f.replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,0.06);padding:2px 4px;border-radius:3px;font-family:monospace;font-size:0.82em;">$1</code>');
    f = f.replace(/^- (.*$)/gim, '<li style="margin-left:14px;margin-bottom:3px;">$1</li>');
    f = f.replace(/\n/g, '<br/>');
    return f;
  };

  // ── Claudex step card ─────────────────────────────────────────────────────
  const renderStep = (step, idx) => {
    const meta    = PHASE_META[step.event] || { emoji: '•', color: '#64748b', bg: '#f8fafc', label: step.event };
    const payload = step.payload || {};
    const hasScore = payload.scoreBreakdown && typeof payload.scoreBreakdown === 'object';
    const hasCited = payload.citedKPIs && payload.citedKPIs.length > 0;
    const hasMissing = payload.missingKPIs && payload.missingKPIs.length > 0;

    return (
      <div key={idx} style={{
        borderLeft: '3px solid ' + meta.color,
        background: meta.bg,
        borderRadius: '6px',
        padding: '8px 10px',
        marginBottom: '7px',
        animation: 'claudexFade 0.3s ease',
        fontSize: '0.77rem',
        lineHeight: '1.45',
      }}>
        {/* Phase header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
          <span style={{ fontSize: '0.95rem' }}>{meta.emoji}</span>
          <span style={{ fontWeight: '800', color: meta.color, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {meta.label}
          </span>
          {payload.label && (
            <span style={{ color: '#94a3b8', fontWeight: '400', fontSize: '0.69rem' }}>— {payload.label}</span>
          )}
        </div>

        {/* Message */}
        {payload.message && (
          <div style={{ color: '#334155', marginBottom: hasCited || hasMissing || hasScore ? '6px' : '0' }}>
            {payload.message}
          </div>
        )}

        {/* Goals */}
        {payload.goals && payload.goals.length > 0 && (
          <div style={{ color: '#64748b', fontSize: '0.69rem', marginBottom: '4px' }}>
            Goals: {payload.goals.map((g) => g.label || g).join(' · ')}
          </div>
        )}

        {/* Confidence bar + score breakdown (OBSERVE) */}
        {payload.confidence != null && (
          <div style={{ marginBottom: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <div style={{ flex: 1, height: '5px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: Math.round((payload.confidence || 0) * 100) + '%',
                  background: (payload.confidence || 0) >= 0.82 ? '#22c55e' : (payload.confidence || 0) >= 0.55 ? '#f59e0b' : '#ef4444',
                  transition: 'width 0.6s ease',
                  borderRadius: '3px',
                }} />
              </div>
              <span style={{ fontWeight: '800', fontSize: '0.75rem', color: meta.color, minWidth: '36px' }}>
                {payload.confidencePct || (Math.round((payload.confidence || 0) * 100) + '%')}
              </span>
            </div>

            {hasScore && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 10px' }}>
                <ConfidenceBar value={payload.scoreBreakdown.length}  label="Answer depth"  color={meta.color} />
                <ConfidenceBar value={payload.scoreBreakdown.numeric} label="KPI citation"  color={meta.color} />
                <ConfidenceBar value={payload.scoreBreakdown.goals}   label="Goal coverage" color={meta.color} />
                <ConfidenceBar value={payload.scoreBreakdown.sla}     label="SLA awareness" color={meta.color} />
              </div>
            )}
          </div>
        )}

        {/* Cited & missing KPIs */}
        {(hasCited || hasMissing) && (
          <div style={{ marginTop: '5px' }}>
            {payload.citedKPIs && payload.citedKPIs.map((k, i) => (
              <KPIBadge key={'c' + i} name={k} cited={true} />
            ))}
            {payload.missingKPIs && payload.missingKPIs.map((k, i) => (
              <KPIBadge key={'m' + i} name={k} cited={false} />
            ))}
          </div>
        )}

        {/* Gaps */}
        {payload.gaps && payload.gaps.length > 0 && (
          <div style={{ marginTop: '4px', color: '#dc2626', fontSize: '0.69rem' }}>
            Gaps: {payload.gaps.join(' · ')}
          </div>
        )}

        {/* Model badge */}
        {payload.model && (
          <div style={{ marginTop: '4px', color: '#94a3b8', fontSize: '0.66rem', textAlign: 'right' }}>
            {payload.model}
          </div>
        )}
      </div>
    );
  };

  // ── Claudex message card ──────────────────────────────────────────────────
  const renderClaudexMsg = (msg, index) => {
    const steps = msg.claudexSteps || [];
    const visibleSteps = steps.filter((s) => s.event !== 'loop_complete');

    return (
      <div key={index} style={{
        alignSelf: 'flex-start', maxWidth: '95%',
        borderRadius: '14px 14px 14px 2px',
        boxShadow: '0 4px 20px rgba(99,102,241,0.15)',
        border: '1px solid rgba(99,102,241,0.22)',
        overflow: 'hidden',
        background: '#fff',
      }}>
        {/* Header bar */}
        <div style={{
          background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #1e3a5f 100%)',
          padding: '10px 14px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1rem' }}>🔄</span>
            <div>
              <div style={{ color: '#fff', fontWeight: '800', fontSize: '0.82rem' }}>Claudex Loop</div>
              <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.66rem' }}>Precision Edition · Think → Act → Observe → Repeat</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {loading && visibleSteps.length > 0 && (
              <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.68rem', animation: 'claudexPulse 1.2s ease infinite' }}>
                Running…
              </span>
            )}
            {!loading && msg.finalConfidence != null && (
              <span style={{
                background: msg.finalConfidence >= 82 ? 'rgba(34,197,94,0.25)' : 'rgba(245,158,11,0.25)',
                color:      msg.finalConfidence >= 82 ? '#86efac' : '#fcd34d',
                padding: '3px 8px', borderRadius: '12px', fontSize: '0.68rem', fontWeight: '700',
              }}>
                {msg.totalIterations} cycles · {msg.finalConfidence}% confident
              </span>
            )}
            {!loading && msg.traceLog && msg.traceLog.length > 0 && (
              <button
                onClick={() => downloadTrace(msg)}
                title="Download loop trace JSON"
                style={{
                  background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)',
                  color: '#fff', borderRadius: '6px', padding: '3px 8px', fontSize: '0.66rem',
                  cursor: 'pointer', fontWeight: '600',
                }}
              >
                ⬇ Trace
              </button>
            )}
          </div>
        </div>

        {/* SSOT snapshot strip (shown after loop completes) */}
        {!loading && msg.ssotSnapshot && Object.keys(msg.ssotSnapshot).length > 0 && (
          <div style={{
            background: 'rgba(99,102,241,0.04)', borderBottom: '1px solid rgba(99,102,241,0.12)',
            padding: '6px 12px', display: 'flex', flexWrap: 'wrap', gap: '6px',
          }}>
            {Object.entries(msg.ssotSnapshot).slice(0, 8).map(([k, v]) => (
              <span key={k} style={{
                background: '#f1f5f9', border: '1px solid #e2e8f0',
                borderRadius: '8px', padding: '2px 7px', fontSize: '0.65rem', color: '#475569',
              }}>
                <span style={{ fontWeight: '600', color: '#0284c7' }}>{k}:</span> {v}
              </span>
            ))}
          </div>
        )}

        {/* Reasoning steps */}
        {visibleSteps.length > 0 && (
          <div style={{
            padding: '10px 12px',
            borderBottom: msg.finalAnswer ? '1px solid #e2e8f0' : 'none',
            maxHeight: '320px', overflowY: 'auto',
          }}>
            {visibleSteps.map(renderStep)}
          </div>
        )}

        {/* Loading shimmer */}
        {loading && visibleSteps.length === 0 && (
          <div style={{ padding: '14px', color: '#64748b', fontSize: '0.8rem' }}>
            <span style={{ animation: 'claudexPulse 1.2s ease infinite', display: 'inline-block' }}>
              🧠 Initialising Claudex Precision Engine…
            </span>
          </div>
        )}

        {/* Final synthesised answer */}
        {msg.finalAnswer && (
          <div style={{ padding: '12px 14px', fontSize: '0.85rem', lineHeight: '1.55', color: '#1e293b' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              fontWeight: '700', color: '#0284c7', fontSize: '0.7rem',
              textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px',
            }}>
              <span>🎯</span> Synthesised Executive Answer
            </div>
            <div dangerouslySetInnerHTML={{ __html: formatMd(msg.finalAnswer) }} />
          </div>
        )}

        {/* Iteration trace pills (mini summary) */}
        {msg.traceLog && msg.traceLog.length > 0 && (
          <div style={{
            padding: '6px 14px 10px',
            borderTop: '1px solid #f1f5f9',
            display: 'flex', flexWrap: 'wrap', gap: '5px',
          }}>
            {msg.traceLog.map((l) => (
              <span key={l.cycle} title={'Model: ' + l.model + ' | Gaps: ' + (l.gaps || []).join(', ')} style={{
                background: l.confidence >= 82 ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)',
                border:     l.confidence >= 82 ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(245,158,11,0.3)',
                color:      l.confidence >= 82 ? '#16a34a' : '#d97706',
                borderRadius: '10px', padding: '2px 8px', fontSize: '0.66rem', fontWeight: '600',
              }}>
                Cycle {l.cycle}: {l.confidence}%
              </span>
            ))}
          </div>
        )}

        {/* Powered-by */}
        <div style={{ padding: '4px 14px 7px', fontSize: '0.65rem', color: '#94a3b8', textAlign: 'right' }}>
          {msg.model}
        </div>
      </div>
    );
  };

  // ── Standard message ──────────────────────────────────────────────────────
  const renderStandardMsg = (msg, index) => (
    <div key={index} style={{
      alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
      maxWidth: '88%',
      background: msg.sender === 'user' ? '#0284c7' : '#ffffff',
      color:      msg.sender === 'user' ? '#ffffff' : '#1e293b',
      padding: '10px 14px',
      borderRadius: msg.sender === 'user' ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
      boxShadow: msg.sender === 'user' ? 'none' : '0 2px 8px rgba(0,0,0,0.05)',
      fontSize: '0.85rem', lineHeight: '1.5',
      border: msg.sender === 'user' ? 'none' : '1px solid #e2e8f0',
    }}>
      <div dangerouslySetInnerHTML={{ __html: formatMd(msg.text) }} />
      {msg.model && (
        <div style={{ fontSize: '0.68rem', color: msg.sender === 'user' ? 'rgba(255,255,255,0.65)' : '#94a3b8', marginTop: '5px', textAlign: 'right' }}>
          {msg.model}
        </div>
      )}
    </div>
  );

  const renderMessage = (msg, index) => msg.isClaudexMsg ? renderClaudexMsg(msg, index) : renderStandardMsg(msg, index);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @keyframes claudexFade { from { opacity:0; transform:translateY(5px); } to { opacity:1; transform:translateY(0); } }
        @keyframes claudexPulse { 0%,100%{opacity:1;} 50%{opacity:0.35;} }
      `}</style>

      {/* Floating button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: 'fixed', bottom: '24px', right: '24px', zIndex: 9999,
          background: claudexMode
            ? 'linear-gradient(135deg, #6366f1 0%, #0284c7 100%)'
            : 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
          color: '#fff', border: 'none', borderRadius: '50px',
          padding: '12px 20px', fontSize: '0.95rem', fontWeight: '700',
          boxShadow: claudexMode ? '0 8px 28px rgba(99,102,241,0.45)' : '0 8px 24px rgba(2,132,199,0.35)',
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px',
          transition: 'all 0.25s ease',
        }}
      >
        <span>{claudexMode ? '🔄' : '🤖'}</span>
        {claudexMode ? 'Claudex' : 'Ask AI'}
      </button>

      {/* Chat panel */}
      {isOpen && (
        <div style={{
          position: 'fixed', bottom: '80px', right: '24px',
          width: '460px', maxWidth: 'calc(100vw - 48px)',
          height: '680px', maxHeight: 'calc(100vh - 110px)',
          zIndex: 9999, background: '#fff', borderRadius: '18px',
          boxShadow: claudexMode
            ? '0 24px 60px rgba(99,102,241,0.20), 0 4px 16px rgba(2,132,199,0.12)'
            : '0 20px 44px rgba(15,23,42,0.22)',
          border: claudexMode ? '1px solid rgba(99,102,241,0.28)' : '1px solid rgba(226,232,240,0.8)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          transition: 'box-shadow 0.3s ease',
        }}>

          {/* Header */}
          <div style={{
            padding: '14px 18px',
            background: claudexMode
              ? 'linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%)'
              : '#0f172a',
            color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
              <span style={{ fontSize: '1.25rem' }}>{claudexMode ? '🔄' : '🤖'}</span>
              <div>
                <div style={{ fontWeight: '800', fontSize: '0.92rem' }}>
                  {claudexMode ? 'Claudex Loop Intelligence' : 'Executive QBR AI Intelligence'}
                </div>
                <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                  {claudexMode ? 'Think → Act → Observe → Repeat · Precision Edition' : 'SSOT Engine & Formula Assistant'}
                </div>
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} style={{
              background: 'transparent', border: 'none', color: '#cbd5e1', fontSize: '1.1rem', cursor: 'pointer', padding: '4px 8px',
            }}>✕</button>
          </div>

          {/* Mode toggle bar */}
          <div style={{
            padding: '8px 14px', background: claudexMode ? 'rgba(99,102,241,0.05)' : '#f8fafc',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ fontSize: '0.73rem', color: '#64748b' }}>
              {claudexMode
                ? '🔄 Claudex Loop active — multi-step precision reasoning'
                : '💬 Standard mode — instant AI response'}
            </div>
            <button
              onClick={() => {
                setClaudexMode((m) => !m);
                if (eventSourceRef.current) { eventSourceRef.current.close(); eventSourceRef.current = null; }
                setLoading(false);
              }}
              style={{
                background:  claudexMode ? 'linear-gradient(135deg,#6366f1,#0284c7)' : '#e2e8f0',
                border: 'none', borderRadius: '20px', padding: '5px 14px',
                color: claudexMode ? '#fff' : '#475569',
                fontWeight: '700', fontSize: '0.71rem', cursor: 'pointer',
                boxShadow: claudexMode ? '0 2px 10px rgba(99,102,241,0.35)' : 'none',
                transition: 'all 0.25s ease',
              }}
            >
              {claudexMode ? '✓ Claudex ON' : '○ Claudex'}
            </button>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1, padding: '14px', overflowY: 'auto',
            background: claudexMode ? '#fafbff' : '#f8fafc',
            display: 'flex', flexDirection: 'column', gap: '12px',
          }}>
            {messages.map(renderMessage)}
            {loading && !claudexMode && (
              <div style={{
                alignSelf: 'flex-start', background: '#fff',
                padding: '8px 14px', borderRadius: '12px', fontSize: '0.8rem', color: '#64748b',
                border: '1px solid #e2e8f0',
              }}>
                ⏳ Analyzing SSOT Dashboard…
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick prompts */}
          <div style={{
            padding: '7px 12px', background: '#fff', borderTop: '1px solid #e2e8f0',
            display: 'flex', gap: '6px', overflowX: 'auto', whiteSpace: 'nowrap',
          }}>
            {quickPrompts.map((qp, i) => (
              <button key={i} onClick={() => handleSend(qp.text)} style={{
                background: claudexMode ? 'rgba(99,102,241,0.07)' : '#f1f5f9',
                border: claudexMode ? '1px solid rgba(99,102,241,0.22)' : '1px solid #cbd5e1',
                borderRadius: '20px', padding: '4px 11px', fontSize: '0.72rem',
                color: claudexMode ? '#4f46e5' : '#0f172a',
                cursor: 'pointer', fontWeight: '600', flexShrink: 0, transition: 'all 0.2s ease',
              }}>
                {qp.label}
              </button>
            ))}
          </div>

          {/* Input bar */}
          <div style={{
            padding: '10px 14px', background: '#fff',
            borderTop: '1px solid #e2e8f0', display: 'flex', gap: '8px',
          }}>
            <input
              type="text" value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={claudexMode
                ? 'Ask anything — Claudex Loop iterates for highest precision…'
                : 'Ask about calculations, devices, sites, SLA…'}
              style={{
                flex: 1, padding: '10px 14px', borderRadius: '8px',
                border: claudexMode ? '1px solid rgba(99,102,241,0.4)' : '1px solid #cbd5e1',
                fontSize: '0.85rem', outline: 'none',
                boxShadow: claudexMode ? '0 0 0 2px rgba(99,102,241,0.1)' : 'none',
                transition: 'all 0.2s ease',
              }}
            />
            <button
              onClick={() => handleSend()}
              disabled={loading || !prompt.trim()}
              style={{
                background: claudexMode
                  ? 'linear-gradient(135deg,#6366f1,#0284c7)'
                  : '#0284c7',
                color: '#fff', border: 'none', borderRadius: '8px',
                padding: '0 16px', fontWeight: '700', fontSize: '0.85rem',
                cursor: loading || !prompt.trim() ? 'not-allowed' : 'pointer',
                opacity: loading || !prompt.trim() ? 0.55 : 1,
                transition: 'all 0.2s ease', minWidth: '60px',
              }}
            >
              {loading ? '…' : claudexMode ? '🔄' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
