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
    <div className="data-table-container" style={{ overflow: 'visible' }}>
      <div className="table-scroll-no-vertical" style={{ overflowX: 'hidden', overflowY: 'visible', maxHeight: 'none' }}>
        <table className="data-table site-summary-master-table" style={{ tableLayout: 'fixed', width: '100%' }}>
          <thead>
            <tr>
              <th style={{ width: '13%', padding: '0.45rem 0.5rem', fontSize: '0.78rem' }}>Site / Location</th>
              <th style={{ width: '7%', padding: '0.45rem 0.5rem', fontSize: '0.78rem' }} className="cell-center">Devices</th>
              <th style={{ width: '7%', padding: '0.45rem 0.5rem', fontSize: '0.78rem' }} className="cell-center">Switches</th>
              <th style={{ width: '7%', padding: '0.45rem 0.5rem', fontSize: '0.78rem' }} className="cell-center">APs</th>
              <th style={{ width: '10%', padding: '0.45rem 0.5rem', fontSize: '0.78rem' }} className="cell-center">Switch Uptime</th>
              <th style={{ width: '13%', padding: '0.45rem 0.5rem', fontSize: '0.78rem' }} className="cell-center">AP Incidents (Unique)</th>
              <th style={{ width: '10%', padding: '0.45rem 0.5rem', fontSize: '0.78rem' }} className="cell-center">Incident-Free %</th>
              <th style={{ width: '13%', padding: '0.45rem 0.5rem', fontSize: '0.78rem' }} className="cell-center">Health Score</th>
              <th style={{ width: '10%', padding: '0.45rem 0.5rem', fontSize: '0.78rem' }}>Primary RCA (All)</th>
              <th style={{ width: '10%', padding: '0.45rem 0.5rem', fontSize: '0.78rem' }}>Primary RCA for APs</th>
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
                  <td style={{ padding: '0.4rem 0.5rem', fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={site.siteId}>
                    <strong>🏢 {site.siteId}</strong>
                  </td>
                  <td style={{ padding: '0.4rem 0.5rem', fontSize: '0.78rem' }} className="cell-center">{site.deviceCount}</td>
                  <td style={{ padding: '0.4rem 0.5rem', fontSize: '0.78rem' }} className="cell-center">{site.switchCount}</td>
                  <td style={{ padding: '0.4rem 0.5rem', fontSize: '0.78rem' }} className="cell-center">{site.apCount}</td>
                  <td style={{ padding: '0.4rem 0.5rem', fontSize: '0.78rem' }} className="cell-center">
                    {site.switchUptime === 'Data Not Available' || site.switchUptime === null
                      ? <span className="na-text">N/A</span>
                      : `${site.switchUptime}%`}
                  </td>
                  <td style={{ padding: '0.4rem 0.5rem', fontSize: '0.78rem' }} className="cell-center">
                    {site.apIncidents ?? 0} ({site.uniqueAPsWithIncidents ?? 0})
                  </td>
                  <td style={{ padding: '0.4rem 0.5rem', fontSize: '0.78rem' }} className="cell-center">
                    {site.incidentFreePercent === 'Data Not Available' || site.incidentFreePercent === null
                      ? <span className="na-text">N/A</span>
                      : `${site.incidentFreePercent}%`}
                  </td>
                  <td style={{ padding: '0.4rem 0.5rem', fontSize: '0.78rem' }} className="cell-center">
                    <span className={`health-badge ${healthColor}`} style={{ fontSize: '0.72rem', padding: '0.15rem 0.4rem' }}>
                      {site.healthScore === 'Data Not Available' || site.healthScore === null ? 'N/A' : `${site.healthScore} (${site.healthLabel})`}
                    </span>
                  </td>
                  <td style={{ padding: '0.4rem 0.5rem', fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={site.primaryRca}>
                    {site.primaryRca === 'Data Not Available' || !site.primaryRca
                      ? <span className="na-text">None</span>
                      : site.primaryRca}
                  </td>
                  <td style={{ padding: '0.4rem 0.5rem', fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={site.primaryRcaForAPs}>
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
