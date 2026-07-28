import React from 'react';

/**
 * KpiCard — displays a single KPI metric.
 * Shows "Data Not Available" for null/undefined values.
 * Tooltip shows the source reference for traceability.
 */
export default function KpiCard({ title, value, unit = '', source, trend }) {
  const displayValue = (value === null || value === undefined || value === '') ? 'Data Not Available' : value;
  const isUnavailable = displayValue === 'Data Not Available';

  return (
    <div className="kpi-card" title={source ? `Source: ${source}` : title}>
      <span className="kpi-label">{title}</span>
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
