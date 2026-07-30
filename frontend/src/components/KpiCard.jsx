import React from 'react';

/**
 * KpiCard — displays a single executive KPI metric with icon, unit, and status styling.
 * Shows "Data Not Available" for null/undefined values.
 */
export default function KpiCard({ title, value, unit = '', icon, source, trend, status }) {
  const displayValue = (value === null || value === undefined || value === '') ? 'Data Not Available' : value;
  const isUnavailable = displayValue === 'Data Not Available';

  return (
    <div className={`kpi-card ${status ? `kpi-${status}` : ''}`} title={source ? `Source: ${source}` : title}>
      <div className="kpi-header-row">
        <span className="kpi-label">{title}</span>
        {icon && <span className="kpi-icon">{icon}</span>}
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

