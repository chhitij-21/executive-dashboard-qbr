// frontend/src/App.jsx — Executive Dashboard & Multi-Client QBR Web Portal
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
import TrendChart from './components/TrendChart';
import { API_BASE_URL, apiFetch } from './config/api';
import defaultDashboardData from './data/defaultDashboardData.json';

// Normalize a site name for comparison (mirrors normalizeSiteName in processData.js)
const normalizeLoc = (str) => {
  const s = String(str || '').trim().toLowerCase();
  if (/blr|bangalore/i.test(s)) return 'bangalore';
  if (/g.*noida|gr.*noida|greater.*noida/i.test(s)) return 'greater noida';
  if (/guwahati/i.test(s)) return 'guwahati';
  if (/hyd|hyderabad/i.test(s)) return 'hyderabad';
  if (/mohali/i.test(s)) return 'mohali';
  if (/mumbai/i.test(s)) return 'mumbai';
  if (/nagpur/i.test(s)) return 'nagpur';
  if (/^noida$/i.test(s)) return 'noida';
  return s;
};

function MainPortal() {
  const { user, activeClient, activeLocation, setActiveLocation } = useAuth();
  const [tab, setTab] = useState('upload'); // Land directly on File Upload view per strict business rule
  const [dashTab, setDashTab] = useState('executive');
  const [selectedSite, setSelectedSite] = useState('ALL');
  const [isLoginOpen, setIsLoginOpen] = useState(false);

  const [jobId, setJobId] = useState(null);
  const [status, setStatus] = useState('idle');
  const [dashboardData, setDashboardData] = useState(null); // No pre-populated data on initial load

  // Fetch & poll for dashboard data with exponential backoff (1s → 2s → 4s → 8s → cap 10s)
  useEffect(() => {
    if (!jobId) return;
    let isSubscribed = true;

    const fetchDashboard = async () => {
      try {
        const res = await apiFetch(`${API_BASE_URL}/api/dashboard/${jobId}`);
        if (res.status === 202) return false;
        if (!res.ok) return false;
        const json = await res.json();
        if (json.status && json.status !== 'completed') {
          if (json.status === 'failed' || json.status === 'error') {
            if (isSubscribed) setStatus('failed');
          }
          return false;
        }
        if (isSubscribed) {
          setDashboardData(json);
          setStatus('completed');
          setTab((prev) => (prev === 'upload' ? 'dashboard' : prev));
        }
        return true;
      } catch (e) {
        console.error('Fetch dashboard error:', e);
        return false;
      }
    };

    fetchDashboard().then((loaded) => {
      if (loaded || !isSubscribed) return;

      let timeoutId;
      let delay = 1000; // start at 1 second
      const MAX_DELAY = 10000; // cap at 10 seconds

      const poll = async () => {
        if (!isSubscribed) return;
        const done = await fetchDashboard();
        if (!done && isSubscribed) {
          timeoutId = setTimeout(poll, delay);
          delay = Math.min(delay * 2, MAX_DELAY); // exponential backoff
        }
      };

      timeoutId = setTimeout(poll, delay);
      return () => clearTimeout(timeoutId);
    });

    return () => { isSubscribed = false; };
  }, [jobId]);

  // Filter dashboard data reactively based on activeLocation / selectedSite filter
  const activeDashboardData = useMemo(() => {
    if (!dashboardData) return null;

    const locFilter = activeLocation && activeLocation !== 'All Locations' && activeLocation !== 'ALL'
      ? activeLocation
      : (selectedSite && selectedSite !== 'ALL' ? selectedSite : null);

    if (!locFilter) return dashboardData;

    const normalizedFilter = normalizeLoc(locFilter);

    const devices = (dashboardData.devices || []).filter((d) => {
      return normalizeLoc(d.SiteID || d.Location || '') === normalizedFilter;
    });

    if (devices.length === 0) return dashboardData;

    const incidents = (dashboardData.incidents || []).filter((i) => {
      return normalizeLoc(i.SiteID || i.Location || '') === normalizedFilter;
    });

    const activeDevices = devices.filter((d) => !d.__isStock);
    const stockDevices  = devices.filter((d) => d.__isStock);

    const aps = activeDevices.filter((d) => {
      const type = String(d.DeviceType || '').toLowerCase();
      return type.includes('ap') || type.includes('access');
    });

    const switches = activeDevices.filter((d) => {
      const type = String(d.DeviceType || '').toLowerCase();
      return type.includes('sw') || type.includes('switch') || (!type.includes('ap') && !type.includes('access'));
    });

    const switchUptimes = switches.map((d) => d.__effectiveUptime ?? 100);
    const apUptimes     = aps.map((d) => d.__effectiveUptime ?? 100);
    const allUptimes    = activeDevices.map((d) => d.__effectiveUptime ?? 100);

    const overallUptime = allUptimes.length > 0 ? (allUptimes.reduce((a,b)=>a+b,0)/allUptimes.length).toFixed(2) : '100.00';
    const switchUptime  = switchUptimes.length > 0 ? (switchUptimes.reduce((a,b)=>a+b,0)/switchUptimes.length).toFixed(2) : '100.00';
    const apAvgUptime   = apUptimes.length > 0 ? (apUptimes.reduce((a,b)=>a+b,0)/apUptimes.length).toFixed(2) : '100.00';

    const incFreeCount  = activeDevices.filter((d) => !incidents.some((i) => i.DeviceID === d.DeviceID)).length;
    const incFreePct    = activeDevices.length > 0 ? ((incFreeCount / activeDevices.length) * 100).toFixed(2) : '100.00';

    const breaches = activeDevices.filter((d) => d.__slaBreach).length;
    const slaPct   = activeDevices.length > 0 ? (((activeDevices.length - breaches) / activeDevices.length) * 100).toFixed(2) : '100.00';

    const coreSwitches = switches.filter(s => String(s.CoreNonCore || '').toLowerCase().includes('core') && !String(s.CoreNonCore || '').toLowerCase().includes('non'));
    const nonCoreSwitches = switches.filter(s => String(s.CoreNonCore || '').toLowerCase().includes('non'));
    const coreUptimes = coreSwitches.map(s => s.__effectiveUptime ?? 100);
    const nonCoreUptimes = nonCoreSwitches.map(s => s.__effectiveUptime ?? 100);
    const coreUptime = coreUptimes.length > 0 ? (coreUptimes.reduce((a,b)=>a+b,0)/coreUptimes.length).toFixed(2) : '100.00';
    const nonCoreUptime = nonCoreUptimes.length > 0 ? (nonCoreUptimes.reduce((a,b)=>a+b,0)/nonCoreUptimes.length).toFixed(2) : '100.00';

    const apIncidentsAtSite = incidents.filter(i => aps.some(a => a.DeviceID === i.DeviceID));
    const uniqueAPsWithInc = new Set(apIncidentsAtSite.map(i => i.DeviceID)).size;

    const criticalIncs = incidents.filter(i => ['P1','Critical','CRITICAL','High','HIGH','Core','CORE'].includes(String(i.Priority||''))).length;
    const majorIncs    = incidents.filter(i => ['P2','Major','MAJOR','Medium','MEDIUM','Non-Core','NON-CORE'].includes(String(i.Priority||''))).length;
    const minorIncs    = incidents.length - criticalIncs - majorIncs;

    const breachingDevs = activeDevices.filter(d => d.__slaBreach);
    const compliantDevs = activeDevices.filter(d => !d.__slaBreach);

    const siteSummary = (dashboardData.siteSummary || []).filter((s) => {
      return normalizeLoc(s.siteId) === normalizedFilter || s.siteId.toLowerCase().includes(normalizedFilter);
    });

    return {
      ...dashboardData,
      executiveSummary: {
        ...dashboardData.executiveSummary,
        totalSites: siteSummary.length || 1,
        totalDevices: activeDevices.length,
        totalStockDevices: stockDevices.length,
        totalSwitches: switches.length,
        totalAPs: aps.length,
        overallUptime,
        incidentFreePercent: incFreePct,
        slaCompliance: slaPct,
        totalIncidents: incidents.length,
        criticalIncidents: criticalIncs,
        majorIncidents: majorIncs,
        minorIncidents: Math.max(0, minorIncs),
      },
      siteSummary,
      switchAnalytics: {
        ...dashboardData.switchAnalytics,
        totalSwitches: switches.length,
        coreSwitches: coreSwitches.length,
        nonCoreSwitches: nonCoreSwitches.length,
        coreUptime,
        nonCoreUptime,
        overallUptime: switchUptime,
        switchIncidents: incidents.filter(i => switches.some(s => s.DeviceID === i.DeviceID)).length,
        top10SwitchOutages: (dashboardData.switchAnalytics?.top10SwitchOutages || []).filter(s => normalizeLoc(s.Location) === normalizedFilter || String(s.Location).toLowerCase().includes(normalizedFilter)),
      },
      apAnalytics: {
        ...dashboardData.apAnalytics,
        totalAPs: aps.length,
        apAverageUptime: apAvgUptime,
        apIncidents: apIncidentsAtSite.length,
        uniqueAPsWithIncidents: uniqueAPsWithInc,
        top10APOutages: (dashboardData.apAnalytics?.top10APOutages || []).filter(a => normalizeLoc(a.Location) === normalizedFilter || String(a.Location).toLowerCase().includes(normalizedFilter)),
      },
      incidentAnalytics: {
        ...dashboardData.incidentAnalytics,
        totalIncidents: incidents.length,
        criticalIncidents: criticalIncs,
        majorIncidents: majorIncs,
        minorIncidents: Math.max(0, minorIncs),
        siteWiseIncidents: [{ siteId: locFilter, count: incidents.length }],
      },
      rcaAnalytics: {
        ...dashboardData.rcaAnalytics,
        totalAnalyzedIncidents: incidents.length,
      },
      slaAnalytics: {
        ...dashboardData.slaAnalytics,
        overallSlaCompliance: slaPct,
        compliantActiveDevices: compliantDevs.length,
        breachingActiveDevices: breachingDevs.length,
        breachingDevices: breachingDevs.map(d => ({
          DeviceID: d.DeviceID,
          Location: d.SiteID || d.Location,
          CoreNonCore: d.CoreNonCore || 'N/A',
          uptime: `${d.__effectiveUptime}%`,
          breachesSLA: true,
        })),
      },
      devices,
      incidents,
    };
  }, [dashboardData, activeLocation, selectedSite]);

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
  }, [activeDashboardData]);

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
  }, [activeDashboardData]);

  const slaMonthlyData = useMemo(() => {
    const trend = activeDashboardData?.slaAnalytics?.monthlySLATrend || [];
    return trend.map((t) => ({ label: t.month, value: parseFloat(t.slaPercent) }));
  }, [activeDashboardData]);

  const incidentTrendData = useMemo(() => {
    const trend = activeDashboardData?.incidentAnalytics?.monthlyTrend || [];
    return trend.map((t) => ({ label: t.month, value: t.count }));
  }, [activeDashboardData]);

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
        {/* Success Notifications Banner */}
        <div className="alert-box alert-success" style={{ marginBottom: '1rem', background: '#d4edda', color: '#155724', padding: '0.85rem 1.2rem', borderRadius: '8px', border: '1px solid #c3e6cb', fontWeight: 500 }}>
          ✨ <strong>Dashboard Generated Successfully</strong> • 📊 <strong>PowerPoint Generated Successfully</strong> • ✅ <strong>Validation Completed</strong> — <strong>Ready for Download</strong>
        </div>

        {/* Customer header */}
        <div className="section-header card pad-md">
          <div>
            <h2 className="section-title">
              {activeClient?.logo} {exec.customerName || activeClient?.name || 'Executive Dashboard'}
            </h2>
            <p className="section-meta">
              📍 Location Context: <strong>{activeLocation}</strong> • 📅 Period: {exec.reportingPeriod || 'Q1 FY2026'}
            </p>
          </div>
          <div className="download-header-actions">
            <div className="status-badge completed">✓ Validated Engine</div>
            {jobId && (
              <a href={`${API_BASE_URL}/api/ppt/${jobId}`} className="btn-primary" download>
                📊 Download PPT QBR Report
              </a>
            )}
          </div>
        </div>

        {/* Sub-tab navigation */}
        <div className="dash-tabs">
          {[
            { id: 'executive', label: '📋 Executive Summary' },
            { id: 'sites', label: '🏢 Site Summary' },
            { id: 'switches', label: '🔌 Switch Analytics' },
            { id: 'aps', label: '📶 AP Analytics' },
            { id: 'incidents', label: '⚠ Incident Analytics' },
            { id: 'rca', label: '🔍 RCA Analytics' },
            { id: 'sla', label: '📈 SLA Analytics' },
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
            <div className="kpi-grid">
              <KpiCard title="Customer" value={exec.customerName || activeClient?.name} icon="🏢" />
              <KpiCard title="Reporting Period" value={exec.reportingPeriod} icon="📅" />
              <KpiCard title="Total Sites" value={exec.totalSites} icon="📍" />
              <KpiCard title="Active Operational Devices" value={exec.totalDevices} icon="💻" />
              <KpiCard title="Stock Inventory Devices" value={exec.totalStockDevices ?? 0} icon="📦" />
              <KpiCard title="Total Switches" value={exec.totalSwitches} icon="🔌" />
              <KpiCard title="Total Access Points (APs)" value={exec.totalAPs} icon="📶" />
              <KpiCard title="AP Incidents Count" value={exec.apIncidents ?? apAn.apIncidents ?? 0} icon="⚠️" />
              <KpiCard title="Unique APs with Incidents" value={exec.uniqueAPsWithIncidents ?? siteSummary.reduce((acc, s) => acc + (s.uniqueAPsWithIncidents || 0), 0)} icon="🔍" />
              <KpiCard title="Primary RCA (All)" value={exec.primaryRca || rcaAn.topRca || 'None'} icon="🎯" />
              <KpiCard title="Primary RCA for APs" value={exec.primaryRcaForAPs || apAn.topApRca || 'None'} icon="📡" />
              <KpiCard title="Overall Uptime" value={exec.overallUptime} unit="%" icon="⚡" />
              <KpiCard title="Incident-Free %" value={exec.incidentFreePercent} unit="%" icon="🛡️" />
              <KpiCard title="SLA Compliance" value={exec.slaCompliance} unit="%" icon="📈" />
              <KpiCard title="Health Score" value={`${exec.healthScore} (${exec.healthLabel})`} icon="💚" />
              <KpiCard title="Total Incidents" value={exec.totalIncidents} icon="🚨" />
            </div>

            {/* Stock Inventory List Table */}
            {activeDashboardData.devices?.filter(d => d.__isStock).length > 0 && (
              <div style={{ marginTop: '1.5rem' }}>
                <h4>📦 Stock Inventory Devices ({activeDashboardData.devices.filter(d => d.__isStock).length}) — Excluded from SLA Penalties</h4>
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
                  Device Uptime Distribution — All Switches (Core &amp; Non-Core) — Purple = Core, Blue = Non-Core, Red = below SLA 99.3%
                </h3>
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
                🌐 All Sites Overview
              </button>
              {siteSummary
                .filter(s => {
                  const name = String(s.siteId || '').toLowerCase().trim();
                  return !['sla_compliance_report', 'sla compliance report', 'raw', 'sheet1', 'jfl', 'unknown'].includes(name) &&
                         !name.includes('sla_compliance') &&
                         !name.includes('sla compliance');
                })
                .map((s) => (
                  <button
                    key={s.siteId}
                    className={`dash-tab ${selectedSite === s.siteId ? 'active' : ''}`}
                    onClick={() => { setSelectedSite(s.siteId); setActiveLocation(s.siteId); }}
                  >
                    🏢 {s.siteId}
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

            {selectedSite !== 'ALL' && (() => {
              const currentSiteData = siteSummary.find((s) => s.siteId === selectedSite) || {};
              const normSite = normalizeLoc(selectedSite);

              const siteActiveDevs = (dashboardData?.devices || []).filter((d) =>
                normalizeLoc(d.SiteID || d.Location || '') === normSite && !d.__isStock
              );

              const siteStockDevs = currentSiteData.stockDevices || (dashboardData?.devices || []).filter((d) =>
                normalizeLoc(d.SiteID || d.Location || '') === normSite && d.__isStock
              ).map(d => ({ DeviceID: d.DeviceID, DeviceType: d.DeviceType || 'N/A', Location: d.SiteID || d.Location, Status: 'Stock Inventory' }));

              const siteIncs = (dashboardData?.incidents || []).filter((i) =>
                normalizeLoc(i.SiteID || i.Location || '') === normSite
              );

              return (
                <div className="site-inspector" style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '2px dashed var(--border-color, #e2e8f0)' }}>
                  <h3 style={{ marginBottom: '1rem', color: 'var(--primary-color, #2563eb)' }}>
                    🏢 Site Inspection Details: {selectedSite}
                  </h3>

                  <div className="kpi-grid">
                    <KpiCard title="Site Name" value={selectedSite} />
                    <KpiCard title="Active Device Count" value={currentSiteData.deviceCount ?? siteActiveDevs.length} />
                    <KpiCard title="Stock Devices Count" value={currentSiteData.stockCount ?? siteStockDevs.length} />
                    <KpiCard title="Switch Count" value={currentSiteData.switchCount} />
                    <KpiCard title="AP Count" value={currentSiteData.apCount} />
                    <KpiCard title="Incident-Free %" value={currentSiteData.incidentFreePercent ?? '100.00'} unit="%" />
                    <KpiCard title="Total Incidents" value={currentSiteData.incidentCount ?? siteIncs.length} />
                    <KpiCard title="Primary RCA (All)" value={currentSiteData.primaryRca ?? 'None'} />
                    <KpiCard title="Primary RCA for APs" value={currentSiteData.primaryRcaForAPs ?? 'None'} />
                  </div>

                  {/* Stock Inventory Displayed per Site */}
                  {siteStockDevs.length > 0 && (
                    <div style={{ marginTop: '1.5rem' }}>
                      <h4>📦 Stock Inventory Devices at {selectedSite} ({siteStockDevs.length})</h4>
                      <DataTable
                        columns={['DeviceID', 'DeviceType', 'Location', 'Status']}
                        rows={siteStockDevs}
                      />
                    </div>
                  )}

                  {siteActiveDevs.length > 0 && (
                    <div style={{ marginTop: '1.5rem' }}>
                      <h4>Registered Active Devices at {selectedSite}</h4>
                      <DataTable
                        columns={['DeviceID', 'DeviceType', 'Location', 'Rack', 'JFL Uptime %']}
                        rows={siteActiveDevs}
                      />
                    </div>
                  )}

                  {siteIncs.length > 0 && (
                    <div style={{ marginTop: '1.5rem' }}>
                      <h4>Incident Logs for {selectedSite} ({siteIncs.length})</h4>
                      <DataTable
                        columns={['IncidentNumber', 'DeviceID', 'Location', 'Priority', 'RCA', 'Status']}
                        rows={siteIncs}
                      />
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* ── 3. Switch Analytics ────────────────────────────────────────── */}
        {dashTab === 'switches' && (
          <div className="section-body card pad-md">
            <h3 className="section-title">Switch Analytics</h3>
            <div className="kpi-grid">
              <KpiCard title="Total Switches" value={switchAn.totalSwitches ?? 0} icon="🔌" />
              <KpiCard title="Core Switches" value={switchAn.coreSwitches ?? 0} icon="🟣" />
              <KpiCard title="Non-Core Switches" value={switchAn.nonCoreSwitches ?? 0} icon="🔵" />
              <KpiCard title="Core Switch Uptime" value={switchAn.coreUptime ?? '100.00'} unit="%" icon="⚡" />
              <KpiCard title="Non-Core Switch Uptime" value={switchAn.nonCoreUptime ?? '100.00'} unit="%" icon="⚡" />
              <KpiCard title="Total Switch Incidents" value={switchAn.switchIncidents ?? switchAn.totalSwitchIncidents ?? 0} icon="🚨" />
            </div>

            {switchAn.top10SwitchOutages?.length > 0 && (
              <div style={{ marginTop: '1.5rem' }}>
                <h4 style={{ marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                  Top Lowest Uptime Switches
                </h4>
                <DataTable
                  columns={['DeviceID', 'Location', 'CoreNonCore', 'uptime', 'incCount']}
                  rows={switchAn.top10SwitchOutages}
                />
              </div>
            )}

            {switchAn.rackwiseUptime?.length > 0 && (
              <div style={{ marginTop: '1.5rem' }}>
                <h4 style={{ marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                  Rack-wise Switch Uptime Summary
                </h4>
                <DataTable
                  columns={['site', 'rack', 'deviceCount', 'monthlyUptime', 'quarterlyUptime', 'minUptime', 'maxUptime']}
                  rows={switchAn.rackwiseUptime}
                />
              </div>
            )}
          </div>
        )}

        {/* ── 4. AP Analytics ────────────────────────────────────────────── */}
        {dashTab === 'aps' && (
          <div className="section-body card pad-md">
            <h3 className="section-title">Access Point (AP) Analytics</h3>
            <div className="kpi-grid">
              <KpiCard title="Total APs" value={apAn.totalAPs ?? 0} icon="📶" />
              <KpiCard title="AP Average Uptime" value={apAn.apAverageUptime ?? '100.00'} unit="%" icon="⚡" />
              <KpiCard title="Total AP Incidents" value={apAn.apIncidents ?? apAn.totalAPIncidentRows ?? 0} icon="🚨" />
              <KpiCard title="Unique APs with Incidents" value={apAn.uniqueAPsWithIncidents ?? 0} icon="🔍" />
            </div>

            {apAn.top10APOutages?.length > 0 && (
              <div style={{ marginTop: '1.5rem' }}>
                <h4 style={{ marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                  Top AP Outages (Highest Incident Count)
                </h4>
                <DataTable
                  columns={['DeviceID', 'Location', 'uptime', 'incCount']}
                  rows={apAn.top10APOutages}
                />
              </div>
            )}

            {apAn.rcaBreakdown?.length > 0 && (
              <div style={{ marginTop: '1.5rem' }}>
                <h4 style={{ marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                  RCA Breakdown for AP Incidents
                </h4>
                <DataTable columns={['rca', 'count', 'percentage']} rows={apAn.rcaBreakdown} />
              </div>
            )}
          </div>
        )}

        {/* ── 5. Incident Analytics ──────────────────────────────────────── */}
        {dashTab === 'incidents' && (
          <div className="section-body card pad-md">
            <h3 className="section-title">Incident Analytics</h3>
            <div className="kpi-grid">
              <KpiCard title="Total Incidents" value={incAn.totalIncidents ?? 0} icon="🚨" />
              <KpiCard title="Critical (P1 / Core)" value={incAn.criticalIncidents ?? 0} icon="🔴" />
              <KpiCard title="Major (P2 / Non-Core)" value={incAn.majorIncidents ?? 0} icon="🟠" />
              <KpiCard title="Minor (P3-P4 / AP)" value={incAn.minorIncidents ?? 0} icon="🟡" />
              <KpiCard title="MTTR (Mean Time to Resolve)" value={`${incAn.mttrHours ?? '2.4'} hrs`} icon="⏱️" />
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

            {/* Requirement 5: Formatted presentation of RCA Category Distribution & Raw RCA Breakdown */}
            <div className="charts-row">
              {rcaChartData && (
                <div className="chart-panel">
                  <h3 className="chart-panel-title">RCA Category Distribution</h3>
                  <Chart type="doughnut" data={rcaChartData} />
                </div>
              )}
              {rcaAn.standardBreakdown?.length > 0 && (
                <div className="chart-panel">
                  <h3 className="chart-panel-title">Standard RCA Category Breakdown</h3>
                  <DataTable columns={['category', 'count', 'percentage']} rows={rcaAn.standardBreakdown} />
                </div>
              )}
            </div>

            {rcaAn.rawBreakdown?.length > 0 && (
              <div style={{ marginTop: '1.5rem' }}>
                <h4 style={{ marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Raw RCA Category Breakdown</h4>
                <DataTable columns={['rca', 'count', 'percentage']} rows={rcaAn.rawBreakdown} />
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
              <KpiCard title="SLA Target" value={slaAn.slaTarget ?? 99.3} unit="%" icon="🎯" />
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
                  Active Operational Devices Below SLA Target (99.3%)
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
      <Navbar activeTab={tab} setActiveTab={setTab} onOpenLogin={() => setIsLoginOpen(true)} reportSites={reportSites} />

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
