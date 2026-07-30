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
      <div className="table-scroll-no-vertical" style={{ overflowX: 'auto', overflowY: 'visible', maxHeight: 'none' }}>
        <table className="data-table site-summary-master-table">
          <thead>
            <tr>
              <th style={{ padding: '0.6rem 0.75rem', fontSize: '0.8rem' }}>Site / Location</th>
              <th style={{ padding: '0.6rem 0.75rem', fontSize: '0.8rem' }} className="cell-center">Devices</th>
              <th style={{ padding: '0.6rem 0.75rem', fontSize: '0.8rem' }} className="cell-center">Switches</th>
              <th style={{ padding: '0.6rem 0.75rem', fontSize: '0.8rem' }} className="cell-center">APs</th>
              <th style={{ padding: '0.6rem 0.75rem', fontSize: '0.8rem' }} className="cell-center">Switch Uptime</th>
              <th style={{ padding: '0.6rem 0.75rem', fontSize: '0.8rem' }} className="cell-center">Site Tickets</th>
              <th style={{ padding: '0.6rem 0.75rem', fontSize: '0.8rem' }} className="cell-center">AP Incidents (Unique)</th>
              <th style={{ padding: '0.6rem 0.75rem', fontSize: '0.8rem' }} className="cell-center">Incident-Free %</th>
              <th style={{ padding: '0.6rem 0.75rem', fontSize: '0.8rem' }} className="cell-center">Health Score</th>
              <th style={{ padding: '0.6rem 0.75rem', fontSize: '0.8rem' }}>Primary RCA (All)</th>
              <th style={{ padding: '0.6rem 0.75rem', fontSize: '0.8rem' }}>Primary RCA for APs</th>
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
                  <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.82rem' }}><strong>🏢 {site.siteId}</strong></td>
                  <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.82rem' }} className="cell-center">{site.deviceCount}</td>
                  <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.82rem' }} className="cell-center">{site.switchCount}</td>
                  <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.82rem' }} className="cell-center">{site.apCount}</td>
                  <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.82rem' }} className="cell-center">
                    {site.switchUptime === 'Data Not Available' || site.switchUptime === null
                      ? <span className="na-text">N/A</span>
                      : `${site.switchUptime}%`}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.82rem' }} className="cell-center">
                    <span style={{
                      padding: '0.2rem 0.55rem',
                      borderRadius: '12px',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      background: site.incidentCount > 0 ? 'rgba(220, 38, 38, 0.12)' : 'rgba(22, 163, 74, 0.12)',
                      color: site.incidentCount > 0 ? '#dc2626' : '#16a34a',
                      border: `1px solid ${site.incidentCount > 0 ? 'rgba(220, 38, 38, 0.3)' : 'rgba(22, 163, 74, 0.3)'}`
                    }}>
                      🎟️ {site.incidentCount ?? 0} Tickets
                    </span>
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.82rem' }} className="cell-center">{site.apIncidents ?? 0} ({site.uniqueAPsWithIncidents ?? 0})</td>
                  <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.82rem' }} className="cell-center">
                    {site.incidentFreePercent === 'Data Not Available' || site.incidentFreePercent === null
                      ? <span className="na-text">N/A</span>
                      : `${site.incidentFreePercent}%`}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.82rem' }} className="cell-center">
                    <span className={`health-badge ${healthColor}`}>
                      {site.healthScore === 'Data Not Available' || site.healthScore === null ? 'N/A' : `${site.healthScore} (${site.healthLabel})`}
                    </span>
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.82rem' }} title={site.primaryRca}>
                    {site.primaryRca === 'Data Not Available' || !site.primaryRca
                      ? <span className="na-text">None</span>
                      : site.primaryRca}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.82rem' }} title={site.primaryRcaForAPs}>
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
