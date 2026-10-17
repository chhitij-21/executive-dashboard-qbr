// frontend/src/components/VulnerabilitiesPage.jsx
// Automated Vulnerabilities Dashboard powered by official Cisco PSIRT openVuln API (v2).
// Flat, printable, dense table layout sorted by CVSS & Date with client-side pagination, severity pills, truncation & tracking.

import React, { useState, useEffect, useMemo } from 'react';
import { API_BASE_URL, apiFetch } from '../config/api';
import { useAuth } from '../context/AuthContext';

const STORAGE_KEY_TRACKER = 'cisco_psirt_tracker_status';
const STORAGE_KEY_CHECKLIST = 'cisco_psirt_checklist_state';

const DEFAULT_CHECKLIST = [
  { id: 'c1', label: 'Review all Critical & High (P1) Cisco Advisories with network engineering team', done: false },
  { id: 'c2', label: 'Verify affected Catalyst switch & Meraki firmware versions against active inventory', done: false },
  { id: 'c3', label: 'Confirm customer change management / maintenance window approval for patch rollouts', done: false },
  { id: 'c4', label: 'Stage and validate recommended fixed release in pre-production test lab', done: false },
  { id: 'c5', label: 'Deploy patch and perform post-upgrade interface & SLA uptime validation', done: false },
];

