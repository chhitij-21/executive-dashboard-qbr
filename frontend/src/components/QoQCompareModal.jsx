import React from 'react';
import { X, TrendingUp, TrendingDown, Minus, AlertCircle, CheckCircle, BarChart3 } from 'lucide-react';

export default function QoQCompareModal({ isOpen, onClose, comparison, qoqData, currentPeriod, clientName }) {
  if (!isOpen) return null;

  const comp = comparison || qoqData;
  const isStandard = comp?.is_standard_quarter ?? false;
  const hasPrior = comp?.has_prior_quarter ?? false;
  const kpis = comp?.kpis;
  const siteComparisons = comp?.siteComparisons || {};
  const rcaShifts = comp?.rcaShifts || [];
  const sites = Object.values(siteComparisons);

  return (
    <div
      className="modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '1.5rem',
      }}
      onClick={onClose}
    >
      <div
        className="modal-container card"
        style={{
          width: '100%',
          maxWidth: '1050px',
          maxHeight: '90vh',
          overflowY: 'auto',
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          padding: '1.75rem',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.85rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <BarChart3 size={22} color="#2563eb" />
              <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700, color: '#1e293b' }}>
                Quarter-over-Quarter Performance Analysis
              </h2>
            </div>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>
              {clientName ? `${clientName} · ` : ''}
              {hasPrior
                ? `Comparing ${comparison?.currentPeriod || 'Current Quarter'} against ${comparison?.priorPeriod || 'Preceding Quarter'}`
                : 'Quarterly Comparative Analysis'}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#64748b',
              padding: '4px',
              borderRadius: '6px',
            }}
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Informational or Empty State for Non-Standard / No Prior */}
        {!isStandard && (
          <div style={{ padding: '1.25rem', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', marginBottom: '1.5rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <AlertCircle color="#dc2626" size={24} />
            <div>
              <h4 style={{ margin: 0, fontSize: '0.95rem', color: '#991b1b', fontWeight: 600 }}>Standard Quarterly Period Required</h4>
              <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: '#b91c1c' }}>
                {comparison?.qoq_disabled_reason || 'QoQ comparison is strictly available for standard quarterly periods (Q1, Q2, Q3, Q4). Custom or single-month date ranges cannot be compared.'}
              </p>
            </div>
          </div>
        )}

        {isStandard && !hasPrior && (
          <div style={{ padding: '1.25rem', backgroundColor: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '8px', marginBottom: '1.5rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <AlertCircle color="#0284c7" size={24} />
            <div>
              <h4 style={{ margin: 0, fontSize: '0.95rem', color: '#075985', fontWeight: 600 }}>Initial QBR Dataset</h4>
              <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: '#0369a1' }}>
                {comparison?.qoq_disabled_reason || 'No previous quarterly data is available on record for this customer. This report serves as your baseline performance quarter.'}
              </p>
            </div>
          </div>
        )}

        {/* When Comparison is Valid */}
        {isStandard && hasPrior && kpis && (
          <>
            {/* KPI Delta Cards Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.85rem', marginBottom: '1.5rem' }}>
              {[
                { title: 'Overall Uptime', kpi: kpis.overallUptime, unit: '%' },
                { title: 'JFL Switch Uptime', kpi: kpis.jflUptime, unit: '%' },
                { title: 'Proactive Uptime', kpi: kpis.proactiveUptime, unit: '%' },
                { title: 'Total Incidents', kpi: kpis.totalIncidents, unit: '' },
                { title: 'SLA Compliance', kpi: kpis.slaCompliance, unit: '%' },
                { title: 'Health Score', kpi: kpis.healthScore, unit: '' },
              ].map(({ title, kpi, unit }) => {
                if (!kpi) return null;
                const isImproved = kpi.direction === 'improved';
                const isDegraded = kpi.direction === 'degraded';
                const badgeColor = isImproved ? '#16a34a' : isDegraded ? '#dc2626' : '#64748b';
                const badgeBg = isImproved ? '#dcfce7' : isDegraded ? '#fee2e2' : '#f1f5f9';

                return (
                  <div key={title} style={{ padding: '1rem', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600, marginBottom: '0.35rem' }}>{title}</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                      <span style={{ fontSize: '1.35rem', fontWeight: 700, color: '#0f172a' }}>
                        {kpi.current}{unit}
                      </span>
                      <span
                        style={{
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: '4px',
                          backgroundColor: badgeBg,
                          color: badgeColor,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '2px',
                        }}
                      >
                        {isImproved ? <TrendingUp size={12} /> : isDegraded ? <TrendingDown size={12} /> : <Minus size={12} />}
                        {kpi.formattedDelta}{unit}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.35rem' }}>
                      Prior: {kpi.prior}{unit}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Site Performance Movement Table */}
            <div style={{ marginBottom: '1.75rem' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.65rem' }}>
                Site-by-Site Progression
              </h3>
              <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f1f5f9', color: '#475569', textAlign: 'left', borderBottom: '1px solid #cbd5e1' }}>
                      <th style={{ padding: '0.55rem 0.75rem' }}>Site</th>
                      <th style={{ padding: '0.55rem 0.75rem' }}>Prior Uptime</th>
                      <th style={{ padding: '0.55rem 0.75rem' }}>Current Uptime</th>
                      <th style={{ padding: '0.55rem 0.75rem' }}>Uptime Delta</th>
                      <th style={{ padding: '0.55rem 0.75rem' }}>Incident Delta</th>
                      <th style={{ padding: '0.55rem 0.75rem' }}>Status</th>
                      <th style={{ padding: '0.55rem 0.75rem' }}>Executive Observation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sites.map((s, idx) => {
                      const isDegraded = s.status === 'degraded';
                      const isImproved = s.status === 'improved';
                      const statusColor = isDegraded ? '#dc2626' : isImproved ? '#16a34a' : '#64748b';
                      const dSign = s.uptimeDelta > 0 ? '+' : '';

                      return (
                        <tr key={s.siteId || idx} style={{ borderBottom: '1px solid #f1f5f9', backgroundColor: idx % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                          <td style={{ padding: '0.55rem 0.75rem', fontWeight: 600, color: '#1e293b' }}>{s.siteId}</td>
                          <td style={{ padding: '0.55rem 0.75rem', color: '#64748b' }}>{s.isNewSite ? 'N/A' : `${s.priorUptime}%`}</td>
                          <td style={{ padding: '0.55rem 0.75rem', fontWeight: 600, color: '#0f172a' }}>{s.currentUptime}%</td>
                          <td style={{ padding: '0.55rem 0.75rem', fontWeight: 700, color: statusColor }}>
                            {s.isNewSite ? 'New Site' : `${dSign}${s.uptimeDelta}%`}
                          </td>
                          <td style={{ padding: '0.55rem 0.75rem', color: '#334155' }}>
                            {s.isNewSite ? 'N/A' : `${s.incidentDelta > 0 ? '+' : ''}${s.incidentDelta}`}
                          </td>
                          <td style={{ padding: '0.55rem 0.75rem' }}>
                            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: statusColor, textTransform: 'uppercase' }}>
                              {s.status}
                            </span>
                          </td>
                          <td style={{ padding: '0.55rem 0.75rem', fontSize: '0.78rem', color: '#475569' }}>
                            {s.narrative}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* RCA Category Shifts Analysis Table & Graceful Empty State */}
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.65rem' }}>
                Root Cause Analysis (RCA) Category Shifts
              </h3>
              {rcaShifts.length === 0 ? (
                <div style={{ padding: '1rem', backgroundColor: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '8px', textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>
                  No significant RCA shifts detected between {comparison.priorPeriod} and {comparison.currentPeriod}. Root cause distribution remained consistent.
                </div>
              ) : (
                <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f1f5f9', color: '#475569', textAlign: 'left', borderBottom: '1px solid #cbd5e1' }}>
                        <th style={{ padding: '0.55rem 0.75rem' }}>Failure Category</th>
                        <th style={{ padding: '0.55rem 0.75rem' }}>Prior Incidents</th>
                        <th style={{ padding: '0.55rem 0.75rem' }}>Current Incidents</th>
                        <th style={{ padding: '0.55rem 0.75rem' }}>Volume Shift</th>
                        <th style={{ padding: '0.55rem 0.75rem' }}>Percentage Change</th>
                        <th style={{ padding: '0.55rem 0.75rem' }}>Impact Assessment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rcaShifts.map((shift, idx) => {
                        const isImproved = shift.direction === 'improved';
                        const isDegraded = shift.direction === 'degraded';
                        const shiftColor = isImproved ? '#16a34a' : isDegraded ? '#dc2626' : '#64748b';
                        const shiftBg = isImproved ? '#dcfce7' : isDegraded ? '#fee2e2' : '#f1f5f9';

                        return (
                          <tr key={shift.normalizedCategory || idx} style={{ borderBottom: '1px solid #f1f5f9', backgroundColor: idx % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                            <td style={{ padding: '0.55rem 0.75rem', fontWeight: 600, color: '#1e293b' }}>{shift.category}</td>
                            <td style={{ padding: '0.55rem 0.75rem', color: '#64748b' }}>{shift.priorCount}</td>
                            <td style={{ padding: '0.55rem 0.75rem', fontWeight: 600, color: '#0f172a' }}>{shift.currentCount}</td>
                            <td style={{ padding: '0.55rem 0.75rem', fontWeight: 700, color: shiftColor }}>
                              {shift.delta > 0 ? `+${shift.delta}` : shift.delta}
                            </td>
                            <td style={{ padding: '0.55rem 0.75rem' }}>
                              <span
                                style={{
                                  fontSize: '0.74rem',
                                  fontWeight: 700,
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  backgroundColor: shiftBg,
                                  color: shiftColor,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '2px',
                                }}
                              >
                                {isImproved ? <TrendingDown size={11} /> : isDegraded ? <TrendingUp size={11} /> : <Minus size={11} />}
                                {shift.changeLabel}
                              </span>
                            </td>
                            <td style={{ padding: '0.55rem 0.75rem', fontSize: '0.78rem', color: '#475569' }}>
                              {shift.isNewOccurrence
                                ? 'New incident driver emerged this quarter'
                                : shift.delta < 0
                                ? 'Failure volume reduced vs prior quarter'
                                : shift.delta > 0
                                ? 'Failure escalation — requires operational review'
                                : 'Consistent volume'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* Footer */}
        <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
          <button
            onClick={onClose}
            className="btn-primary"
            style={{ padding: '0.45rem 1.25rem', fontSize: '0.85rem' }}
          >
            Close Overview
          </button>
        </div>
      </div>
    </div>
  );
}
