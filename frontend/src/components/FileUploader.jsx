// frontend/src/components/FileUploader.jsx
import React, { useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';

export default function FileUploader({ onJobStarted, onJobCompleted }) {
  const { user, clients, activeClient, activeLocation, setActiveClient, setActiveLocation, isAdmin } = useAuth();

  const [incidentFile, setIncidentFile] = useState(null);
  const [inventoryFile, setInventoryFile] = useState(null);
  const [reportPeriod, setReportPeriod] = useState('Q1 FY2026 (7 Apr – 6 Jul 2026)');

  const [status, setStatus] = useState('idle'); // idle, validating, processing, failed, completed
  const [validationErrors, setValidationErrors] = useState([]);
  const [validationWarnings, setValidationWarnings] = useState([]);
  const [errorMsg, setErrorMsg] = useState(null);
  const [currentJobId, setCurrentJobId] = useState(null);

  const incidentRef = useRef(null);
  const inventoryRef = useRef(null);

  const handleIncidentSelect = (e) => {
    if (e.target.files && e.target.files[0]) {
      setIncidentFile(e.target.files[0]);
      setValidationErrors([]);
    }
  };

  const handleInventorySelect = (e) => {
    if (e.target.files && e.target.files[0]) {
      setInventoryFile(e.target.files[0]);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!incidentFile) {
      setValidationErrors(['Mandatory Incidents Excel file must be uploaded.']);
      return;
    }

    setValidationErrors([]);
    setValidationWarnings([]);
    setErrorMsg(null);
    setStatus('processing');

    const form = new FormData();
    form.append('incidents', incidentFile);
    if (inventoryFile) form.append('inventory', inventoryFile);
    form.append('clientId', activeClient?.id || 'client-jfl');
    form.append('location', activeLocation || 'All Locations');
    form.append('reportPeriod', reportPeriod);
    form.append('uploadedBy', user?.name || 'System User');

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      const json = await res.json();

      if (!res.ok) {
        setStatus('failed');
        if (json.validationErrors) {
          setValidationErrors(json.validationErrors);
          setValidationWarnings(json.validationWarnings || []);
        } else {
          setErrorMsg(json.error || 'Upload failed');
        }
        return;
      }

      setCurrentJobId(json.jobId);
      if (onJobStarted) onJobStarted(json.jobId);
    } catch (err) {
      setStatus('failed');
      setErrorMsg(err.message);
    }
  };

  return (
    <div className="upload-container">
      <div className="card hero-upload-card">
        <div className="card-header">
          <div>
            <h2 className="card-title">🚀 QBR Report Generation Workflow</h2>
            <p className="card-subtitle">
              Upload client incidents and inventory workbooks. The non-interfering processing engine will generate executive KPIs and PowerPoint reports without altering raw data.
            </p>
          </div>
          <div className="privacy-badge">
            🔒 <strong>Zero Storage Policy:</strong> Raw Excel data is deleted immediately post-processing.
          </div>
        </div>

        {/* Workflow Steps Indicator */}
        <div className="workflow-steps">
          <div className={`step-item ${activeClient ? 'step-done' : 'step-active'}`}>
            <span className="step-num">1</span>
            <span className="step-label">Select Client</span>
          </div>
          <div className={`step-item ${activeLocation ? 'step-done' : ''}`}>
            <span className="step-num">2</span>
            <span className="step-label">Select Location</span>
          </div>
          <div className={`step-item ${incidentFile ? 'step-done' : 'step-active'}`}>
            <span className="step-num">3</span>
            <span className="step-label">Upload Excel</span>
          </div>
          <div className={`step-item ${status === 'completed' ? 'step-done' : ''}`}>
            <span className="step-num">4</span>
            <span className="step-label">Generate QBR</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="upload-form">
          {/* Target Context Summary Row */}
          <div className="form-row-context">
            <div className="context-card">
              <label>CLIENT TARGET</label>
              {isAdmin ? (
                <select
                  value={activeClient?.id || ''}
                  onChange={(e) => {
                    const c = clients.find((item) => item.id === e.target.value);
                    if (c) setActiveClient(c);
                  }}
                  className="select-field"
                >
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.logo} {c.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="context-value">
                  {activeClient?.logo} {activeClient?.name}
                </div>
              )}
            </div>

            <div className="context-card">
              <label>LOCATION ISOLATION</label>
              <select
                value={activeLocation}
                onChange={(e) => setActiveLocation(e.target.value)}
                className="select-field"
              >
                {(activeClient?.locations || ['All Locations']).map((loc) => (
                  <option key={loc} value={loc}>
                    📍 {loc}
                  </option>
                ))}
              </select>
            </div>

            <div className="context-card">
              <label>REPORTING PERIOD</label>
              <input
                type="text"
                value={reportPeriod}
                onChange={(e) => setReportPeriod(e.target.value)}
                className="input-field"
                placeholder="e.g. Q1 FY2026"
              />
            </div>
          </div>

          {/* Validation Errors Alert Box */}
          {validationErrors.length > 0 && (
            <div className="alert-box alert-error">
              <h4>❌ Pre-Upload Validation Errors</h4>
              <ul>
                {validationErrors.map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
              <p className="alert-hint">Processing stopped. Please correct the Excel file before retrying.</p>
            </div>
          )}

          {errorMsg && (
            <div className="alert-box alert-error">
              ⚠️ {errorMsg}
            </div>
          )}

          {/* Dropzone File Upload Grid */}
          <div className="dropzone-grid">
            {/* Incident File Dropzone */}
            <div
              className={`dropzone-card mandatory ${incidentFile ? 'file-loaded' : ''}`}
              onClick={() => incidentRef.current?.click()}
            >
              <input
                type="file"
                ref={incidentRef}
                accept=".xlsx,.xls"
                onChange={handleIncidentSelect}
                style={{ display: 'none' }}
              />
              <div className="dropzone-icon">📁</div>
              <div className="dropzone-title">Incident Excel File (Mandatory)</div>
              <div className="dropzone-desc">
                {incidentFile ? (
                  <span className="file-name">✅ {incidentFile.name} ({(incidentFile.size / 1024).toFixed(1)} KB)</span>
                ) : (
                  <span>Click to select or drop <code>jfl incidents.xlsx</code></span>
                )}
              </div>
              <span className="badge-required">REQUIRED</span>
            </div>

            {/* Inventory File Dropzone */}
            <div
              className={`dropzone-card optional ${inventoryFile ? 'file-loaded' : ''}`}
              onClick={() => inventoryRef.current?.click()}
            >
              <input
                type="file"
                ref={inventoryRef}
                accept=".xlsx,.xls"
                onChange={handleInventorySelect}
                style={{ display: 'none' }}
              />
              <div className="dropzone-icon">📋</div>
              <div className="dropzone-title">Device Inventory File (Optional)</div>
              <div className="dropzone-desc">
                {inventoryFile ? (
                  <span className="file-name">✅ {inventoryFile.name} ({(inventoryFile.size / 1024).toFixed(1)} KB)</span>
                ) : (
                  <span>Click to select or drop <code>JFL Updated Inventory.xlsx</code></span>
                )}
              </div>
              <span className="badge-optional">OPTIONAL</span>
            </div>
          </div>

          {/* Submit Action Bar */}
          <div className="action-bar">
            <button
              type="submit"
              className="btn-primary btn-hero"
              disabled={status === 'processing' || !incidentFile}
            >
              {status === 'processing' ? (
                <>⏳ Running Processing Engine...</>
              ) : (
                <>⚡ Validate & Generate QBR Reports</>
              )}
            </button>
          </div>
        </form>

        {/* Processing Spinner / Progress Bar */}
        {status === 'processing' && (
          <div className="processing-indicator">
            <div className="spinner"></div>
            <div className="processing-text">
              <h4>Processing Report for {activeClient?.name} ({activeLocation})</h4>
              <p>Parsing Excel data • Applying rule engine • Calculating KPIs • Building PowerPoint slides</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
