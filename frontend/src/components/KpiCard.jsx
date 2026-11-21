import React from 'react';

/**
 * KpiCard — displays a single executive KPI metric with icon, unit, status styling,
 * and optional lineage traceability trigger to inspect cell origin.
 * Shows "Data Not Available" for null/undefined values.
 */
export default function KpiCard({ title, value, unit = '', icon, source, trend, status, metricKey, onTrace }) {
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
      <div className="kpi-value-row">
        <span className={`kpi-value ${isUnavailable ? 'kpi-na' : ''}`}>
          {displayValue}
        </span>
        {unit && !isUnavailable && <span className="kpi-unit">{unit}</span>}
      </div>
      {trend && <span className="kpi-trend">{trend}</span>}
    </div>
  );
}
