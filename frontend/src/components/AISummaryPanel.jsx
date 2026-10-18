// frontend/src/components/AISummaryPanel.jsx
import React, { useState } from 'react';
import { motion } from 'framer-motion';

/**
 * Single AI Summary Section Item with Read More / Read Less toggle
 */
function AISummaryItem({ sectionKey, text }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const textContent = typeof text === 'string' ? text : (text?.text || String(text || ''));
  const isLong = textContent.length > 150;

  const formatTitle = (key) => {
    if (!key || key === 'default' || key === 'executive') return 'Executive AI Summary';
    const spaced = key.replace(/([A-Z])/g, ' $1').replace(/[-_]/g, ' ');
    return spaced.charAt(0).toUpperCase() + spaced.slice(1) + ' Summary';
  };

  return (
    <div className="ai-summary-item" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
        <span style={{ fontSize: '1.1rem' }} role="img" aria-label="ai">🤖</span>
        <h4 style={{
          margin: 0,
          fontSize: '0.82rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: '#0284c7'
        }}>
          {formatTitle(sectionKey)}
        </h4>
      </div>
      <div
        className="ai-summary-text"
        style={{
          fontSize: '0.925rem',
          lineHeight: '1.65',
          color: 'var(--text-primary, #0f172a)',
          display: isLong && !isExpanded ? '-webkit-box' : 'block',
          WebkitLineClamp: isLong && !isExpanded ? 3 : 'none',
          WebkitBoxOrient: isLong && !isExpanded ? 'vertical' : 'unset',
          overflow: isLong && !isExpanded ? 'hidden' : 'visible',
          textOverflow: isLong && !isExpanded ? 'ellipsis' : 'unset',
          whiteSpace: 'pre-wrap'
        }}
      >
        {textContent}
      </div>
      {isLong && (
        <button
          type="button"
          onClick={() => setIsExpanded(prev => !prev)}
          className="ai-summary-toggle-btn"
          style={{
            background: 'none',
            border: 'none',
            padding: '0.3rem 0',
            marginTop: '0.25rem',
            color: '#0284c7',
            fontWeight: 600,
            fontSize: '0.82rem',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3rem'
          }}
          aria-expanded={isExpanded}
        >
          {isExpanded ? 'Read Less ▲' : 'Read More ▼'}
        </button>
      )}
    </div>
  );
}

/**
 * AISummaryPanel — Displays AI Section Summaries with graceful fallback, line clamping, and motion.
 * @param {Object|string} summaries - aiSectionSummaries map or string from SSOT
 */
export default function AISummaryPanel({ summaries, text, title }) {
  // Defensive coding: handle text prop directly or summaries map/string
  let safeSummaries = summaries || {};
  if (text) {
    safeSummaries = { [title || 'executive']: text };
  }

  const entries = typeof safeSummaries === 'string'
    ? [['executive', safeSummaries]]
    : Object.entries(safeSummaries).filter(([_, val]) => Boolean(val && String(val).trim()));

  // If empty: Render a professional card with subtle gray background
  if (entries.length === 0) {
    return (
      <motion.div
        className="ai-summary-panel ai-summary-empty"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        style={{
          background: 'var(--bg-secondary, #f8fafc)',
          border: '1px solid var(--border, #e2e8f0)',
          borderRadius: '12px',
          padding: '1.25rem 1.5rem',
          marginBottom: '1.5rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          color: 'var(--text-secondary, #64748b)',
          fontSize: '0.9rem',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)'
        }}
      >
        <span style={{ fontSize: '1.3rem' }} role="img" aria-label="sparkles">✨</span>
        <span>AI summary will be generated in the next report cycle.</span>
      </motion.div>
    );
  }

  // If populated: Map the data with line-clamp-3 and Read More / Read Less toggle
  return (
    <motion.div
      className="ai-summary-panel ai-summary-populated"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      style={{
        background: 'linear-gradient(135deg, rgba(240, 249, 255, 0.75) 0%, rgba(224, 242, 254, 0.45) 100%)',
        border: '1px solid #bae6fd',
        borderRadius: '12px',
        padding: '1.25rem 1.5rem',
        marginBottom: '1.5rem',
        boxShadow: '0 2px 8px rgba(2, 132, 199, 0.06)',
        backdropFilter: 'blur(8px)'
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '0.85rem',
        borderBottom: '1px solid rgba(186, 230, 253, 0.6)',
        paddingBottom: '0.5rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <span style={{ fontSize: '1.15rem' }}>✨</span>
          <span style={{
            fontSize: '0.85rem',
            fontWeight: 700,
            color: '#0369a1',
            textTransform: 'uppercase',
            letterSpacing: '0.04em'
          }}>
            AI Executive Intelligence
          </span>
        </div>
        <span style={{
          fontSize: '0.72rem',
          color: '#0284c7',
          background: 'rgba(224, 242, 254, 0.8)',
          padding: '0.15rem 0.5rem',
          borderRadius: '999px',
          border: '1px solid #7dd3fc',
          fontWeight: 600
        }}>
          Automated Synthesis
        </span>
      </div>

      {entries.map(([key, val]) => (
        <AISummaryItem key={key} sectionKey={key} text={val} />
      ))}
    </motion.div>
  );
}
