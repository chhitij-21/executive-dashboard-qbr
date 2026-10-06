import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend, ReferenceLine
} from 'recharts';
import { useTranslation } from 'react-i18next';

const PIE_COLORS = ['#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

export function ChartsSection({ qbrData, showHeader = true }) {
  const { t } = useTranslation();

  // 1. Engineer SLA Performance & Breaches (SLA Met vs SLA Breached)
  const engineerSlaData = useMemo(() => {
    if (!qbrData) return [];
    const engList = qbrData.proactiveTicketAnalytics?.byEngineer || qbrData.incidentAnalytics?.byEngineer || qbrData.engineerBreakdown || [];
    return [...engList]
      .sort((a, b) => (b.slaMissed || b.slaBreached || 0) - (a.slaMissed || a.slaBreached || 0) || (b.total - a.total))
      .map(e => ({
        name: e.name || e.engineer || 'Unknown',
        met: e.slaMet || 0,
        breached: e.slaMissed || e.slaBreached || 0,
        total: e.total || 0,
        slaPercent: e.total ? ((e.slaMet / e.total) * 100).toFixed(2) : '100.00',
      }));
  }, [qbrData]);

  // 2. Site SLA Uptime % vs SLA Target (99.3%) & Breach Analysis
  const siteSlaData = useMemo(() => {
    if (!qbrData) return [];
    const siteList = Array.isArray(qbrData.siteSummary) ? qbrData.siteSummary : [];
    const target = parseFloat(qbrData.executiveSummary?.slaTarget || 99.3);

    return siteList.map(s => {
      const uptimeNum = parseFloat(s.jflSwitchUptime || s.uptime || '100');
      const isBreaching = uptimeNum < target;
      return {
        name: s.siteId || s.site || 'Unknown',
        uptime: uptimeNum,
        slaTarget: target,
        isBreaching,
        color: isBreaching ? (uptimeNum < 80 ? '#ef4444' : '#f59e0b') : '#10b981',
      };
    }).sort((a, b) => a.uptime - b.uptime); // Lowest uptime first so breaching sites stand out
  }, [qbrData]);

  // 3. Top 10 Engineers by Ticket Volume
  const engineerData = useMemo(() => {
    if (!qbrData) return [];
    const engList = qbrData.proactiveTicketAnalytics?.byEngineer || qbrData.incidentAnalytics?.byEngineer || qbrData.engineerBreakdown || [];
    return [...engList]
      .sort((a, b) => (b.total || b.totalTickets || 0) - (a.total || a.totalTickets || 0))
      .slice(0, 10)
      .map(e => ({
        name: e.name || e.engineer || 'Unknown',
        tickets: e.total || e.totalTickets || 0,
      }));
  }, [qbrData]);

  // 4. Site Incident Distribution
  const siteData = useMemo(() => {
    if (!qbrData) return [];
    const siteList = qbrData.proactiveTicketAnalytics?.bySite || qbrData.siteSummary || [];
    return siteList.map(s => ({
      name: s.siteId || s.site || 'Unknown',
      value: s.total ?? s.incidentCount ?? 0,
    })).filter(s => s.value > 0);
  }, [qbrData]);

  if (!qbrData) return null;

  const customerName = (qbrData?.customerName || 'Jubilant Foodworks Ltd (JFL)').toUpperCase();
  const periodLabel = qbrData?.report_period?.display_label || qbrData?.reportingPeriod || '1 September 2026 – 30 September 2026';
  const slaTarget = parseFloat(qbrData?.executiveSummary?.slaTarget || 99.3);

  return (
    <section className="charts-container" style={{
      margin: '28px 0',
      background: '#ffffff',
      border: '1px solid #e2e8f0',
      borderRadius: '16px',
      padding: '24px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.03)'
    }}>
      {/* Section Header */}
      {showHeader && (
        <div style={{
          borderBottom: '2px solid #f1f5f9',
          paddingBottom: '14px',
          marginBottom: '22px'
        }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>
            {customerName}
          </div>
          <h3 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#0f172a', margin: '0 0 6px 0' }}>
            Proactive Tickets &amp; Engineer SLA Performance
          </h3>
          <div style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: 600 }}>
            Reporting Period: <span style={{ color: '#0f172a', fontWeight: 700 }}>{periodLabel}</span>
          </div>
        </div>
      )}

      <div
        className="charts-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))',
          gap: '24px',
        }}
      >
        {/* CHART 1: Engineer SLA Performance & Breaches */}
        <div
          className="chart-card"
          style={{
            background: 'var(--bg-card, #ffffff)',
            border: '1px solid var(--border-color, #e2e8f0)',
            borderRadius: '14px',
            padding: '20px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.04)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <h4 style={{ fontSize: '1.05rem', fontWeight: '700', color: 'var(--text-main, #1e293b)', margin: 0 }}>
              👨‍💻 Engineer SLA Performance &amp; Breaches
            </h4>
            <span style={{ fontSize: '0.75rem', background: '#fee2e2', color: '#dc2626', fontWeight: 700, padding: '2px 8px', borderRadius: '10px' }}>
              SLA Breaches Tracked
            </span>
          </div>
          <div style={{ width: '100%', height: 400 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={engineerSlaData} margin={{ top: 25, right: 15, left: 0, bottom: 70 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color, #f1f5f9)" />
                <XAxis dataKey="name" angle={-35} textAnchor="end" interval={0} tick={{ fontSize: 11.5, fontWeight: 600, fill: 'var(--text-main, #334155)' }} />
                <YAxis tick={{ fontSize: 12, fill: 'var(--text-main, #475569)' }} />
                <Tooltip
                  formatter={(val, name) => [val, name === 'met' ? 'SLA Met' : 'SLA Breached']}
                  contentStyle={{ background: 'var(--bg-card, #ffffff)', borderRadius: '8px', border: '1px solid #cbd5e1', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                />
                <Legend verticalAlign="top" align="right" height={36} wrapperStyle={{ fontSize: '11.5px', fontWeight: 600 }} />
                <Bar dataKey="met" name="SLA Met" stackId="a" fill="#10b981" />
                <Bar dataKey="breached" name="SLA Breached" stackId="a" fill="#ef4444" radius={[6, 6, 0, 0]} label={{ position: 'top', fill: '#dc2626', fontSize: 11.5, fontWeight: 700, formatter: (v) => v > 0 ? `⚠️ ${v} Breached` : '' }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* CHART 2: Site SLA Uptime % vs Target (99.3%) */}
        <div
          className="chart-card"
          style={{
            background: 'var(--bg-card, #ffffff)',
            border: '1px solid var(--border-color, #e2e8f0)',
            borderRadius: '14px',
            padding: '20px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.04)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <h4 style={{ fontSize: '1.05rem', fontWeight: '700', color: 'var(--text-main, #1e293b)', margin: 0 }}>
              📍 Site SLA Uptime % vs Target ({slaTarget}%)
            </h4>
            <span style={{ fontSize: '0.75rem', background: '#fef3c7', color: '#b45309', fontWeight: 700, padding: '2px 8px', borderRadius: '10px' }}>
              Target: {slaTarget}%
            </span>
          </div>
          <div style={{ width: '100%', height: 400 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={siteSlaData} margin={{ top: 25, right: 15, left: 0, bottom: 70 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color, #f1f5f9)" />
                <XAxis dataKey="name" angle={-35} textAnchor="end" interval={0} tick={{ fontSize: 11.5, fontWeight: 600, fill: 'var(--text-main, #334155)' }} />
                <YAxis domain={[50, 100]} tick={{ fontSize: 12, fill: 'var(--text-main, #475569)' }} />
                <Tooltip
                  formatter={(val) => [`${val}%`, 'Switch Uptime %']}
                  contentStyle={{ background: 'var(--bg-card, #ffffff)', borderRadius: '8px', border: '1px solid #cbd5e1', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                />
                <ReferenceLine y={slaTarget} stroke="#ef4444" strokeDasharray="4 4" label={{ value: `SLA Target (${slaTarget}%)`, fill: '#dc2626', fontSize: 11, fontWeight: 700, position: 'top' }} />
                <Bar dataKey="uptime" radius={[6, 6, 0, 0]} label={{ position: 'top', fill: '#0f172a', fontSize: 11, fontWeight: 700, formatter: (v) => `${v}%` }}>
                  {siteSlaData.map((entry, index) => (
                    <Cell key={`site-cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* CHART 3: Top Engineers by Ticket Volume */}
        <div
          className="chart-card"
          style={{
            background: 'var(--bg-card, #ffffff)',
            border: '1px solid var(--border-color, #e2e8f0)',
            borderRadius: '14px',
            padding: '20px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.04)',
          }}
        >
          <h4 style={{ fontSize: '1.05rem', fontWeight: '700', marginBottom: '14px', color: 'var(--text-main, #1e293b)' }}>
            📊 {t('chart_engineer_title')}
          </h4>
          <div style={{ width: '100%', height: 400 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={engineerData} margin={{ top: 25, right: 15, left: 0, bottom: 70 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color, #f1f5f9)" />
                <XAxis dataKey="name" angle={-35} textAnchor="end" interval={0} tick={{ fontSize: 11.5, fontWeight: 600, fill: 'var(--text-main, #334155)' }} />
                <YAxis tick={{ fontSize: 12, fill: 'var(--text-main, #475569)' }} />
                <Tooltip contentStyle={{ background: 'var(--bg-card, #ffffff)', borderRadius: '8px', border: '1px solid #cbd5e1', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                <Bar dataKey="tickets" fill="#6366f1" radius={[6, 6, 0, 0]} label={{ position: 'top', fill: '#4338ca', fontSize: 11.5, fontWeight: 700 }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* CHART 4: Site Incident Distribution */}
        <div
          className="chart-card"
          style={{
            background: 'var(--bg-card, #ffffff)',
            border: '1px solid var(--border-color, #e2e8f0)',
            borderRadius: '14px',
            padding: '20px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.04)',
          }}
        >
          <h4 style={{ fontSize: '1.05rem', fontWeight: '700', marginBottom: '14px', color: 'var(--text-main, #1e293b)' }}>
            🥧 {t('chart_site_title')}
          </h4>
          <div style={{ width: '100%', height: 400 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={siteData}
                  cx="50%"
                  cy="42%"
                  outerRadius={115}
                  innerRadius={50}
                  paddingAngle={2}
                  dataKey="value"
                  label={({ name, value }) => `${name}: ${value}`}
                  labelLine={true}
                >
                  {siteData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: 'var(--bg-card, #ffffff)', borderRadius: '8px', border: '1px solid #cbd5e1', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                <Legend verticalAlign="bottom" height={48} wrapperStyle={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-main, #475569)', paddingTop: '12px' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </section>
  );
}