export default function VulnerabilitiesPage() {
  const { user, isAdmin } = useAuth();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [vulnData, setVulnData] = useState(null);

  // Filters
  const [datePreset, setDatePreset] = useState('ALL'); // 'WEEK', 'MONTH', 'ALL', 'CUSTOM'
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedSeverity, setSelectedSeverity] = useState('ALL'); // 'ALL', 'CRITICAL', 'HIGH', 'MEDIUM'
  const [showInformational, setShowInformational] = useState(false); // Default: UNCHECKED (hides NA / Informational)
  const [searchQuery, setSearchQuery] = useState('');

  // Pagination for flat table (default 15 rows per page)
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  // Local storage states for remediation tracker & validation checklist
  const [trackerStatus, setTrackerStatus] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_TRACKER);
      return saved ? JSON.parse(saved) : {};
    } catch (_) {
      return {};
    }
  });

  const [checklist, setChecklist] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_CHECKLIST);
      return saved ? JSON.parse(saved) : DEFAULT_CHECKLIST;
    } catch (_) {
      return DEFAULT_CHECKLIST;
    }
  });

  // Save tracker updates
  const updateTracker = (cveId, status) => {
    setTrackerStatus((prev) => {
      const next = { ...prev, [cveId]: status };
      try {
        localStorage.setItem(STORAGE_KEY_TRACKER, JSON.stringify(next));
      } catch (_) {}
      return next;
    });
  };

  // Toggle checklist item
  const toggleChecklistItem = (id) => {
    setChecklist((prev) => {
      const next = prev.map((item) => (item.id === id ? { ...item, done: !item.done } : item));
      try {
        localStorage.setItem(STORAGE_KEY_CHECKLIST, JSON.stringify(next));
      } catch (_) {}
      return next;
    });
  };

  // Reset checklist
  const resetChecklist = () => {
    setChecklist(DEFAULT_CHECKLIST);
    try {
      localStorage.setItem(STORAGE_KEY_CHECKLIST, JSON.stringify(DEFAULT_CHECKLIST));
    } catch (_) {}
  };

  // Fetch vulnerabilities from backend
  const loadVulnerabilities = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/vulnerabilities`);
      if (!res.ok) {
        throw new Error(`Failed to fetch vulnerabilities (HTTP ${res.status})`);
      }
      const data = await res.json();
      setVulnData(data);
    } catch (err) {
      console.error('[VulnerabilitiesPage] Load error:', err);
      setError(err.message || 'Unable to connect to vulnerabilities API');
    } finally {
      setLoading(false);
    }
  };

  // Admin on-demand sync from Cisco PSIRT API
  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/vulnerabilities/refresh?count=100`, {
        method: 'POST',
      });
      if (!res.ok) {
        throw new Error(`Sync failed (HTTP ${res.status})`);
      }
      await loadVulnerabilities();
    } catch (err) {
      alert(`Manual refresh error: ${err.message}`);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadVulnerabilities();
  }, []);

  // Compute date filter boundary
  const effectiveDateRange = useMemo(() => {
    const now = new Date();
    if (datePreset === 'WEEK') {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return { start: d.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
    }
    if (datePreset === 'MONTH') {
      const d = new Date(now);
      d.setDate(d.getDate() - 30);
      return { start: d.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
    }
    if (datePreset === 'CUSTOM') {
      return { start: startDate, end: endDate };
    }
    return { start: '', end: '' };
  }, [datePreset, startDate, endDate]);

  // Filtered & Sorted CVE rows
  const filteredCves = useMemo(() => {
    const all = vulnData?.cveList || [];
    return all
      .filter((item) => {
        // Task: Hide "NA" or "Informational" clutter (if toggle is unchecked)
        if (!showInformational) {
          const sev = (item.severity || '').toLowerCase();
          const cve = (item.cveId || '').toUpperCase();
          if (sev === 'informational' || cve === 'NA' || cve === 'N/A') {
            return false;
          }
        }

        // Date filter
        if (effectiveDateRange.start && item.advisoryDate < effectiveDateRange.start) return false;
        if (effectiveDateRange.end && item.advisoryDate > effectiveDateRange.end) return false;

        // Quick Severity filter
        if (selectedSeverity !== 'ALL') {
          if ((item.severity || '').toUpperCase() !== selectedSeverity) return false;
        }

        // Search query (CVE, Product, Impact)
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchCve = (item.cveId || '').toLowerCase().includes(q);
          const matchProd = (item.product || '').toLowerCase().includes(q);
          const matchImpact = (item.vulnerabilityImpact || '').toLowerCase().includes(q);
          if (!matchCve && !matchProd && !matchImpact) return false;
        }

        return true;
      })
      .sort((a, b) => {
        // Default sorting:
        // 1. CVSS Score (Descending) — highest first
        const cvssA = parseFloat(a.cvss) || 0;
        const cvssB = parseFloat(b.cvss) || 0;
        if (cvssB !== cvssA) {
          return cvssB - cvssA;
        }
        // 2. If CVSS tied, sort by Advisory Date (Descending)
        const dateA = a.advisoryDate || '';
        const dateB = b.advisoryDate || '';
        return dateB.localeCompare(dateA);
      });
  }, [vulnData, effectiveDateRange, selectedSeverity, showInformational, searchQuery]);

  // Reset pagination when any filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [datePreset, startDate, endDate, selectedSeverity, showInformational, searchQuery, pageSize]);

  // Overall KPI metrics (compact summary)
  const kpis = useMemo(() => {
    const total = filteredCves.length;
    const p1Count = filteredCves.filter((c) => c.priority === 'P1').length;
    const p2Count = total - p1Count;
    const criticalCount = filteredCves.filter((c) => (c.severity || '').toLowerCase() === 'critical').length;
    const highCount = filteredCves.filter((c) => (c.severity || '').toLowerCase() === 'high').length;
    const distinctProducts = new Set(filteredCves.map((c) => c.product).filter(Boolean)).size;

    let patchedCount = 0;
    for (const c of filteredCves) {
      if (trackerStatus[c.cveId] === 'Patch Applied') patchedCount++;
    }

    return { total, p1Count, p2Count, criticalCount, highCount, distinctProducts, patchedCount };
  }, [filteredCves, trackerStatus]);

  // Paginated flat table records
  const totalEntries = filteredCves.length;
  const totalPages = Math.ceil(totalEntries / pageSize) || 1;
  const startEntry = totalEntries === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endEntry = Math.min(currentPage * pageSize, totalEntries);

  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredCves.slice(start, start + pageSize);
  }, [filteredCves, currentPage, pageSize]);

  // Checklist completed percentage
  const checklistProgress = useMemo(() => {
    if (!checklist.length) return 0;
    const doneCount = checklist.filter((i) => i.done).length;
    return Math.round((doneCount / checklist.length) * 100);
  }, [checklist]);

  // Truncate product strings (> 60 characters)
  const formatProductDisplay = (prod) => {
    if (!prod) return 'Cisco Networking Equipment';
    const clean = String(prod).trim();
    if (clean.length <= 60) return clean;
    return clean.slice(0, 60) + '...';
  };

  // Truncate vulnerability / impact strings (> 150 characters)
  const formatImpactDisplay = (impact) => {
    if (!impact) return 'Impact details in Cisco advisory bulletin.';
    const clean = String(impact).trim();
    if (clean.length <= 150) return clean;
    return clean.slice(0, 150) + '...';
  };

  const getSeverityBadgeClass = (sev) => {
    const s = String(sev || '').toLowerCase();
    if (s === 'critical') return 'badge-critical';
    if (s === 'high') return 'badge-high';
    if (s === 'medium') return 'badge-medium';
    return 'badge-low';
  };

  const getCvssColor = (score) => {
    const val = parseFloat(score) || 0;
    if (val >= 9.0) return '#ef4444';
    if (val >= 7.0) return '#f97316';
    if (val >= 4.0) return '#eab308';
    return '#3b82f6';
  };

  return (
    <div className="vulnerabilities-page" style={{ paddingBottom: '3rem' }}>
      {/* Header & Source Attribution */}
      <div className="section-header" style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ fontSize: '1.6rem' }}>🛡️</span>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
              Cisco PSIRT openVuln Security Intelligence
            </h2>
          </div>
          <p style={{ margin: '0.25rem 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            Official Cisco Security Advisories & Common Vulnerabilities (v2 API). Real-time telemetry, zero fabrication.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {vulnData?.lastFetched && (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'right' }}>
              <div>Last Synced: <strong>{new Date(vulnData.lastFetched).toLocaleString()}</strong></div>
              <div>Source: <a href="https://developer.cisco.com/psirt/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'underline' }}>Cisco openVuln API</a></div>
            </div>
          )}

          {isAdmin && (
            <button
              onClick={handleManualRefresh}
              disabled={refreshing || loading}
              className="btn btn-secondary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.85rem', fontSize: '0.82rem' }}
              title="Admin trigger: pull latest advisories from Cisco PSIRT API"
            >
              {refreshing ? <span className="spinner" style={{ width: 14, height: 14 }} /> : <span>🔄</span>}
              <span>{refreshing ? 'Syncing...' : 'Sync Cisco API'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Task 1: Compact KPI Strip (Takes minimal vertical space so Flat Table is immediately visible) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '0.75rem',
          marginBottom: '1rem',
        }}
      >
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.55rem 0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Total Advisories</span>
          <span style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' }}>{kpis.total}</span>
        </div>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.55rem 0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#dc2626', textTransform: 'uppercase' }}>P1 Critical / High</span>
          <span style={{ fontSize: '1.15rem', fontWeight: 700, color: '#dc2626' }}>{kpis.p1Count}</span>
        </div>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.55rem 0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>P2 Medium / Low</span>
          <span style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' }}>{kpis.p2Count}</span>
        </div>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.55rem 0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Affected Products</span>
          <span style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' }}>{kpis.distinctProducts}</span>
        </div>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.55rem 0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Remediation Progress</span>
          <span style={{ fontSize: '1.15rem', fontWeight: 700, color: kpis.patchedCount === kpis.total && kpis.total > 0 ? 'var(--accent-green)' : 'var(--text-primary)' }}>
            {kpis.patchedCount} / {kpis.total}
          </span>
        </div>
      </div>

      {/* Filter Toolbar with Quick Pills, Informational Toggle, and Search */}
      <div className="card pad-md" style={{ marginBottom: '1.25rem', background: 'var(--bg-card)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.9rem', alignItems: 'center', justifyContent: 'space-between' }}>
          {/* Preset Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>TIME:</span>
            {[
              { id: 'ALL', label: 'All' },
              { id: 'WEEK', label: 'Last 7 Days' },
              { id: 'MONTH', label: 'Last 30 Days' },
              { id: 'CUSTOM', label: 'Custom' },
            ].map((p) => (
              <button
                key={p.id}
                onClick={() => setDatePreset(p.id)}
                className={`btn ${datePreset === p.id ? 'btn-primary' : 'btn-ghost'}`}
                style={{ padding: '0.28rem 0.65rem', fontSize: '0.8rem', borderRadius: '6px' }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Quick Severity Pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>SEVERITY:</span>
            {[
              { id: 'ALL', label: 'All', color: 'var(--accent-blue)', bg: 'rgba(37, 99, 235, 0.12)' },
              { id: 'CRITICAL', label: 'Critical', color: '#dc2626', bg: 'rgba(220, 38, 38, 0.15)' },
              { id: 'HIGH', label: 'High', color: '#ea580c', bg: 'rgba(234, 88, 12, 0.15)' },
              { id: 'MEDIUM', label: 'Medium', color: '#d97706', bg: 'rgba(217, 119, 6, 0.15)' },
            ].map((s) => {
              const isActive = selectedSeverity === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setSelectedSeverity(s.id)}
                  type="button"
                  style={{
                    padding: '0.25rem 0.7rem',
                    fontSize: '0.8rem',
                    borderRadius: '9999px',
                    fontWeight: isActive ? 700 : 500,
                    border: isActive ? `1.5px solid ${s.color}` : '1px solid var(--border)',
                    background: isActive ? s.bg : 'var(--bg-secondary)',
                    color: isActive ? s.color : 'var(--text-secondary)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {s.label}
                </button>
              );
            })}
          </div>

          {/* Show Informational Advisories Toggle */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer', fontSize: '0.82rem', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={showInformational}
              onChange={(e) => setShowInformational(e.target.checked)}
              style={{ width: '15px', height: '15px', cursor: 'pointer' }}
            />
            <span style={{ color: 'var(--text-secondary)' }}>Show Informational Advisories</span>
          </label>

          {/* Search Box */}
          <div style={{ flex: '1 1 200px', minWidth: '160px' }}>
            <input
              type="text"
              placeholder="Search CVE, Product, Impact..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-field"
              style={{ width: '100%', fontSize: '0.82rem', padding: '0.35rem 0.75rem' }}
            />
          </div>
        </div>

        {/* Custom Range Inputs */}
        {datePreset === 'CUSTOM' && (
          <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>From:</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="input-field"
                style={{ fontSize: '0.82rem', padding: '0.3rem 0.6rem' }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>To:</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="input-field"
                style={{ fontSize: '0.82rem', padding: '0.3rem 0.6rem' }}
              />
            </div>
          </div>
        )}
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
          <div className="spinner" style={{ width: 36, height: 36, margin: '0 auto 1rem' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Querying Cisco PSIRT openVuln Security Intelligence...</p>
        </div>
      )}

      {error && (
        <div className="card pad-md" style={{ background: '#fef2f2', border: '1px solid #f87171', color: '#991b1b', marginBottom: '1.5rem' }}>
          <strong>Error loading vulnerability data:</strong> {error}
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Task 2: Rebuilt Flat Table (Print-ready report style, exactly 8 columns, zebra striped, visible immediately) */}
          <div className="card pad-md" style={{ marginBottom: '1.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  Active CVE Advisories Register ({totalEntries} Records)
                </h3>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Sorted by CVSS Score (descending) & Advisory Date. Dense printable format with active telemetry links.
                </span>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  border: '1px solid var(--border)',
                  fontSize: '0.82rem',
                }}
              >
                <thead>
                  <tr
                    style={{
                      background: '#0f172a',
                      color: '#ffffff',
                      textAlign: 'left',
                      borderBottom: '2px solid #334155',
                    }}
                  >
                    <th style={{ padding: '0.65rem 0.5rem', color: '#ffffff', fontWeight: 600, width: '50px', textAlign: 'center', borderRight: '1px solid #334155' }}>
                      S.No.
                    </th>
                    <th style={{ padding: '0.65rem 0.6rem', color: '#ffffff', fontWeight: 600, width: '105px', whiteSpace: 'nowrap', borderRight: '1px solid #334155' }}>
                      Advisory Date
                    </th>
                    <th style={{ padding: '0.65rem 0.6rem', color: '#ffffff', fontWeight: 600, minWidth: '150px', maxWidth: '220px', borderRight: '1px solid #334155' }}>
                      Product
                    </th>
                    <th style={{ padding: '0.65rem 0.6rem', color: '#ffffff', fontWeight: 600, width: '135px', whiteSpace: 'nowrap', borderRight: '1px solid #334155' }}>
                      CVE ID
                    </th>
                    <th style={{ padding: '0.65rem 0.5rem', color: '#ffffff', fontWeight: 600, width: '90px', borderRight: '1px solid #334155' }}>
                      Severity
                    </th>
                    <th style={{ padding: '0.65rem 0.5rem', color: '#ffffff', fontWeight: 600, width: '70px', borderRight: '1px solid #334155' }}>
                      CVSS
                    </th>
                    <th style={{ padding: '0.65rem 0.6rem', color: '#ffffff', fontWeight: 600, minWidth: '220px', maxWidth: '340px', borderRight: '1px solid #334155' }}>
                      Vulnerability / Impact
                    </th>
                    <th style={{ padding: '0.65rem 0.6rem', color: '#ffffff', fontWeight: 600, minWidth: '160px' }}>
                      Fixed Release / Recommended Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        No advisories found matching the selected filters.
                      </td>
                    </tr>
                  ) : (
                    paginatedRows.map((row, idx) => {
                      const sNo = (currentPage - 1) * pageSize + idx + 1;
                      const isEven = idx % 2 === 0;
                      return (
                        <tr
                          key={`${row.cveId}-${idx}`}
                          style={{
                            background: isEven ? 'var(--bg-card)' : 'var(--bg-card-hover)',
                            borderBottom: '1px solid var(--border)',
                            transition: 'background 0.15s',
                          }}
                        >
                          <td style={{ padding: '0.55rem 0.5rem', color: 'var(--text-muted)', fontWeight: 500, textAlign: 'center', borderRight: '1px solid var(--border)' }}>
                            {sNo}
                          </td>
                          <td style={{ padding: '0.55rem 0.6rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', borderRight: '1px solid var(--border)' }}>
                            {row.advisoryDate}
                          </td>
                          {/* Truncated product display with hover tooltip */}
                          <td
                            style={{ padding: '0.55rem 0.6rem', color: 'var(--text-primary)', fontWeight: 500, maxWidth: '220px', borderRight: '1px solid var(--border)' }}
                            title={row.product}
                          >
                            {formatProductDisplay(row.product)}
                          </td>
                          {/* CVE ID with clickable link to Cisco advisory */}
                          <td style={{ padding: '0.55rem 0.6rem', fontWeight: 600, color: 'var(--accent-blue)', whiteSpace: 'nowrap', borderRight: '1px solid var(--border)' }}>
                            {row.advisoryLink ? (
                              <a
                                href={row.advisoryLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ textDecoration: 'none', color: 'inherit' }}
                                title={`Open official Cisco Advisory for ${row.cveId}`}
                              >
                                {row.cveId} ↗
                              </a>
                            ) : (
                              row.cveId
                            )}
                          </td>
                          <td style={{ padding: '0.55rem 0.5rem', borderRight: '1px solid var(--border)' }}>
                            <span className={`badge ${getSeverityBadgeClass(row.severity)}`}>
                              {row.severity}
                            </span>
                          </td>
                          <td style={{ padding: '0.55rem 0.5rem', fontWeight: 700, color: getCvssColor(row.cvss), borderRight: '1px solid var(--border)' }}>
                            {row.cvss.toFixed(1)}
                          </td>
                          {/* Truncated Impact with hover tooltip */}
                          <td
                            style={{
                              padding: '0.55rem 0.6rem',
                              color: 'var(--text-primary)',
                              lineHeight: 1.4,
                              maxWidth: '340px',
                              borderRight: '1px solid var(--border)',
                            }}
                            title={row.vulnerabilityImpact}
                          >
                            {formatImpactDisplay(row.vulnerabilityImpact)}
                          </td>
                          {/* Fixed Release / Recommended Action */}
                          <td
                            style={{
                              padding: '0.55rem 0.6rem',
                              color: 'var(--text-secondary)',
                              fontSize: '0.8rem',
                            }}
                            title={row.fixedRelease}
                          >
                            {row.fixedRelease || 'Refer to Cisco Advisory bulletin'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
                Showing <strong>{startEntry}</strong> to <strong>{endEntry}</strong> of <strong>{totalEntries}</strong> entries
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Rows per page:</span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    className="nav-select"
                    style={{ fontSize: '0.82rem', padding: '0.25rem 0.5rem' }}
                  >
                    <option value={10}>10</option>
                    <option value={15}>15</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                  </select>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage <= 1}
                    className="btn btn-ghost"
                    style={{ padding: '0.3rem 0.75rem', fontSize: '0.82rem' }}
                  >
                    Previous
                  </button>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', padding: '0 0.25rem' }}>
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage >= totalPages}
                    className="btn btn-ghost"
                    style={{ padding: '0.3rem 0.75rem', fontSize: '0.82rem' }}
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Validation Checklist & Operational Remediation Protocol */}
          <div className="card pad-md" style={{ background: 'var(--bg-card)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  📋 Operational Remediation Checklist & Audit Progress
                </h3>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Step-by-step engineering checklist saved locally in browser. Complete before closing security tickets.
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: checklistProgress === 100 ? 'var(--accent-green)' : 'var(--text-secondary)' }}>
                  {checklistProgress}% Completed
                </span>
                <button
                  onClick={resetChecklist}
                  className="btn btn-ghost"
                  style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                >
                  Reset
                </button>
              </div>
            </div>

            {/* Progress Bar */}
            <div style={{ width: '100%', height: '8px', background: 'var(--border)', borderRadius: '4px', overflow: 'hidden', marginBottom: '1rem' }}>
              <div
                style={{
                  width: `${checklistProgress}%`,
                  height: '100%',
                  background: checklistProgress === 100 ? 'var(--accent-green)' : 'var(--accent-blue)',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>

            {/* Checklist Items */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {checklist.map((item) => (
                <label
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.55rem 0.8rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border)',
                    background: item.done ? 'rgba(22, 163, 74, 0.06)' : 'var(--bg-secondary)',
                    cursor: 'pointer',
                    userSelect: 'none',
                    transition: 'all 0.15s',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={() => toggleChecklistItem(item.id)}
                    style={{ width: '17px', height: '17px', cursor: 'pointer' }}
                  />
                  <span
                    style={{
                      fontSize: '0.88rem',
                      color: item.done ? 'var(--text-muted)' : 'var(--text-primary)',
                      textDecoration: item.done ? 'line-through' : 'none',
                    }}
                  >
                    {item.label}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
