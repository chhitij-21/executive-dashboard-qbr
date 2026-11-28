// frontend/src/components/AuditLogsPanel.tsx
// Security Audit Trail & Compliance Logs UI (Item #21 — Strict TypeScript)

import React, { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, Download, RefreshCw, Search, AlertTriangle } from 'lucide-react';
import { API_BASE_URL, apiFetch } from '../config/api';
import { useAuth } from '../context/AuthContext';
import type { AuditLogEntry } from '../../../shared/types/qbr';

interface AuditQueryResponse {
  total?: number;
  logs?: AuditLogEntry[];
  error?: string;
}

export default function AuditLogsPanel(): React.ReactElement {
  const { isAdmin, activeClient } = useAuth() as {
    isAdmin: boolean;
    activeClient?: { id?: string; code?: string } | null;
  };

  const [scope, setScope] = useState<'TENANT' | 'ALL'>('TENANT');
  const [severity, setSeverity] = useState<string>('ALL');
  const [actionFilter, setActionFilter] = useState<string>('ALL');
  const [eventTypeQuery, setEventTypeQuery] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [exporting, setExporting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveScope: 'TENANT' | 'ALL' = isAdmin ? scope : 'TENANT';

  const buildQueryParams = useCallback((): string => {
    const params = new URLSearchParams();
    if (severity !== 'ALL') params.set('severity', severity);
    if (actionFilter !== 'ALL') params.set('action', actionFilter);
    if (eventTypeQuery.trim()) params.set('eventType', eventTypeQuery.trim());
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    params.set('limit', '100');
    return params.toString();
  }, [severity, actionFilter, eventTypeQuery, startDate, endDate]);

  const loadLogs = useCallback(async () => {
    const clientId = activeClient?.id || 'client-jfl';
    setLoading(true);
    setError(null);
    try {
      const qs = buildQueryParams();
      const basePath =
        effectiveScope === 'ALL' && isAdmin
          ? `${API_BASE_URL}/api/v1/audit`
          : `${API_BASE_URL}/api/v1/tenants/${encodeURIComponent(clientId)}/audit`;
      const res = await apiFetch(`${basePath}${qs ? `?${qs}` : ''}`);
      const json: AuditQueryResponse = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || `Failed to load audit logs (HTTP ${res.status})`);
      }
      const rows = Array.isArray(json.logs) ? json.logs : [];
      setLogs(rows);
      setTotal(Number(json.total ?? rows.length));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to fetch audit trail';
      setError(msg);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [activeClient?.id, effectiveScope, isAdmin, buildQueryParams]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const handleExportCsv = async (): Promise<void> => {
    const clientId = activeClient?.id || 'client-jfl';
    setExporting(true);
    setError(null);
    try {
      const qs = buildQueryParams();
      const basePath =
        effectiveScope === 'ALL' && isAdmin
          ? `${API_BASE_URL}/api/v1/audit/export`
          : `${API_BASE_URL}/api/v1/tenants/${encodeURIComponent(clientId)}/audit/export`;
      const res = await apiFetch(`${basePath}${qs ? `?${qs}` : ''}`);
      if (!res.ok) {
        const json: AuditQueryResponse = await res.json().catch(() => ({}));
        throw new Error(json.error || `Export failed (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit_${effectiveScope === 'ALL' ? 'all' : clientId}_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to export compliance CSV');
    } finally {
      setExporting(false);
    }
  };

  const getSeverityStyle = (sev?: string): { bg: string; color: string; border: string } => {
    const s = String(sev || 'INFO').toUpperCase();
    if (s === 'CRITICAL') return { bg: '#fee2e2', color: '#991b1b', border: '#fecaca' };
    if (s === 'WARN') return { bg: '#fef3c7', color: '#92400e', border: '#fde68a' };
    return { bg: '#e0f2fe', color: '#075985', border: '#bae6fd' };
  };

  return (
    <div style={{ maxWidth: '1380px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
          color: '#ffffff',
          borderRadius: '12px',
          padding: '1.5rem 1.75rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <div style={{ padding: '0.65rem', backgroundColor: 'rgba(59, 130, 246, 0.2)', borderRadius: '10px' }}>
            <ShieldCheck size={24} color="#60a5fa" />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 700, color: '#ffffff' }}>
              Security Audit Trail & Compliance Logs
            </h2>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.84rem', color: '#94a3b8' }}>
              Tamper-evident authentication, tenant isolation, report exports, and webhook ingestion ledger ({total} events).
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => void loadLogs()}
            disabled={loading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.5rem 0.9rem',
              borderRadius: '8px',
              border: '1px solid #334155',
              backgroundColor: '#1e293b',
              color: '#f8fafc',
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <RefreshCw size={14} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={() => void handleExportCsv()}
            disabled={exporting}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              padding: '0.5rem 1rem',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: '#10b981',
              color: '#ffffff',
              fontSize: '0.82rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            <Download size={14} />
            <span>{exporting ? 'Exporting CSV...' : 'Export Compliance CSV'}</span>
          </button>
        </div>
      </div>

      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '10px',
          border: '1px solid #e2e8f0',
          padding: '1rem 1.25rem',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.85rem',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
          {isAdmin && (
            <div style={{ display: 'inline-flex', backgroundColor: '#f1f5f9', padding: '3px', borderRadius: '8px' }}>
              {[
                { id: 'TENANT' as const, label: `${activeClient?.code || 'Tenant'} Scoped` },
                { id: 'ALL' as const, label: 'All Tenants (Admin)' },
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setScope(s.id)}
                  style={{
                    border: 'none',
                    padding: '0.35rem 0.75rem',
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    backgroundColor: scope === s.id ? '#2563eb' : 'transparent',
                    color: scope === s.id ? '#ffffff' : '#475569',
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}

          <select
            aria-label="Severity Filter"
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            style={{ padding: '0.42rem 0.7rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.82rem' }}
          >
            <option value="ALL">All Severities</option>
            <option value="INFO">INFO</option>
            <option value="WARN">WARN</option>
            <option value="CRITICAL">CRITICAL</option>
          </select>

          <select
            aria-label="Action Filter"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            style={{ padding: '0.42rem 0.7rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.82rem' }}
          >
            <option value="ALL">All Actions</option>
            <option value="LOGIN">LOGIN</option>
            <option value="LOGOUT">LOGOUT</option>
            <option value="CREATE">CREATE</option>
            <option value="UPDATE">UPDATE</option>
            <option value="DELETE">DELETE</option>
            <option value="INGEST">INGEST</option>
            <option value="DOWNLOAD">DOWNLOAD</option>
            <option value="READ">READ</option>
          </select>

          <input
            type="date"
            aria-label="Audit Start Date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{ padding: '0.38rem 0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.8rem' }}
          />
          <input
            type="date"
            aria-label="Audit End Date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={{ padding: '0.38rem 0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.8rem' }}
          />
        </div>

        <div style={{ position: 'relative', minWidth: '220px' }}>
          <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
          <input
            type="text"
            placeholder="Filter eventType (e.g. AUTH_)..."
            value={eventTypeQuery}
            onChange={(e) => setEventTypeQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '0.42rem 0.75rem 0.42rem 2rem',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              fontSize: '0.82rem',
            }}
          />
        </div>
      </div>

      {error && (
        <div style={{ padding: '0.85rem 1rem', borderRadius: '8px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      )}

      <div style={{ backgroundColor: '#ffffff', borderRadius: '10px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', textAlign: 'left' }}>
            <thead>
              <tr style={{ backgroundColor: '#0f172a', color: '#ffffff' }}>
                <th style={{ padding: '0.7rem 0.85rem' }}>Timestamp</th>
                <th style={{ padding: '0.7rem 0.85rem' }}>Event Type</th>
                <th style={{ padding: '0.7rem 0.85rem' }}>Severity</th>
                <th style={{ padding: '0.7rem 0.85rem' }}>Tenant</th>
                <th style={{ padding: '0.7rem 0.85rem' }}>Actor / Role</th>
                <th style={{ padding: '0.7rem 0.85rem' }}>Action</th>
                <th style={{ padding: '0.7rem 0.85rem' }}>Status</th>
                <th style={{ padding: '0.7rem 0.85rem' }}>Resource / Details</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                    Loading security audit trail...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                    No audit log entries match the selected filters.
                  </td>
                </tr>
              ) : (
                logs.map((row, idx) => {
                  const sevStyle = getSeverityStyle(row.severity);
                  const detailsStr =
                    typeof row.details === 'string'
                      ? row.details
                      : JSON.stringify(row.details || {});
                  return (
                    <tr
                      key={row.id || idx}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        backgroundColor: idx % 2 === 0 ? '#ffffff' : '#f8fafc',
                      }}
                    >
                      <td style={{ padding: '0.6rem 0.85rem', whiteSpace: 'nowrap', color: '#475569' }}>
                        {row.timestamp ? new Date(row.timestamp).toLocaleString() : '—'}
                      </td>
                      <td style={{ padding: '0.6rem 0.85rem', fontWeight: 700, color: '#0f172a', fontFamily: 'monospace' }}>
                        {row.event_type}
                      </td>
                      <td style={{ padding: '0.6rem 0.85rem' }}>
                        <span
                          style={{
                            padding: '0.15rem 0.5rem',
                            borderRadius: '999px',
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            backgroundColor: sevStyle.bg,
                            color: sevStyle.color,
                            border: `1px solid ${sevStyle.border}`,
                          }}
                        >
                          {row.severity}
                        </span>
                      </td>
                      <td style={{ padding: '0.6rem 0.85rem', color: '#334155', fontWeight: 600 }}>
                        {row.tenant_id || 'global'}
                      </td>
                      <td style={{ padding: '0.6rem 0.85rem', color: '#334155' }}>
                        <div>{row.username || 'system'}</div>
                        <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{row.role || '—'} • {row.ip_address}</div>
                      </td>
                      <td style={{ padding: '0.6rem 0.85rem', fontWeight: 600, color: '#1e293b' }}>
                        {row.action}
                      </td>
                      <td style={{ padding: '0.6rem 0.85rem' }}>
                        <span
                          style={{
                            padding: '0.15rem 0.45rem',
                            borderRadius: '6px',
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            backgroundColor: row.status === 'SUCCESS' ? '#dcfce7' : '#fee2e2',
                            color: row.status === 'SUCCESS' ? '#166534' : '#991b1b',
                          }}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td
                        style={{
                          padding: '0.6rem 0.85rem',
                          color: '#475569',
                          maxWidth: '280px',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          fontFamily: 'monospace',
                          fontSize: '0.75rem',
                        }}
                        title={detailsStr}
                      >
                        {row.resource_type ? `[${row.resource_type}] ` : ''}{detailsStr}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
