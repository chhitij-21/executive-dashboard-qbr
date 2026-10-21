/**
 * frontend/src/components/ReportsView.jsx
 * MMTC Operational & SLA Reports Dashboard
 * Aligned with Client PPT Layout (Data + PPT UI + AI Fix)
 */

import React, { useState, useEffect } from 'react';
import API_BASE_URL, { getAuthHeaders } from '../config/api';
import { buildDeterministicSummary } from '../utils/reportHelpers';

function formatDowntime(val) {
  if (val === undefined || val === null || val === '') return '0.00';
  const num = typeof val === 'number' ? val : parseFloat(String(val).replace(/,/g, ''));
  if (isNaN(num)) return '0.00';
  return Number(num.toFixed(2)).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function ReportsView() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [execSummary, setExecSummary] = useState('');

  const fetchLatestReport = async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = {
        ...getAuthHeaders(),
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      };
      const res = await fetch(`${API_BASE_URL}/api/reports/mmtc/latest`, { headers });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setReport(data);
      setExecSummary(buildDeterministicSummary(data));
    } catch (err) {
      setError(err.message || 'Failed to load report.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLatestReport();
  }, []);

  const start = report?.meta?.start || '1 September 2026';
  const end = report?.meta?.end || '30 September 2026';
  const channel = report?.channel || {};
  const rcaList = Array.isArray(report?.rca_breakdown) ? report.rca_breakdown : [];
  const holdTickets = Array.isArray(report?.hold_tickets) ? report.hold_tickets : [];
  const crTickets = Array.isArray(report?.cr_tickets) ? report.cr_tickets : [];
  const crSummary = report?.cr_summary || {
    meraki_crs: crTickets.filter(c => /meraki/i.test(c.category)).length,
    security_crs: crTickets.filter(c => /security/i.test(c.category)).length,
    security_emails: channel.security_emails ?? 0,
    total_crs: crTickets.length,
  };

  return (
    <div className="report-view" style={{ padding: '1rem', maxWidth: '1400px', margin: '0 auto' }}>
      {/* ── 1. Header: Reporting Period: {start} to {end} (Large, bold) ── */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.875rem', fontWeight: 800, color: 'var(--text-primary, #111827)', margin: 0 }}>
          Reporting Period: {start} to {end}
        </h1>
      </div>

      {error && (
        <div style={{ padding: '1rem', marginBottom: '1.5rem', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
          {error}
        </div>
      )}

      {loading && !report && (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading reports data...
        </div>
      )}

      {/* ── 2. Channel KPIs: 4 Purple Boxes ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4" style={{ marginBottom: '2rem' }}>
        <div className="mmtc-purple-box">
          <h2>{channel.meraki_alerts ?? 0}</h2>
          <p>Meraki Alerts</p>
        </div>
        <div className="mmtc-purple-box">
          <h2>{channel.meraki_emails ?? 0}</h2>
          <p>Meraki Emails</p>
        </div>
        <div className="mmtc-purple-box">
          <h2>{channel.security_alerts ?? 0}</h2>
          <p>Security Alerts</p>
        </div>
        <div className="mmtc-purple-box">
          <h2>{channel.security_emails ?? 0}</h2>
          <p>Security Emails</p>
        </div>
      </div>

      {/* ── 3. RCA Table: .mmtc-table with RCA, No of Tickets, Downtime (in min) ── */}
      <div style={{ marginBottom: '2rem', overflowX: 'auto' }}>
        <table className="mmtc-table">
          <thead>
            <tr>
              <th>RCA</th>
              <th style={{ width: '25%' }}>No of Tickets</th>
              <th style={{ width: '30%' }}>Downtime (in min)</th>
            </tr>
          </thead>
          <tbody>
            {rcaList.length > 0 ? (
              rcaList.map((row, idx) => (
                <tr key={idx}>
                  <td style={{ fontWeight: 500 }}>{row.rca}</td>
                  <td>{row.tickets}</td>
                  <td>{formatDowntime(row.downtime_min)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="3" style={{ textAlign: 'center', padding: '1.5rem', color: '#6b7280' }}>
                  No RCA data available for this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── 4. Hold Table: Header 'Hold with Rollover Tickets' (purple block) ── */}
      <div style={{ marginBottom: '2rem', overflowX: 'auto' }}>
        <div style={{
          background: '#7b1c5a',
          color: 'white',
          padding: '12px 16px',
          borderRadius: '8px 8px 0 0',
          fontWeight: 700,
          fontSize: '1.05rem',
        }}>
          Hold with Rollover Tickets
        </div>
        <table className="mmtc-table" style={{ marginTop: 0 }}>
          <thead>
            <tr>
              <th style={{ width: '18%' }}>Ticket Num</th>
              <th style={{ width: '32%' }}>Subject</th>
              <th style={{ width: '24%' }}>Reason for Hold</th>
              <th style={{ width: '13%' }}>Rollover/Hold</th>
              <th style={{ width: '13%' }}>Created Date</th>
            </tr>
          </thead>
          <tbody>
            {holdTickets.length === 0 ? (
              <tr>
                <td colSpan="5" style={{ textAlign: 'center', padding: '1.5rem', color: '#6b7280' }}>
                  No On-Hold tickets found for this period.
                </td>
              </tr>
            ) : (
              holdTickets.map((row, idx) => (
                <tr key={idx}>
                  <td style={{ fontWeight: 500 }}>{row.ticket_number}</td>
                  <td>{row.subject}</td>
                  <td>{row.reason}</td>
                  <td>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      background: row.rollover === 'Rollover' ? '#fef3c7' : '#f3e8ff',
                      color: row.rollover === 'Rollover' ? '#92400e' : '#6b21a8',
                    }}>
                      {row.rollover}
                    </span>
                  </td>
                  <td>{row.created_date}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── 5. CR KPIs: 4 Purple Boxes (Meraki CRs, Security CRs, Security Email, Total CRs) ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4" style={{ marginBottom: '2rem' }}>
        <div className="mmtc-purple-box">
          <h2>{crSummary.meraki_crs ?? 0}</h2>
          <p>Meraki CRs</p>
        </div>
        <div className="mmtc-purple-box">
          <h2>{crSummary.security_crs ?? 0}</h2>
          <p>Security CRs</p>
        </div>
        <div className="mmtc-purple-box">
          <h2>{crSummary.security_emails ?? channel.security_emails ?? 0}</h2>
          <p>Security Email</p>
        </div>
        <div className="mmtc-purple-box">
          <h2>{crSummary.total_crs ?? crTickets.length}</h2>
          <p>Total CRs</p>
        </div>
      </div>

      {/* ── 6. CR Table: Header 'Meraki and Security Managed Services: CR Details' ── */}
      <div style={{ marginBottom: '2rem', overflowX: 'auto' }}>
        <div style={{
          background: '#7b1c5a',
          color: 'white',
          padding: '12px 16px',
          borderRadius: '8px 8px 0 0',
          fontWeight: 700,
          fontSize: '1.05rem',
        }}>
          Meraki and Security Managed Services: CR Details
        </div>
        <table className="mmtc-table" style={{ marginTop: 0 }}>
          <thead>
            <tr>
              <th style={{ width: '8%' }}>SNO.</th>
              <th style={{ width: '42%' }}>SUBJECT</th>
              <th style={{ width: '20%' }}>CATEGORY</th>
              <th style={{ width: '18%' }}>SUB-CATEGORY</th>
              <th style={{ width: '12%' }}>STATUS</th>
            </tr>
          </thead>
          <tbody>
            {crTickets.length === 0 ? (
              <tr>
                <td colSpan="5" style={{ textAlign: 'center', padding: '1.5rem', color: '#6b7280' }}>
                  No Change Requests found
                </td>
              </tr>
            ) : (
              crTickets.map((row, idx) => (
                <tr key={idx}>
                  <td>{row.s_no}</td>
                  <td style={{ fontWeight: 500 }}>{row.subject}</td>
                  <td>{row.category}</td>
                  <td>{row.sub_category}</td>
                  <td>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      background: '#dcfce7',
                      color: '#15803d',
                    }}>
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── 7. Executive Insight Box: .mmtc-insight-box with <h3>Executive Insight :</h3> and <p>{execSummary}</p> ── */}
      <div className="mmtc-insight-box">
        <h3 style={{ margin: '0 0 0.5rem 0', color: '#7b1c5a', fontWeight: 700 }}>
          Executive Insight :
        </h3>
        <p style={{ margin: 0, fontSize: '0.95rem', lineHeight: 1.6, color: '#1f2937' }}>
          {execSummary || 'No data to summarize for this range.'}
        </p>
      </div>
    </div>
  );
}
