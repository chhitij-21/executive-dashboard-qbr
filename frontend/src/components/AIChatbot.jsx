import React, { useState, useRef, useEffect } from 'react';
import { API_BASE_URL } from '../config/apiConfig';

export function AIChatbot({ jobId }) {
  const [isOpen, setIsOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState([
    {
      sender: 'ai',
      text: '### 🤖 Welcome to Executive QBR AI Assistant!\n\nI can answer any question about active dashboard metrics, site uptimes, device SLA breaches, primary RCA drivers, and backend calculation formulas (JFL Uptime %, Proactive Uptime %, Health Score).\n\nTry one of the quick question shortcuts below or type your question.'
    }
  ]);

  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) scrollToBottom();
  }, [messages, isOpen]);

  const handleSend = async (customPrompt) => {
    const textToSend = customPrompt || prompt;
    if (!textToSend.trim() || loading) return;

    const userMessage = { sender: 'user', text: textToSend };
    setMessages((prev) => [...prev, userMessage]);
    if (!customPrompt) setPrompt('');
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: textToSend, jobId })
      });

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }

      const data = await response.json();
      const aiMessage = {
        sender: 'ai',
        text: data.answer || 'No answer returned from AI engine.',
        model: data.model || null
      };

      setMessages((prev) => [...prev, aiMessage]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          sender: 'ai',
          text: `⚠️ **AI Chat Note**: ${err.message}. Please check connection or retry.`
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const quickPrompts = [
    { label: '📊 JFL Uptime Formula', text: 'Explain JFL Switch Uptime calculation formula and hold mins rules' },
    { label: '⚡ Proactive Uptime', text: 'How is Proactive Switch Uptime calculated for open and resolved tickets?' },
    { label: '🎯 SLA Compliance', text: 'Which sites or devices breached the 99.3% SLA target?' },
    { label: '🏥 Health Score', text: 'Explain how the Infrastructure Health Score is computed' },
    { label: '🔍 RCA Drivers', text: 'What are the primary RCA drivers for Switches and APs?' },
  ];

  // Helper to format simple markdown-like text
  const formatMarkdown = (text) => {
    if (!text) return '';
    let formatted = text;

    // Headers
    formatted = formatted.replace(/^### (.*$)/gim, '<h4 style="margin: 6px 0; color: #0284c7; font-size: 0.95rem;">$1</h4>');
    // Bold
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Code blocks / inline math
    formatted = formatted.replace(/`([^`]+)`/g, '<code style="background: rgba(0,0,0,0.06); padding: 2px 4px; border-radius: 4px; font-family: monospace;">$1</code>');
    // Bullet points
    formatted = formatted.replace(/^- (.*$)/gim, '<li style="margin-left: 12px; margin-bottom: 2px;">$1</li>');
    // Line breaks
    formatted = formatted.replace(/\n/g, '<br/>');

    return formatted;
  };

  return (
    <>
      {/* Floating Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 9999,
          background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
          color: '#ffffff',
          border: 'none',
          borderRadius: '50px',
          padding: '12px 20px',
          fontSize: '0.95rem',
          fontWeight: '700',
          boxShadow: '0 8px 24px rgba(2, 132, 199, 0.35)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          transition: 'all 0.2s ease',
        }}
        title="Open Executive AI Chatbot"
      >
        <span>🤖</span> Ask AI
      </button>

      {/* Slide-over Drawer / Chat Popup */}
      {isOpen && (
        <div
          style={{
            position: 'fixed',
            bottom: '80px',
            right: '24px',
            width: '420px',
            maxWidth: 'calc(100vw - 48px)',
            height: '600px',
            maxHeight: 'calc(100vh - 120px)',
            zIndex: 9999,
            background: '#ffffff',
            borderRadius: '16px',
            boxShadow: '0 20px 40px rgba(15, 23, 42, 0.25)',
            border: '1px solid rgba(226, 232, 240, 0.8)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '14px 18px',
              background: '#0f172a',
              color: '#ffffff',
              display: 'flex',
              justify: 'space-between',
              alignItems: 'center',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.3rem' }}>🤖</span>
              <div>
                <div style={{ fontWeight: '700', fontSize: '0.95rem' }}>Executive QBR AI Intelligence</div>
                <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>SSOT Engine & Formula Assistant</div>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#cbd5e1',
                fontSize: '1.2rem',
                cursor: 'pointer',
                padding: '4px 8px',
              }}
            >
              ✕
            </button>
          </div>

          {/* Messages Scroll Area */}
          <div
            style={{
              flex: 1,
              padding: '14px',
              overflowY: 'auto',
              background: '#f8fafc',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            {messages.map((msg, index) => (
              <div
                key={index}
                style={{
                  alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '88%',
                  background: msg.sender === 'user' ? '#0284c7' : '#ffffff',
                  color: msg.sender === 'user' ? '#ffffff' : '#1e293b',
                  padding: '10px 14px',
                  borderRadius: msg.sender === 'user' ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
                  boxShadow: msg.sender === 'user' ? 'none' : '0 2px 8px rgba(0, 0, 0, 0.05)',
                  fontSize: '0.85rem',
                  lineHeight: '1.45',
                  border: msg.sender === 'user' ? 'none' : '1px solid #e2e8f0',
                }}
              >
                <div dangerouslySetInnerHTML={{ __html: formatMarkdown(msg.text) }} />
                {msg.model && (
                  <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '4px', textAlign: 'right' }}>
                    Powered by {msg.model}
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div style={{ alignSelf: 'flex-start', background: '#ffffff', padding: '8px 12px', borderRadius: '12px', fontSize: '0.8rem', color: '#64748b' }}>
                ⏳ Analyzing SSOT Dashboard Engine...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Prompt Shortcuts */}
          <div
            style={{
              padding: '8px 12px',
              background: '#ffffff',
              borderTop: '1px solid #e2e8f0',
              display: 'flex',
              gap: '6px',
              overflowX: 'auto',
              whiteSpace: 'nowrap',
            }}
          >
            {quickPrompts.map((qp, idx) => (
              <button
                key={idx}
                onClick={() => handleSend(qp.text)}
                style={{
                  background: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  borderRadius: '20px',
                  padding: '4px 10px',
                  fontSize: '0.75rem',
                  color: '#0f172a',
                  cursor: 'pointer',
                  fontWeight: '500',
                  flexShrink: 0,
                }}
              >
                {qp.label}
              </button>
            ))}
          </div>

          {/* Input Bar */}
          <div style={{ padding: '10px 14px', background: '#ffffff', borderTop: '1px solid #e2e8f0', display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Ask anything about calculations, devices, sites..."
              style={{
                flex: 1,
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '0.85rem',
                outline: 'none',
              }}
            />
            <button
              onClick={() => handleSend()}
              disabled={loading || !prompt.trim()}
              style={{
                background: '#0284c7',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '0 16px',
                fontWeight: '600',
                fontSize: '0.85rem',
                cursor: loading || !prompt.trim() ? 'not-allowed' : 'pointer',
                opacity: loading || !prompt.trim() ? 0.6 : 1,
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}
