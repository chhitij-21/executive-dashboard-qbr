// frontend/src/components/VulnerabilitiesPage.jsx
// Automated Vulnerabilities Dashboard powered by official Cisco PSIRT openVuln API (v2).
// Real-time advisories, CVSS sorting, pagination, date range filtering, per-product grouping, tracking & operational checklist.

import React, { useState, useEffect, useMemo } from 'react';
import { API_BASE_URL, apiFetch } from '../config/api';
import { useAuth } from '../context/AuthContext';
import KpiCard from './KpiCard';

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
  const [expandedProduct, setExpandedProduct] = useState(null);

  // Pagination for flat table
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15); // Default 15 rows per page

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
        // Task 5: Hide "NA" or "Informational" clutter (if toggle is unchecked)
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

        // Task 4: Quick Severity filter
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
        // Task 1: Default sorting
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

  // Grouped by Product Family for Executive Summary & Accordions
  const productGroups = useMemo(() => {
    const map = new Map();
    for (const cve of filteredCves) {
      const prod = cve.product || 'Other Cisco Hardware';
      if (!map.has(prod)) {
        map.set(prod, {
          product: prod,
          cves: [],
          maxCvss: 0,
          p1Count: 0,
          criticalCount: 0,
          highCount: 0,
          mediumCount: 0,
          lowCount: 0,
        });
      }
      const entry = map.get(prod);
      entry.cves.push(cve);
      if (cve.cvss > entry.maxCvss) entry.maxCvss = cve.cvss;
      if (cve.priority === 'P1') entry.p1Count++;
      const s = (cve.severity || '').toLowerCase();
      if (s === 'critical') entry.criticalCount++;
      else if (s === 'high') entry.highCount++;
      else if (s === 'medium') entry.mediumCount++;
      else if (s === 'low') entry.lowCount++;
    }
    return Array.from(map.values()).sort((a, b) => b.cves.length - a.cves.length);
  }, [filteredCves]);

  // Overall KPI metrics
  const kpis = useMemo(() => {
    const total = filteredCves.length;
    const p1Count = filteredCves.filter((c) => c.priority === 'P1').length;
    const p2Count = total - p1Count;
    const criticalCount = filteredCves.filter((c) => (c.severity || '').toLowerCase() === 'critical').length;
    const highCount = filteredCves.filter((c) => (c.severity || '').toLowerCase() === 'high').length;
    const distinctProducts = productGroups.length;

    let patchedCount = 0;
    for (const c of filteredCves) {
      if (trackerStatus[c.cveId] === 'Patch Applied') patchedCount++;
    }

    return { total, p1Count, p2Count, criticalCount, highCount, distinctProducts, patchedCount };
  }, [filteredCves, productGroups, trackerStatus]);

  // Task 3: Paginated flat table records
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

  // Task 2: Truncate long product strings (> 60 characters)
  const formatProductDisplay = (prod) => {
    if (!prod) return 'Cisco Networking Equipment';
    const clean = String(prod).trim();
    if (clean.length <= 60) return clean;
    return clean.slice(0, 60) + '...';
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
      <div className="section-header" style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ fontSize: '1.8rem' }}>🛡️</span>
            <h2 style={{ fontSize: '1.6rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
              Cisco PSIRT openVuln Security Intelligence
            </h2>
          </div>
          <p style={{ margin: '0.35rem 0 0', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Official Cisco Security Advisories & Common Vulnerabilities (v2 API). Real-time telemetry, zero fabrication.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {vulnData?.lastFetched && (
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'right' }}>
              <div>Last Synced: <strong>{new Date(vulnData.lastFetched).toLocaleString()}</strong></div>
              <div>Source: <a href="https://developer.cisco.com/psirt/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'underline' }}>Cisco openVuln API</a></div>
            </div>
          )}

          {isAdmin && (
            <button
              onClick={handleManualRefresh}
              disabled={refreshing || loading}
              className="btn btn-secondary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.45rem 0.9rem', fontSize: '0.85rem' }}
              title="Admin trigger: pull latest advisories from Cisco PSIRT API"
            >
              {refreshing ? <span className="spinner" style={{ width: 14, height: 14 }} /> : <span>🔄</span>}
              <span>{refreshing ? 'Syncing...' : 'Sync Cisco API'}</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="kpi-grid" style={{ marginBottom: '1.75rem' }}>
        <KpiCard
          title="TOTAL CVE ADVISORIES"
          value={kpis.total}
          status="normal"
        />
        <KpiCard
          title="P1 CRITICAL / HIGH"
          value={kpis.p1Count}
          status={kpis.p1Count > 0 ? 'breached' : 'met'}
        />
        <KpiCard
          title="P2 MEDIUM / LOW"
          value={kpis.p2Count}
          status="normal"
        />
        <KpiCard
          title="AFFECTED PRODUCTS"
          value={kpis.distinctProducts}
          status="normal"
        />
        <KpiCard
          title="REMEDIATION PROGRESS"
          value={`${kpis.patchedCount} / ${kpis.total}`}
          status={kpis.patchedCount === kpis.total && kpis.total > 0 ? 'met' : 'normal'}
        />
      </div>

      {/* Filter Toolbar with Quick Pills & Informational Toggle */}
      <div className="card pad-md" style={{ marginBottom: '1.5rem', background: 'var(--bg-card)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', justifyContent: 'space-between' }}>
          {/* Preset Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>TIME:</span>
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
                style={{ padding: '0.3rem 0.65rem', fontSize: '0.8rem', borderRadius: '6px' }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Task 4: Quick Severity Pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>SEVERITY:</span>
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
                    padding: '0.28rem 0.75rem',
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

          {/* Task 5: Show Informational Advisories Toggle */}
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
          {/* Executive Summary & Product Accordions */}
          <div className="card pad-md" style={{ marginBottom: '1.75rem' }}>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>📦</span> Executive Product Summary & Breakdown ({productGroups.length} Product Families)
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              Click on any product group below to expand and view specific CVE entries and remediation guidance.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {productGroups.map((group) => {
                const isExpanded = expandedProduct === group.product;
                return (
                  <div
                    key={group.product}
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      overflow: 'hidden',
                      background: 'var(--bg-secondary)',
                      transition: 'border-color 0.2s',
                    }}
                  >
                    <div
                      onClick={() => setExpandedProduct(isExpanded ? null : group.product)}
                      style={{
                        padding: '0.75rem 1rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '1rem',
                        background: isExpanded ? 'var(--bg-card-hover)' : 'transparent',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>{isExpanded ? '▼' : '▶'}</span>
                        <span
                          style={{
                            fontWeight: 600,
                            color: 'var(--text-primary)',
                            fontSize: '0.92rem',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={group.product}
                        >
                          {group.product}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                        {group.criticalCount > 0 && (
                          <span style={{ padding: '0.15rem 0.5rem', borderRadius: '4px', background: '#fee2e2', color: '#991b1b', fontSize: '0.75rem', fontWeight: 600 }}>
                            {group.criticalCount} Critical
                          </span>
                        )}
                        {group.highCount > 0 && (
                          <span style={{ padding: '0.15rem 0.5rem', borderRadius: '4px', background: '#ffedd5', color: '#9a3412', fontSize: '0.75rem', fontWeight: 600 }}>
                            {group.highCount} High
                          </span>
                        )}
                        <span style={{ padding: '0.15rem 0.5rem', borderRadius: '4px', background: 'var(--border)', color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 600 }}>
                          Max CVSS: <span style={{ color: getCvssColor(group.maxCvss) }}>{group.maxCvss.toFixed(1)}</span>
                        </span>
                        <span style={{ padding: '0.15rem 0.5rem', borderRadius: '4px', background: 'var(--border-accent)', color: '#fff', fontSize: '0.75rem', fontWeight: 600 }}>
                          {group.cves.length} CVE{group.cves.length > 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>

                    {isExpanded && (
                      <div style={{ padding: '1rem', borderTop: '1px solid var(--border)', background: 'var(--bg-card)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', textAlign: 'left' }}>
                              <th style={{ padding: '0.4rem 0.6rem' }}>CVE ID</th>
                              <th style={{ padding: '0.4rem 0.6rem' }}>Severity</th>
                              <th style={{ padding: '0.4rem 0.6rem' }}>CVSS</th>
                              <th style={{ padding: '0.4rem 0.6rem' }}>Date</th>
                              <th style={{ padding: '0.4rem 0.6rem' }}>Advisory Title / Impact</th>
                              <th style={{ padding: '0.4rem 0.6rem' }}>Remediation Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.cves.map((c) => (
                              <tr key={c.cveId} style={{ borderBottom: '1px solid var(--border)' }}>
                                <td style={{ padding: '0.5rem 0.6rem', fontWeight: 600, color: 'var(--accent-blue)' }}>
                                  <a href={c.advisoryLink} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
                                    {c.cveId} ↗
                                  </a>
                                </td>
                                <td style={{ padding: '0.5rem 0.6rem' }}>
                                  <span className={`badge ${getSeverityBadgeClass(c.severity)}`}>
                                    {c.severity}
                                  </span>
                                </td>
                                <td style={{ padding: '0.5rem 0.6rem', fontWeight: 700, color: getCvssColor(c.cvss) }}>
                                  {c.cvss.toFixed(1)}
                                </td>
                                <td style={{ padding: '0.5rem 0.6rem', color: 'var(--text-muted)' }}>
                                  {c.advisoryDate}
                                </td>
                                <td style={{ padding: '0.5rem 0.6rem', color: 'var(--text-primary)', maxWidth: '380px' }}>
                                  {c.vulnerabilityImpact}
                                </td>
                                <td style={{ padding: '0.5rem 0.6rem' }}>
                                  <select
                                    value={trackerStatus[c.cveId] || 'Pending Assessment'}
                                    onChange={(e) => updateTracker(c.cveId, e.target.value)}
                                    style={{ fontSize: '0.78rem', padding: '0.2rem 0.4rem', borderRadius: '4px', border: '1px solid var(--border)' }}
                                  >
                                    <option value="Pending Assessment">Pending Assessment</option>
                                    <option value="Scheduled for Maintenance">Scheduled for Maintenance</option>
                                    <option value="Patch Applied">Patch Applied</option>
                                    <option value="Workaround In Place">Workaround In Place</option>
                                    <option value="Not Applicable">Not Applicable</option>
                                  </select>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Flat CVE Records Table */}
          <div className="card pad-md" style={{ marginBottom: '1.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  Active CVE Advisories Register ({totalEntries} Records)
                </h3>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Sorted by CVSS Score (descending) & Advisory Date. Detailed impact disclosures and targets.
                </span>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)', background: 'var(--bg-card-hover)', textAlign: 'left', color: 'var(--text-secondary)' }}>
                    <th style={{ padding: '0.6rem 0.5rem', width: '50px' }}>S.No</th>
                    <th style={{ padding: '0.6rem 0.6rem', width: '95px' }}>Date</th>
                    <th style={{ padding: '0.6rem 0.6rem', minWidth: '160px', maxWidth: '240px' }}>Product</th>
                    <th style={{ padding: '0.6rem 0.6rem', width: '135px' }}>CVE ID</th>
                    <th style={{ padding: '0.6rem 0.5rem', width: '90px' }}>Severity</th>
                    <th style={{ padding: '0.6rem 0.5rem', width: '70px' }}>CVSS</th>
                    <th style={{ padding: '0.6rem 0.5rem', width: '70px' }}>Priority</th>
                    <th style={{ padding: '0.6rem 0.6rem', minWidth: '220px' }}>Vulnerability Impact</th>
                    <th style={{ padding: '0.6rem 0.6rem', width: '130px' }}>Fixed Release</th>
                    <th style={{ padding: '0.6rem 0.6rem', width: '90px' }}>Advisory</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedRows.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        No advisories found matching the selected filters.
                      </td>
                    </tr>
                  ) : (
                    paginatedRows.map((row, idx) => {
                      const sNo = (currentPage - 1) * pageSize + idx + 1;
                      return (
                        <tr
                          key={`${row.cveId}-${idx}`}
                          style={{
                            borderBottom: '1px solid var(--border)',
                            transition: 'background 0.15s',
                          }}
                        >
                          <td style={{ padding: '0.6rem 0.5rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                            {sNo}
                          </td>
                          <td style={{ padding: '0.6rem 0.6rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                            {row.advisoryDate}
                          </td>
                          {/* Task 2: Truncated product display with title tooltip on hover */}
                          <td
                            style={{ padding: '0.6rem 0.6rem', color: 'var(--text-primary)', fontWeight: 500, maxWidth: '240px' }}
                            title={row.product}
                          >
                            {formatProductDisplay(row.product)}
                          </td>
                          <td style={{ padding: '0.6rem 0.6rem', fontWeight: 600, color: 'var(--accent-blue)', whiteSpace: 'nowrap' }}>
                            <a href={row.advisoryLink} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
                              {row.cveId}
                            </a>
                          </td>
                          <td style={{ padding: '0.6rem 0.5rem' }}>
                            <span className={`badge ${getSeverityBadgeClass(row.severity)}`}>
                              {row.severity}
                            </span>
                          </td>
                          <td style={{ padding: '0.6rem 0.5rem', fontWeight: 700, color: getCvssColor(row.cvss) }}>
                            {row.cvss.toFixed(1)}
                          </td>
                          <td style={{ padding: '0.6rem 0.5rem' }}>
                            <span
                              style={{
                                padding: '0.15rem 0.45rem',
                                borderRadius: '4px',
                                fontSize: '0.74rem',
                                fontWeight: 700,
                                background: row.priority === 'P1' ? 'rgba(220, 38, 38, 0.15)' : 'rgba(100, 116, 139, 0.15)',
                                color: row.priority === 'P1' ? '#dc2626' : '#64748b',
                              }}
                            >
                              {row.priority}
                            </span>
                          </td>
                          <td style={{ padding: '0.6rem 0.6rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>
                            {row.vulnerabilityImpact}
                          </td>
                          <td style={{ padding: '0.6rem 0.6rem', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                            {row.fixedRelease}
                          </td>
                          <td style={{ padding: '0.6rem 0.6rem', whiteSpace: 'nowrap' }}>
                            <a
                              href={row.advisoryLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn btn-ghost"
                              style={{ padding: '0.2rem 0.5rem', fontSize: '0.78rem', color: 'var(--accent-blue)' }}
                            >
                              View ↗
                            </a>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Task 3: Bottom Pagination Controls */}
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
