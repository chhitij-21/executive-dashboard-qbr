import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend,
  LineChart, Line
} from 'recharts';
import { useTranslation } from 'react-i18next';

const PIE_COLORS = ['#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

export function ChartsSection({ qbrData }) {
  const { t } = useTranslation();

  // 1. Top 10 Engineers by ticket count
  const engineerData = useMemo(() => {
    if (!qbrData) return [];
    const engList = qbrData.incidentAnalytics?.byEngineer || qbrData.engineerBreakdown || [];
    return [...engList]
      .sort((a, b) => (b.total || b.totalTickets || 0) - (a.total || a.totalTickets || 0))
      .slice(0, 10)
      .map(e => ({
        name: e.name || e.engineer || 'Unknown',
        tickets: e.total || e.totalTickets || 0,
      }));
  }, [qbrData]);

  // 2. Site Incident Distribution
  const siteData = useMemo(() => {
    if (!qbrData) return [];
    const siteList = qbrData.proactiveTicketAnalytics?.bySite || qbrData.siteSummary || [];
    return siteList.map(s => ({
      name: s.siteId || s.site || 'Unknown',
      value: s.total ?? s.incidentCount ?? 0,
    })).filter(s => s.value > 0);
  }, [qbrData]);

  // 3. Monthly Incident Trend (derived cleanly from incident dates)
  const monthlyTrendData = useMemo(() => {
    if (!qbrData || !Array.isArray(qbrData.incidents)) return [];
    const monthsMap = new Map();

    for (const inc of qbrData.incidents) {
      let dateVal = inc.OpenTime || inc.CreatedDate || inc.OpenDate;
      let dateObj = null;

      if (typeof dateVal === 'number') {
        // Excel serial date integer handling
        dateObj = new Date((dateVal - (25567 + 2)) * 86400 * 1000);
      } else if (dateVal) {
        dateObj = new Date(dateVal);
      }

      const key = dateObj && !isNaN(dateObj.getTime())
        ? dateObj.toLocaleString('default', { month: 'short', year: '2-digit' })
        : (qbrData.report_period?.display_label || 'Current Period');

      monthsMap.set(key, (monthsMap.get(key) || 0) + 1);
    }

    return Array.from(monthsMap.entries()).map(([month, count]) => ({
      month,
      incidents: count,
    }));
  }, [qbrData]);

  const trendChartTitle = monthlyTrendData.length < 2
    ? 'Incident Timeline (Current Period)'
    : t('chart_trend_title');

  if (!qbrData) return null;

  return (
    <section className="charts-container" style={{ margin: '24px 0' }}>
      <h3 style={{ marginBottom: '16px', fontSize: '1.2rem', color: 'var(--text-main, #0f172a)' }}>
        📊 {t('charts_title')}
      </h3>
      <div
        className="charts-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '20px',
        }}
      >
        {/* Chart 1: Engineer Bar Chart */}
        <div
          className="chart-card"
          style={{
            background: 'var(--bg-card, #ffffff)',
            border: '1px solid var(--border-color, #e2e8f0)',
            borderRadius: '12px',
            padding: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <h4 style={{ fontSize: '0.95rem', marginBottom: '12px', color: 'var(--text-main, #1e293b)' }}>
            {t('chart_engineer_title')}
          </h4>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={engineerData} margin={{ top: 10, right: 10, left: -20, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color, #f1f5f9)" />
                <XAxis dataKey="name" angle={-35} textAnchor="end" interval={0} tick={{ fontSize: 11, fill: 'var(--text-main, #475569)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-main, #475569)' }} />
                <Tooltip contentStyle={{ background: 'var(--bg-card, #ffffff)', borderRadius: '8px', border: '1px solid #cbd5e1' }} />
                <Bar dataKey="tickets" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Site Incident Pie Chart */}
        <div
          className="chart-card"
          style={{
            background: 'var(--bg-card, #ffffff)',
            border: '1px solid var(--border-color, #e2e8f0)',
            borderRadius: '12px',
            padding: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <h4 style={{ fontSize: '0.95rem', marginBottom: '12px', color: 'var(--text-main, #1e293b)' }}>
            {t('chart_site_title')}
          </h4>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={siteData}
                  cx="50%"
                  cy="45%"
                  outerRadius={75}
                  dataKey="value"
                  label={({ name, value }) => `${name}: ${value}`}
                  labelLine={false}
                >
                  {siteData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: 'var(--bg-card, #ffffff)', borderRadius: '8px', border: '1px solid #cbd5e1' }} />
                <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: '11px', color: 'var(--text-main, #475569)' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 3: Monthly Trend / Timeline Line Chart */}
        <div
          className="chart-card"
          style={{
            background: 'var(--bg-card, #ffffff)',
            border: '1px solid var(--border-color, #e2e8f0)',
            borderRadius: '12px',
            padding: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <h4 style={{ fontSize: '0.95rem', marginBottom: '12px', color: 'var(--text-main, #1e293b)' }}>
            {trendChartTitle}
          </h4>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyTrendData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color, #f1f5f9)" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--text-main, #475569)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-main, #475569)' }} />
                <Tooltip contentStyle={{ background: 'var(--bg-card, #ffffff)', borderRadius: '8px', border: '1px solid #cbd5e1' }} />
                <Line type="monotone" dataKey="incidents" stroke="#3b82f6" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </section>
  );
}
