import React, { useState, useMemo } from 'react';
import AISectionSummary from './AISectionSummary';
import { ChartsSection } from './ChartsSection';

/**
 * TicketsDetailPage — Proactive Ticket Analytics & Operational SLA Portal
 * Consumes canonical SSOT qbrData object passed via `data` prop.
 */
export default function TicketsDetailPage({ data, initialSubTab }) {
  const [activeTab, setActiveTab] = useState(initialSubTab || 'engineer'); // 'engineer' | 'site' | 'reasons' | 'raw'
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  React.useEffect(() => {
    if (initialSubTab) setActiveTab(initialSubTab);
  }, [initialSubTab]);

  if (!data || !data.proactiveTicketAnalytics) {
    return (
      <div style={{ padding: '3rem 1.5rem', textAlign: 'center', maxWidth: '800px', margin: '2rem auto' }}>
        <div className="card" style={{ padding: '2.5rem', background: '#ffffff', borderRadius: '12px', boxShadow: '0 4px 16px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎫</div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.5rem' }}>
            Proactive Ticket Analytics
          </h2>
          <p style={{ color: '#64748b', fontSize: '0.95rem' }}>
            No proactive ticket data available in the loaded report.
          </p>
        </div>
      </div>
    );
  }

  const pro = data.proactiveTicketAnalytics || {};
  const overall = pro.overall || {};
  const byEngineer = pro.byEngineer || [];
  const bySite = pro.bySite || [];
  const holdReasons = pro.holdReasons || [];
  const rawIncidents = data.incidents || [];
  const periodLabel = data.report_period?.display_label || data.reportingPeriod || 'Selected Period';
  const customerName = data.customerName || 'Jubilant Foodworks Ltd (JFL)';

  // Filtered raw incidents for Tab 4
  const filteredIncidents = useMemo(() => {
    return rawIncidents.filter((inc) => {
      const owner = (inc.TicketOwner || inc['Ticket Owner'] || '').toLowerCase();
      const site = (inc.SiteID || inc.Location || '').toLowerCase();
      const refVal = (inc.display_reference?.value || inc.TicketID || inc.IncidentID || '').toLowerCase();
      const reason = (inc.HoldReason || inc['Hold Reason'] || '').toLowerCase();
      const status = (inc.RawStatus || inc.Status || '').toLowerCase();
      const term = searchTerm.toLowerCase().trim();

      const matchesSearch = !term || owner.includes(term) || site.includes(term) || refVal.includes(term) || reason.includes(term) || status.includes(term);
      const matchesStatus = statusFilter === 'ALL' ||
        (statusFilter === 'open' && (status.includes('open') || status.includes('in progress'))) ||
        (statusFilter === 'onHold' && status.includes('hold')) ||
        (statusFilter === 'closed' && status.includes('closed'));

      return matchesSearch && matchesStatus;
    });
  }, [rawIncidents, searchTerm, statusFilter]);

  return (
    <div className="tickets-detail-page" style={{ padding: '1.5rem 0', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
        color: '#ffffff',
        padding: '1.5rem 2rem',
        borderRadius: '12px',
        marginBottom: '1.5rem',
        boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
      }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.05em', color: '#94a3b8', textTransform: 'uppercase' }}>
          {customerName}
        </span>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0.2rem 0', color: '#f8fafc' }}>
          Proactive Tickets & Engineer SLA Performance
        </h1>
        <span style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>
          Reporting Period: <strong>{periodLabel}</strong>
        </span>
      </div>

      {/* KPI Cards Header Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Total Tickets</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#1d4ed8', margin: '0.2rem 0' }}>{overall.total || 0}</div>
          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>All Monitored Incidents</div>
        </div>

        <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Open Tickets</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#b45309', margin: '0.2rem 0' }}>{overall.open || 0}</div>
          <div style={{ fontSize: '0.75rem', color: '#b45309' }}>Active / In Progress</div>
        </div>

        <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>On Hold</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#475569', margin: '0.2rem 0' }}>{overall.onHold || 0}</div>
          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Awaiting External/Client</div>
        </div>

        <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Assignment</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#6d28d9', margin: '0.2rem 0' }}>{overall.assignment || 0}</div>
          <div style={{ fontSize: '0.75rem', color: '#6d28d9' }}>Pending Dispatch</div>
        </div>

        <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Closed</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#15803d', margin: '0.2rem 0' }}>{overall.closed || 0}</div>
          <div style={{ fontSize: '0.75rem', color: '#15803d' }}>Resolved & Closed</div>
        </div>

        <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Resolution SLA %</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#2563eb', margin: '0.2rem 0' }}>{overall.slaPercent || '0.00'}%</div>
          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Met: {overall.slaMet || 0} | Breached: {overall.slaBreached || 0}</div>
        </div>
      </div>

      {/* Interactive Analytics & Trends (Charts Section) */}
      <ChartsSection qbrData={data} showHeader={false} />

      {/* Sub Navigation Tabs */}
      <div style={{ display: 'flex', borderBottom: '2px solid #e2e8f0', marginBottom: '1.5rem', gap: '0.5rem' }}>
        <button
          onClick={() => setActiveTab('engineer')}
          style={{
            padding: '0.75rem 1.25rem',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'engineer' ? '3px solid #2563eb' : '3px solid transparent',
            color: activeTab === 'engineer' ? '#2563eb' : '#64748b',
            fontWeight: activeTab === 'engineer' ? 700 : 500,
            cursor: 'pointer',
            fontSize: '0.9rem'
          }}
        >
          👨‍💻 Engineer Breakdown ({byEngineer.length})
        </button>

        <button
          onClick={() => setActiveTab('site')}
          style={{
            padding: '0.75rem 1.25rem',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'site' ? '3px solid #2563eb' : '3px solid transparent',
            color: activeTab === 'site' ? '#2563eb' : '#64748b',
            fontWeight: activeTab === 'site' ? 700 : 500,
            cursor: 'pointer',
            fontSize: '0.9rem'
          }}
        >
          📍 Site Breakdown ({bySite.length})
        </button>

        <button
          onClick={() => setActiveTab('reasons')}
          style={{
            padding: '0.75rem 1.25rem',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'reasons' ? '3px solid #2563eb' : '3px solid transparent',
            color: activeTab === 'reasons' ? '#2563eb' : '#64748b',
            fontWeight: activeTab === 'reasons' ? 700 : 500,
            cursor: 'pointer',
            fontSize: '0.9rem'
          }}
        >
          ⏸️ Hold Reasons ({holdReasons.length})
        </button>

        <button
          onClick={() => setActiveTab('raw')}
          style={{
            padding: '0.75rem 1.25rem',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'raw' ? '3px solid #2563eb' : '3px solid transparent',
            color: activeTab === 'raw' ? '#2563eb' : '#64748b',
            fontWeight: activeTab === 'raw' ? 700 : 500,
            cursor: 'pointer',
            fontSize: '0.9rem'
          }}
        >
          📋 Raw Incidents ({rawIncidents.length})
        </button>
      </div>

      {/* Tab 1: Engineer Breakdown Table */}
      {activeTab === 'engineer' && (
        <div style={{ background: '#ffffff', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
          <AISectionSummary section="engineer" jobId={data?.jobId || 'latest'} title="Engineer Workload AI Summary" />
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b', marginBottom: '1rem' }}>
            Ticket Owner & Engineer Workload
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="mobile-card-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#475569' }}>
                  <th style={{ padding: '0.75rem 1rem' }}>Ticket Owner</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Total Tickets</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Open</th>
                  <th style={{ padding: '0.75rem 1rem' }}>On Hold</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Assignment</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Closed</th>
                  <th style={{ padding: '0.75rem 1rem' }}>SLA Met</th>
                  <th style={{ padding: '0.75rem 1rem' }}>SLA Breached</th>
                </tr>
              </thead>
              <tbody>
                {byEngineer.length === 0 ? (
                  <tr>
                    <td colSpan="8" style={{ padding: '1.5rem', textAlign: 'center', color: '#94a3b8' }}>
                      No engineer data available.
                    </td>
                  </tr>
                ) : (
                  byEngineer.map((eng, idx) => (
                    <tr key={eng.name || idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td data-label="Ticket Owner" style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#0f172a' }}>{eng.name}</td>
                      <td data-label="Total Tickets" style={{ padding: '0.75rem 1rem', fontWeight: 700 }}>{eng.total}</td>
                      <td data-label="Open" style={{ padding: '0.75rem 1rem', color: eng.open > 0 ? '#b45309' : '#64748b' }}>{eng.open}</td>
                      <td data-label="On Hold" style={{ padding: '0.75rem 1rem' }}>{eng.onHold}</td>
                      <td data-label="Assignment" style={{ padding: '0.75rem 1rem' }}>{eng.assignment}</td>
                      <td data-label="Closed" style={{ padding: '0.75rem 1rem', color: '#15803d' }}>{eng.closed}</td>
                      <td data-label="SLA Met" style={{ padding: '0.75rem 1rem', color: '#16a34a', fontWeight: 600 }}>{eng.slaMet}</td>
                      <td data-label="SLA Breached" style={{ padding: '0.75rem 1rem', color: eng.slaMissed > 0 ? '#dc2626' : '#64748b', fontWeight: 600 }}>{eng.slaMissed}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Site Breakdown Table */}
      {activeTab === 'site' && (
        <div style={{ background: '#ffffff', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
          <AISectionSummary section="site" jobId={data?.jobId || 'latest'} title="Site Performance AI Summary" />
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b', marginBottom: '1rem' }}>
            Site-Wise Proactive Ticket Distribution
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#475569' }}>
                  <th style={{ padding: '0.75rem 1rem' }}>Site ID</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Total Incidents</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Open</th>
                  <th style={{ padding: '0.75rem 1rem' }}>On Hold</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Assignment</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Closed</th>
                  <th style={{ padding: '0.75rem 1rem' }}>SLA Met</th>
                  <th style={{ padding: '0.75rem 1rem' }}>SLA Breached</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Incident SLA %</th>
                </tr>
              </thead>
              <tbody>
                {bySite.length === 0 ? (
                  <tr>
                    <td colSpan="9" style={{ padding: '1.5rem', textAlign: 'center', color: '#94a3b8' }}>
                      No site ticket data available.
                    </td>
                  </tr>
                ) : (
                  bySite.map((st, idx) => (
                    <tr key={st.siteId || idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#0f172a' }}>{st.siteId}</td>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 700 }}>{st.total}</td>
                      <td style={{ padding: '0.75rem 1rem', color: st.open > 0 ? '#b45309' : '#64748b' }}>{st.open}</td>
                      <td style={{ padding: '0.75rem 1rem' }}>{st.onHold}</td>
                      <td style={{ padding: '0.75rem 1rem' }}>{st.assignment}</td>
                      <td style={{ padding: '0.75rem 1rem', color: '#15803d' }}>{st.closed}</td>
                      <td style={{ padding: '0.75rem 1rem', color: '#16a34a', fontWeight: 600 }}>{st.slaMet}</td>
                      <td style={{ padding: '0.75rem 1rem', color: st.slaBreached > 0 ? '#dc2626' : '#64748b', fontWeight: 600 }}>{st.slaBreached}</td>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#2563eb' }}>{st.slaPercent}%</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Hold Reasons Breakdown */}
      {activeTab === 'reasons' && (
        <div style={{ background: '#ffffff', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
          <AISectionSummary section="holdReason" jobId={data?.jobId || 'latest'} title="Hold Reasons AI Summary" />
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b', marginBottom: '1rem' }}>
            Hold Reason Categorization & Frequency
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#475569' }}>
                  <th style={{ padding: '0.75rem 1rem' }}>Categorized Hold Reason</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Incident Count</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Engineers Assigned</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Site-wise</th>
                </tr>
              </thead>
              <tbody>
                {holdReasons.length === 0 ? (
                  <tr>
                    <td colSpan="4" style={{ padding: '1.5rem', textAlign: 'center', color: '#94a3b8' }}>
                      No hold reasons recorded in the active dataset.
                    </td>
                  </tr>
                ) : (
                  holdReasons.map((hr, idx) => (
                    <tr key={hr.reason || idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#0f172a' }}>{hr.reason}</td>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: '#2563eb' }}>{hr.count}</td>
                      <td style={{ padding: '0.75rem 1rem', color: '#475569' }}>{hr.engineers ? hr.engineers.join(', ') : 'None'}</td>
                      <td style={{ padding: '0.75rem 1rem', color: '#475569' }}>{hr.sites && hr.sites.length ? hr.sites.join(', ') : 'None'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 4: Raw Incidents Table */}
      {activeTab === 'raw' && (
        <div style={{ background: '#ffffff', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>
              All Incidents Table ({filteredIncidents.length})
            </h3>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <input
                type="text"
                placeholder="Search ticket, owner, site..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  padding: '0.45rem 0.75rem',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  width: '240px'
                }}
              />

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{
                  padding: '0.45rem 0.75rem',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  fontSize: '0.85rem'
                }}
              >
                <option value="ALL">All Statuses</option>
                <option value="open">Open</option>
                <option value="onHold">On Hold</option>
                <option value="closed">Closed</option>
              </select>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#475569' }}>
                  <th style={{ padding: '0.75rem 1rem' }}>Reference</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Site ID</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Ticket Owner</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Status</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Hold Reason</th>
                  <th style={{ padding: '0.75rem 1rem' }}>SLA Status</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Primary RCA</th>
                </tr>
              </thead>
              <tbody>
                {filteredIncidents.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ padding: '1.5rem', textAlign: 'center', color: '#94a3b8' }}>
                      No matching incidents found.
                    </td>
                  </tr>
                ) : (
                  filteredIncidents.map((inc, idx) => {
                    const refObj = inc.display_reference || { type: 'Ticket', value: inc.TicketID || inc.IncidentID || 'N/A' };
                    const sla = inc.sla_status || 'Open';
                    const statusText = inc.RawStatus || inc.Status || 'Unspecified';

                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#0f172a' }}>
                          {refObj.type}: {refObj.value}
                        </td>
                        <td style={{ padding: '0.75rem 1rem' }}>{inc.SiteID || inc.Location || 'Unknown'}</td>
                        <td style={{ padding: '0.75rem 1rem', color: '#334155' }}>{inc.TicketOwner || 'Unassigned'}</td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          <span style={{
                            padding: '0.15rem 0.5rem',
                            borderRadius: '6px',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            background: statusText.toLowerCase().includes('closed') ? '#dcfce7' : statusText.toLowerCase().includes('hold') ? '#f1f5f9' : '#fef3c7',
                            color: statusText.toLowerCase().includes('closed') ? '#166534' : statusText.toLowerCase().includes('hold') ? '#334155' : '#b45309'
                          }}>
                            {statusText}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 1rem', color: '#64748b' }}>{inc.HoldReason || '—'}</td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          <span style={{
                            padding: '0.15rem 0.5rem',
                            borderRadius: '6px',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            background: sla === 'SLA Met' ? '#dcfce7' : sla === 'SLA Breached' ? '#fee2e2' : '#eff6ff',
                            color: sla === 'SLA Met' ? '#166534' : sla === 'SLA Breached' ? '#991b1b' : '#1d4ed8'
                          }}>
                            {sla}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 1rem', color: '#475569' }}>{inc.RCA || 'Unclassified'}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
