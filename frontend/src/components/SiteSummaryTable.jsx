import React from 'react';

/**
 * SiteSummaryTable — Executive overview table displaying high-level operational KPIs.
 * Features 100% responsive column width without horizontal scrolling.
 */
export default function SiteSummaryTable({ sites, selectedSite, onSelectSite }) {
  const isGenericLocation = (loc) => {
    if (!loc) return true;
    const str = String(loc).trim().toLowerCase();
    if (['unknown', 'sheet1', 'sheet 1', 'raw', 'jfl', 'sla_compliance_report', 'sla compliance report', 'all location', 'all locations', 'n/a', 'none', 'null'].includes(str)) return true;
    if (/^raw/i.test(str) || /^sheet/i.test(str) || /^sla/i.test(str) || /^jfl/i.test(str) || /^incident/i.test(str)) return true;
    if (str.includes('sla_compliance') || str.includes('sla compliance') || str.includes('july') || str.includes('august') || str.includes('september') || str.includes('report') || str.includes('compliance')) return true;
    const validSites = ['bangalore', 'greater noida', 'guwahati', 'hyderabad', 'mohali', 'mumbai', 'nagpur', 'noida'];
    const norm = str.replace(/[^a-z0-9]/g, '');
    const isMatched = validSites.some(v => v.replace(/[^a-z0-9]/g, '') === norm || norm.includes(v.replace(/[^a-z0-9]/g, '')));
    return !isMatched;
  };

  const filteredSites = (sites || []).filter(site => {
    const name = String(site.siteId || '').trim();
    return !isGenericLocation(name);
  });

  if (!filteredSites || filteredSites.length === 0) {
    return (
      <div className="empty-state" style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-secondary)' }}>No site overview data available.</p>
      </div>
    );
  }

  return (
    <div className="data-table-container" style={{ overflow: 'visible' }}>
      <div className="table-scroll-wrapper" style={{ overflowX: 'auto', overflowY: 'visible', width: '100%' }}>
        <table className="data-table site-summary-master-table" style={{ width: '100%', minWidth: '1150px', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ width: '11%', padding: '0.6rem 0.5rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>Site</th>
              <th style={{ width: '5%', padding: '0.6rem 0.4rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }} className="cell-center">Devices</th>
              <th style={{ width: '5%', padding: '0.6rem 0.4rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }} className="cell-center">Switches</th>
              <th style={{ width: '5%', padding: '0.6rem 0.4rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }} className="cell-center">APs</th>
              <th style={{ width: '11%', padding: '0.6rem 0.5rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }} className="cell-center">Proactive Switch Uptime</th>
              <th style={{ width: '11%', padding: '0.6rem 0.5rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }} className="cell-center">JFL Switch Uptime</th>
              <th style={{ width: '10%', padding: '0.6rem 0.5rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }} className="cell-center">AP Incidents (Unique)</th>
              <th style={{ width: '9%', padding: '0.6rem 0.4rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }} className="cell-center">Incident-Free %</th>
              <th style={{ width: '11%', padding: '0.6rem 0.5rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }} className="cell-center">Health Score</th>
              <th style={{ width: '11%', padding: '0.6rem 0.5rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>Primary RCA (Switches)</th>
              <th style={{ width: '11%', padding: '0.6rem 0.5rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>Primary RCA (APs)</th>
            </tr>
          </thead>
          <tbody>
            {filteredSites.map((site, i) => {
              const isSelected = selectedSite === site.siteId;
              const proUp = site.proactiveSwitchUptime ? `${site.proactiveSwitchUptime}` : `${site.switchUptime || '100.00'}`;
              const jflUp = site.jflSwitchUptime ? `${site.jflSwitchUptime}` : `${site.switchUptime || '100.00'}`;
              const swRca = site.primaryRca && site.primaryRca !== 'None' ? site.primaryRca : 'Not case received';
              const apRca = site.primaryRcaForAPs && site.primaryRcaForAPs !== 'None' ? site.primaryRcaForAPs : 'Not case received';

              const healthNum = parseFloat(site.healthScore);
              const healthColorClass =
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
                  <td style={{ padding: '0.55rem 0.5rem', fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={site.siteId}>
                    <strong>{site.siteId}</strong>
                  </td>
                  <td style={{ padding: '0.55rem 0.4rem', fontSize: '0.8rem' }} className="cell-center">{site.deviceCount}</td>
                  <td style={{ padding: '0.55rem 0.4rem', fontSize: '0.8rem' }} className="cell-center">{site.switchCount}</td>
                  <td style={{ padding: '0.55rem 0.4rem', fontSize: '0.8rem' }} className="cell-center">{site.apCount}</td>
                  <td style={{ padding: '0.55rem 0.5rem', fontSize: '0.8rem' }} className="cell-center">
                    <strong style={{ color: '#2563eb' }}>{proUp}%</strong>
                  </td>
                  <td style={{ padding: '0.55rem 0.5rem', fontSize: '0.8rem' }} className="cell-center">
                    <strong style={{ color: '#16a34a' }}>{jflUp}%</strong>
                  </td>
                  <td style={{ padding: '0.55rem 0.5rem', fontSize: '0.8rem' }} className="cell-center">
                    <strong>{site.apIncidents ?? 0}</strong> ({site.uniqueAPsWithIncidents ?? 0})
                  </td>
                  <td style={{ padding: '0.55rem 0.4rem', fontSize: '0.8rem' }} className="cell-center">
                    {site.incidentFreePercent === 'Data Not Available' || site.incidentFreePercent === null
                      ? <span className="na-text">N/A</span>
                      : `${site.incidentFreePercent}%`}
                  </td>
                  <td style={{ padding: '0.55rem 0.5rem', fontSize: '0.8rem' }} className="cell-center">
                    <span className={`health-badge ${healthColorClass}`} style={{ fontSize: '0.72rem', padding: '0.15rem 0.45rem', whiteSpace: 'nowrap' }}>
                      {site.healthScore === 'Data Not Available' || site.healthScore === null ? 'N/A' : `${site.healthScore} (${site.healthLabel})`}
                    </span>
                  </td>
                  <td style={{ padding: '0.55rem 0.5rem', fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }} title={swRca}>
                    {swRca}
                  </td>
                  <td style={{ padding: '0.55rem 0.5rem', fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }} title={apRca}>
                    {apRca}
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
