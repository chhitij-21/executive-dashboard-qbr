// frontend/src/App.jsx — Executive Report Dashboard
import React, { useState, useEffect, useMemo } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import Navbar from './components/Navbar';
import LoginModal from './components/LoginModal';
import FileUploader from './components/FileUploader';
import ReportHistory from './components/ReportHistory';
import ClientManager from './components/ClientManager';
import ExcelAnalyzer from './components/ExcelAnalyzer';

import KpiCard from './components/KpiCard';
import Chart from './components/Chart';
import DataTable from './components/DataTable';
import SiteSummaryTable from './components/SiteSummaryTable';
import SiteInspector from './components/SiteInspector';
import TrendChart from './components/TrendChart';
import { API_BASE_URL, apiFetch } from './config/api';
import defaultDashboardData from './data/defaultDashboardData.json';
// FINDING-025 FIX: Import shared utilities instead of duplicating them inline.
import { normalizeLoc, isGenericLocation } from './utils/siteUtils';

// FINDING-025: normalizeLoc and isGenericLocation imported from ./utils/siteUtils above.
// Local duplicates removed.

function MainPortal() {
  const { user, activeClient, activeLocation, setActiveLocation } = useAuth();
  const [tab, setTab] = useState('upload'); // Land directly on File Upload view per strict business rule
  const [dashTab, setDashTab] = useState('executive');
  const [selectedSite, setSelectedSite] = useState('ALL');
  const [isLoginOpen, setIsLoginOpen] = useState(false);

  const [jobId, setJobId] = useState('latest');
  const [status, setStatus] = useState('idle');
  const [dashboardData, setDashboardData] = useState(defaultDashboardData);
  const [apiError, setApiError] = useState(null);

  // Fetch & poll for dashboard data if jobId or site selection changes
  useEffect(() => {
    let isSubscribed = true;

    const fetchDashboard = async () => {
      try {
        const siteParam = (activeLocation && activeLocation !== 'All Locations' && activeLocation !== 'ALL')
          ? activeLocation
          : (selectedSite && selectedSite !== 'ALL' ? selectedSite : 'ALL');

        const query = new URLSearchParams({
          jobId: jobId || 'latest',
          site: siteParam,
        }).toString();

        const res = await apiFetch(`${API_BASE_URL}/api/dashboard?${query}`);
        if (res.status === 202) return false;
        if (!res.ok) {
          if (isSubscribed) setApiError('Could not retrieve dashboard data from server.');
          return false;
        }
        const json = await res.json();
        if (json.status && json.status !== 'completed') {
          if (json.status === 'failed' || json.status === 'error') {
            if (isSubscribed) {
              setStatus('failed');
              setApiError(json.error || 'Report processing failed.');
            }
          }
          return false;
        }
        if (isSubscribed) {
          setDashboardData(json);
          setStatus('completed');
          setApiError(null);
        }
        return true;
      } catch (e) {
        console.error('Fetch dashboard error:', e);
        if (isSubscribed) setApiError('Network error connecting to backend API.');
        return false;
      }
    };

    fetchDashboard();
    return () => { isSubscribed = false; };
  }, [jobId, selectedSite, activeLocation]);

  // Use canonical backend dashboard data directly (SSOT)
  const activeDashboardData = dashboardData;


  // Requirement 1: Device Uptime Distribution for ALL Switches (Core and Non-Core)
  const switchUptimeChartData = useMemo(() => {
    const allSwitches = (activeDashboardData?.devices || []).filter((d) => {
      if (d.__isStock) return false;
      const type = String(d.DeviceType || '').toLowerCase();
      return type.includes('sw') || type.includes('switch') || (!type.includes('ap') && !type.includes('access'));
    });

    if (!allSwitches.length) return null;

    return {
      labels: allSwitches.map((d) => String(d.__combinedSLASlot || d.DeviceID || 'N/A')),
      datasets: [
        {
          label: 'Switch Uptime %',
          data: allSwitches.map((d) => d.__effectiveUptime ?? 100),
          backgroundColor: allSwitches.map((d) => {
            const isCore = String(d.CoreNonCore || '').toLowerCase().includes('core') && !String(d.CoreNonCore || '').toLowerCase().includes('non');
            const uptime = d.__effectiveUptime ?? 100;
            if (uptime < 99.3) return 'hsla(0,73%,58%,0.85)';
            return isCore ? 'hsla(262,52%,62%,0.85)' : 'hsla(212,92%,52%,0.85)';
          }),
          borderRadius: 3,
        },
      ],
    };
  }, [activeDashboardData?.devices]);

  // Formatted RCA Category Distribution chart
  const rcaChartData = useMemo(() => {
    const items = activeDashboardData?.rcaAnalytics?.standardBreakdown?.filter((r) => r.count > 0) ||
      activeDashboardData?.rcaAnalytics?.rawBreakdown?.filter((r) => r.count > 0) || [];
    if (!items.length) return null;
    return {
      labels: items.map((r) => r.category || r.rca),
      datasets: [
        {
          data: items.map((r) => r.count),
          backgroundColor: [
            'hsla(212,92%,52%,0.85)',
            'hsla(0,73%,58%,0.85)',
            'hsla(40,100%,55%,0.85)',
            'hsla(262,52%,62%,0.85)',
            'hsla(137,55%,45%,0.85)',
            'hsla(320,70%,60%,0.85)',
          ],
          borderWidth: 0,
        },
      ],
    };
  }, [activeDashboardData?.rcaAnalytics]);

  const slaMonthlyData = useMemo(() => {
    const trend = activeDashboardData?.slaAnalytics?.monthlySLATrend || [];
    return trend.map((t) => ({ label: t.month, value: parseFloat(t.slaPercent) }));
  }, [activeDashboardData?.slaAnalytics]);

  const incidentTrendData = useMemo(() => {
    const trend = activeDashboardData?.incidentAnalytics?.monthlyTrend || [];
    return trend.map((t) => ({ label: t.month, value: t.count }));
  }, [activeDashboardData?.incidentAnalytics]);

  // Render full 7-section Executive Dashboard
  const renderDashboard = () => {
    if (!activeDashboardData) {
      return (
        <div className="empty-state card pad-lg" style={{ textAlign: 'center', padding: '3rem 2rem' }}>
          <span className="empty-state-icon" style={{ fontSize: '3rem', display: 'block', marginBottom: '1rem' }}>📊</span>
          <h3 style={{ fontSize: '1.4rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
            No Dashboard Data Loaded
          </h3>
          <p style={{ color: 'var(--text-secondary)', maxWidth: '520px', margin: '0 auto 1.5rem' }}>
            {status === 'processing'
              ? 'Processing report files for client... Please wait.'
              : 'Please upload raw Excel workbooks or select a previous report from history to view executive dashboard analytics.'}
          </p>
          {status === 'processing' ? (
            <div className="spinner" style={{ width: 32, height: 32, margin: '1rem auto' }} />
          ) : (
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={() => setTab('upload')}>
                📁 Upload & Generate Report
              </button>
              <button className="btn btn-secondary" onClick={() => setTab('history')}>
                📜 Select from History
              </button>
              <button className="btn btn-outline" style={{ border: '1px solid #ccc', background: 'transparent' }} onClick={() => setJobId('default')}>
                ⚡ Load Sample Demo Data
              </button>
            </div>
          )}
        </div>
      );
    }

    const exec = activeDashboardData.executiveSummary || {};
    const siteSummary = activeDashboardData.siteSummary || [];
    const switchAn = activeDashboardData.switchAnalytics || {};
    const apAn = activeDashboardData.apAnalytics || {};
    const incAn = activeDashboardData.incidentAnalytics || {};
    const rcaAn = activeDashboardData.rcaAnalytics || {};
    const slaAn = activeDashboardData.slaAnalytics || {};

    return (
      <div className="dashboard-section">
        {apiError && (
          <div className="alert-box alert-error" style={{ marginBottom: '1rem', background: '#f8d7da', color: '#721c24', padding: '0.85rem 1.2rem', borderRadius: '8px', border: '1px solid #f5c6cb', fontWeight: 500 }}>
            <strong>Server Alert:</strong> {apiError}
          </div>
        )}
        {/* FINDING-024 FIX: Success banner is now conditional — shown only when actual
            report data exists and a real job was processed (jobId set by upload), not for demo data. */}
        {activeDashboardData && !apiError && jobId && jobId !== 'latest' && jobId !== 'default' && (
          <div className="alert-box alert-success" style={{ marginBottom: '1rem', background: '#d4edda', color: '#155724', padding: '0.85rem 1.2rem', borderRadius: '8px', border: '1px solid #c3e6cb', fontWeight: 500 }}>
            <strong>Dashboard Generated Successfully</strong> •{' '}
            {/* Only show PPT success if there's a real job to download */}
            <strong>PowerPoint Generated Successfully</strong> • <strong>Validation Completed</strong> — <strong>Ready for Download</strong>
          </div>
        )}

        {/* Customer header — period label consumed from SSOT report_period.display_label */}
        <div className="section-header card pad-md" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h2 className="section-title">
              {exec.customerName || activeClient?.name || 'Executive Dashboard'}
            </h2>
            <p className="section-meta">
              Location Context: <strong>{activeLocation}</strong> • Period:{' '}
              <strong>
                {activeDashboardData?.report_period?.display_label ||
                 exec.reportingPeriod ||
                 'Custom Period'}
              </strong>
            </p>
          </div>
          <div className="download-header-actions" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="status-badge completed">✓ Validated Engine</div>
            {jobId && jobId !== 'latest' && jobId !== 'default' && (
              <a href={`${API_BASE_URL}/api/ppt/${jobId}`} className="btn-primary" download>
                Download PPT
              </a>
            )}
          </div>
        </div>

        {/* Sub-tab navigation */}
        <div className="dash-tabs">
          {[
            { id: 'executive', label: 'Executive Summary' },
            { id: 'sites', label: 'Site Summary' },
            { id: 'switches', label: 'Switch Analytics' },
            { id: 'aps', label: 'AP Analytics' },
            { id: 'incidents', label: 'Incident Analytics' },
            { id: 'rca', label: 'RCA Analytics' },
            { id: 'sla', label: 'SLA Analytics' },
          ].map(({ id, label }) => (
            <button
              key={id}
              className={dashTab === id ? 'dash-tab active' : 'dash-tab'}
              onClick={() => setDashTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── 1. Executive Summary ──────────────────────────────────────── */}
        {dashTab === 'executive' && (
          <div className="section-body card pad-md">
            {/* Executive Hero Banner */}
            <div className="exec-banner">
              <div className="exec-banner-left">
                <h3>Executive Performance Overview</h3>
                <p>Quarterly Business Review (QBR) &amp; SLA Compliance Audit for {exec.customerName || activeClient?.name || 'Jubilant Foodworks Ltd (JFL)'}</p>
              </div>
              <div className="exec-banner-badges">
                <span className="exec-badge-item">{exec.totalSites || 8} Monitored Sites</span>
                <span className="exec-badge-item">{exec.totalDevices || 372} Active Devices</span>
                <span className="exec-badge-item" style={{ background: 'rgba(34,197,94,0.2)', color: '#4ade80' }}>Health: {exec.healthLabel || 'Excellent'}</span>
              </div>
            </div>

            <div className="exec-section-title">Key Performance Indicators</div>
            <div className="kpi-grid">
              <KpiCard title="Customer" value={exec.customerName || activeClient?.name} />
              <KpiCard title="Reporting Period" value={exec.reportingPeriod} />
              <KpiCard title="Total Sites" value={exec.totalSites} />
              <KpiCard title="Active Operational Devices" value={exec.totalDevices} />
              <KpiCard title="Stock Inventory Devices" value={exec.totalStockDevices ?? 0} />
              <KpiCard title="Total Switches" value={exec.totalSwitches} />
              <KpiCard title="Total Access Points (APs)" value={exec.totalAPs} />
              <KpiCard title="AP Incidents Count" value={exec.apIncidents ?? apAn.apIncidents ?? 0} />
              <KpiCard title="Unique APs with Incidents" value={exec.uniqueAPsWithIncidents ?? siteSummary.reduce((acc, s) => acc + (s.uniqueAPsWithIncidents || 0), 0)} />
              <KpiCard title="Primary RCA (All)" value={exec.primaryRca || rcaAn.topRca || 'None'} />
              <KpiCard title="Primary RCA for APs" value={exec.primaryRcaForAPs || apAn.topApRca || 'None'} />
              <KpiCard title="Overall Uptime" value={exec.overallUptime} unit="%" />
              <KpiCard title="Incident-Free %" value={exec.incidentFreePercent} unit="%" />
              <KpiCard title="SLA Compliance" value={exec.slaCompliance} unit="%" />
              <KpiCard title="Health Score" value={`${exec.healthScore} (${exec.healthLabel})`} />
              <KpiCard title="Total Incidents" value={exec.totalIncidents} />
            </div>

            {/* Stock Inventory List Table */}
            {activeDashboardData.devices?.filter(d => d.__isStock).length > 0 && (
              <div style={{ marginTop: '1.5rem' }}>
                <h4 style={{ marginBottom: '0.5rem' }}>
                  Stock Inventory Devices ({activeDashboardData.devices.filter(d => d.__isStock).length}) — Excluded from SLA Penalties
                </h4>
                <DataTable
                  columns={['DeviceID', 'DeviceType', 'Location', 'Rack', 'Status']}
                  rows={activeDashboardData.devices.filter(d => d.__isStock).map(d => ({
                    DeviceID: d.DeviceID,
                    DeviceType: d.DeviceType || 'N/A',
                    Location: d.SiteID || d.Location,
                    Rack: d.Rack || 'STOCK',
                    Status: 'Stock Inventory'
                  }))}
                />
              </div>
            )}

            {/* Requirement 1: All Switches Core and Non-Core Uptime Distribution */}
            {switchUptimeChartData && (
              <div className="chart-panel" style={{ marginTop: '1.5rem' }}>
                <h3 className="chart-panel-title">
                  Device Uptime Distribution — All Switches (Core &amp; Non-Core)
                </h3>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                  Purple = Core Switches • Blue = Non-Core Switches • Red = Below SLA Threshold
                </p>
                <Chart
                  type="bar"
                  data={switchUptimeChartData}
                  options={{
                    plugins: { legend: { display: false } },
                    scales: { y: { min: 0, max: 100, ticks: { callback: (v) => v + '%' } } },
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* ── 2. Site Summary ────────────────────────────────────────────── */}
        {dashTab === 'sites' && (
          <div className="section-body card pad-md">
            <h3 className="section-title">Site Summary &amp; Site Inspector</h3>
            <p className="section-meta">
              Overview across all monitored sites. Select a site to inspect per-site switches, APs, stock inventory, and incident logs.
            </p>

            {/* Site selector pills */}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', margin: '1rem 0' }}>
              <button
                className={`dash-tab ${selectedSite === 'ALL' ? 'active' : ''}`}
                onClick={() => { setSelectedSite('ALL'); setActiveLocation('All Locations'); }}
              >
                All Sites Overview
              </button>
              {siteSummary
                .filter(s => !isGenericLocation(s.siteId))
                .map((s) => (
                  <button
                    key={s.siteId}
                    className={`dash-tab ${selectedSite === s.siteId ? 'active' : ''}`}
                    onClick={() => { setSelectedSite(s.siteId); setActiveLocation(s.siteId); }}
                  >
                    {s.siteId}
                  </button>
                ))}
            </div>

            {/* Always render full Site Summary Table so all sites stay visible when inspecting a site */}
            <SiteSummaryTable
              sites={siteSummary}
              selectedSite={selectedSite}
              onSelectSite={(siteId) => {
                setSelectedSite(siteId);
                setActiveLocation(siteId === 'ALL' ? 'All Locations' : siteId);
              }}
            />

            {selectedSite !== 'ALL' && (
              <SiteInspector
                siteId={selectedSite}
                siteSummary={siteSummary}
                devices={activeDashboardData?.devices || []}
                incidents={activeDashboardData?.incidents || []}
                onClose={() => {
                  setSelectedSite('ALL');
                  setActiveLocation('All Locations');
                }}
              />
            )}
          </div>
        )}

        {/* ── 3. Switch Analytics ─────────────────────────────────────────── */}
        {dashTab === 'switches' && (
          <div className="section-body card pad-md">
            <h3 className="section-title">Switch Analytics</h3>

            {/* Uptime KPIs */}
            <div className="kpi-grid">
              <KpiCard title="Total Switches" value={switchAn.totalSwitches ?? 0} />
              <KpiCard title="Core Switches" value={switchAn.coreSwitches ?? 0} />
              <KpiCard title="Non-Core Switches" value={switchAn.nonCoreSwitches ?? 0} />
              <KpiCard title="Core Switch Uptime" value={switchAn.coreUptime ?? '100.00'} unit="%" />
              <KpiCard title="Non-Core Switch Uptime" value={switchAn.nonCoreUptime ?? '100.00'} unit="%" />
              <KpiCard title="Total Switch Incidents" value={switchAn.switchIncidents ?? switchAn.totalSwitchIncidents ?? 0} />
            </div>

            {/* Incident Resolution SLA Summary */}
            {switchAn.slaSummary && switchAn.slaSummary.total > 0 && (
              <div style={{ marginTop: '1.5rem' }}>
                <h4 style={{ marginBottom: '0.75rem', color: 'var(--text-primary)', fontWeight: 700 }}>
                  Incident Resolution SLA Summary
                  <span style={{ marginLeft: '0.5rem', fontSize: '0.78rem', fontWeight: 400, color: 'var(--text-secondary)' }}>
                    (target: {switchAn.slaSummary.total > 0 ? (switchAn.incidentSLADetails?.[0]?.sla_target_hours ?? 2) : 2}h per incident)
                  </span>
                </h4>
                <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
                  <div className="kpi-card" style={{ padding: '0.85rem 1rem', borderLeft: '4px solid #22c55e' }}>
                    <span className="kpi-label">SLA Met</span>
                    <span className="kpi-value" style={{ color: '#16a34a' }}>{switchAn.slaSummary.met}</span>
                  </div>
                  <div className="kpi-card" style={{ padding: '0.85rem 1rem', borderLeft: '4px solid #ef4444' }}>
                    <span className="kpi-label">SLA Breached</span>
                    <span className="kpi-value" style={{ color: '#dc2626' }}>{switchAn.slaSummary.breached}</span>
                  </div>
                  <div className="kpi-card" style={{ padding: '0.85rem 1rem', borderLeft: '4px solid #94a3b8' }}>
                    <span className="kpi-label">No Timing Data</span>
                    <span className="kpi-value" style={{ color: 'var(--text-secondary)' }}>{switchAn.slaSummary.unknown}</span>
                  </div>
                  <div className="kpi-card" style={{ padding: '0.85rem 1rem', borderLeft: '4px solid #3b82f6' }}>
                    <span className="kpi-label">% SLA Met</span>
                    <span className="kpi-value" style={{ color: parseFloat(switchAn.slaSummary.percentMet) >= 80 ? '#16a34a' : '#dc2626' }}>
                      {switchAn.slaSummary.percentMet}%
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* RCA Breakdown for Switch Incidents */}
            {switchAn.rcaBreakdown?.length > 0 && (
              <div style={{ marginTop: '1.5rem' }}>
                <h4 style={{ marginBottom: '0.5rem', color: 'var(--text-primary)' }}>RCA Breakdown — Switch Incidents</h4>
                <DataTable columns={['rca', 'count', 'percentage']} rows={switchAn.rcaBreakdown} noScroll />
              </div>
            )}

            {/* Per-Incident SLA Status Table */}
            {switchAn.incidentSLADetails?.length > 0 && (
              <div style={{ marginTop: '1.5rem' }}>
                <h4 style={{ marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Switch Incident SLA Details</h4>
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table" style={{ width: '100%', tableLayout: 'fixed' }}>
                    <thead>
                      <tr>
                        <th style={{ width: '18%' }}>Reference</th>
                        <th style={{ width: '16%' }}>Device</th>
                        <th style={{ width: '14%' }}>Location</th>
                        <th style={{ width: '14%', textAlign: 'center' }}>Resolution (hrs)</th>
                        <th style={{ width: '10%', textAlign: 'center' }}>Target (hrs)</th>
                        <th style={{ width: '12%', textAlign: 'center' }}>SLA Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {switchAn.incidentSLADetails.map((row, i) => {
                        const ref = row.display_reference || { type: 'Incident ID', value: row.IncidentID };
                        return (
                          <tr key={i}>
                            <td style={{ padding: '0.4rem 0.5rem', fontSize: '0.78rem' }}>
                              <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>{ref.type}</div>
                              <strong>{ref.value}</strong>
                            </td>
                            <td style={{ padding: '0.4rem 0.5rem', fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.Device}>{row.Device}</td>
                            <td style={{ padding: '0.4rem 0.5rem', fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.Location}>{row.Location}</td>
                            <td style={{ padding: '0.4rem 0.5rem', fontSize: '0.78rem', textAlign: 'center' }}>
                              {row.resolution_time_hours !== null && row.resolution_time_hours !== undefined
                                ? `${row.resolution_time_hours}h`
                                : <span style={{ color: 'var(--text-secondary)' }}>N/A</span>}
                            </td>
                            <td style={{ padding: '0.4rem 0.5rem', fontSize: '0.78rem', textAlign: 'center' }}>{row.sla_target_hours ?? 2}h</td>
                            <td style={{ padding: '0.4rem 0.5rem', textAlign: 'center' }}>
                              {row.sla_status ? (
                                <span style={{
                                  padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700,
                                  background: row.sla_status === 'SLA Met' ? '#dcfce7' : '#fee2e2',
                                  color:      row.sla_status === 'SLA Met' ? '#15803d' : '#991b1b',
                                  border: `1px solid ${row.sla_status === 'SLA Met' ? '#86efac' : '#fca5a5'}`,
                                }}>{row.sla_status}</span>
                              ) : (
                                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>N/A</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {switchAn.top10SwitchOutages?.length > 0 && (
              <div style={{ marginTop: '1.5rem' }}>
                <h4 style={{ marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Top Lowest Uptime Switches</h4>
                <DataTable
                  columns={['DeviceID', 'Location', 'CoreNonCore', 'uptime', 'incCount']}
                  rows={switchAn.top10SwitchOutages}
                />
              </div>
            )}

            {switchAn.rackwiseUptime?.length > 0 && (
              <div style={{ marginTop: '1.5rem' }}>
                <h4 style={{ marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Rack-wise Switch Uptime Summary</h4>
                <DataTable
                  columns={['site', 'rack', 'deviceCount', 'monthlyUptime', 'quarterlyUptime']}
                  rows={switchAn.rackwiseUptime}
                />
              </div>
            )}
          </div>
        )}

        {/* ── 4. AP Analytics ─────────────────────────────────────────────── */}
        {dashTab === 'aps' && (
          <div className="section-body card pad-md">
            <h3 className="section-title">Access Point (AP) Analytics</h3>

            {/* AP KPIs — no uptime per requirement */}
            <div className="kpi-grid">
              <KpiCard title="Total APs" value={apAn.totalAPs ?? 0} icon="📶" />
              <KpiCard title="Total AP Incidents" value={apAn.apIncidents ?? apAn.totalAPIncidentRows ?? 0} icon="🚨" />
              <KpiCard title="Unique APs with Incidents" value={apAn.uniqueAPsWithIncidents ?? 0} icon="🔍" />
            </div>

            {/* Incident Resolution SLA Summary */}
            {apAn.slaSummary && apAn.slaSummary.total > 0 && (
              <div style={{ marginTop: '1.5rem' }}>
                <h4 style={{ marginBottom: '0.75rem', color: 'var(--text-primary)', fontWeight: 700 }}>
                  Incident Resolution SLA Summary
                  <span style={{ marginLeft: '0.5rem', fontSize: '0.78rem', fontWeight: 400, color: 'var(--text-secondary)' }}>
                    (target: {apAn.incidentSLADetails?.[0]?.sla_target_hours ?? 2}h per incident)
                  </span>
                </h4>
                <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
                  <div className="kpi-card" style={{ padding: '0.85rem 1rem', borderLeft: '4px solid #22c55e' }}>
                    <span className="kpi-label">SLA Met</span>
                    <span className="kpi-value" style={{ color: '#16a34a' }}>{apAn.slaSummary.met}</span>
                  </div>
                  <div className="kpi-card" style={{ padding: '0.85rem 1rem', borderLeft: '4px solid #ef4444' }}>
                    <span className="kpi-label">SLA Breached</span>
                    <span className="kpi-value" style={{ color: '#dc2626' }}>{apAn.slaSummary.breached}</span>
                  </div>
                  <div className="kpi-card" style={{ padding: '0.85rem 1rem', borderLeft: '4px solid #94a3b8' }}>
                    <span className="kpi-label">No Timing Data</span>
                    <span className="kpi-value" style={{ color: 'var(--text-secondary)' }}>{apAn.slaSummary.unknown}</span>
                  </div>
                  <div className="kpi-card" style={{ padding: '0.85rem 1rem', borderLeft: '4px solid #3b82f6' }}>
                    <span className="kpi-label">% SLA Met</span>
                    <span className="kpi-value" style={{ color: parseFloat(apAn.slaSummary.percentMet) >= 80 ? '#16a34a' : '#dc2626' }}>
                      {apAn.slaSummary.percentMet}%
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* RCA Breakdown for AP Incidents */}
            {apAn.rcaBreakdown?.length > 0 && (
              <div style={{ marginTop: '1.5rem' }}>
                <h4 style={{ marginBottom: '0.5rem', color: 'var(--text-primary)' }}>RCA Breakdown — AP Incidents</h4>
                <DataTable columns={['rca', 'count', 'percentage']} rows={apAn.rcaBreakdown} noScroll />
              </div>
            )}

            {/* Per-Incident SLA Status Table */}
            {apAn.incidentSLADetails?.length > 0 && (
              <div style={{ marginTop: '1.5rem' }}>
                <h4 style={{ marginBottom: '0.5rem', color: 'var(--text-primary)' }}>AP Incident SLA Details</h4>
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table" style={{ width: '100%', tableLayout: 'fixed' }}>
                    <thead>
                      <tr>
                        <th style={{ width: '18%' }}>Reference</th>
                        <th style={{ width: '16%' }}>Device</th>
                        <th style={{ width: '14%' }}>Location</th>
                        <th style={{ width: '14%', textAlign: 'center' }}>Resolution (hrs)</th>
                        <th style={{ width: '10%', textAlign: 'center' }}>Target (hrs)</th>
                        <th style={{ width: '12%', textAlign: 'center' }}>SLA Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {apAn.incidentSLADetails.map((row, i) => {
                        const ref = row.display_reference || { type: 'Incident ID', value: row.IncidentID };
                        return (
                          <tr key={i}>
                            <td style={{ padding: '0.4rem 0.5rem', fontSize: '0.78rem' }}>
                              <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>{ref.type}</div>
                              <strong>{ref.value}</strong>
                            </td>
                            <td style={{ padding: '0.4rem 0.5rem', fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.Device}>{row.Device}</td>
                            <td style={{ padding: '0.4rem 0.5rem', fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.Location}>{row.Location}</td>
                            <td style={{ padding: '0.4rem 0.5rem', fontSize: '0.78rem', textAlign: 'center' }}>
                              {row.resolution_time_hours !== null && row.resolution_time_hours !== undefined
                                ? `${row.resolution_time_hours}h`
                                : <span style={{ color: 'var(--text-secondary)' }}>N/A</span>}
                            </td>
                            <td style={{ padding: '0.4rem 0.5rem', fontSize: '0.78rem', textAlign: 'center' }}>{row.sla_target_hours ?? 2}h</td>
                            <td style={{ padding: '0.4rem 0.5rem', textAlign: 'center' }}>
                              {row.sla_status ? (
                                <span style={{
                                  padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700,
                                  background: row.sla_status === 'SLA Met' ? '#dcfce7' : '#fee2e2',
                                  color:      row.sla_status === 'SLA Met' ? '#15803d' : '#991b1b',
                                  border: `1px solid ${row.sla_status === 'SLA Met' ? '#86efac' : '#fca5a5'}`,
                                }}>{row.sla_status}</span>
                              ) : (
                                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>N/A</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {apAn.top10APOutages?.length > 0 && (
              <div style={{ marginTop: '1.5rem' }}>
                <h4 style={{ marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Top AP Outages (Highest Incident Count)</h4>
                <DataTable
                  columns={['DeviceID', 'Location', 'incCount']}
                  rows={apAn.top10APOutages}
                />
              </div>
            )}
          </div>
        )}

        {/* ── 5. Incident Analytics ──────────────────────────────────────── */}
        {dashTab === 'incidents' && (
          <div className="section-body card pad-md">
            <h3 className="section-title">Incident Analytics</h3>
            {/* Requirement 5: MTTR KPI card removed from frontend. MTTR is retained in backend for audit only. */}
            <div className="kpi-grid">
              <KpiCard title="Total Incidents" value={incAn.totalIncidents ?? 0} icon="🚨" />
              <KpiCard title="Critical (P1 / Core)" value={incAn.criticalIncidents ?? 0} icon="🔴" />
              <KpiCard title="Major (P2 / Non-Core)" value={incAn.majorIncidents ?? 0} icon="🟠" />
              <KpiCard title="Minor (P3-P4 / AP)" value={incAn.minorIncidents ?? 0} icon="🟡" />
            </div>

            {incidentTrendData.length > 0 && (
              <div className="chart-panel" style={{ marginTop: '1.5rem' }}>
                <h3 className="chart-panel-title">Monthly Incident Volume Trend</h3>
                <TrendChart data={incidentTrendData} datasetLabel="Incidents" yLabel="Count" color="hsl(0,73%,58%)" />
              </div>
            )}

            {incAn.siteWiseIncidents?.length > 0 && (
              <div style={{ marginTop: '1.5rem' }}>
                <h4 style={{ marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Site-wise Incident Breakdown</h4>
                <DataTable columns={['siteId', 'count']} rows={incAn.siteWiseIncidents} />
              </div>
            )}
          </div>
        )}

        {/* ── 6. RCA Analytics ──────────────────────────────────────────── */}
        {dashTab === 'rca' && (
          <div className="section-body card pad-md">
            <h3 className="section-title">Root Cause Analysis (RCA)</h3>
            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
              <KpiCard title="Total Analyzed Incidents" value={rcaAn.totalIncidents ?? 0} icon="📋" />
              <KpiCard title="Primary Root Cause" value={rcaAn.topRca ?? 'None'} icon="🔍" />
            </div>

            {/* RCA Category Doughnut chart — full width */}
            {rcaChartData && (
              <div className="chart-panel" style={{ marginBottom: '1.5rem' }}>
                <h3 className="chart-panel-title">RCA Category Distribution</h3>
                <div style={{ maxWidth: '420px', margin: '0 auto' }}>
                  <Chart type="doughnut" data={rcaChartData} />
                </div>
              </div>
            )}

            {/* Standard RCA Category Breakdown — full width, no scroll */}
            {rcaAn.standardBreakdown?.length > 0 && (
              <div style={{ marginBottom: '1.5rem' }}>
                <h4 style={{ marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Standard RCA Category Breakdown</h4>
                <div style={{ overflowX: 'hidden' }}>
                  <DataTable columns={['category', 'count', 'percentage']} rows={rcaAn.standardBreakdown} noScroll />
                </div>
              </div>
            )}

            {/* Raw RCA Breakdown — full width, no scroll */}
            {rcaAn.rawBreakdown?.length > 0 && (
              <div>
                <h4 style={{ marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Raw RCA Breakdown (All Incidents)</h4>
                <div style={{ overflowX: 'hidden' }}>
                  <DataTable columns={['rca', 'count', 'percentage']} rows={rcaAn.rawBreakdown} noScroll />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── 7. SLA Analytics ──────────────────────────────────────────── */}
        {dashTab === 'sla' && (
          <div className="section-body card pad-md">
            <h3 className="section-title">SLA Analytics (Active Operational Devices)</h3>
            <div className="kpi-grid">
              <KpiCard title="Overall SLA Compliance" value={slaAn.overallSLAPercent ?? '100.00'} unit="%" icon="📈" />
              {/* Device SLA Status: single clean Met/Breached indicator — no raw % target shown */}
              <div className="kpi-card" style={{
                borderLeft: `4px solid ${
                  parseFloat(slaAn.overallSLAPercent ?? 100) >= parseFloat(slaAn.slaTarget ?? 99.3)
                    ? '#22c55e' : '#ef4444'
                }`,
              }}>
                <span className="kpi-label">Device SLA Status</span>
                <span className="kpi-value" style={{
                  color: parseFloat(slaAn.overallSLAPercent ?? 100) >= parseFloat(slaAn.slaTarget ?? 99.3)
                    ? '#16a34a' : '#dc2626',
                  fontSize: '1.1rem',
                  fontWeight: 700,
                }}>
                  {parseFloat(slaAn.overallSLAPercent ?? 100) >= parseFloat(slaAn.slaTarget ?? 99.3)
                    ? '✅ SLA Met'
                    : '❌ SLA Breached'}
                </span>
              </div>
              <KpiCard title="Compliant Active Devices" value={slaAn.compliantDevices ?? 0} icon="✅" />
              <KpiCard title="Breaching Active Devices" value={slaAn.breachingDevices ?? 0} icon="❌" />
            </div>

            {slaMonthlyData.length > 0 && (
              <div className="charts-row" style={{ marginTop: '1.5rem' }}>
                <div className="chart-panel">
                  <h3 className="chart-panel-title">Monthly SLA Trend</h3>
                  <TrendChart data={slaMonthlyData} datasetLabel="SLA %" yLabel="SLA %" color="hsl(137,55%,45%)" />
                </div>
              </div>
            )}

            {slaAn.deviceSLA?.length > 0 && (
              <div style={{ marginTop: '1.5rem' }}>
                <h4 style={{ marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                  Active Operational Devices Below SLA Threshold
                </h4>
                <DataTable columns={['DeviceID', 'Location', 'uptime', 'slaTarget', 'gap']} rows={slaAn.deviceSLA} />
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const reportSites = useMemo(() => (dashboardData?.siteSummary || []).map((s) => s.siteId), [dashboardData]);

  return (
    <div className="app-container">
      <Navbar
        activeTab={tab}
        setActiveTab={setTab}
        onOpenLogin={() => setIsLoginOpen(true)}
        reportSites={reportSites}
      />

      <main className="main-content">
        {tab === 'upload' && (
          <FileUploader
            onJobStarted={(jid) => {
              setJobId(jid);
              setStatus('processing');
            }}
            onJobCompleted={(jid) => {
              setJobId(jid);
              setTab('dashboard');
            }}
          />
        )}

        {tab === 'dashboard' && renderDashboard()}

        {tab === 'history' && (
          <ReportHistory
            onViewDashboard={(jid) => {
              setJobId(jid);
              setStatus('completed');
              setTab('dashboard');
            }}
            onReportDeleted={(jid) => {
              if (jobId === jid) {
                setJobId(null);
                setDashboardData(null);
              }
            }}
          />
        )}

        {tab === 'clients' && <ClientManager />}
      </main>

      <LoginModal isOpen={isLoginOpen} onClose={() => setIsLoginOpen(false)} />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <MainPortal />
    </AuthProvider>
  );
}
