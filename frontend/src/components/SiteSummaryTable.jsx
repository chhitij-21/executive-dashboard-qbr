import React from 'react';

/**
 * SiteSummaryTable — per-site breakdown table with health badges and primary RCA for APs.
 */
export default function SiteSummaryTable({ sites, selectedSite, onSelectSite }) {
  const filteredSites = (sites || []).filter(site => {
    const name = String(site.siteId || '').toLowerCase().trim();
    return !['sla_compliance_report', 'sla compliance report', 'raw', 'sheet1', 'jfl', 'unknown'].includes(name) &&
           !name.includes('sla_compliance') &&
           !name.includes('sla compliance');
  });

  if (!filteredSites || filteredSites.length === 0) {
    return (
      <div className="empty-state">
        <span className="empty-state-icon">🏢</span>
        <p>No site data available.</p>
      </div>
    );
  }

  return (
    <div className="data-table-container">
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Site / Location</th>
              <th>Devices</th>
              <th>Switches</th>
              <th>APs</th>
              <th>Switch Uptime</th>
              <th>Total Incidents</th>
              <th>AP Incidents (Unique APs)</th>
              <th>Incident-Free %</th>
              <th>Health Score</th>
              <th>Primary RCA (All)</th>
              <th>Primary RCA for APs</th>
            </tr>
          </thead>
          <tbody>
            {filteredSites.map((site, i) => {
              const isSelected = selectedSite === site.siteId;
              const healthNum = parseFloat(site.healthScore);
              const healthColor =
                isNaN(healthNum) ? '' :
                healthNum >= 95 ? 'health-excellent' :
                healthNum >= 85 ? 'health-good' :
                healthNum >= 70 ? 'health-fair' : 'health-poor';

              return (
                <tr
                  key={i}
                  onClick={() => onSelectSite && onSelectSite(site.siteId)}
                  style={{
                    background: isSelected ? 'rgba(59, 130, 246, 0.15)' : undefined,
                    cursor: onSelectSite ? 'pointer' : 'default',
                    transition: 'background 0.2s ease',
                  }}
                  className={isSelected ? 'selected-site-row' : ''}
                >
                  <td><strong>🏢 {site.siteId}</strong></td>
                  <td className="cell-center">{site.deviceCount}</td>
                  <td className="cell-center">{site.switchCount}</td>
                  <td className="cell-center">{site.apCount}</td>
                  <td className="cell-center">
                    {site.switchUptime === 'Data Not Available' || site.switchUptime === null
                      ? <span className="na-text">N/A</span>
                      : `${site.switchUptime}%`}
                  </td>
                  <td className="cell-center">
                    <strong style={{ color: site.incidentCount > 0 ? '#dc2626' : '#16a34a' }}>
                      {site.incidentCount ?? 0}
                    </strong>
                  </td>
                  <td className="cell-center">{site.apIncidents ?? 0} ({site.uniqueAPsWithIncidents ?? 0})</td>
                  <td className="cell-center">
                    {site.incidentFreePercent === 'Data Not Available' || site.incidentFreePercent === null
                      ? <span className="na-text">N/A</span>
                      : `${site.incidentFreePercent}%`}
                  </td>
                  <td className="cell-center">
                    <span className={`health-badge ${healthColor}`}>
                      {site.healthScore === 'Data Not Available' || site.healthScore === null ? 'N/A' : `${site.healthScore} (${site.healthLabel})`}
                    </span>
                  </td>
                  <td title={site.primaryRca}>
                    {site.primaryRca === 'Data Not Available' || !site.primaryRca
                      ? <span className="na-text">None</span>
                      : site.primaryRca}
                  </td>
                  <td title={site.primaryRcaForAPs}>
                    {site.primaryRcaForAPs === 'Data Not Available' || !site.primaryRcaForAPs
                      ? <span className="na-text">None</span>
                      : site.primaryRcaForAPs}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
