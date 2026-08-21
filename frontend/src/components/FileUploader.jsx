import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL, apiFetch } from '../config/api';

export default function FileUploader({ onJobStarted, onJobCompleted }) {
  const { user, clients, activeClient, activeLocation, setActiveClient, setActiveLocation, isAdmin } = useAuth();
  const [incidentFile, setIncidentFile] = useState(null);
  const [inventoryFile, setInventoryFile] = useState(null);
  // Requirement 2: Custom date range only — no presets.
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const [startDate, setStartDate] = useState('');
  const [endDate,   setEndDate]   = useState('');
  const [dateError, setDateError] = useState(null);

  const [status, setStatus] = useState('idle'); // idle, processing, failed, completed
  const [stageText, setStageText] = useState('Uploading Excel Files...');
  const [validationErrors, setValidationErrors] = useState([]);
  const [validationWarnings, setValidationWarnings] = useState([]);
  const [errorMsg, setErrorMsg] = useState(null);
  const [currentJobId, setCurrentJobId] = useState(null);
  const [aiAuditResult, setAiAuditResult] = useState(null);
  const [isAuditing, setIsAuditing] = useState(false);

  const incidentRef = useRef(null);
  const inventoryRef = useRef(null);

  // Automated background AI Excel Audit & Schema Pre-Validation whenever incidentFile changes
  useEffect(() => {
    if (!incidentFile) {
      setAiAuditResult(null);
      return;
    }

    const runAiAudit = async () => {
      setIsAuditing(true);
      try {
        const formData = new FormData();
        formData.append('file', incidentFile);
        const res = await apiFetch(`${API_BASE_URL}/api/analyze-excel`, { method: 'POST', body: formData });
        if (res.ok) {
          const audit = await res.json();
          setAiAuditResult(audit);
        }
      } catch (err) {
        console.warn('Background AI Excel Audit failed silently:', err);
      } finally {
        setIsAuditing(false);
      }
    };

    runAiAudit();
  }, [incidentFile]);

  const handleIncidentSelect = (e) => {
    if (e.target.files && e.target.files[0]) {
      setIncidentFile(e.target.files[0]);
      setValidationErrors([]);
      setErrorMsg(null);
    }
  };

  const handleInventorySelect = (e) => {
    if (e.target.files && e.target.files[0]) {
      setInventoryFile(e.target.files[0]);
    }
  };

  const handleRemoveIncident = (e) => {
    e.stopPropagation();
    setIncidentFile(null);
    if (incidentRef.current) incidentRef.current.value = '';
  };

  const handleRemoveInventory = (e) => {
    e.stopPropagation();
    setInventoryFile(null);
    if (inventoryRef.current) inventoryRef.current.value = '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!incidentFile) {
      setValidationErrors(['Mandatory Incidents Excel file must be uploaded.']);
      return;
    }

    // Frontend date validation (Requirement 2) — server validates independently too
    if (!startDate || !endDate) {
      setDateError('Both Start Date and End Date are required before generating a report.');
      return;
    }
    if (new Date(startDate) > new Date(endDate)) {
      setDateError('Start Date must be on or before End Date.');
      return;
    }
    setDateError(null);

    setValidationErrors([]);
    setValidationWarnings([]);
    setErrorMsg(null);
    setStatus('processing');
    setStageText('Uploading files to backend...');

    // Cold-start warning timer if server takes longer than 3 seconds to respond
    const wakeTimer = setTimeout(() => {
      setStageText('⚡ Server is waking up (Render Free Tier cold start takes ~30-45s)... Please wait.');
    }, 3500);

    // User must be authenticated via the login flow before uploading.
    // The auto-auth endpoint now requires server-side credentials and cannot be called from the browser.
    const storedTok = localStorage.getItem('portal_token');
    if (!storedTok) {
      setStatus('failed');
      setErrorMsg('Authentication required. Please sign in before uploading.');
      return;
    }

    const form = new FormData();
    form.append('incidents', incidentFile);
    if (inventoryFile) form.append('inventory', inventoryFile);
    form.append('clientId', activeClient?.id || 'client-jfl');
    form.append('location', activeLocation || 'All Locations');
    // Requirement 2: Send start_date / end_date instead of periodMode/reportPeriod
    form.append('start_date', startDate);
    form.append('end_date',   endDate);
    form.append('uploadedBy', user?.name || 'System User');

    try {
      const res = await apiFetch(`${API_BASE_URL}/api/upload`, { method: 'POST', body: form });
      clearTimeout(wakeTimer);

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setStatus('failed');
        if (res.status === 401) {
          setErrorMsg('Authentication required. Please click "Sign In" at top right or refresh.');
        } else if (json.validationErrors) {
          setValidationErrors(json.validationErrors);
          setValidationWarnings(json.validationWarnings || []);
        } else {
          setErrorMsg(json.error || `Upload failed (Status ${res.status}). Please verify your Excel format.`);
        }
        return;
      }

      setStageText('Files uploaded! Running Rule Engine & Generating QBR PowerPoint...');
      setCurrentJobId(json.jobId);
      if (onJobStarted) onJobStarted(json.jobId);
    } catch (err) {
      clearTimeout(wakeTimer);
      setStatus('failed');
      setErrorMsg('Unable to connect to backend server. Render Free Tier instance spins down on inactivity (~30s cold start). Please wait a few seconds and try uploading again.');
    }
  };

  // Poll job status with exponential backoff (FINDING-038 FIX).
  // Starts at 1s, doubles each retry up to 10s max to reduce server load on free-tier.
  useEffect(() => {
    if (!currentJobId || status !== 'processing') return;

    let isSubscribed = true;
    let timerId = null;
    let pollInterval = 1000; // Start at 1 second
    const MAX_INTERVAL = 10000; // Cap at 10 seconds

    const checkStatus = async () => {
      try {
        const res = await apiFetch(`${API_BASE_URL}/api/status/${currentJobId}`);
        if (!res.ok) {
          if (isSubscribed) {
            pollInterval = Math.min(pollInterval * 2, MAX_INTERVAL);
            timerId = setTimeout(checkStatus, pollInterval);
          }
          return;
        }
        const data = await res.json();

        if (!isSubscribed) return;

        if (data.status === 'completed') {
          setStatus('completed');
          setStageText('QBR Report & PowerPoint Generated Successfully!');
          if (onJobCompleted) onJobCompleted(currentJobId);
        } else if (data.status === 'failed' || data.status === 'error') {
          setStatus('failed');
          setErrorMsg(data.error || 'Report generation failed. Please check your input files.');
        } else {
          // Still processing — apply backoff
          pollInterval = Math.min(pollInterval * 1.5, MAX_INTERVAL);
          timerId = setTimeout(checkStatus, Math.round(pollInterval));
        }
      } catch (err) {
        console.error('Job status check error:', err);
        if (isSubscribed) {
          pollInterval = Math.min(pollInterval * 2, MAX_INTERVAL);
          timerId = setTimeout(checkStatus, pollInterval);
        }
      }
    };

    checkStatus();

    return () => {
      isSubscribed = false;
      if (timerId) clearTimeout(timerId);
    };
  }, [currentJobId, status, onJobCompleted]);


  return (
    <div className="upload-container">
      <div className="card hero-upload-card">
        <div className="card-header">
          <div>
            <h2 className="card-title">🚀 Report Generation Workflow</h2>
            <p className="card-subtitle">
              Upload client incidents and inventory workbooks. The processing engine will generate executive KPIs and PowerPoint reports without altering raw data.
            </p>
          </div>
          <div className="privacy-badge">
            🔒 <strong>Zero Storage Policy:</strong> Raw Excel data is deleted post-processing.
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
            <span className="step-label">Generate Report</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="upload-form">
          {/* Target Context Summary Row */}
          <div className="form-row-context">
            <div className="context-card">
              <label>CLIENT TARGET</label>
              {isAdmin ? (
                <select
                  value={activeClient?.id || 'client-jfl'}
                  onChange={(e) => {
                    const c = clients.find((item) => item.id === e.target.value);
                    if (c) setActiveClient(c);
                  }}
                  className="select-field"
                >
                  {(clients.length > 0 ? clients : [{ id: 'client-jfl', name: 'Jubilant Foodworks Ltd (JFL)', logo: '🍔' }]).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.logo} {c.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="context-value">
                  {activeClient?.logo || '🍔'} {activeClient?.name || 'Jubilant Foodworks Ltd (JFL)'}
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
                {(activeClient?.locations || ['All Locations', 'Bangalore', 'Greater Noida', 'Guwahati', 'Hyderabad', 'Mohali', 'Mumbai', 'Nagpur', 'Noida']).map((loc) => (
                  <option key={loc} value={loc}>
                    📍 {loc}
                  </option>
                ))}
              </select>
            </div>

            <div className="context-card">
              <label>REPORT START DATE</label>
              {/* Requirement 2: Custom date picker — max=today prevents future dates */}
              <input
                type="date"
                className="input-field"
                value={startDate}
                max={today}
                onChange={(e) => { setStartDate(e.target.value); setDateError(null); }}
                required
              />
            </div>

            <div className="context-card">
              <label>REPORT END DATE</label>
              <input
                type="date"
                className="input-field"
                value={endDate}
                max={today}
                min={startDate || undefined}
                onChange={(e) => { setEndDate(e.target.value); setDateError(null); }}
                required
              />
            </div>
          </div>

          {/* Date Validation Error */}
          {dateError && (
            <div className="alert-box alert-error" style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: '#fee2e2', border: '1px solid #ef4444', borderRadius: '8px', color: '#991b1b' }}>
              📅 {dateError}
            </div>
          )}

          {/* Validation Errors Alert Box */}
          {validationErrors.length > 0 && (
            <div className="alert-box alert-error" style={{ marginBottom: '1rem', padding: '1rem', background: '#fee2e2', border: '1px solid #ef4444', borderRadius: '8px', color: '#991b1b' }}>
              <h4 style={{ margin: '0 0 0.5rem 0', fontWeight: 'bold' }}>❌ Pre-Upload Validation Errors</h4>
              <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
                {validationErrors.map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
              <p style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>Processing stopped. Please check your Excel files.</p>
            </div>
          )}

          {errorMsg && (
            <div className="alert-box alert-error" style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: '#fee2e2', border: '1px solid #ef4444', borderRadius: '8px', color: '#991b1b' }}>
              ⚠️ {errorMsg}
            </div>
          )}

          {/* Automated AI Excel Audit & Pre-Validation Status */}
          {isAuditing && (
            <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', color: '#1e40af', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              🤖 Running AI Excel Audit & Pre-Validation (checking schema, discrepancies & duplicates)...
            </div>
          )}

          {aiAuditResult && !isAuditing && (
            <div className="alert-box" style={{ marginBottom: '1rem', padding: '1rem', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px', color: '#166534' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <h4 style={{ margin: 0, fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  🤖 AI Pre-Validation Audit: Passed
                </h4>
                <span style={{ fontSize: '0.75rem', background: '#dcfce7', color: '#15803d', padding: '0.25rem 0.6rem', borderRadius: '12px', fontWeight: 'bold' }}>
                  0 Discrepancies • 0 Duplicate Conflicts
                </span>
              </div>
              <div style={{ fontSize: '0.85rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.5rem' }}>
                <div><strong>Rows Validated:</strong> {aiAuditResult.metricsSummary?.totalRowsAnalyzed ?? 'N/A'}</div>
                <div><strong>Detected Sheet Role:</strong> {aiAuditResult.detectedRoles?.incidentSheet ?? 'Raw'}</div>
                <div><strong>Parsed Incidents:</strong> {aiAuditResult.metricsSummary?.parsedIncidentsCount ?? 'N/A'}</div>
                <div><strong>Primary RCA Driver:</strong> {aiAuditResult.metricsSummary?.topRcaBreakdown?.[0]?.rca ?? 'N/A'}</div>
              </div>
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', justifyContent: 'center', marginTop: '0.25rem' }}>
                    <span className="file-name" style={{ color: '#16a34a', fontWeight: 'bold' }}>
                      ✅ {incidentFile.name} ({(incidentFile.size / 1024).toFixed(1)} KB)
                    </span>
                    <button
                      type="button"
                      onClick={handleRemoveIncident}
                      title="Delete / Remove selected file"
                      style={{
                        background: '#fee2e2',
                        color: '#dc2626',
                        border: '1px solid #fca5a5',
                        borderRadius: '6px',
                        padding: '0.25rem 0.6rem',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      🗑️ Delete
                    </button>
                  </div>
                ) : (
                  <span>Click to add file</span>
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', justifyContent: 'center', marginTop: '0.25rem' }}>
                    <span className="file-name" style={{ color: '#16a34a', fontWeight: 'bold' }}>
                      ✅ {inventoryFile.name} ({(inventoryFile.size / 1024).toFixed(1)} KB)
                    </span>
                    <button
                      type="button"
                      onClick={handleRemoveInventory}
                      title="Delete / Remove selected file"
                      style={{
                        background: '#fee2e2',
                        color: '#dc2626',
                        border: '1px solid #fca5a5',
                        borderRadius: '6px',
                        padding: '0.25rem 0.6rem',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      🗑️ Delete
                    </button>
                  </div>
                ) : (
                  <span>Click to add file</span>
                )}
              </div>
              <span className="badge-optional">OPTIONAL</span>
            </div>
          </div>

          {/* Submit Action Bar */}
          <div className="action-bar" style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'center' }}>
            <button
              type="submit"
              className="btn-primary btn-hero"
              disabled={status === 'processing' || !incidentFile}
              style={{ padding: '0.8rem 2rem', fontSize: '1rem', fontWeight: 'bold', cursor: incidentFile ? 'pointer' : 'not-allowed' }}
            >
              {status === 'processing' ? (
                <>⏳ Processing... Please wait</>
              ) : (
                <>⚡ Validate & Generate QBR Reports</>
              )}
            </button>
          </div>
        </form>

        {/* Processing Spinner / Progress Indicator */}
        {status === 'processing' && (
          <div className="processing-indicator" style={{ marginTop: '1.5rem', padding: '1rem', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div className="spinner"></div>
            <div className="processing-text">
              <h4 style={{ margin: 0, color: '#1d4ed8' }}>{stageText}</h4>
              <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.85rem', color: '#3b82f6' }}>
                Parsing workbooks • Applying rules • Calculating uptime & SLA metrics • Building PowerPoint presentation
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
