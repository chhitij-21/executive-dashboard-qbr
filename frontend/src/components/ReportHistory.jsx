import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL, apiFetch } from '../config/api';

export default function ReportHistory({ onViewDashboard, onReportDeleted }) {
  const { user, clients, activeClient, activeLocation, isAdmin } = useAuth();
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deletingJobId, setDeletingJobId] = useState(null);
  const [clientFilter, setClientFilter] = useState(activeClient?.id || (clients[0]?.id || ''));
  const [locationFilter, setLocationFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const handleDownload = async (e, endpoint, jobId, itemClientId) => {
    e.preventDefault();
    const targetClientId = itemClientId || clientFilter || activeClient?.id;
    if (!targetClientId) {
      alert('Cannot download: customer identifier missing.');
      return;
    }
    const token = localStorage.getItem('portal_token') || localStorage.getItem('token');
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/download-ticket`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          clientId: targetClientId,
          jobId,
          exportType: endpoint
        })
      });
      if (res.ok) {
        const ticketData = await res.json();
        if (ticketData.downloadTicket) {
          window.location.href = `${API_BASE_URL}/api/${endpoint}/${jobId}?clientId=${encodeURIComponent(targetClientId)}&ticket=${encodeURIComponent(ticketData.downloadTicket)}`;
          return;
        }
      }
    } catch (err) {
      console.warn('[ReportHistory] Download ticket acquisition failed:', err);
    }
    const authQuery = token ? `&downloadToken=${encodeURIComponent(token)}` : '';
    window.location.href = `${API_BASE_URL}/api/${endpoint}/${jobId}?clientId=${encodeURIComponent(targetClientId)}${authQuery}`;
  };

  const fetchHistory = async () => {
    try {
      setLoading(true);
      const queryParams = new URLSearchParams();
      const targetClientId = (clientFilter && clientFilter !== 'all') ? clientFilter : (activeClient?.id || clients[0]?.id);
      if (!targetClientId) {
        setHistory([]);
        setLoading(false);
        return;
      }
      queryParams.append('clientId', targetClientId);
      if (locationFilter && locationFilter !== 'ALL' && locationFilter !== 'All Locations') {
        queryParams.append('location', locationFilter);
      }

      const res = await apiFetch(`${API_BASE_URL}/api/history?${queryParams.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setHistory(json.history || []);
      }
    } catch (err) {
      console.error('Error fetching history:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeClient?.id) {
      setClientFilter(activeClient.id);
    }
  }, [activeClient?.id]);

  useEffect(() => {
    fetchHistory();
  }, [clientFilter, locationFilter]);

  const handleDeleteReport = async (e, jobId) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!window.confirm('Are you sure you want to delete this report from history?')) {
      return;
    }
    try {
      setDeletingJobId(jobId);
      const encodedId = encodeURIComponent(jobId);
      const res = await apiFetch(`${API_BASE_URL}/api/history/${encodedId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });

      let json = {};
      try {
        json = await res.json();
      } catch (pErr) {
        console.warn('Response was not JSON:', pErr);
      }

      if (res.ok || res.status === 404) {
        setHistory((prev) => prev.filter((item) => String(item.jobId).trim().toLowerCase() !== String(jobId).trim().toLowerCase()));
        if (onReportDeleted) onReportDeleted(jobId);
      } else {
        alert(`Failed to delete report: ${json.error || `Server responded with status ${res.status}`}`);
      }
    } catch (err) {
      console.error('Error deleting report:', err);
      // Remove from UI state as fallback if server operation completed
      setHistory((prev) => prev.filter((item) => String(item.jobId).trim().toLowerCase() !== String(jobId).trim().toLowerCase()));
      if (onReportDeleted) onReportDeleted(jobId);
    } finally {
      setDeletingJobId(null);
    }
  };

  const handleClearAllHistory = async () => {
    if (!window.confirm('Are you sure you want to permanently delete ALL report history entries? This action cannot be undone.')) {
      return;
    }
    try {
      setLoading(true);
      const res = await apiFetch(`${API_BASE_URL}/api/history`, { method: 'DELETE' });
      if (res.ok) {
        setHistory([]);
        if (onReportDeleted) onReportDeleted('all');
      } else {
        alert('Failed to clear history. Please try again.');
      }
    } catch (err) {
      console.error('Error clearing history:', err);
      setHistory([]);
    } finally {
      setLoading(false);
    }
  };

  const filteredHistory = history.filter((item) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.jobId.toLowerCase().includes(q) ||
      item.clientName.toLowerCase().includes(q) ||
      item.location.toLowerCase().includes(q) ||
      item.uploadedBy.toLowerCase().includes(q)
    );
  });

  return (
    <div className="history-container">
      <div className="card">
        <div className="card-header border-bottom">
          <div>
            <h2 className="card-title">📜 Generated Reports History</h2>
            <p className="card-subtitle">
              Audit log of executive report generation metadata. No raw ticket or inventory data is retained per strict data policy.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button className="btn-secondary" onClick={fetchHistory}>
              🔄 Refresh Log
            </button>
            {history.length > 0 && (
              <button
                className="btn-secondary"
                onClick={handleClearAllHistory}
                style={{ background: '#fee2e2', color: '#dc2626', borderColor: '#fca5a5', fontWeight: 600 }}
              >
                🧹 Clear All History
              </button>
            )}
          </div>
        </div>

        {/* Filters Bar */}
        <div className="filters-bar">
          <div className="filter-group">
            <label>Client Filter:</label>
            <select
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
              className="select-field"
            >
              <option value="all">All Clients</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.logo} {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label>Location:</label>
            <input
              type="text"
              placeholder="Filter by site..."
              value={locationFilter === 'ALL' ? '' : locationFilter}
              onChange={(e) => setLocationFilter(e.target.value || 'ALL')}
              className="input-field"
            />
          </div>

          <div className="filter-group search-group">
            <label>Search:</label>
            <input
              type="text"
              placeholder="Search user, client, ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-field"
            />
          </div>
        </div>

        {/* History Table */}
        {loading ? (
          <div className="loading-state">Loading history metadata...</div>
        ) : filteredHistory.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📂</div>
            <h4>No report metadata found</h4>
            <p>Upload files from the "Upload & Generate" tab to generate executive dashboards.</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="data-table history-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Location</th>
                  <th>Period</th>
                  <th>Upload Date</th>
                  <th>Generated By</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredHistory.map((item) => (
                  <tr key={item.jobId}>
                    <td>
                      <div className="client-cell">
                        <span className="client-badge">{item.clientName}</span>
                      </div>
                    </td>
                    <td>📍 {item.location}</td>
                    <td>📅 {item.reportPeriod}</td>
                    <td>{new Date(item.uploadTimestamp).toLocaleString()}</td>
                    <td>👤 {item.uploadedBy}</td>
                    <td>
                      <span className={`status-badge ${item.status}`}>
                        {item.status === 'completed' && '✅ Completed'}
                        {item.status === 'processing' && '⏳ Processing'}
                        {item.status === 'failed' && '❌ Failed'}
                        {item.status === 'error' && '⚠️ Error'}
                      </span>
                    </td>
                    <td>
                      <div className="action-buttons" style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        {item.status === 'completed' && (
                          <>
                            <button
                              className="btn-action btn-view"
                              onClick={() => onViewDashboard(item.jobId)}
                              title="View Executive Dashboard"
                            >
                              📈 Dashboard
                            </button>
                            <a
                              href="#download-pdf"
                              onClick={(e) => handleDownload(e, 'pdf', item.jobId, item.clientId)}
                              className="btn-action btn-ppt"
                              title="Download Executive PDF Report"
                            >
                              📄 PDF
                            </a>
                            <a
                              href="#download-report"
                              onClick={(e) => handleDownload(e, 'report', item.jobId, item.clientId)}
                              className="btn-action btn-log"
                              title="Download Validation Report"
                            >
                              📝 Report
                            </a>
                            <a
                              href="#download-log"
                              onClick={(e) => handleDownload(e, 'processing-log', item.jobId, item.clientId)}
                              className="btn-action btn-log"
                              title="Download Processing Log"
                            >
                              📋 Log
                            </a>
                            <a
                              href="#download-quality"
                              onClick={(e) => handleDownload(e, 'data-quality', item.jobId, item.clientId)}
                              className="btn-action btn-log"
                              title="Download Data Quality Report"
                            >
                              🔍 Quality
                            </a>
                          </>
                        )}
                        <button
                          type="button"
                          className="btn-action btn-delete"
                          disabled={deletingJobId === item.jobId}
                          onClick={(e) => handleDeleteReport(e, item.jobId)}
                          title="Delete Report"
                          style={{
                            background: deletingJobId === item.jobId ? '#e5e7eb' : '#fee2e2',
                            color: deletingJobId === item.jobId ? '#9ca3af' : '#dc2626',
                            border: '1px solid #fca5a5',
                            borderRadius: '6px',
                            padding: '0.35rem 0.65rem',
                            fontSize: '0.82rem',
                            fontWeight: 600,
                            cursor: deletingJobId === item.jobId ? 'not-allowed' : 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.3rem',
                            transition: 'all 0.2s ease',
                          }}
                        >
                          {deletingJobId === item.jobId ? '⏳ Deleting...' : '🗑️ Delete'}
                        </button>
                        {item.error && (
                          <span className="error-tooltip" title={item.error}>
                            ⚠️ Error details
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
