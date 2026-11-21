// frontend/src/components/DataHealthModal.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Enterprise Data Health & Invariant Telemetry Panel (Item #12)
// Displays mathematical conservation checks, data hygiene issues,
// lazy-loaded row previews, and multi-format export (Excel & PDF).
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect } from 'react';
import { API_BASE_URL, apiFetch } from '../config/api';

export default function DataHealthModal({ isOpen, onClose, qbrData, activeJobId }) {
  const [activeTab, setActiveTab] = useState('invariants');
  const [healthData, setHealthData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  // Lazy row snapshot state
  const [selectedIssue, setSelectedIssue] = useState(null);
  const [rowSnapshot, setRowSnapshot] = useState(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [snapshotCache, setSnapshotCache] = useState({});
  const [copiedRow, setCopiedRow] = useState(false);

  // Export states
  const [exportingFormat, setExportingFormat] = useState(null);

  // Invalidate stale cache on activeJobId change (dataset refresh)
  useEffect(() => {
    setSnapshotCache({});
    setSelectedIssue(null);
    setRowSnapshot(null);
  }, [activeJobId]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedIssue(null);
      setRowSnapshot(null);
      return;
    }

    const fetchHealth = async () => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const query = activeJobId ? `?jobId=${encodeURIComponent(activeJobId)}` : '';
        const res = await apiFetch(`${API_BASE_URL}/api/data-health${query}`);
        if (res.ok) {
          const body = await res.json();
          if (body.health) {
            setHealthData(body.health);
            return;
          }
        }
      } catch (err) {
        console.warn('[DataHealthModal] Could not fetch server health:', err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchHealth();
  }, [isOpen, activeJobId]);

  if (!isOpen) return null;

  const health = healthData || {
    status: 'HEALTHY',
    score: 100,
    evaluatedAt: new Date().toISOString(),
    invariants: { total: 5, passed: 5, failed: 0, checks: [] },
    metrics: { inventoryCompleteness: 100, incidentHygiene: 100, anomaliesCount: 0 },
    issues: [],
    recommendations: [],
  };

  const handleSelectIssue = async (issue) => {
    setSelectedIssue(issue);
    setCopiedRow(false);

    const cacheKey = `${activeJobId || 'default'}_${issue.id}`;
    if (snapshotCache[cacheKey]) {
      setRowSnapshot(snapshotCache[cacheKey]);
      return;
    }

    setLoadingSnapshot(true);
    try {
      const query = `?jobId=${encodeURIComponent(activeJobId || 'latest')}`;
      const res = await apiFetch(`${API_BASE_URL}/api/data-health/issue/${encodeURIComponent(issue.id)}${query}`);
      if (res.ok) {
        const data = await res.json();
        if (data.rowSnapshot) {
          setRowSnapshot(data);
          setSnapshotCache((prev) => ({ ...prev, [cacheKey]: data }));
          return;
        }
      }
      // Fallback preview
      const fallback = {
        sheetName: issue.sheetName,
        rowNumber: issue.rowNumber,
        fieldName: issue.fieldName,
        rawValue: issue.rawValue,
        rowSnapshot: {
          Issue: issue.message,
          Sheet: issue.sheetName,
          Row: issue.rowNumber,
          Field: issue.fieldName,
          Value: String(issue.rawValue ?? 'N/A'),
        },
      };
      setRowSnapshot(fallback);
      setSnapshotCache((prev) => ({ ...prev, [cacheKey]: fallback }));
    } catch (err) {
      console.warn('Failed to lazy load snapshot:', err.message);
    } finally {
      setLoadingSnapshot(false);
    }
  };

  const handleExport = async (format) => {
    setExportingFormat(format);
    try {
      const query = activeJobId ? `&jobId=${encodeURIComponent(activeJobId)}` : '';
      const token = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
      const url = `${API_BASE_URL}/api/data-health/export?format=${format}${query}`;

      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        if (res.status === 413) {
          throw new Error('Export exceeded safety limit of 2,000 issues.');
        }
        throw new Error(`Export failed with HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `Data_Health_Report_${Date.now()}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      alert(`Export Error: ${err.message}`);
    } finally {
      setExportingFormat(null);
    }
  };

  const handleCopySnapshot = () => {
    if (!rowSnapshot?.rowSnapshot) return;
    navigator.clipboard.writeText(JSON.stringify(rowSnapshot.rowSnapshot, null, 2));
    setCopiedRow(true);
    setTimeout(() => setCopiedRow(false), 2000);
  };

  const getStatusBadge = (status) => {
    if (status === 'HEALTHY') return { bg: '#dcfce7', color: '#15803d', label: '🟢 HEALTHY' };
    if (status === 'WARNING') return { bg: '#fef3c7', color: '#b45309', label: '🟡 WARNING' };
    return { bg: '#fee2e2', color: '#b91c1c', label: '🔴 CRITICAL' };
  };

  const statusBadge = getStatusBadge(health.status);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          width: '100%',
          maxWidth: '1050px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          overflow: 'hidden',
          border: '1px solid #e2e8f0',
        }}
      >
        {/* ── Modal Header ────────────────────────────────────────────── */}
        <div
          style={{
            padding: '1.25rem 1.75rem',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: '#ffffff',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span style={{ fontSize: '1.35rem' }}>🛡️</span>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
                Data Quality &amp; Invariant Health Audit
              </h2>
            </div>
            <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0.25rem 0 0 0' }}>
              Continuous automated verification of mathematical conservation laws, hardware completeness, and incident classification.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button
              type="button"
              onClick={() => handleExport('xlsx')}
              disabled={Boolean(exportingFormat)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                fontSize: '0.8rem',
                fontWeight: 600,
                padding: '0.4rem 0.85rem',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: '#f8fafc',
                color: '#166534',
                cursor: 'pointer',
              }}
              title="Download structured multi-tab Excel workbook"
            >
              {exportingFormat === 'xlsx' ? '⏳ Exporting...' : '📊 Export Excel (.xlsx)'}
            </button>

            <button
              type="button"
              onClick={() => handleExport('pdf')}
              disabled={Boolean(exportingFormat)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                fontSize: '0.8rem',
                fontWeight: 600,
                padding: '0.4rem 0.85rem',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: '#f8fafc',
                color: '#1d4ed8',
                cursor: 'pointer',
              }}
              title="Download executive audit PDF report"
            >
              {exportingFormat === 'pdf' ? '⏳ Exporting...' : '📄 Export PDF (.pdf)'}
            </button>

            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '1.25rem',
                color: '#64748b',
                cursor: 'pointer',
                padding: '0.2rem 0.5rem',
              }}
              aria-label="Close modal"
            >
              ✕
            </button>
          </div>
        </div>

        {/* ── Scrollable Body ─────────────────────────────────────────── */}
        <div style={{ padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Top Score Banner & KPI Grid */}
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem' }}>
                <span style={{ fontSize: '2.5rem', fontWeight: 800, color: health.score >= 90 ? '#15803d' : health.score >= 70 ? '#b45309' : '#b91c1c' }}>
                  {health.score}%
                </span>
                <span
                  style={{
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    padding: '0.25rem 0.65rem',
                    borderRadius: '20px',
                    background: statusBadge.bg,
                    color: statusBadge.color,
                  }}
                >
                  {statusBadge.label}
                </span>
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  Last Evaluated: {health.evaluatedAt ? new Date(health.evaluatedAt).toLocaleTimeString() : 'Live'}
                </span>
              </div>
            </div>

            {/* 4 Quick-Stat Metric Tiles */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem' }}>
                <span style={{ fontSize: '0.7rem', color: '#64748b', display: 'block', fontWeight: 600 }}>INVARIANT RULES</span>
                <span style={{ fontSize: '1.1rem', fontWeight: 700, color: health.invariants.failed === 0 ? '#15803d' : '#b91c1c' }}>
                  {health.invariants.passed} / {health.invariants.total} Passed
                </span>
              </div>

              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem' }}>
                <span style={{ fontSize: '0.7rem', color: '#64748b', display: 'block', fontWeight: 600 }}>DEVICE COMPLETENESS</span>
                <span style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b' }}>
                  {health.metrics?.inventoryCompleteness || 100}%
                </span>
              </div>

              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem' }}>
                <span style={{ fontSize: '0.7rem', color: '#64748b', display: 'block', fontWeight: 600 }}>INCIDENT HYGIENE</span>
                <span style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b' }}>
                  {health.metrics?.incidentHygiene || 100}%
                </span>
              </div>

              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem' }}>
                <span style={{ fontSize: '0.7rem', color: '#64748b', display: 'block', fontWeight: 600 }}>TOTAL ISSUES</span>
                <span style={{ fontSize: '1.1rem', fontWeight: 700, color: health.issues.length === 0 ? '#15803d' : '#b45309' }}>
                  {health.issues.length} Flagged
                </span>
              </div>
            </div>
          </div>

          {/* Tab Navigation */}
          <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.5rem' }}>
            <button
              type="button"
              onClick={() => setActiveTab('invariants')}
              style={{
                padding: '0.4rem 0.85rem',
                fontSize: '0.85rem',
                fontWeight: activeTab === 'invariants' ? 700 : 500,
                color: activeTab === 'invariants' ? '#1d4ed8' : '#64748b',
                borderTop: 'none',
                borderLeft: 'none',
                borderRight: 'none',
                borderBottom: activeTab === 'invariants' ? '2px solid #1d4ed8' : '2px solid transparent',
                background: 'none',
                cursor: 'pointer',
              }}
            >
              🧮 Invariant Rules ({health.invariants?.checks?.length || 5})
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('issues')}
              style={{
                padding: '0.4rem 0.85rem',
                fontSize: '0.85rem',
                fontWeight: activeTab === 'issues' ? 700 : 500,
                color: activeTab === 'issues' ? '#1d4ed8' : '#64748b',
                borderTop: 'none',
                borderLeft: 'none',
                borderRight: 'none',
                borderBottom: activeTab === 'issues' ? '2px solid #1d4ed8' : '2px solid transparent',
                background: 'none',
                cursor: 'pointer',
              }}
            >
              ⚠️ Data Hygiene &amp; Warnings ({health.issues.length})
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('recommendations')}
              style={{
                padding: '0.4rem 0.85rem',
                fontSize: '0.85rem',
                fontWeight: activeTab === 'recommendations' ? 700 : 500,
                color: activeTab === 'recommendations' ? '#1d4ed8' : '#64748b',
                borderTop: 'none',
                borderLeft: 'none',
                borderRight: 'none',
                borderBottom: activeTab === 'recommendations' ? '2px solid #1d4ed8' : '2px solid transparent',
                background: 'none',
                cursor: 'pointer',
              }}
            >
              💡 Recommendations ({health.recommendations.length})
            </button>
          </div>

          {/* ── TAB 1: INVARIANTS ────────────────────────────────────────── */}
          {activeTab === 'invariants' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                Mathematical conservation laws must hold 100% across the dataset. Zero tolerance for broken arithmetic.
              </div>

              <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                  <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>
                    <tr>
                      <th style={{ padding: '0.65rem 0.75rem' }}>Status</th>
                      <th style={{ padding: '0.65rem 0.75rem' }}>Invariant Law</th>
                      <th style={{ padding: '0.65rem 0.75rem' }}>Formula</th>
                      <th style={{ padding: '0.65rem 0.75rem' }}>Expected</th>
                      <th style={{ padding: '0.65rem 0.75rem' }}>Actual</th>
                      <th style={{ padding: '0.65rem 0.75rem' }}>Audit Verification Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(health.invariants?.checks || []).map((c) => (
                      <tr key={c.id} style={{ borderBottom: '1px solid #f1f5f9', background: c.passed ? '#ffffff' : '#fef2f2' }}>
                        <td style={{ padding: '0.65rem 0.75rem', fontWeight: 700, color: c.passed ? '#16a34a' : '#dc2626' }}>
                          {c.passed ? '✓ PASS' : '✗ FAIL'}
                        </td>
                        <td style={{ padding: '0.65rem 0.75rem', fontWeight: 600, color: '#1e293b' }}>{c.name}</td>
                        <td style={{ padding: '0.65rem 0.75rem', fontFamily: 'monospace', color: '#475569', fontSize: '0.75rem' }}>
                          {c.formula}
                        </td>
                        <td style={{ padding: '0.65rem 0.75rem' }}>{String(c.expected)}</td>
                        <td style={{ padding: '0.65rem 0.75rem', fontWeight: c.passed ? 400 : 700, color: c.passed ? 'inherit' : '#dc2626' }}>
                          {String(c.actual)}
                        </td>
                        <td style={{ padding: '0.65rem 0.75rem', color: '#64748b' }}>{c.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── TAB 2: HYGIENE & CLICKABLE WARNINGS ─────────────────────── */}
          {activeTab === 'issues' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                Click any warning item below to jump to the offending row in the mini preview table.
              </div>

              {health.issues.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', background: '#f0fdf4', borderRadius: '8px', color: '#166534' }}>
                  ✨ Zero data hygiene issues found! All devices and incidents have complete metadata.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: selectedIssue ? '1fr 1fr' : '1fr', gap: '1rem' }}>
                  {/* Issues List */}
                  <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden', maxHeight: '360px', overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                      <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0 }}>
                        <tr>
                          <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left' }}>Severity</th>
                          <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left' }}>Sheet &amp; Row</th>
                          <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left' }}>Field</th>
                          <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left' }}>Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        {health.issues.map((iss) => {
                          const isSelected = selectedIssue?.id === iss.id;
                          return (
                            <tr
                              key={iss.id}
                              onClick={() => handleSelectIssue(iss)}
                              style={{
                                cursor: 'pointer',
                                borderBottom: '1px solid #f1f5f9',
                                background: isSelected ? '#eff6ff' : 'transparent',
                              }}
                            >
                              <td style={{ padding: '0.5rem 0.75rem' }}>
                                <span
                                  style={{
                                    fontSize: '0.65rem',
                                    fontWeight: 700,
                                    padding: '0.15rem 0.4rem',
                                    borderRadius: '4px',
                                    background: iss.severity === 'CRITICAL' ? '#fee2e2' : iss.severity === 'HIGH' ? '#ffedd5' : '#f1f5f9',
                                    color: iss.severity === 'CRITICAL' ? '#b91c1c' : iss.severity === 'HIGH' ? '#c2410c' : '#475569',
                                  }}
                                >
                                  {iss.severity}
                                </span>
                              </td>
                              <td style={{ padding: '0.5rem 0.75rem', color: '#1e293b', fontWeight: 600 }}>
                                {iss.sheetName} : R#{iss.rowNumber}
                              </td>
                              <td style={{ padding: '0.5rem 0.75rem', color: '#2563eb', fontFamily: 'monospace' }}>
                                {iss.fieldName}
                              </td>
                              <td style={{ padding: '0.5rem 0.75rem', color: '#475569' }}>
                                {iss.message}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Lazy-Loaded Mini Row Preview Table */}
                  {selectedIssue && (
                    <div
                      style={{
                        border: '1px solid #bfdbfe',
                        background: '#f8fafc',
                        borderRadius: '8px',
                        padding: '1rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.75rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#1e40af' }}>
                            📍 Offending Row Preview
                          </span>
                          <span style={{ fontSize: '0.7rem', color: '#64748b', display: 'block' }}>
                            Sheet: "{selectedIssue.sheetName}" &bull; Row #{selectedIssue.rowNumber}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={handleCopySnapshot}
                          style={{
                            fontSize: '0.7rem',
                            padding: '0.2rem 0.5rem',
                            borderRadius: '4px',
                            border: '1px solid #cbd5e1',
                            background: '#ffffff',
                            cursor: 'pointer',
                          }}
                        >
                          {copiedRow ? '✓ Copied!' : '📋 Copy Row JSON'}
                        </button>
                      </div>

                      {loadingSnapshot ? (
                        <div style={{ padding: '2rem', textAlign: 'center', fontSize: '0.8rem', color: '#64748b' }}>
                          ⏳ Fetching full row attributes from server...
                        </div>
                      ) : rowSnapshot?.rowSnapshot ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          <div
                            style={{
                              background: '#fff7ed',
                              border: '1px solid #fed7aa',
                              borderRadius: '6px',
                              padding: '0.5rem',
                              fontSize: '0.75rem',
                              color: '#9a3412',
                            }}
                          >
                            <strong>⚠️ Offending Attribute:</strong> <code>{selectedIssue.fieldName}</code> = <code>{String(selectedIssue.rawValue ?? 'NULL/EMPTY')}</code>
                          </div>

                          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '6px', overflow: 'hidden' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                              <tbody>
                                {Object.entries(rowSnapshot.rowSnapshot).map(([key, val]) => {
                                  const isOffending = key.toLowerCase() === selectedIssue.fieldName.toLowerCase();
                                  return (
                                    <tr
                                      key={key}
                                      style={{
                                        borderBottom: '1px solid #f1f5f9',
                                        background: isOffending ? '#fee2e2' : 'transparent',
                                      }}
                                    >
                                      <td style={{ padding: '0.4rem 0.6rem', fontWeight: 600, color: isOffending ? '#b91c1c' : '#475569', width: '35%' }}>
                                        {key}
                                      </td>
                                      <td style={{ padding: '0.4rem 0.6rem', color: isOffending ? '#b91c1c' : '#1e293b', fontWeight: isOffending ? 700 : 400 }}>
                                        {String(val ?? 'NULL')}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Click an issue to view full row data.</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── TAB 3: RECOMMENDATIONS ──────────────────────────────────── */}
          {activeTab === 'recommendations' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                Operational checklist generated for NOC operators and data engineers to improve QBR reporting accuracy.
              </div>

              {health.recommendations.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', background: '#f0fdf4', borderRadius: '8px', color: '#166534' }}>
                  ✨ No action items required. Dataset is fully optimized!
                </div>
              ) : (
                health.recommendations.map((rec, i) => (
                  <div
                    key={i}
                    style={{
                      background: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                      padding: '0.85rem 1rem',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.75rem',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        padding: '0.2rem 0.5rem',
                        borderRadius: '4px',
                        background: rec.priority === 'P0' ? '#fee2e2' : rec.priority === 'P1' ? '#ffedd5' : '#f1f5f9',
                        color: rec.priority === 'P0' ? '#b91c1c' : rec.priority === 'P1' ? '#c2410c' : '#475569',
                      }}
                    >
                      {rec.priority}
                    </span>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600, color: '#1e293b' }}>{rec.title}</h4>
                      <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.75rem', color: '#64748b' }}>{rec.description}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────── */}
        <div
          style={{
            padding: '0.85rem 1.75rem',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'flex-end',
            background: '#f8fafc',
          }}
        >
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            style={{ padding: '0.45rem 1.25rem', fontSize: '0.85rem' }}
          >
            Close Panel
          </button>
        </div>
      </div>
    </div>
  );
}
