import React from 'react';

/**
 * SiteSummaryTable — per-site breakdown table with health badges and primary RCA for APs.
 */
export default function SiteSummaryTable({ sites }) {
  if (!sites || sites.length === 0) {
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
              <th>AP Incidents (Unique APs)</th>
              <th>Overall Uptime</th>
              <th>Incident-Free %</th>
              <th>Health Score</th>
              <th>Primary RCA (All)</th>
              <th>Primary RCA for APs</th>
            </tr>
          </thead>
          <tbody>
            {sites.map((site, i) => {
              const healthNum = parseFloat(site.healthScore);
              const healthColor =
                isNaN(healthNum) ? '' :
                healthNum >= 95 ? 'health-excellent' :
                healthNum >= 85 ? 'health-good' :
                healthNum >= 70 ? 'health-fair' : 'health-poor';

              return (
                <tr key={i}>
                  <td><strong>{site.siteId}</strong></td>
                  <td className="cell-center">{site.deviceCount}</td>
                  <td className="cell-center">{site.switchCount}</td>
                  <td className="cell-center">{site.apCount}</td>
                  <td className="cell-center">
                    {site.switchUptime === 'Data Not Available' || site.switchUptime === null
                      ? <span className="na-text">N/A</span>
                      : `${site.switchUptime}%`}
                  </td>
                  <td className="cell-center">{site.uniqueAPsWithIncidents}</td>
                  <td className="cell-center">
                    {site.overallUptime === 'Data Not Available' || site.overallUptime === null
                      ? <span className="na-text">N/A</span>
                      : `${site.overallUptime}%`}
                  </td>
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
