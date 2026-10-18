// frontend/src/components/InventorySyncPage.jsx
// Phase G.3 — Enterprise Hardware Inventory Drift Detection & Synchronization

import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL, apiFetch, getAuthHeaders } from '../config/api';

export default function InventorySyncPage() {
  const [clientId, setClientId] = useState('jfl');
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [pendingSync, setPendingSync] = useState(null);
  const [syncs, setSyncs] = useState([]);
  const [currentInv, setCurrentInv] = useState(null);
  const [showAllDevices, setShowAllDevices] = useState(false);
  const [expandedSections, setExpandedSections] = useState({
    added: false,
    removed: false,
    replaced: false,
    unchanged: false,
  });
  const [showFullSection, setShowFullSection] = useState({
    added: false,
    removed: false,
    replaced: false,
    unchanged: false,
  });
  const [showFullCurrent, setShowFullCurrent] = useState(false);

  const fetchSyncs = useCallback(async (cid) => {
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/inventory/syncs?clientId=${encodeURIComponent(cid)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to fetch syncs (${res.status})`);
      }
      const data = await res.json();
      setSyncs(data.syncs || []);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const fetchCurrent = useCallback(async (cid, includeAll = false) => {
    try {
      const url = `${API_BASE_URL}/api/inventory/current?clientId=${encodeURIComponent(cid)}${includeAll ? '&include=all' : ''}`;
      const res = await apiFetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to fetch current inventory (${res.status})`);
      }
      const data = await res.json();
      setCurrentInv(data);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    fetchSyncs(clientId);
    fetchCurrent(clientId, false);
  }, [clientId, fetchSyncs, fetchCurrent]);

  const handleClientChange = (newCid) => {
    if (newCid === clientId) return;
    if (pendingSync !== null) {
      const confirmed = window.confirm(
        `Switching client will discard the pending upload for ${clientId.toUpperCase()}. Continue?`
      );
      if (!confirmed) return;
      setPendingSync(null);
      setError(null);
      setSuccess(null);
      setFile(null);
    } else {
      setError(null);
      setSuccess(null);
    }
    setShowAllDevices(false);
    setShowFullCurrent(false);
    setClientId(newCid);
  };

  const handleFileChange = (e) => {
    setFile(e.target.files?.[0] || null);
    setError(null);
  };

  const handleUpload = async () => {
    if (!file) {
      setError('Please select an Excel or CSV file to analyze.');
      return;
    }
    if (pendingSync !== null) {
      const confirmed = window.confirm(
        `You have an unapproved pending sync (#${pendingSync.syncId}, ${pendingSync.fileName}). Uploading a new file will leave it pending. Continue?`
      );
      if (!confirmed) return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const fd = new FormData();
      fd.append('clientId', clientId);
      fd.append('file', file);

      const res = await fetch(`${API_BASE_URL}/api/inventory/sync/upload`, {
        method: 'POST',
        headers: { ...getAuthHeaders() },
        body: fd,
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || `Upload failed with HTTP ${res.status}`);
      }

      setPendingSync({
        syncId: body.syncId,
        fileName: body.fileName,
        counts: body.counts,
        diff: body.diff,
        warnings: body.warnings || [],
      });
      setSuccess(`Diff generated successfully for sync #${body.syncId}`);
      await fetchSyncs(clientId);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!pendingSync) return;
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await apiFetch(`${API_BASE_URL}/api/inventory/sync/${pendingSync.syncId}/approve`, {
        method: 'POST',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || `Approve failed with HTTP ${res.status}`);
      }

      const applied = body.applied || {};
      const addedCount = applied.added ?? pendingSync.counts.added;
      const removedCount = applied.removed ?? pendingSync.counts.removed;
      const replacedCount = applied.replaced ?? pendingSync.counts.replaced;

      setSuccess(`Approved sync #${pendingSync.syncId}: added ${addedCount}, removed ${removedCount}, replaced ${replacedCount}`);
      setPendingSync(null);
      setFile(null);
      await fetchSyncs(clientId);
      await fetchCurrent(clientId, showAllDevices);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    if (!pendingSync) return;
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await apiFetch(`${API_BASE_URL}/api/inventory/sync/${pendingSync.syncId}/reject`, {
        method: 'POST',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || `Reject failed with HTTP ${res.status}`);
      }

      setSuccess(`Rejected sync #${pendingSync.syncId}`);
      setPendingSync(null);
      setFile(null);
      await fetchSyncs(clientId);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleSection = (section) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const toggleShowFullSection = (section) => {
    setShowFullSection((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const toggleShowDevices = async () => {
    const nextShow = !showAllDevices;
    setShowAllDevices(nextShow);
    setShowFullCurrent(false);
    await fetchCurrent(clientId, nextShow);
  };

  const renderDeviceTable = (devices = [], sectionKey) => {
    if (!devices || devices.length === 0) {
      return (
        <div style={{ padding: '0.75rem', color: '#64748b', fontStyle: 'italic', fontSize: '0.85rem' }}>
          No devices in this category.
        </div>
      );
    }

    const isFull = showFullSection[sectionKey];
    const displayList = isFull ? devices : devices.slice(0, 50);

    return (
      <div style={{ overflowX: 'auto', marginTop: '0.5rem' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', textAlign: 'left' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>Serial</th>
              <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>Hostname</th>
              <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>Model</th>
              <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>Site</th>
              <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>Type</th>
              <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {displayList.map((d, idx) => (
              <tr key={d.serial_no || idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '0.45rem 0.75rem', fontFamily: 'monospace', fontWeight: 600 }}>{d.serial_no}</td>
                <td style={{ padding: '0.45rem 0.75rem' }}>{d.hostname || '—'}</td>
                <td style={{ padding: '0.45rem 0.75rem' }}>{d.model || '—'}</td>
                <td style={{ padding: '0.45rem 0.75rem' }}>{d.site_id || '—'}</td>
                <td style={{ padding: '0.45rem 0.75rem' }}>{d.device_type || '—'}</td>
                <td style={{ padding: '0.45rem 0.75rem' }}>
                  <span style={{
                    padding: '0.15rem 0.5rem',
                    borderRadius: '4px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    background: d.status === 'active' ? '#dcfce7' : '#f1f5f9',
                    color: d.status === 'active' ? '#166534' : '#475569'
                  }}>
                    {d.status || 'unknown'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {devices.length > 50 && (
          <div style={{ padding: '0.5rem 0.75rem', textAlign: 'center', background: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
            <button
              className="btn btn-secondary"
              style={{ fontSize: '0.78rem', padding: '0.25rem 0.75rem' }}
              onClick={() => toggleShowFullSection(sectionKey)}
            >
              {isFull ? 'Show first 50 rows' : `Show all ${devices.length} rows`}
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderReplacedTable = (replacedList = []) => {
    if (!replacedList || replacedList.length === 0) {
      return (
        <div style={{ padding: '0.75rem', color: '#64748b', fontStyle: 'italic', fontSize: '0.85rem' }}>
          No modified devices.
        </div>
      );
    }

    const isFull = showFullSection.replaced;
    const displayList = isFull ? replacedList : replacedList.slice(0, 50);

    return (
      <div style={{ overflowX: 'auto', marginTop: '0.5rem' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', textAlign: 'left' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>Serial</th>
              <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>Changed Fields</th>
              <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>Modifications (Before → After)</th>
            </tr>
          </thead>
          <tbody>
            {displayList.map((item, idx) => {
              const before = item.before || {};
              const after = item.after || {};
              const fields = item.changed_fields || [];

              return (
                <tr key={item.serial_no || idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '0.45rem 0.75rem', fontFamily: 'monospace', fontWeight: 600, verticalAlign: 'top' }}>
                    {item.serial_no}
                  </td>
                  <td style={{ padding: '0.45rem 0.75rem', verticalAlign: 'top' }}>
                    <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                      {fields.map((f) => (
                        <span key={f} style={{
                          padding: '0.1rem 0.4rem',
                          background: '#fef3c7',
                          color: '#92400e',
                          borderRadius: '4px',
                          fontSize: '0.72rem',
                          fontWeight: 600
                        }}>
                          {f}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td style={{ padding: '0.45rem 0.75rem', verticalAlign: 'top' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      {fields.map((f) => (
                        <div key={f} style={{ fontSize: '0.78rem' }}>
                          <span style={{ fontWeight: 600, color: '#64748b' }}>{f}: </span>
                          <span style={{ color: '#dc2626', textDecoration: 'line-through' }}>{String(before[f] ?? '—')}</span>
                          {' → '}
                          <span style={{ color: '#16a34a', fontWeight: 600 }}>{String(after[f] ?? '—')}</span>
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {replacedList.length > 50 && (
          <div style={{ padding: '0.5rem 0.75rem', textAlign: 'center', background: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
            <button
              className="btn btn-secondary"
              style={{ fontSize: '0.78rem', padding: '0.25rem 0.75rem' }}
              onClick={() => toggleShowFullSection('replaced')}
            >
              {isFull ? 'Show first 50 rows' : `Show all ${replacedList.length} rows`}
            </button>
          </div>
        )}
      </div>
    );
  };

  const getStatusBadgeStyle = (status) => {
    switch (status) {
      case 'approved':
        return { background: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0' };
      case 'rejected':
        return { background: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca' };
      case 'pending':
        return { background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' };
      default:
        return { background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0' };
    }
  };

  return (
    <div style={{ maxWidth: 1200, margin: '1.5rem auto', padding: '0 1rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* ── Main Container Card ── */}
      <div className="card" style={{ padding: '1.5rem', borderRadius: '12px' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 700, margin: 0, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>🔄</span> Hardware Inventory Drift & Sync
            </h2>
            <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>
              Reconcile physical inventory spreadsheets against enterprise active topology with preview and atomic snapshotting.
            </p>
          </div>

          {/* 1. Client Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Client:
            </span>
            <button
              type="button"
              onClick={() => handleClientChange('jfl')}
              className={`btn ${clientId === 'jfl' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '0.35rem 0.9rem', fontSize: '0.85rem', fontWeight: 600 }}
            >
              🍔 JFL
            </button>
            <button
              type="button"
              onClick={() => handleClientChange('mmtc')}
              className={`btn ${clientId === 'mmtc' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '0.35rem 0.9rem', fontSize: '0.85rem', fontWeight: 600 }}
            >
              🏭 MMTC
            </button>
          </div>
        </div>

        {/* 2. Upload Section */}
        <div style={{
          background: '#f8fafc',
          border: '1px dashed #cbd5e1',
          borderRadius: '8px',
          padding: '1rem 1.25rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: 260 }}>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileChange}
              style={{ fontSize: '0.85rem' }}
            />
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!file || loading}
            onClick={handleUpload}
            style={{ minWidth: 130 }}
          >
            {loading ? 'Analyzing…' : 'Analyze Drift'}
          </button>
        </div>

        {/* 3. Feedback Banners */}
        {error && (
          <div style={{
            padding: '0.75rem 1rem',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '8px',
            color: '#991b1b',
            fontSize: '0.85rem',
            marginBottom: '1rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span>⚠️ {error}</span>
            <button
              onClick={() => setError(null)}
              style={{ background: 'transparent', border: 'none', color: '#991b1b', cursor: 'pointer', fontWeight: 700 }}
            >
              ✕
            </button>
          </div>
        )}

        {success && (
          <div style={{
            padding: '0.75rem 1rem',
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: '8px',
            color: '#166534',
            fontSize: '0.85rem',
            marginBottom: '1rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span>✅ {success}</span>
            <button
              onClick={() => setSuccess(null)}
              style={{ background: 'transparent', border: 'none', color: '#166534', cursor: 'pointer', fontWeight: 700 }}
            >
              ✕
            </button>
          </div>
        )}

        {/* 4. Pending Diff Preview */}
        {pendingSync && (
          <div style={{
            background: '#ffffff',
            border: '1px solid #3b82f6',
            borderRadius: '10px',
            padding: '1.25rem',
            marginBottom: '1.5rem',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: '#2563eb', letterSpacing: '0.05em' }}>
                  Pending Sync Preview #{pendingSync.syncId}
                </span>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0.15rem 0 0 0', color: '#1e293b' }}>
                  File: {pendingSync.fileName}
                </h3>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={loading}
                  onClick={handleApprove}
                  style={{ background: '#16a34a', borderColor: '#16a34a' }}
                >
                  Approve & Update DB
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={loading}
                  onClick={handleReject}
                >
                  Reject
                </button>
              </div>
            </div>

            {/* Warnings notification */}
            {pendingSync.warnings && pendingSync.warnings.length > 0 && (
              <div style={{
                padding: '0.6rem 0.9rem',
                background: '#fffbeb',
                border: '1px solid #fde68a',
                borderRadius: '6px',
                color: '#92400e',
                fontSize: '0.8rem',
                marginBottom: '1rem'
              }}>
                ℹ️ {pendingSync.warnings.length} warning(s) during parsing (e.g. invalid or empty serial numbers skipped).
              </div>
            )}

            {/* KPI Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '0.75rem', textAlign: 'center' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#166534', textTransform: 'uppercase' }}>Added</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#15803d' }}>{pendingSync.counts.added}</div>
              </div>
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '0.75rem', textAlign: 'center' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#991b1b', textTransform: 'uppercase' }}>Removed</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#b91c1c' }}>{pendingSync.counts.removed}</div>
              </div>
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '0.75rem', textAlign: 'center' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#92400e', textTransform: 'uppercase' }}>Replaced</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#b45309' }}>{pendingSync.counts.replaced}</div>
              </div>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem', textAlign: 'center' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Unchanged</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#334155' }}>{pendingSync.counts.unchanged}</div>
              </div>
            </div>

            {/* Expandable Sections */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {/* Added Section */}
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px', overflow: 'hidden' }}>
                <button
                  type="button"
                  onClick={() => toggleSection('added')}
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.9rem',
                    background: '#f8fafc',
                    border: 'none',
                    textAlign: 'left',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    cursor: 'pointer'
                  }}
                >
                  <span style={{ color: '#166534' }}>📥 Added Devices ({pendingSync.counts.added})</span>
                  <span>{expandedSections.added ? '▲' : '▼'}</span>
                </button>
                {expandedSections.added && renderDeviceTable(pendingSync.diff?.added, 'added')}
              </div>

              {/* Removed Section */}
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px', overflow: 'hidden' }}>
                <button
                  type="button"
                  onClick={() => toggleSection('removed')}
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.9rem',
                    background: '#f8fafc',
                    border: 'none',
                    textAlign: 'left',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    cursor: 'pointer'
                  }}
                >
                  <span style={{ color: '#991b1b' }}>📤 Removed Devices ({pendingSync.counts.removed})</span>
                  <span>{expandedSections.removed ? '▲' : '▼'}</span>
                </button>
                {expandedSections.removed && renderDeviceTable(pendingSync.diff?.removed, 'removed')}
              </div>

              {/* Replaced Section */}
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px', overflow: 'hidden' }}>
                <button
                  type="button"
                  onClick={() => toggleSection('replaced')}
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.9rem',
                    background: '#f8fafc',
                    border: 'none',
                    textAlign: 'left',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    cursor: 'pointer'
                  }}
                >
                  <span style={{ color: '#b45309' }}>🔄 Modified / Replaced Devices ({pendingSync.counts.replaced})</span>
                  <span>{expandedSections.replaced ? '▲' : '▼'}</span>
                </button>
                {expandedSections.replaced && renderReplacedTable(pendingSync.diff?.replaced)}
              </div>

              {/* Unchanged Section */}
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px', overflow: 'hidden' }}>
                <button
                  type="button"
                  onClick={() => toggleSection('unchanged')}
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.9rem',
                    background: '#f8fafc',
                    border: 'none',
                    textAlign: 'left',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    cursor: 'pointer'
                  }}
                >
                  <span style={{ color: '#475569' }}>⏹️ Unchanged Devices ({pendingSync.counts.unchanged})</span>
                  <span>{expandedSections.unchanged ? '▲' : '▼'}</span>
                </button>
                {expandedSections.unchanged && renderDeviceTable(pendingSync.diff?.unchanged, 'unchanged')}
              </div>
            </div>
          </div>
        )}

        {/* 5. Recent Syncs Table */}
        <div style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.75rem 0', color: '#1e293b' }}>
            Recent Sync History ({clientId.toUpperCase()})
          </h3>
          {syncs.length === 0 ? (
            <p style={{ color: '#64748b', fontSize: '0.88rem', fontStyle: 'italic', margin: 0 }}>
              No syncs yet. Upload a file to start.
            </p>
          ) : (
            <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '0.6rem 0.75rem', fontWeight: 600 }}>ID</th>
                    <th style={{ padding: '0.6rem 0.75rem', fontWeight: 600 }}>Status</th>
                    <th style={{ padding: '0.6rem 0.75rem', fontWeight: 600 }}>File</th>
                    <th style={{ padding: '0.6rem 0.75rem', fontWeight: 600 }}>Created At</th>
                    <th style={{ padding: '0.6rem 0.75rem', fontWeight: 600 }}>Approved At</th>
                  </tr>
                </thead>
                <tbody>
                  {syncs.slice(0, 10).map((s) => (
                    <tr key={s.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.55rem 0.75rem', fontWeight: 600 }}>#{s.id}</td>
                      <td style={{ padding: '0.55rem 0.75rem' }}>
                        <span style={{
                          padding: '0.2rem 0.55rem',
                          borderRadius: '4px',
                          fontSize: '0.74rem',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          ...getStatusBadgeStyle(s.status)
                        }}>
                          {s.status}
                        </span>
                      </td>
                      <td style={{ padding: '0.55rem 0.75rem' }}>{s.uploaded_file_name}</td>
                      <td style={{ padding: '0.55rem 0.75rem', color: '#64748b' }}>{s.created_at}</td>
                      <td style={{ padding: '0.55rem 0.75rem', color: '#64748b' }}>{s.approved_at || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 6. Current Inventory Summary */}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.05em' }}>
                Current Active Topology
              </span>
              <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#1e293b' }}>
                Current DB for {clientId.toUpperCase()}: <strong style={{ color: '#2563eb' }}>{currentInv?.count ?? 0}</strong> {showAllDevices ? 'total devices (all statuses)' : 'active devices'}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={toggleShowDevices}
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.85rem' }}
            >
              {showAllDevices ? 'Hide all devices' : 'Show all devices (includes stock/faulty)'}
            </button>
          </div>

          {showAllDevices && currentInv?.devices && (
            <div style={{ marginTop: '1rem', overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '6px', background: '#ffffff' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>Serial</th>
                    <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>Hostname</th>
                    <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>Model</th>
                    <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>Site</th>
                    <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(showFullCurrent ? currentInv.devices : currentInv.devices.slice(0, 50)).map((d, idx) => (
                    <tr key={d.serial_no || idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.45rem 0.75rem', fontFamily: 'monospace', fontWeight: 600 }}>{d.serial_no}</td>
                      <td style={{ padding: '0.45rem 0.75rem' }}>{d.hostname || '—'}</td>
                      <td style={{ padding: '0.45rem 0.75rem' }}>{d.model || '—'}</td>
                      <td style={{ padding: '0.45rem 0.75rem' }}>{d.site_id || '—'}</td>
                      <td style={{ padding: '0.45rem 0.75rem' }}>
                        <span style={{
                          padding: '0.15rem 0.5rem',
                          borderRadius: '4px',
                          fontSize: '0.74rem',
                          fontWeight: 600,
                          background: d.status === 'active' ? '#dcfce7' : '#f1f5f9',
                          color: d.status === 'active' ? '#166534' : '#475569'
                        }}>
                          {d.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {currentInv.devices.length > 50 && (
                <div style={{ padding: '0.5rem 0.75rem', textAlign: 'center', background: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: '0.78rem', padding: '0.25rem 0.75rem' }}
                    onClick={() => setShowFullCurrent(!showFullCurrent)}
                  >
                    {showFullCurrent ? 'Show first 50 rows' : `Show all ${currentInv.devices.length} rows`}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
