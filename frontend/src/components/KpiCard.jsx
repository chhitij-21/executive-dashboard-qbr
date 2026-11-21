import React from 'react';

/**
 * KpiCard — displays a single executive KPI metric with icon, unit, status styling,
 * and optional lineage traceability trigger to inspect cell origin.
 * Shows "Data Not Available" for null/undefined values.
 */
export default function KpiCard({
  title,
  value,
  unit = '',
  icon,
  source,
  trend,
  status,
  metricKey,
  onTrace,
  deltaBadge,
  sparklineData,
}) {
  const displayValue = (value === null || value === undefined || value === '') ? 'Data Not Available' : value;
  const isUnavailable = displayValue === 'Data Not Available';

  return (
    <div className={`kpi-card ${status ? `kpi-${status}` : ''}`} title={source ? `Source: ${source}` : title}>
      <div className="kpi-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="kpi-label">{title}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          {onTrace && metricKey && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onTrace(metricKey, title, displayValue);
              }}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '0.85rem',
                color: '#64748b',
                padding: '2px 4px',
                borderRadius: '4px',
                display: 'inline-flex',
                alignItems: 'center',
                opacity: 0.75,
                transition: 'opacity 0.15s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.75')}
              title={`Trace ${title} to spreadsheet cell`}
              aria-label={`Trace ${title} to spreadsheet cell`}
            >
              🔗
            </button>
          )}
          {icon && <span className="kpi-icon">{icon}</span>}
        </div>
      </div>
      <div className="kpi-value-row" style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span className={`kpi-value ${isUnavailable ? 'kpi-na' : ''}`}>
          {displayValue}
        </span>
        {unit && !isUnavailable && <span className="kpi-unit">{unit}</span>}
        {deltaBadge && (
          <span
            className="kpi-delta-badge"
            style={{
              marginLeft: '0.5rem',
              fontSize: '0.75rem',
              fontWeight: 700,
              padding: '2px 6px',
              borderRadius: '4px',
              background: deltaBadge.direction === 'improved' ? '#dcfce7' : deltaBadge.direction === 'degraded' ? '#fee2e2' : '#f1f5f9',
              color: deltaBadge.direction === 'improved' ? '#15803d' : deltaBadge.direction === 'degraded' ? '#b91c1c' : '#475569',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '2px',
            }}
            title={`QoQ change: ${deltaBadge.formattedDelta}`}
          >
            {deltaBadge.direction === 'improved' ? '▲' : deltaBadge.direction === 'degraded' ? '▼' : '■'} {deltaBadge.formattedDelta}
          </span>
        )}
      </div>

      {sparklineData && sparklineData.length >= 2 && (
        <div style={{ marginTop: '0.35rem', height: '22px', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <svg width="56" height="18" style={{ overflow: 'visible' }}>
            <polyline
              fill="none"
              stroke={deltaBadge?.direction === 'improved' ? '#16a34a' : deltaBadge?.direction === 'degraded' ? '#dc2626' : '#2563eb'}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={(() => {
                const vals = sparklineData.map(d => d.value);
                const min = Math.min(...vals);
                const max = Math.max(...vals);
                const range = max - min || 1;
                return sparklineData.map((d, i) => {
                  const x = (i / (sparklineData.length - 1)) * 52 + 2;
                  const y = 16 - ((d.value - min) / range) * 12;
                  return `${x},${y}`;
                }).join(' ');
              })()}
            />
            {sparklineData.map((d, i) => {
              const vals = sparklineData.map(pt => pt.value);
              const min = Math.min(...vals);
              const max = Math.max(...vals);
              const range = max - min || 1;
              const x = (i / (sparklineData.length - 1)) * 52 + 2;
              const y = 16 - ((d.value - min) / range) * 12;
              return (
                <circle
                  key={i}
                  cx={x}
                  cy={y}
                  r="2.5"
                  fill={deltaBadge?.direction === 'improved' ? '#16a34a' : deltaBadge?.direction === 'degraded' ? '#dc2626' : '#2563eb'}
                />
              );
            })}
          </svg>
          <span style={{ fontSize: '0.68rem', color: '#64748b' }}>QoQ Trend</span>
        </div>
      )}

      {trend && <span className="kpi-trend">{trend}</span>}
    </div>
  );
}
