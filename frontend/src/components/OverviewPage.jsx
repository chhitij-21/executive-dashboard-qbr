// frontend/src/components/OverviewPage.jsx
import React from 'react';

/**
 * OverviewPage — High-level Executive Overview & Operations Dashboard
 * Consumes canonical SSOT qbrData object passed via `data` prop.
 */
export default function OverviewPage({ data, onOpenReports, onOpenTickets }) {
  if (!data || !data.executiveSummary) {
    return (
      <div style={{ padding: '3rem 1.5rem', textAlign: 'center', maxWidth: '800px', margin: '2rem auto' }}>
        <div className="card" style={{ padding: '2.5rem', background: '#ffffff', borderRadius: '12px', boxShadow: '0 4px 16px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🌐</div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.5rem' }}>
            Executive Overview Portal
          </h2>
          <p style={{ color: '#64748b', fontSize: '0.95rem', marginBottom: '1.5rem' }}>
            No report data currently loaded. Please upload a QBR Excel file or select a completed report from history to view executive insights.
          </p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
            {onOpenReports && (
              <button
                onClick={onOpenReports}
                style={{
                  padding: '0.6rem 1.2rem',
                  background: '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Go to Executive Dashboard
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const exec = data.executiveSummary || {};
  const periodLabel = data.report_period?.display_label || data.reportingPeriod || 'Selected Period';
  const customerName = data.customerName || 'Jubilant Foodworks Ltd (JFL)';
  const proTickets = data.proactiveTicketAnalytics || { overall: {}, byEngineer: [], bySite: [], holdReasons: [] };
  const overallTix = proTickets.overall || {};
  const siteList = data.siteSummary || [];

  return (
    <div className="overview-page" style={{ padding: '1.5rem 0', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Page Header */}
      <div className="overview-header" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
        color: '#ffffff',
        padding: '1.5rem 2rem',
        borderRadius: '12px',
        marginBottom: '1.5rem',
        boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
      }}>
        <div>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.05em', color: '#94a3b8', textTransform: 'uppercase' }}>
            {customerName}
          </span>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0.2rem 0', color: '#f8fafc' }}>
            Executive Operations Overview
          </h1>
          <span style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>
            Reporting Period: <strong>{periodLabel}</strong>
          </span>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          {onOpenReports && (
            <button
              onClick={onOpenReports}
              style={{
                padding: '0.55rem 1.1rem',
                background: 'rgba(255, 255, 255, 0.15)',
                color: '#ffffff',
                border: '1px solid rgba(255, 255, 255, 0.25)',
                borderRadius: '8px',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '0.85rem'
              }}
            >
              📈 Executive Dashboard
            </button>
          )}
          {onOpenTickets && (
            <button
              onClick={onOpenTickets}
              style={{
                padding: '0.55rem 1.1rem',
                background: '#3b82f6',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '0.85rem'
              }}
            >
              🎫 Proactive Tickets
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '10px', border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Total Sites</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0f172a', margin: '0.3rem 0' }}>{exec.totalSites || siteList.length || 0}</div>
          <div style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 500 }}>Active Monitored Locations</div>
        </div>

        <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '10px', border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Monitored Devices</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0f172a', margin: '0.3rem 0' }}>{exec.totalDevices || 0}</div>
          <div style={{ fontSize: '0.75rem', color: '#475569' }}>
            Switches: {exec.totalSwitches || 0} | APs: {exec.totalAPs || 0}
          </div>
        </div>

        <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '10px', border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Proactive Switch Uptime</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#2563eb', margin: '0.3rem 0' }}>
            {exec.proactiveSwitchUptime ? `${exec.proactiveSwitchUptime}%` : '100.00%'}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Target SLA: {exec.slaTarget || 99.30}%</div>
        </div>

        <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '10px', border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>JFL Switch Uptime</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#059669', margin: '0.3rem 0' }}>
            {exec.jflSwitchUptime ? `${exec.jflSwitchUptime}%` : '100.00%'}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#059669', fontWeight: 500 }}>Hold Time Adjusted</div>
        </div>

        <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '10px', border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Overall SLA %</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#7c3aed', margin: '0.3rem 0' }}>
            {exec.slaCompliance ? `${exec.slaCompliance}%` : '100.00%'}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Device SLA Target: 99.30%</div>
        </div>

        <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '10px', border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Health Score</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0d9488', margin: '0.3rem 0' }}>
            {exec.healthScore || 100}<span style={{ fontSize: '1rem', color: '#94a3b8' }}>/100</span>
          </div>
          <div style={{ fontSize: '0.75rem', color: '#0d9488', fontWeight: 500 }}>{exec.healthLabel || 'Optimal'}</div>
        </div>
      </div>

      {/* Two Column Layout: Executive RCA & Proactive Ticket Analytics Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '1.5rem', marginBottom: '1.5rem' }}>
        
        {/* RCA Summary Card */}
        <div style={{ background: '#ffffff', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            🔍 Primary RCA Drivers
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: '8px', borderLeft: '4px solid #3b82f6' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>PRIMARY RCA (SWITCHES)</div>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a', marginTop: '0.2rem' }}>
                {exec.primaryRcaSwitches || 'Stable Operations (No Incidents)'}
              </div>
            </div>

            <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: '8px', borderLeft: '4px solid #8b5cf6' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>PRIMARY RCA (ACCESS POINTS)</div>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a', marginTop: '0.2rem' }}>
                {exec.primaryRcaAPs || 'Stable Operations (No Incidents)'}
              </div>
            </div>
          </div>
        </div>

        {/* Proactive Tickets Sneak Peek Card */}
        <div style={{ background: '#ffffff', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              🎫 Proactive Ticket Summary
            </h3>
            {onOpenTickets && (
              <button
                onClick={onOpenTickets}
                style={{ background: 'none', border: 'none', color: '#2563eb', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem' }}
              >
                View Details →
              </button>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem', textAlign: 'center', marginBottom: '1rem' }}>
            <div style={{ padding: '0.75rem', background: '#eff6ff', borderRadius: '8px' }}>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1d4ed8' }}>{overallTix.total || 0}</div>
              <div style={{ fontSize: '0.7rem', color: '#1e40af', fontWeight: 600 }}>Total</div>
            </div>
            <div style={{ padding: '0.75rem', background: '#fef3c7', borderRadius: '8px' }}>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#b45309' }}>{overallTix.open || 0}</div>
              <div style={{ fontSize: '0.7rem', color: '#92400e', fontWeight: 600 }}>Open</div>
            </div>
            <div style={{ padding: '0.75rem', background: '#f1f5f9', borderRadius: '8px' }}>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#475569' }}>{overallTix.onHold || 0}</div>
              <div style={{ fontSize: '0.7rem', color: '#334155', fontWeight: 600 }}>On Hold</div>
            </div>
            <div style={{ padding: '0.75rem', background: '#dcfce7', borderRadius: '8px' }}>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#15803d' }}>{overallTix.closed || 0}</div>
              <div style={{ fontSize: '0.7rem', color: '#166534', fontWeight: 600 }}>Closed</div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 1rem', background: '#f8fafc', borderRadius: '8px', fontSize: '0.85rem' }}>
            <span>Incident Resolution SLA: <strong style={{ color: '#2563eb' }}>{overallTix.slaPercent || '0.00'}%</strong></span>
            <span>SLA Met: <strong style={{ color: '#16a34a' }}>{overallTix.slaMet || 0}</strong> | Breached: <strong style={{ color: '#dc2626' }}>{overallTix.slaBreached || 0}</strong></span>
          </div>
        </div>

      </div>

      {/* Site Performance Overview Table */}
      <div style={{ background: '#ffffff', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b', marginBottom: '1rem' }}>
          📍 Site Performance & Inventory Summary
        </h3>
        
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#475569' }}>
                <th style={{ padding: '0.75rem 1rem' }}>Site ID</th>
                <th style={{ padding: '0.75rem 1rem' }}>Devices</th>
                <th style={{ padding: '0.75rem 1rem' }}>Switches</th>
                <th style={{ padding: '0.75rem 1rem' }}>APs</th>
                <th style={{ padding: '0.75rem 1rem' }}>Incidents</th>
                <th style={{ padding: '0.75rem 1rem' }}>Proactive Uptime</th>
                <th style={{ padding: '0.75rem 1rem' }}>JFL Uptime</th>
                <th style={{ padding: '0.75rem 1rem' }}>Health Score</th>
              </tr>
            </thead>
            <tbody>
              {siteList.length === 0 ? (
                <tr>
                  <td colSpan="8" style={{ padding: '1.5rem', textAlign: 'center', color: '#94a3b8' }}>
                    No site data available.
                  </td>
                </tr>
              ) : (
                siteList.map((st, idx) => (
                  <tr key={st.siteId || idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#0f172a' }}>{st.siteId}</td>
                    <td style={{ padding: '0.75rem 1rem' }}>{st.totalDevices || st.devices?.length || 0}</td>
                    <td style={{ padding: '0.75rem 1rem' }}>{st.totalSwitches || 0}</td>
                    <td style={{ padding: '0.75rem 1rem' }}>{st.totalAPs || 0}</td>
                    <td style={{ padding: '0.75rem 1rem' }}>{st.incidentCount || st.incidents?.length || 0}</td>
                    <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: parseFloat(st.proactiveSwitchUptime || 100) < 99.3 ? '#dc2626' : '#2563eb' }}>
                      {st.proactiveSwitchUptime != null ? `${st.proactiveSwitchUptime}%` : '100.00%'}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#059669' }}>
                      {st.jflSwitchUptime != null ? `${st.jflSwitchUptime}%` : '100.00%'}
                    </td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <span style={{
                        padding: '0.2rem 0.6rem',
                        borderRadius: '12px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        background: (st.healthScore || 100) >= 90 ? '#dcfce7' : (st.healthScore || 100) >= 75 ? '#fef3c7' : '#fee2e2',
                        color: (st.healthScore || 100) >= 90 ? '#166534' : (st.healthScore || 100) >= 75 ? '#92400e' : '#991b1b'
                      }}>
                        {st.healthScore || 100} / 100
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
