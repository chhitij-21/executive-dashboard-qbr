// frontend/src/components/OverviewDashboard.jsx
import React, { useMemo } from 'react';
import {
  Server,
  CheckCircle,
  AlertTriangle,
  Activity,
  Clock,
  Lightbulb,
  ArrowUpRight,
  ArrowDownRight,
  ExternalLink,
  ShieldCheck,
  AlertCircle
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell
} from 'recharts';

const PIE_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'];

export default function OverviewDashboard({ data, onNavigate }) {
  const exec = data?.executiveSummary || {};
  const incidents = useMemo(() => Array.isArray(data?.incidents) ? data.incidents : [], [data]);
  const siteSummary = useMemo(() => Array.isArray(data?.siteSummary) ? data.siteSummary : [], [data]);

  // Total Devices & Incidents directly from executiveSummary and data
  const totalDevices = Number(exec.totalDevices ?? (data?.devices?.length || 0));
  const totalIncidents = Number(exec.totalIncidents ?? incidents.length);

  // atRiskDevices = unique devices in data.incidents
  const atRiskDevices = useMemo(() => {
    if (!incidents || incidents.length === 0) return 0;
    const devSet = new Set();
    incidents.forEach((i) => {
      const dev = i.DeviceID || i.SerialNo || i.Hostname || i.device_name || i.deviceName;
      if (dev && dev !== 'STOCK' && dev !== 'NA') {
        devSet.add(dev);
      }
    });
    return devSet.size;
  }, [incidents]);

  // healthyDevices = totalDevices - atRiskDevices
  const healthyDevices = Math.max(0, totalDevices - atRiskDevices);

  // SLA Compliance & Target
  const targetSLA = parseFloat(exec.slaTarget ?? 99.3);
  const currentSLA = parseFloat(exec.slaCompliance ?? data?.slaCompliance?.overall ?? 0);
  const slaDiff = Number((currentSLA - targetSLA).toFixed(2));
  const isSlaBelow = slaDiff < 0;
  const slaDiffText = `${isSlaBelow ? '-' : '+'}${Math.abs(slaDiff).toFixed(2)}% ${isSlaBelow ? 'Below Target' : 'Above Target'}`;
  const slaDiffColor = isSlaBelow ? '#dc2626' : '#16a34a';

  const healthScore = exec.healthScore ?? 100;

  // Monthly trend for Incidents (Single Line using count from data.incidentAnalytics.monthlyTrend)
  const incidentTrendData = useMemo(() => {
    const rawTrend = data?.incidentAnalytics?.monthlyTrend || data?.trendAnalytics?.monthly;
    if (Array.isArray(rawTrend) && rawTrend.length > 0) {
      return rawTrend.map((t) => ({
        month: t.month || t.name || 'Period',
        count: Number(t.count ?? t.incidents ?? 0),
      }));
    }
    return [];
  }, [data]);

  // Proactive Insights: Top 3 most recent actual incidents
  const recentInsights = useMemo(() => {
    if (!incidents || incidents.length === 0) return [];
    return incidents.slice(0, 3).map((inc, idx) => ({
      id: inc.TicketNumber || inc.IncidentNumber || inc.IncidentID || `INC-00${idx + 1}`,
      title: inc.RCA || inc.Description || inc.ShortDescription || inc.Category || 'Network Incident',
      location: inc.Location || inc.SiteID || 'Site',
      device: inc.DeviceID || inc.Hostname || inc.SerialNo || 'Device',
      time: inc.CreatedTime || (typeof inc.OpenTime === 'string' ? inc.OpenTime : '') || '',
      severity: String(inc.Priority || inc.Severity || (inc.sla_status === 'SLA Breached' ? 'High' : 'Normal')),
      status: inc.Status || inc.RawStatus || inc.sla_status || 'Mitigated',
    }));
  }, [incidents]);

  // RCA Breakdown data for Donut Chart (strictly from data)
  const rcaData = useMemo(() => {
    const bd = data?.rcaAnalytics?.breakdown || data?.rcaAnalytics?.categories;
    if (Array.isArray(bd) && bd.length > 0) {
      return bd.slice(0, 6).map((item) => ({
        name: item.name || item.category || item.rca || 'Other',
        value: Number(item.count || item.value || 0),
      })).filter((i) => i.value > 0);
    }
    if (bd && typeof bd === 'object' && Object.keys(bd).length > 0) {
      return Object.entries(bd).slice(0, 6).map(([name, count]) => ({
        name,
        value: typeof count === 'number' ? count : Number(count?.count || 0),
      })).filter((i) => i.value > 0);
    }
    return [];
  }, [data]);

  // Top 5 Sites by SLA: Map to data.siteSummary.slice(0, 5) using site.proactiveSwitchUptime or site.overallUptime
  const topSites = useMemo(() => {
    if (!siteSummary || siteSummary.length === 0) return [];
    return siteSummary.slice(0, 5).map((s) => {
      const rawUptime = s.proactiveSwitchUptime ?? s.overallUptime ?? s.jflSwitchUptime ?? s.switchUptime ?? 100;
      const num = parseFloat(rawUptime);
      return {
        name: s.siteId || s.Location || 'Site',
        sla: isNaN(num) ? '100.00' : num.toFixed(2),
      };
    });
  }, [siteSummary]);

  // Recent Proactive Alerts Table (Top 5 actual incidents)
  const recentAlerts = useMemo(() => {
    if (!incidents || incidents.length === 0) return [];
    return incidents.slice(0, 5).map((inc, idx) => ({
      id: inc.TicketNumber || inc.IncidentNumber || inc.IncidentID || `INC-00${idx + 1}`,
      time: inc.CreatedTime || (typeof inc.OpenTime === 'string' ? inc.OpenTime : '') || 'N/A',
      device: inc.DeviceID || inc.Hostname || inc.SerialNo || 'Device',
      location: inc.Location || inc.SiteID || 'N/A',
      issue: inc.RCA || inc.Description || inc.ShortDescription || inc.Category || 'Network incident',
      severity: String(inc.Priority || inc.Severity || (inc.sla_status === 'SLA Breached' ? 'High' : 'Normal')),
      status: inc.Status || inc.RawStatus || inc.sla_status || 'Closed',
    }));
  }, [incidents]);

  const getSeverityBadge = (severity) => {
    const s = String(severity).toLowerCase();
    if (s.includes('high') || s.includes('crit') || s.includes('p1') || s.includes('breach')) {
      return {
        className: 'bg-red-100 text-red-700',
        style: { backgroundColor: '#fee2e2', color: '#b91c1c' },
        label: 'High',
      };
    }
    if (s.includes('med') || s.includes('warn') || s.includes('p2') || s.includes('major')) {
      return {
        className: 'bg-orange-100 text-orange-700',
        style: { backgroundColor: '#ffedd5', color: '#c2410c' },
        label: 'Medium',
      };
    }
    return {
      className: 'bg-blue-100 text-blue-700',
      style: { backgroundColor: '#e0f2fe', color: '#0369a1' },
      label: 'Normal',
    };
  };

  return (
    <div
      className="p-8 flex flex-col gap-6 overflow-y-auto h-[calc(100vh-80px)] bg-[#f8fafc]"
      style={{
        padding: '2rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.5rem',
        overflowY: 'auto',
        height: 'calc(100vh - 80px)',
        backgroundColor: '#f8fafc',
        boxSizing: 'border-box',
      }}
    >
      {/* ══════════════════════════════════════════════════════════════
          ROW 1: KPI CARDS (5 Columns)
          ══════════════════════════════════════════════════════════════ */}
      <div
        className="grid grid-cols-5 gap-6"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
          gap: '1.5rem',
        }}
      >
        {/* Card 1: Total Devices */}
        <div
          className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col justify-between"
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '0.75rem',
            border: '1px solid #f1f5f9',
            padding: '1.5rem',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            minHeight: '140px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#64748b' }}>Total Devices</span>
            <div style={{ padding: '0.5rem', backgroundColor: '#eff6ff', borderRadius: '0.5rem', color: '#2563eb' }}>
              <Server size={18} />
            </div>
          </div>
          <div>
            <div style={{ fontSize: '1.875rem', fontWeight: 700, color: '#0f172a', lineHeight: 1.1 }}>
              {totalDevices}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.5rem' }}>
              <span style={{ color: '#2563eb', fontSize: '0.75rem', fontWeight: 600 }}>
                Active Fleet
              </span>
              <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>managed network</span>
            </div>
          </div>
        </div>

        {/* Card 2: Healthy Devices */}
        <div
          className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col justify-between"
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '0.75rem',
            border: '1px solid #f1f5f9',
            padding: '1.5rem',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            minHeight: '140px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#64748b' }}>Healthy Devices</span>
            <div style={{ padding: '0.5rem', backgroundColor: '#f0fdf4', borderRadius: '0.5rem', color: '#16a34a' }}>
              <CheckCircle size={18} />
            </div>
          </div>
          <div>
            <div style={{ fontSize: '1.875rem', fontWeight: 700, color: '#0f172a', lineHeight: 1.1 }}>
              {healthyDevices}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.5rem' }}>
              <span style={{ color: '#16a34a', fontSize: '0.75rem', fontWeight: 600 }}>
                {totalDevices > 0 ? ((healthyDevices / totalDevices) * 100).toFixed(1) : '100'}%
              </span>
              <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>operational</span>
            </div>
          </div>
        </div>

        {/* Card 3: At Risk Devices */}
        <div
          className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col justify-between"
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '0.75rem',
            border: '1px solid #f1f5f9',
            padding: '1.5rem',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            minHeight: '140px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#64748b' }}>At Risk Devices</span>
            <div style={{ padding: '0.5rem', backgroundColor: '#fef2f2', borderRadius: '0.5rem', color: '#dc2626' }}>
              <AlertTriangle size={18} />
            </div>
          </div>
          <div>
            <div style={{ fontSize: '1.875rem', fontWeight: 700, color: '#0f172a', lineHeight: 1.1 }}>
              {atRiskDevices}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.5rem' }}>
              <span style={{ color: atRiskDevices > 0 ? '#dc2626' : '#16a34a', fontSize: '0.75rem', fontWeight: 600 }}>
                {totalDevices > 0 ? ((atRiskDevices / totalDevices) * 100).toFixed(1) : '0'}%
              </span>
              <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>affected by incidents</span>
            </div>
          </div>
        </div>

        {/* Card 4: Incidents */}
        <div
          className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col justify-between"
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '0.75rem',
            border: '1px solid #f1f5f9',
            padding: '1.5rem',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            minHeight: '140px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#64748b' }}>Total Incidents</span>
            <div style={{ padding: '0.5rem', backgroundColor: '#faf5ff', borderRadius: '0.5rem', color: '#9333ea' }}>
              <Activity size={18} />
            </div>
          </div>
          <div>
            <div style={{ fontSize: '1.875rem', fontWeight: 700, color: '#0f172a', lineHeight: 1.1 }}>
              {totalIncidents}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.5rem' }}>
              <span style={{ color: '#64748b', fontSize: '0.75rem', fontWeight: 600 }}>
                Logged
              </span>
              <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>in reporting period</span>
            </div>
          </div>
        </div>

        {/* Card 5: SLA Compliance */}
        <div
          className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col justify-between"
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '0.75rem',
            border: '1px solid #f1f5f9',
            padding: '1.5rem',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            minHeight: '140px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#64748b' }}>SLA Compliance</span>
            <div
              style={{
                padding: '0.5rem',
                backgroundColor: isSlaBelow ? '#fef2f2' : '#ecfdf5',
                borderRadius: '0.5rem',
                color: isSlaBelow ? '#dc2626' : '#059669',
              }}
            >
              <Clock size={18} />
            </div>
          </div>
          <div>
            <div style={{ fontSize: '1.875rem', fontWeight: 700, color: '#0f172a', lineHeight: 1.1 }}>
              {currentSLA.toFixed(2)}%
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.5rem' }}>
              <span
                style={{
                  color: slaDiffColor,
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.15rem',
                }}
              >
                {isSlaBelow ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}
                {slaDiffText}
              </span>
              <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Target: {targetSLA.toFixed(2)}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          ROW 2: MAIN CHARTS + INSIGHTS (col-span-2 Line Chart + col-span-1 Panel)
          ══════════════════════════════════════════════════════════════ */}
      <div
        className="grid grid-cols-3 gap-6"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: '1.5rem',
        }}
      >
        {/* Left (col-span-2) - Line Chart (Incidents Trend mapped to incidentAnalytics.monthlyTrend) */}
        <div
          className="col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col justify-between"
          style={{
            gridColumn: 'span 2 / span 2',
            backgroundColor: '#ffffff',
            borderRadius: '0.75rem',
            border: '1px solid #f1f5f9',
            padding: '1.5rem',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
                Incidents Trend
              </h3>
              <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0.2rem 0 0 0' }}>
                Total monthly incident volume across network infrastructure
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', color: '#334155' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#3b82f6' }} />
                <span style={{ fontWeight: 600 }}>Incidents</span>
              </div>
            </div>
          </div>

          <div style={{ width: '100%', height: 260 }}>
            {incidentTrendData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={incidentTrendData} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="month" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                  <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      border: 'none',
                      borderRadius: '8px',
                      color: '#ffffff',
                      fontSize: '12px',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                    }}
                    itemStyle={{ color: '#e2e8f0' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="count"
                    name="Incidents"
                    stroke="#3b82f6"
                    strokeWidth={3}
                    dot={{ r: 4, fill: '#3b82f6', stroke: '#ffffff', strokeWidth: 2 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '0.875rem' }}>
                No trend data available for selected period.
              </div>
            )}
          </div>
        </div>

        {/* Right (col-span-1) - Proactive Insights Panel (Mapped to incidents.slice(0, 3)) */}
        <div
          className="col-span-1 bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col justify-between"
          style={{
            gridColumn: 'span 1 / span 1',
            backgroundColor: '#ffffff',
            borderRadius: '0.75rem',
            border: '1px solid #f1f5f9',
            padding: '1.5rem',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ padding: '0.4rem', backgroundColor: '#fef3c7', borderRadius: '0.5rem', color: '#d97706' }}>
                <Lightbulb size={18} />
              </div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
                Proactive Insights
              </h3>
            </div>
            {onNavigate && (
              <span
                onClick={() => onNavigate('incidents')}
                style={{ fontSize: '0.75rem', fontWeight: 600, color: '#2563eb', cursor: 'pointer' }}
              >
                View All
              </span>
            )}
          </div>

          {/* Actual incident alerts list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            {recentInsights.length > 0 ? (
              recentInsights.map((item, idx) => {
                const badge = getSeverityBadge(item.severity);
                return (
                  <div
                    key={idx}
                    className="bg-gray-50 rounded-lg p-3 border border-gray-100"
                    style={{ backgroundColor: '#f8fafc', borderRadius: '0.5rem', padding: '0.75rem', border: '1px solid #f1f5f9' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.2rem' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#0f172a', maxWidth: '180px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.title}
                      </span>
                      <span
                        className={badge.className}
                        style={{
                          fontSize: '10px',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontWeight: 600,
                          ...badge.style,
                        }}
                      >
                        {item.severity}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: '#64748b', margin: 0 }}>
                      {item.device} • {item.location} ({item.status})
                    </p>
                  </div>
                );
              })
            ) : (
              <div style={{ padding: '2rem 1rem', textAlign: 'center', color: '#64748b', fontSize: '0.875rem' }}>
                No active insights.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          ROW 3: BOTTOM CHARTS (3 Columns)
          ══════════════════════════════════════════════════════════════ */}
      <div
        className="grid grid-cols-3 gap-6"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: '1.5rem',
        }}
      >
        {/* Card 1: Incidents by Category */}
        <div
          className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col justify-between"
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '0.75rem',
            border: '1px solid #f1f5f9',
            padding: '1.5rem',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            minHeight: '280px',
          }}
        >
          <div>
            <h4 style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
              Incidents by Category
            </h4>
            <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '0.2rem 0 0.75rem 0' }}>
              Primary RCA classification drivers
            </p>
          </div>

          <div style={{ width: '100%', height: 160 }}>
            {rcaData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={rcaData}
                    cx="50%"
                    cy="50%"
                    innerRadius={48}
                    outerRadius={70}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {rcaData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      border: 'none',
                      borderRadius: '8px',
                      color: '#ffffff',
                      fontSize: '11px',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '0.8rem' }}>
                No RCA breakdown available.
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'center', marginTop: '0.5rem' }}>
            {rcaData.slice(0, 4).map((entry, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.7rem', color: '#475569' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }} />
                <span>{entry.name} ({entry.value})</span>
              </div>
            ))}
          </div>
        </div>

        {/* Card 2: SLA Performance */}
        <div
          className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col justify-between"
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '0.75rem',
            border: '1px solid #f1f5f9',
            padding: '1.5rem',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            minHeight: '280px',
          }}
        >
          <div>
            <h4 style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
              SLA Performance
            </h4>
            <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '0.2rem 0 0.75rem 0' }}>
              Service level agreement threshold compliance
            </p>
          </div>

          <div style={{ position: 'relative', width: '100%', height: 160 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={[
                    { name: 'Compliant', value: currentSLA },
                    { name: 'Breached', value: Math.max(0, 100 - currentSLA) },
                  ]}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={72}
                  startAngle={90}
                  endAngle={-270}
                  dataKey="value"
                >
                  <Cell fill={isSlaBelow ? '#f59e0b' : '#10b981'} />
                  <Cell fill="#e2e8f0" />
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
              }}
            >
              <span style={{ fontSize: '1.15rem', fontWeight: 700, color: '#0f172a' }}>
                {currentSLA.toFixed(2)}%
              </span>
              <span style={{ fontSize: '0.7rem', color: slaDiffColor, fontWeight: 600 }}>
                {isSlaBelow ? 'Below Target' : 'Compliant'}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f1f5f9', paddingTop: '0.65rem' }}>
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Target SLA: {targetSLA.toFixed(2)}%</span>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: slaDiffColor }}>
              {slaDiffText}
            </span>
          </div>
        </div>

        {/* Card 3: Device Health */}
        <div
          className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col justify-between"
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '0.75rem',
            border: '1px solid #f1f5f9',
            padding: '1.5rem',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            minHeight: '280px',
          }}
        >
          <div>
            <h4 style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
              Device Health
            </h4>
            <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '0.2rem 0 0.75rem 0' }}>
              Fleet availability & stability index
            </p>
          </div>

          <div style={{ position: 'relative', width: '100%', height: 160 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={[
                    { name: 'Optimal', value: healthyDevices },
                    { name: 'At Risk', value: atRiskDevices },
                  ]}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={72}
                  startAngle={90}
                  endAngle={-270}
                  dataKey="value"
                >
                  <Cell fill="#3b82f6" />
                  <Cell fill={atRiskDevices > 0 ? '#f59e0b' : '#e2e8f0'} />
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
              }}
            >
              <span style={{ fontSize: '1.15rem', fontWeight: 700, color: '#0f172a' }}>
                {healthScore}%
              </span>
              <span style={{ fontSize: '0.7rem', color: '#3b82f6', fontWeight: 600 }}>
                Healthy
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f1f5f9', paddingTop: '0.65rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: '#475569' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#3b82f6' }} />
              <span>Optimal: {healthyDevices}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: '#475569' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#f59e0b' }} />
              <span>At Risk: {atRiskDevices}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          ROW 4: TABLES & LISTS (col-span-2 Alerts Table + col-span-1 Performance)
          ══════════════════════════════════════════════════════════════ */}
      <div
        className="grid grid-cols-3 gap-6"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: '1.5rem',
        }}
      >
        {/* Left (col-span-2) - Recent Proactive Alerts Table */}
        <div
          className="col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col justify-between"
          style={{
            gridColumn: 'span 2 / span 2',
            backgroundColor: '#ffffff',
            borderRadius: '0.75rem',
            border: '1px solid #f1f5f9',
            padding: '1.5rem',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
                Recent Proactive Alerts
              </h3>
              <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0.2rem 0 0 0' }}>
                Automated telemetry notifications requiring review or ongoing resolution
              </p>
            </div>
            {onNavigate && (
              <button
                onClick={() => onNavigate('incidents')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#2563eb',
                  fontWeight: 600,
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                }}
              >
                <span>View All Tickets</span>
                <ExternalLink size={14} />
              </button>
            )}
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '0.65rem 0.5rem', fontWeight: 600 }}>Time</th>
                  <th style={{ padding: '0.65rem 0.5rem', fontWeight: 600 }}>Device</th>
                  <th style={{ padding: '0.65rem 0.5rem', fontWeight: 600 }}>Location</th>
                  <th style={{ padding: '0.65rem 0.5rem', fontWeight: 600 }}>Issue</th>
                  <th style={{ padding: '0.65rem 0.5rem', fontWeight: 600 }}>Severity</th>
                  <th style={{ padding: '0.65rem 0.5rem', fontWeight: 600 }}>Status</th>
                  <th style={{ padding: '0.65rem 0.5rem', fontWeight: 600, textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {recentAlerts.length > 0 ? (
                  recentAlerts.map((row, idx) => {
                    const badge = getSeverityBadge(row.severity);
                    return (
                      <tr
                        key={idx}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          transition: 'background-color 0.1s ease',
                        }}
                      >
                        <td style={{ padding: '0.75rem 0.5rem', color: '#64748b', fontSize: '0.8rem' }}>
                          {row.time}
                        </td>
                        <td style={{ padding: '0.75rem 0.5rem', fontWeight: 600, color: '#0f172a' }}>
                          {row.device}
                        </td>
                        <td style={{ padding: '0.75rem 0.5rem', color: '#475569' }}>
                          {row.location}
                        </td>
                        <td style={{ padding: '0.75rem 0.5rem', color: '#334155', maxWidth: '240px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {row.issue}
                        </td>
                        <td style={{ padding: '0.75rem 0.5rem' }}>
                          <span
                            className={badge.className}
                            style={{
                              padding: '0.2rem 0.5rem',
                              borderRadius: '9999px',
                              fontSize: '0.725rem',
                              fontWeight: 600,
                              ...badge.style,
                            }}
                          >
                            {badge.label}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 0.5rem' }}>
                          <span
                            style={{
                              padding: '0.2rem 0.5rem',
                              borderRadius: '9999px',
                              fontSize: '0.725rem',
                              fontWeight: 600,
                              backgroundColor: String(row.status).toLowerCase().includes('res') || String(row.status).toLowerCase().includes('clos') || String(row.status).toLowerCase().includes('met') ? '#dcfce7' : '#e0f2fe',
                              color: String(row.status).toLowerCase().includes('res') || String(row.status).toLowerCase().includes('clos') || String(row.status).toLowerCase().includes('met') ? '#15803d' : '#0369a1',
                            }}
                          >
                            {row.status}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>
                          <button
                            onClick={() => onNavigate && onNavigate('incidents')}
                            style={{
                              backgroundColor: '#eff6ff',
                              color: '#2563eb',
                              border: 'none',
                              borderRadius: '0.375rem',
                              padding: '0.25rem 0.65rem',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            Investigate
                          </button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                      No recent incidents recorded for this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right (col-span-1) - Network Performance: Top 5 Sites by SLA from data.siteSummary */}
        <div
          className="col-span-1 bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col justify-between"
          style={{
            gridColumn: 'span 1 / span 1',
            backgroundColor: '#ffffff',
            borderRadius: '0.75rem',
            border: '1px solid #f1f5f9',
            padding: '1.5rem',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
                Top 5 Sites by SLA
              </h3>
              <span style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: 600 }}>High Availability</span>
            </div>
            <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0 0 1.25rem 0' }}>
              Locations with highest network uptime
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {topSites.length > 0 ? (
                topSites.map((site, idx) => (
                  <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                      <span style={{ fontWeight: 600, color: '#0f172a' }}>{site.name}</span>
                      <span style={{ fontWeight: 700, color: '#16a34a' }}>{site.sla}%</span>
                    </div>
                    {/* Green Progress Bar */}
                    <div style={{ width: '100%', height: '6px', backgroundColor: '#f1f5f9', borderRadius: '9999px', overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${Math.min(100, Math.max(0, parseFloat(site.sla) || 0))}%`,
                          height: '100%',
                          backgroundColor: '#22c55e',
                          borderRadius: '9999px',
                        }}
                      />
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ padding: '1rem', textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>
                  No site SLA data available.
                </div>
              )}
            </div>
          </div>

          <div
            style={{
              marginTop: '1.25rem',
              padding: '0.75rem',
              backgroundColor: '#f8fafc',
              borderRadius: '0.5rem',
              border: '1px solid #f1f5f9',
              fontSize: '0.75rem',
              color: '#64748b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>Network SLA Compliance:</span>
            <strong style={{ color: slaDiffColor }}>{currentSLA.toFixed(2)}%</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
