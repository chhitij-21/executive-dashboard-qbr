/**
 * frontend/src/components/ReportsView.jsx
 * Minimal 8-block MMTC Operational & SLA Reports Dashboard (Phase 1)
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Upload, Calendar, RefreshCw, CheckCircle, AlertTriangle } from 'lucide-react';
import API_BASE_URL, { getAuthHeaders } from '../config/api';

/**
 * Computes deterministic fallback executive summary (no LLM, no fabrication).
 */
function getDeterministicFallback(rep, periodLabel) {
  if (!rep || !rep.summary || rep.summary.total === 0) {
    return 'No data to summarize for this range.';
  }
  const total = rep.summary.total;
  const met = rep.sla?.met ?? 0;
  const breached = rep.sla?.breached ?? 0;
  const topRca = rep.rca_breakdown?.[0];
  const topDriverStr = topRca
    ? `Top driver: ${topRca.rca} (${topRca.tickets} tickets).`
    : 'Stable operations observed.';

  return `MMTC received ${total} tickets in ${periodLabel}. SLA met for ${met} tickets with ${breached} breach(es). ${topDriverStr}`;
}

export default function ReportsView() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const thirtyDaysAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  }, []);

  const [periodType, setPeriodType] = useState('monthly');
  const [startDate, setStartDate] = useState(thirtyDaysAgo);
  const [endDate, setEndDate] = useState(today);
  const [appliedLabel, setAppliedLabel] = useState(`MMTC · Monthly · ${thirtyDaysAgo} to ${today}`);

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [execSummary, setExecSummary] = useState('');
  const [uploadStatus, setUploadStatus] = useState(null); // { type: 'loading'|'success'|'error', msg: '' }

  const fileInputRef = useRef(null);

  // Period toggle handler
  const handlePeriodChange = (type) => {
    setPeriodType(type);
    const end = today;
    let start = thirtyDaysAgo;

    const now = new Date();
    if (type === 'fortnightly') {
      const d = new Date(now);
      d.setDate(d.getDate() - 14);
      start = d.toISOString().slice(0, 10);
    } else if (type === 'monthly') {
      const d = new Date(now);
      d.setDate(d.getDate() - 30);
      start = d.toISOString().slice(0, 10);
    } else if (type === 'quarterly') {
      const d = new Date(now);
      d.setDate(d.getDate() - 90);
      start = d.toISOString().slice(0, 10);
    }

    setStartDate(start);
    setEndDate(end);
    fetchReport(start, end, type);
  };

  // Fetch report data
  const fetchReport = async (start = startDate, end = endDate, pType = periodType) => {
    setLoading(true);
    setError(null);

    const typeCapitalized = pType.charAt(0).toUpperCase() + pType.slice(1);
    const labelStr = `MMTC · ${typeCapitalized} · ${start} to ${end}`;
    setAppliedLabel(labelStr);

    try {
      const headers = {
        ...getAuthHeaders(),
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      };

      const res = await fetch(
        `${API_BASE_URL}/api/reports/mmtc?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&label=${encodeURIComponent(labelStr)}`,
        { headers }
      );

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setReport(data);

      // 1. Initial immediate fallback summary
      const fallback = getDeterministicFallback(data, labelStr);
      setExecSummary(fallback);

      // 2. Fetch AI Insights asynchronously without blocking view
      if (data && data.summary && data.summary.total > 0) {
        fetchAiInsights(data, labelStr);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Virtual CTO AI insights fetcher
  const fetchAiInsights = async (repData, labelStr) => {
    try {
      const payload = {
        section: 'reports',
        clientId: 'client-mmtcpamp',
        data: {
          summary: repData.summary,
          sla: repData.sla,
          channel: repData.channel,
          rca_breakdown: repData.rca_breakdown,
          isp_pct: repData.isp_pct,
          top_sites: repData.top_sites || repData.isp_location,
          label: labelStr,
        },
      };

      const res = await fetch(`${API_BASE_URL}/api/ai/insights`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const json = await res.json();
        const aiText = json.data?.executive_summary || json.executive_summary;
        if (aiText && typeof aiText === 'string' && aiText.trim()) {
          setExecSummary(aiText.trim());
        }
      }
    } catch (e) {
      // Keep deterministic fallback silently on failure
    }
  };

  // Initial load
  useEffect(() => {
    fetchReport(startDate, endDate, periodType);
  }, []);

  // Upload handler
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadStatus({ type: 'loading', msg: 'Uploading and validating spreadsheet...' });

    const formData = new FormData();
    formData.append('excel', file);

    try {
      const res = await fetch(`${API_BASE_URL}/api/reports/mmtc/tickets/upload`, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
        },
        body: formData,
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(json.error || `Upload failed (HTTP ${res.status})`);
      }

      setUploadStatus({
        type: 'success',
        msg: `Successfully uploaded and verified ${json.insertedCount || json.totalRows || 'all'} tickets.`,
      });

      // Clear input and auto-refetch current range
      if (fileInputRef.current) fileInputRef.current.value = '';
      fetchReport(startDate, endDate, periodType);
    } catch (err) {
      setUploadStatus({ type: 'error', msg: err.message });
    }
  };

  const byType = report?.sla?.by_type || { Incident: 0, CR: 0, RF: 0, Upgrade: 0 };
  const rcaList = report?.rca_breakdown || [];
  const topSitesList = report?.top_sites || report?.isp_location || [];

  return (
    <div className="report-view">
      {/* ── BLOCK 1: Header Bar ───────────────────────────────────────── */}
      <div className="report-card report-header-bar">
        <div className="report-period-toggle">
          <button
            type="button"
            className={periodType === 'fortnightly' ? 'active' : ''}
            onClick={() => handlePeriodChange('fortnightly')}
          >
            Fortnightly
          </button>
          <button
            type="button"
            className={periodType === 'monthly' ? 'active' : ''}
            onClick={() => handlePeriodChange('monthly')}
          >
            Monthly
          </button>
          <button
            type="button"
            className={periodType === 'quarterly' ? 'active' : ''}
            onClick={() => handlePeriodChange('quarterly')}
          >
            Quarterly
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Calendar size={16} style={{ color: 'var(--text-muted)' }} />
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{
              padding: '0.4rem 0.6rem',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
              fontSize: '0.875rem',
            }}
          />
          <span style={{ color: 'var(--text-muted)' }}>to</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={{
              padding: '0.4rem 0.6rem',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
              fontSize: '0.875rem',
            }}
          />
        </div>

        <button
          type="button"
          onClick={() => fetchReport(startDate, endDate, periodType)}
          disabled={loading}
          style={{
            padding: '0.45rem 1.25rem',
            borderRadius: '6px',
            border: 'none',
            background: 'var(--accent-blue, #2563eb)',
            color: '#ffffff',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '0.875rem',
          }}
        >
          {loading ? 'Applying...' : 'Apply'}
        </button>

        <div style={{ marginLeft: 'auto', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
          {appliedLabel}
        </div>
      </div>

      {error && (
        <div style={{ padding: '1rem', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
          {error}
        </div>
      )}

      {/* ── BLOCK 2: KPI Row (3 Cards) ─────────────────────────────────── */}
      <div className="report-grid-3">
        <div className="report-card">
          <div className="report-kpi">{report?.summary?.total ?? 0}</div>
          <div className="report-kpi-label">Total Tickets</div>
        </div>
        <div className="report-card">
          <div className="report-kpi">{report?.summary?.closed ?? 0}</div>
          <div className="report-kpi-label">Closed</div>
        </div>
        <div className="report-card">
          <div className="report-kpi">{report?.summary?.on_hold ?? 0}</div>
          <div className="report-kpi-label">On Hold</div>
        </div>
      </div>

      {/* ── BLOCK 3: SLA Row (3 Cards) + Sub-line ──────────────────────── */}
      <div className="report-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div className="report-grid-3">
          <div>
            <div className="report-kpi" style={{ color: 'var(--accent-green, #16a34a)' }}>
              {report?.sla?.met ?? 0}
            </div>
            <div className="report-kpi-label">SLA Met</div>
          </div>
          <div>
            <div className="report-kpi" style={{ color: report?.sla?.breached > 0 ? 'var(--accent-red, #dc2626)' : 'var(--text-primary)' }}>
              {report?.sla?.breached ?? 0}
            </div>
            <div className="report-kpi-label">SLA Breached</div>
          </div>
          <div>
            <div className="report-kpi">{report?.sla?.on_hold ?? 0}</div>
            <div className="report-kpi-label">On Hold</div>
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
          of which: {byType.Incident ?? 0} Incidents, {byType.CR ?? 0} CRs, {byType.RF ?? 0} RF, {byType.Upgrade ?? 0} Upgrades
        </div>
      </div>

      {/* ── BLOCK 4: Channel Breakdown (4 Cards) ───────────────────────── */}
      <div className="report-grid-4">
        <div className="report-card">
          <div className="report-kpi">{report?.channel?.meraki_alerts ?? 0}</div>
          <div className="report-kpi-label">Meraki Alerts</div>
        </div>
        <div className="report-card">
          <div className="report-kpi">{report?.channel?.meraki_emails ?? 0}</div>
          <div className="report-kpi-label">Meraki Emails</div>
        </div>
        <div className="report-card">
          <div className="report-kpi">{report?.channel?.security_alerts ?? 0}</div>
          <div className="report-kpi-label">Security Alerts</div>
        </div>
        <div className="report-card">
          <div className="report-kpi">{report?.channel?.security_emails ?? 0}</div>
          <div className="report-kpi-label">Security Emails</div>
        </div>
      </div>

      {/* ── BLOCK 5: RCA Breakdown Table ──────────────────────────────── */}
      <div className="report-card">
        <h4 style={{ margin: '0 0 1rem 0', color: 'var(--text-primary)', fontWeight: 600 }}>
          RCA Breakdown
        </h4>
        {rcaList.length > 0 ? (
          <table className="report-table">
            <thead>
              <tr>
                <th>RCA</th>
                <th style={{ width: '15%' }}>Tickets</th>
                <th style={{ width: '20%' }}>Downtime (min)</th>
                <th style={{ width: '15%' }}>Downtime (days)</th>
              </tr>
            </thead>
            <tbody>
              {rcaList.map((row, idx) => (
                <tr key={idx}>
                  <td style={{ fontWeight: 500 }}>{row.rca}</td>
                  <td>{row.tickets}</td>
                  <td>{row.downtime_min}</td>
                  <td>{row.downtime_days}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            No RCA data in this window
          </div>
        )}
      </div>

      {/* ── BLOCK 6: ISP Location-wise Table ───────────────────────────── */}
      <div className="report-card">
        <h4 style={{ margin: '0 0 1rem 0', color: 'var(--text-primary)', fontWeight: 600 }}>
          ISP Location-Wise Breakdown
        </h4>
        {topSitesList.length > 0 ? (
          <table className="report-table">
            <thead>
              <tr>
                <th>Site</th>
                <th style={{ width: '25%' }}>ISP Tickets</th>
              </tr>
            </thead>
            <tbody>
              {topSitesList.map((row, idx) => (
                <tr key={idx}>
                  <td style={{ fontWeight: 500 }}>{row.site}</td>
                  <td>{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            No ISP tickets in this window
          </div>
        )}
      </div>

      {/* ── BLOCK 7: Executive Summary ────────────────────────────────── */}
      <div className="report-card">
        <h4 style={{ margin: '0 0 0.75rem 0', color: 'var(--text-primary)', fontWeight: 600 }}>
          Executive Summary
        </h4>
        <p style={{ margin: 0, fontSize: '0.9375rem', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
          {execSummary || 'No data to summarize for this range.'}
        </p>
      </div>

      {/* ── BLOCK 8: Upload Bar ───────────────────────────────────────── */}
      <div className="report-card report-upload-bar">
        <input
          type="file"
          ref={fileInputRef}
          accept=".xlsx"
          onChange={handleFileUpload}
          style={{ display: 'none' }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.5rem 1.25rem',
            borderRadius: '6px',
            border: '1px solid var(--border)',
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '0.875rem',
          }}
        >
          <Upload size={16} />
          Upload Tickets Excel
        </button>

        {uploadStatus && (
          <div
            style={{
              fontSize: '0.875rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              color:
                uploadStatus.type === 'error'
                  ? '#ef4444'
                  : uploadStatus.type === 'success'
                  ? '#16a34a'
                  : 'var(--text-muted)',
            }}
          >
            {uploadStatus.type === 'loading' && <RefreshCw size={14} className="spin" />}
            {uploadStatus.type === 'success' && <CheckCircle size={14} />}
            {uploadStatus.type === 'error' && <AlertTriangle size={14} />}
            {uploadStatus.msg}
          </div>
        )}
      </div>
    </div>
  );
}
