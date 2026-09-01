import React, { useState } from 'react';

/**
 * DataTable — sortable, scrollable table with "Data Not Available" fallback.
 * Each cell shows its source as a tooltip (from row.__source).
 */
const COLUMN_HEADER_MAP = {
  site: 'Site Name',
  rack: 'Rack Number',
  deviceCount: 'Switch Count',
  monthlyUptime: 'Monthly Uptime %',
  quarterlyUptime: 'Quarterly Uptime %',
  avgUptime: 'Average Uptime %',
  minUptime: 'Min Uptime %',
  maxUptime: 'Max Uptime %',
  DeviceID: 'Device / Hostname',
  SerialNo: 'Serial Number',
  serialNumbers: 'Serial Number',
  ReplacedSerial: 'Faulty / Replaced Serial',
  Location: 'Site Location',
  CoreNonCore: 'Switch Type',
  uptime: 'Effective Uptime %',
  incCount: 'Incidents',
  rca: 'Root Cause',
  category: 'RCA Category',
  count: 'Count',
  percentage: '%',
  periodUptime: 'Monthly Uptime %',
  status: 'Operating Status',
  slaTarget: 'SLA Target %',
  gap: 'Gap %',
  siteId: 'Site',
};

export default function DataTable({ columns, rows, title, noScroll = false, columnLabels = {} }) {
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 15;

  const handleSort = (col) => {
    if (sortCol === col) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
    setPage(0);
  };

  const sorted = [...(rows || [])].sort((a, b) => {
    if (!sortCol) return 0;
    const av = a[sortCol] ?? '';
    const bv = b[sortCol] ?? '';
    const aNum = parseFloat(av);
    const bNum = parseFloat(bv);
    if (!isNaN(aNum) && !isNaN(bNum)) {
      return sortDir === 'asc' ? aNum - bNum : bNum - aNum;
    }
    return sortDir === 'asc'
      ? String(av).localeCompare(String(bv))
      : String(bv).localeCompare(String(av));
  });

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const visible = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="data-table-container">
      {title && <h4 className="table-title">{title}</h4>}
      <div className={noScroll ? '' : 'table-scroll'}>
        <table className={`data-table${noScroll ? ' no-scroll' : ''}`}>
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col}
                  onClick={() => handleSort(col)}
                  className={sortCol === col ? 'sorted' : ''}
                  title={`Sort by ${columnLabels[col] || COLUMN_HEADER_MAP[col] || col}`}
                >
                  {columnLabels[col] || COLUMN_HEADER_MAP[col] || col}
                  <span className="sort-icon">
                    {sortCol === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="no-data">
                  Data Not Available
                </td>
              </tr>
            ) : (
              visible.map((row, i) => (
                <tr key={i} className={row.__slaBreach ? 'row-breach' : ''}>
                  {columns.map((col) => {
                    let val = row[col];
                    if (val === null || val === undefined) {
                      if (col === 'periodUptime') {
                        val = row.periodUptime ?? row.monthlyUptime ?? row.quarterlyUptime ?? row.avgUptime ?? row.uptime;
                      } else if (col === 'status') {
                        const upVal = parseFloat(row.periodUptime || row.monthlyUptime || row.quarterlyUptime || row.avgUptime || row.uptime || 100);
                        val = isNaN(upVal) || upVal >= 100 ? 'Stable Operations (100% Uptime)' : 'Operational';
                      }
                    }
                    const display = val === null || val === undefined ? 'Data Not Available' : String(val);
                    const source = row.__source?.[col] || '';
                    return (
                      <td key={col} title={source} className={display === 'Data Not Available' ? 'na-cell' : ''}>
                        {display}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="pagination">
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
            ‹ Prev
          </button>
          <span>
            Page {page + 1} of {totalPages} ({sorted.length} rows)
          </span>
          <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>
            Next ›
          </button>
        </div>
      )}
    </div>
  );
}
