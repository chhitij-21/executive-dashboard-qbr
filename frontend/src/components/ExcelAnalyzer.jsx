// frontend/src/components/ExcelAnalyzer.jsx
import React, { useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL, apiFetch } from '../config/api';

export default function ExcelAnalyzer() {
  const { user } = useAuth();
  const [file, setFile] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState(null);
  const [activeSheetTab, setActiveSheetTab] = useState(0);

  const fileInputRef = useRef(null);

  const handleFileSelect = (e) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError(null);
      setAnalysis(null);
    }
  };

  const handleRunAnalysis = async (e) => {
    e.preventDefault();
    if (!file) {
      setError('Please select an Excel (.xlsx, .xls) or CSV (.csv) file to analyze.');
      return;
    }

    setAnalyzing(true);
    setError(null);

    const form = new FormData();
    form.append('excel', file);

    try {
      const res = await apiFetch(`${API_BASE_URL}/api/analyze-excel`, {
        method: 'POST',
        body: form,
      });

      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to analyze Excel file.');
        setAnalyzing(false);
        return;
      }

      setAnalysis(json.analysis);
      setActiveSheetTab(0);
    } catch (err) {
      console.error('AI Excel Analysis Error:', err);
      setError('Network or server error during AI analysis. Please verify your file.');
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="card pad-lg" style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <div className="section-header" style={{ marginBottom: '1.5rem' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            🤖 AI Excel Schema & Structure Analyzer
          </h2>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
            Upload any Excel (.xlsx, .xls) or CSV report to inspect its schema, column mappings, sheet roles, data health, and summary analytics.
          </p>
        </div>
      </div>

      {/* File Upload Zone */}
      <form onSubmit={handleRunAnalysis} style={{ marginBottom: '2rem' }}>
        <div
          className="drop-zone"
          style={{
            border: '2px dashed var(--border-color)',
            borderRadius: '12px',
            padding: '2rem',
            textAlign: 'center',
            background: 'var(--bg-secondary)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
          />

          <span style={{ fontSize: '2.5rem', display: 'block', marginBottom: '0.75rem' }}>📊</span>
          <h4 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem', fontWeight: 600 }}>
            {file ? file.name : 'Select or Drag & Drop Any Excel / CSV File'}
          </h4>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            {file ? `${(file.size / 1024 / 1024).toFixed(2)} MB • Ready for AI Audit` : 'Supports multi-sheet workbooks, raw ticket logs, and inventory files'}
          </p>
        </div>

        {error && (
          <div className="alert-box alert-danger" style={{ marginTop: '1rem' }}>
            ⚠️ {error}
          </div>
        )}

        <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
          {file && (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => {
                setFile(null);
                setAnalysis(null);
                setError(null);
              }}
            >
              ✕ Clear Selection
            </button>
          )}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={analyzing || !file}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1.5rem', fontWeight: 600 }}
          >
            {analyzing ? (
              <>
                <div className="spinner" style={{ width: 16, height: 16, border: '2px solid white', borderTopColor: 'transparent', borderRadius: '50%' }} />
                <span>Running AI Audit...</span>
              </>
            ) : (
              <>
                <span>🤖 Run AI Schema Audit</span>
              </>
            )}
          </button>
        </div>
      </form>

      {/* Analysis Results Display */}
      {analysis && (
        <div className="analysis-results" style={{ animation: 'fadeIn 0.3s ease' }}>
          <div className="alert-box alert-success" style={{ marginBottom: '1.5rem', background: '#e6fffa', color: '#234e52', borderColor: '#b2f5ea' }}>
            ✨ <strong>AI Analysis Complete</strong> • Audited {analysis.fileName} ({analysis.fileSizeMB}) across {analysis.totalSheets} sheet(s).
          </div>

          {/* Metadata Cards Grid */}
          <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
            <div className="kpi-card card">
              <span className="kpi-label">Analyzed File</span>
              <span className="kpi-value" style={{ fontSize: '1.1rem' }}>{analysis.fileName}</span>
            </div>
            <div className="kpi-card card">
              <span className="kpi-label">Total Worksheets</span>
              <span className="kpi-value">{analysis.totalSheets}</span>
            </div>
            <div className="kpi-card card">
              <span className="kpi-label">Total Rows Analyzed</span>
              <span className="kpi-value">{analysis.metricsSummary.totalRowsAnalyzed}</span>
            </div>
            <div className="kpi-card card">
              <span className="kpi-label">Parsed Incidents</span>
              <span className="kpi-value">{analysis.metricsSummary.parsedIncidentsCount}</span>
            </div>
            <div className="kpi-card card">
              <span className="kpi-label">Unique Devices</span>
              <span className="kpi-value">{analysis.metricsSummary.uniqueDevicesCount}</span>
            </div>
          </div>

          {/* Detected Sheet Roles */}
          <div className="card pad-md" style={{ marginBottom: '1.5rem', background: 'var(--bg-secondary)' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.75rem' }}>🎯 AI Detected Sheet Roles</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
              <div>
                <strong>Primary Incident Log:</strong> <span style={{ color: 'var(--accent-color)' }}>{analysis.detectedRoles.incidentSheet || 'None'}</span>
              </div>
              <div>
                <strong>Uptime Summary Sheet:</strong> <span style={{ color: 'var(--accent-color)' }}>{analysis.detectedRoles.uptimeSheet || 'Dynamic Calc'}</span>
              </div>
              <div>
                <strong>Location/Inventory Sheets:</strong> <span style={{ color: 'var(--accent-color)' }}>{analysis.detectedRoles.locationSheets.length} sheet(s)</span>
              </div>
            </div>
          </div>

          {/* Column Mappings Table */}
          <div className="card pad-md" style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.75rem' }}>🔍 Resolved Column Schema Mappings</h3>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Standard Metric Field</th>
                  <th>Source File Column Header</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {analysis.columnMappings.map((m, idx) => (
                  <tr key={idx}>
                    <td><strong>{m.field}</strong></td>
                    <td><code>{m.mappedColumn}</code></td>
                    <td>
                      {m.mappedColumn !== 'N/A' && m.mappedColumn !== 'Auto-Generated' ? (
                        <span className="badge badge-success" style={{ background: '#d4edda', color: '#155724', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>✓ Mapped</span>
                      ) : (
                        <span className="badge badge-warning" style={{ background: '#fff3cd', color: '#856404', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>⚠ Fallback</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* RCA Distribution Preview */}
          {analysis.metricsSummary.topRcaBreakdown.length > 0 && (
            <div className="card pad-md" style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.75rem' }}>📊 Primary Root Cause Breakdown</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>RCA Category</th>
                    <th>Incident Count</th>
                    <th>Percentage</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.metricsSummary.topRcaBreakdown.map((r, i) => (
                    <tr key={i}>
                      <td><strong>{r.rca}</strong></td>
                      <td>{r.count}</td>
                      <td>{r.pct}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Sheet Inspector Tabs */}
          <div className="card pad-md">
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.75rem' }}>📑 Worksheet Inspector</h3>
            <div className="dash-tabs" style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {analysis.sheetsInfo.map((s, idx) => (
                <button
                  key={idx}
                  className={`dash-tab ${activeSheetTab === idx ? 'active' : ''}`}
                  onClick={() => setActiveSheetTab(idx)}
                >
                  {s.sheetName} ({s.rowCount} rows)
                </button>
              ))}
            </div>

            {analysis.sheetsInfo[activeSheetTab] && (
              <div>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                  Sheet <strong>{analysis.sheetsInfo[activeSheetTab].sheetName}</strong> has {analysis.sheetsInfo[activeSheetTab].columnCount} columns: <code>{analysis.sheetsInfo[activeSheetTab].columns.join(', ')}</code>
                </p>
                <h4>Sample Data Preview (First 3 Rows)</h4>
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        {analysis.sheetsInfo[activeSheetTab].columns.map((col, idx) => (
                          <th key={idx}>{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.sheetsInfo[activeSheetTab].sampleRows.map((row, rIdx) => (
                        <tr key={rIdx}>
                          {analysis.sheetsInfo[activeSheetTab].columns.map((col, cIdx) => (
                            <td key={cIdx}>{String(row[col] ?? '')}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
