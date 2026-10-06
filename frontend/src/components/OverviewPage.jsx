// frontend/src/components/OverviewPage.jsx
import React from 'react';
import { API_BASE_URL } from '../config/api';
import AISectionSummary from './AISectionSummary';

/**
 * OverviewPage — Executive Operations Landing Page
 * Displays a clean 2-column layout for Reports and Proactive Tickets Summary.
 */
export default function OverviewPage({ data, jobId, onOpenReports, onOpenTickets }) {
  const periodLabel = data?.report_period?.display_label || data?.reportingPeriod || 'Selected Period';
  const customerName = data?.customerName || 'Jubilant Foodworks Ltd (JFL)';
  const overall = data?.proactiveTicketAnalytics?.overall || {};
  const topEngineers = (data?.proactiveTicketAnalytics?.byEngineer || []).slice(0, 5);

  const activeJobId = jobId || 'latest';

  return (
    <div className="overview-page" style={{ padding: '1rem 0', maxWidth: '1680px', margin: '0 auto' }}>
      {/* Header Banner */}
      <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-main, #0f172a)', margin: 0 }}>
            Executive Operations Overview
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary, #64748b)', margin: '0.25rem 0 0 0' }}>
            {customerName} — Reporting Period: <strong>{periodLabel}</strong>
          </p>
        </div>
      </div>

      <AISectionSummary section="executive" jobId={activeJobId} title="Executive Summary Insight" />

      {/* 2-Column Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: '1.5rem',
        marginTop: '0.5rem'
      }}>
        {/* LEFT CARD — Reports */}
        <div
          className="overview-card"
          style={{
            background: '#ffffff',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            borderTop: '4px solid #2563eb',
            padding: '1.75rem',
            boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            transition: 'transform 0.2s ease, box-shadow 0.2s ease'
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.3rem' }}>
              <span style={{ fontSize: '1.5rem' }}>📊</span>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
                Reports
              </h3>
            </div>
            <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0 0 1.25rem 0' }}>
              Executive dashboard, PPT, PDF &amp; validation reports
            </p>

            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1.5rem 0', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <li>
                <button
                  onClick={onOpenReports}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    color: '#2563eb',
                    fontWeight: 600,
                    fontSize: '0.9rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}
                >
                  <span>•</span> Executive Dashboard
                </button>
              </li>
              <li>
                <a
                  href={`${API_BASE_URL}/api/ppt/${activeJobId}`}
                  download="JFL_QBR_Executive_Report.pdf"
                  style={{
                    color: '#2563eb',
                    fontWeight: 600,
                    fontSize: '0.9rem',
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}
                >
                  <span>•</span> Download Executive PDF Report
                </a>
              </li>
              <li>
                <a
                  href={`${API_BASE_URL}/api/pdf/${activeJobId}`}
                  download="JFL_QBR_Executive_Report.pdf"
                  style={{
                    color: '#2563eb',
                    fontWeight: 600,
                    fontSize: '0.9rem',
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}
                >
                  <span>•</span> Download PDF Report
                </a>
              </li>
            </ul>
          </div>

          <button
            onClick={onOpenReports}
            style={{
              width: '100%',
              padding: '0.75rem 1rem',
              background: '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 600,
              fontSize: '0.9rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              transition: 'background-color 0.2s ease'
            }}
          >
            Open Dashboard →
          </button>
        </div>

        {/* RIGHT CARD — Proactive Tickets Summary */}
        <div
          className="overview-card"
          style={{
            background: '#ffffff',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            borderTop: '4px solid #16a34a',
            padding: '1.75rem',
            boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            transition: 'transform 0.2s ease, box-shadow 0.2s ease'
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.3rem' }}>
              <span style={{ fontSize: '1.5rem' }}>🎫</span>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
                Proactive Tickets Summary
              </h3>
            </div>
            <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0 0 1.25rem 0' }}>
              Engineer-wise breakdown, SLA tracking, hold reasons
            </p>

            {/* 4-Cell Mini KPI Grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: '0.5rem',
              textAlign: 'center',
              marginBottom: '1.25rem'
            }}>
              <div style={{ background: '#f8fafc', padding: '0.6rem 0.4rem', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f172a' }}>
                  {overall?.total != null ? overall.total : '—'}
                </div>
                <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Total</div>
              </div>

              <div style={{ background: '#fffbeb', padding: '0.6rem 0.4rem', borderRadius: '8px', border: '1px solid #fef3c7' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#b45309' }}>
                  {overall?.open != null ? overall.open : '—'}
                </div>
                <div style={{ fontSize: '0.7rem', color: '#b45309', fontWeight: 600, textTransform: 'uppercase' }}>Open</div>
              </div>

              <div style={{ background: '#f1f5f9', padding: '0.6rem 0.4rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#475569' }}>
                  {overall?.onHold != null ? overall.onHold : '—'}
                </div>
                <div style={{ fontSize: '0.7rem', color: '#475569', fontWeight: 600, textTransform: 'uppercase' }}>On Hold</div>
              </div>

              <div style={{ background: '#f0fdf4', padding: '0.6rem 0.4rem', borderRadius: '8px', border: '1px solid #dcfce7' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#16a34a' }}>
                  {overall?.slaPercent != null ? `${overall.slaPercent}%` : '—'}
                </div>
                <div style={{ fontSize: '0.7rem', color: '#16a34a', fontWeight: 600, textTransform: 'uppercase' }}>SLA %</div>
              </div>
            </div>

            {/* Top 5 Engineers Table */}
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                Top 5 Engineers
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.825rem', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>
                      <th style={{ padding: '0.4rem 0.6rem', fontWeight: 600 }}>Engineer</th>
                      <th style={{ padding: '0.4rem 0.6rem', fontWeight: 600, textAlign: 'center' }}>Total</th>
                      <th style={{ padding: '0.4rem 0.6rem', fontWeight: 600, textAlign: 'right' }}>SLA %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topEngineers.length === 0 ? (
                      <tr>
                        <td colSpan="3" style={{ padding: '0.75rem', textAlign: 'center', color: '#94a3b8' }}>
                          No engineer data available
                        </td>
                      </tr>
                    ) : (
                      topEngineers.map((eng, idx) => {
                        const met = eng.slaMet || 0;
                        const missed = eng.slaMissed || 0;
                        const denom = met + missed;
                        const rowSlaNum = denom === 0 ? 0 : (met / denom) * 100;
                        const rowSlaStr = denom === 0 ? '0.00' : rowSlaNum.toFixed(2);
                        const slaColor = rowSlaNum >= 90 ? '#16a34a' : rowSlaNum >= 70 ? '#d97706' : '#dc2626';

                        return (
                          <tr key={eng.name || idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '0.4rem 0.6rem', color: '#0f172a', fontWeight: 500 }}>{eng.name}</td>
                            <td style={{ padding: '0.4rem 0.6rem', textAlign: 'center', fontWeight: 600, color: '#334155' }}>{eng.total}</td>
                            <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right', fontWeight: 700, color: slaColor }}>{rowSlaStr}%</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <button
            onClick={onOpenTickets}
            style={{
              width: '100%',
              padding: '0.75rem 1rem',
              background: '#16a34a',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 600,
              fontSize: '0.9rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              transition: 'background-color 0.2s ease'
            }}
          >
            View Full Breakdown →
          </button>
        </div>
      </div>
    </div>
  );
}
