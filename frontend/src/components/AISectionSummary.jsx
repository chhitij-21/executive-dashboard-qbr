// frontend/src/components/AISectionSummary.jsx
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config/api';

export default function AISectionSummary({ section, jobId, title = 'AI Section Summary' }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cached, setCached] = useState(false);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    fetch(`${API_BASE_URL}/api/ai/section-summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section, jobId }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (isMounted) {
          if (data.success && data.summary) {
            setSummary(data.summary);
            setCached(!!data.cached);
          }
          setLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    return () => { isMounted = false; };
  }, [section, jobId]);

  if (loading) {
    return (
      <div style={{
        background: '#f8fafc',
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        padding: '0.75rem 1rem',
        marginBottom: '1rem',
        fontSize: '0.85rem',
        color: '#64748b',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem'
      }}>
        <span>✨</span>
        <span>Generating AI section summary...</span>
      </div>
    );
  }

  if (!summary) return null;

  return (
    <div style={{
      background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
      border: '1px solid #bae6fd',
      borderRadius: '8px',
      padding: '0.85rem 1.15rem',
      marginBottom: '1.25rem',
      fontSize: '0.875rem',
      color: '#0369a1',
      boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700, color: '#0284c7', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          <span>🤖</span>
          <span>{title}</span>
        </div>
        {cached && (
          <span style={{ fontSize: '0.7rem', color: '#0369a1', background: '#e0f2fe', padding: '0.1rem 0.4rem', borderRadius: '4px', border: '1px solid #7dd3fc', fontWeight: 600 }}>
            Cached
          </span>
        )}
      </div>
      <div style={{ color: '#0f172a', lineHeight: 1.55, fontWeight: 450 }}>
        {summary}
      </div>
    </div>
  );
}
