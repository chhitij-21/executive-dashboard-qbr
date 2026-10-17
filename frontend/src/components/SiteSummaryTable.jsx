import React from 'react';
import { isGenericLocation } from '../utils/siteUtils';

/**
 * SiteSummaryTable — Executive overview table displaying high-level operational KPIs.
 * Features 100% responsive column width without horizontal scrolling.
 */
export default function SiteSummaryTable({ sites, selectedSite, onSelectSite, clientCode }) {
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

  const hasJflUptime = filteredSites.some(site => site.jflSwitchUptime !== null && site.jflSwitchUptime !== undefined);
  const uptimeColLabel = clientCode ? `${clientCode} Switch Uptime` : 'Client Switch Uptime';

  return (
    <div className="data-table-container" style={{ overflow: 'visible' }}>
      <div className="table-scroll-wrapper" style={{ overflowX: 'auto', overflowY: 'visible', width: '100%' }}>
        <table className="data-table site-summary-master-table" style={{ width: '100%', minWidth: hasJflUptime ? '1150px' : '980px', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ width: hasJflUptime ? '14%' : '16%', minWidth: '130px', padding: '0.6rem 0.5rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>Site</th>
              <th style={{ width: hasJflUptime ? '10%' : '12%', padding: '0.6rem 0.4rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }} className="cell-center">No of devices</th>
              <th style={{ width: hasJflUptime ? '14%' : '16%', padding: '0.6rem 0.5rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }} className="cell-center">Proactive Switch Uptime</th>
              {hasJflUptime && (
                <th style={{ width: '14%', padding: '0.6rem 0.5rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }} className="cell-center">{uptimeColLabel}</th>
              )}
              <th style={{ width: hasJflUptime ? '18%' : '22%', padding: '0.6rem 0.5rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>Primary RCA Driver (Switches)</th>
              <th style={{ width: hasJflUptime ? '12%' : '14%', padding: '0.6rem 0.5rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }} className="cell-center">AP Incidents (Unique)</th>
              <th style={{ width: hasJflUptime ? '18%' : '20%', padding: '0.6rem 0.5rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>Primary RCA Driver (AP)</th>
            </tr>
          </thead>
          <tbody>
            {filteredSites.map((site, i) => {
              const isSelected = selectedSite === site.siteId;
              const formatPct = (val) => {
                if (val === undefined || val === null) return '100';
                const str = String(val).replace('%', '').trim();
                const n = parseFloat(str);
                return isNaN(n) ? '100' : (n === 100 ? '100' : n.toFixed(2));
              };

              // SSOT uptime — aggregate over available minutes for the selected period
              // (AGENTS.md §3). Prefer the per-device switch uptime; the per-ticket
              // fallback is only used for legacy files where device uptime is absent.
              const proUp = formatPct(site.proactiveSwitchUptime ?? site.proactiveTicketAvg);
              const jflUp = formatPct(site.jflSwitchUptime ?? site.jflTicketAvg);

              const rawSwRca = site.primaryRcaSwitches || site.primaryRca;
              const rawApRca = site.primaryRcaAPs || site.primaryRcaForAPs;

              const hasSwInc = site.incidentCount > 0 || (site.switches && site.switches.some(d => d.__effectiveUptime < 100));
              const hasApInc = (site.apIncidents ?? 0) > 0;

              const swRca = rawSwRca && !['None', 'Not case received', 'N/A', ''].includes(rawSwRca)
                ? rawSwRca
                : 'Stable Operations (No Incidents)';

              const apRca = rawApRca && !['None', 'Not case received', 'N/A', ''].includes(rawApRca)
                ? rawApRca
                : 'Stable Operations (No Incidents)';

              const apIncDisplay = `${site.apIncidents ?? 0} / ${site.uniqueAPsWithIncidents ?? 0}`;

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
                  <td style={{ minWidth: '130px', padding: '0.55rem 0.5rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }} title={site.siteId}>
                    <strong>{site.siteId}</strong>
                  </td>
                  <td style={{ padding: '0.55rem 0.4rem', fontSize: '0.8rem' }} className="cell-center">{site.deviceCount}</td>
                  <td style={{ padding: '0.55rem 0.5rem', fontSize: '0.8rem' }} className="cell-center">
                    <strong style={{ color: '#2563eb' }}>{proUp}%</strong>
                  </td>
                  {hasJflUptime && (
                    <td style={{ padding: '0.55rem 0.5rem', fontSize: '0.8rem' }} className="cell-center">
                      <strong style={{ color: '#16a34a' }}>{jflUp}%</strong>
                    </td>
                  )}
                  <td style={{ padding: '0.55rem 0.5rem', fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '180px' }} title={swRca}>
                    {swRca}
                  </td>
                  <td style={{ padding: '0.55rem 0.5rem', fontSize: '0.8rem' }} className="cell-center">
                    <strong>{apIncDisplay}</strong>
                  </td>
                  <td style={{ padding: '0.55rem 0.5rem', fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '180px' }} title={apRca}>
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