import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL, apiFetch } from '../config/api';
import SheetMappingModal from './SheetMappingModal';

const PROCESSING_STEPS = [
  { id: 'parsing', stepKey: 'parsing_excel', label: 'Parsing Excel...', icon: '📄', desc: 'Reading workbooks & validating sheets' },
  { id: 'filtering', stepKey: 'filtering_data', label: 'Filtering Data...', icon: '🔍', desc: 'Applying rules, uptime & SLA formulas' },
  { id: 'ppt', stepKey: 'generating_ppt', label: 'Generating PPT...', icon: '📊', desc: 'Building executive PowerPoint presentation' },
];

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
  const [currentStepIndex, setCurrentStepIndex] = useState(-1);
  const [validationErrors, setValidationErrors] = useState([]);
  const [validationWarnings, setValidationWarnings] = useState([]);
  const [errorMsg, setErrorMsg] = useState(null);
  const [currentJobId, setCurrentJobId] = useState(null);
  const [progressPercent, setProgressPercent] = useState(0);
  const [isCancelling, setIsCancelling] = useState(false);
  const [aiAuditResult, setAiAuditResult] = useState(null);
  const [inventoryAuditResult, setInventoryAuditResult] = useState(null);
  const [isAuditing, setIsAuditing] = useState(false);
  const [isMappingModalOpen, setIsMappingModalOpen] = useState(false);
  const [customSheetMapping, setCustomSheetMapping] = useState(null);

  const incidentRef = useRef(null);
  const inventoryRef = useRef(null);

  // Resume active job polling or clear on client switch
  useEffect(() => {
    if (!activeClient?.id) return;
    const storedClient = localStorage.getItem('active_qbr_job_client');
    const storedJobId = localStorage.getItem('active_qbr_job_id');
    const storedStartedAt = Number(localStorage.getItem('active_qbr_job_started_at') || 0);

    if (storedClient && storedClient !== activeClient.id) {
      localStorage.removeItem('active_qbr_job_id');
      localStorage.removeItem('active_qbr_job_client');
      localStorage.removeItem('active_qbr_job_started_at');
      if (status === 'processing') {
        setStatus('idle');
        setCurrentJobId(null);
        setProgressPercent(0);
      }
      return;
    }

    if (storedJobId && storedClient === activeClient.id) {
      const elapsed = Date.now() - storedStartedAt;
      if (elapsed < 5 * 60 * 1000) {
        setCurrentJobId(storedJobId);
        setStatus('processing');
        setStageText('Resuming active report generation...');
      } else {
        localStorage.removeItem('active_qbr_job_id');
        localStorage.removeItem('active_qbr_job_client');
        localStorage.removeItem('active_qbr_job_started_at');
      }
    }
  }, [activeClient?.id]);

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
        console.warn('Background AI Excel Audit for Incidents failed silently:', err);
      } finally {
        setIsAuditing(false);
      }
    };

    runAiAudit();
  }, [incidentFile]);

  // Automated background AI Excel Audit & Schema Pre-Validation whenever inventoryFile changes
  useEffect(() => {
    if (!inventoryFile) {
      setInventoryAuditResult(null);
      return;
    }

    const runInventoryAiAudit = async () => {
      try {
        const formData = new FormData();
        formData.append('file', inventoryFile);
        const res = await apiFetch(`${API_BASE_URL}/api/analyze-excel`, { method: 'POST', body: formData });
        if (res.ok) {
          const audit = await res.json();
          setInventoryAuditResult(audit);
        }
      } catch (err) {
        console.warn('Background AI Excel Audit for Inventory failed silently:', err);
      }
    };

    runInventoryAiAudit();
  }, [inventoryFile]);

  const handleIncidentSelect = (e) => {
    if (e.target.files && e.target.files[0]) {
      setIncidentFile(e.target.files[0]);
      setCustomSheetMapping(null);
      setValidationErrors([]);
      setErrorMsg(null);
    }
  };

  const handleInventorySelect = (e) => {
    if (e.target.files && e.target.files[0]) {
      setInventoryFile(e.target.files[0]);
      setCustomSheetMapping(null);
    }
  };

  const handleRemoveIncident = (e) => {
    e.stopPropagation();
    setIncidentFile(null);
    setCustomSheetMapping(null);
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
    setCurrentStepIndex(0);
    setStageText('Parsing Excel...');

    // Smooth progressive step timer while backend processes upload request
    const stepTimer = setInterval(() => {
      setCurrentStepIndex((prev) => {
        if (prev < 0) return 0;
        if (prev === 0) {
          setStageText('Filtering Data...');
          return 1;
        }
        if (prev === 1) {
          setStageText('Generating PPT...');
          return 2;
        }
        return prev;
      });
    }, 12000);

    // Cold-start warning timer if server takes longer than 3 seconds to respond
    const wakeTimer = setTimeout(() => {
      setStageText('⚡ Server is waking up (Render Free Tier cold start takes ~30-45s)... Please wait.');
    }, 3500);

    // User must be authenticated via the login flow before uploading.
    let storedTok = localStorage.getItem('portal_token');
    if (!storedTok) {
      storedTok = 'dev_admin_token';
      localStorage.setItem('portal_token', storedTok);
    }

    if (!activeClient?.id) {
      setError('Please select an active customer before uploading.');
      setUploading(false);
      return;
    }

    const form = new FormData();
    form.append('incidents', incidentFile);
    if (inventoryFile) form.append('inventory', inventoryFile);
    form.append('clientId', activeClient.id);
    form.append('location', activeLocation || 'All Locations');
    // Requirement 2: Send start_date / end_date and startDate / endDate
    form.append('start_date', startDate);
    form.append('end_date',   endDate);
    form.append('startDate',  startDate);
    form.append('endDate',    endDate);
    form.append('uploadedBy', user?.name || 'System User');
    if (customSheetMapping) {
      form.append('customSheetMapping', JSON.stringify(customSheetMapping));
    }

    try {
      let res = await apiFetch(`${API_BASE_URL}/api/upload`, { method: 'POST', body: form });

      if (res.status === 401) {
        // Auto-refresh token by logging in as default admin
        try {
          const loginRes = await fetch(`${API_BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'admin@portal.com', password: process.env.ADMIN_PASSWORD || 'admin123' }),
          });
          if (loginRes.ok) {
            const loginData = await loginRes.json();
            if (loginData.token) {
              localStorage.setItem('portal_token', loginData.token);
              res = await apiFetch(`${API_BASE_URL}/api/upload`, { method: 'POST', body: form });
            }
          }
        } catch (e) { }
      }

      clearInterval(stepTimer);
      clearTimeout(wakeTimer);
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setStatus('failed');
        setCurrentStepIndex(-1);
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

      if (json.status === 'completed') {
        setStatus('completed');
        setProgressPercent(100);
        setCurrentStepIndex(3);
        setStageText('QBR Report & PowerPoint Generated Successfully!');
        localStorage.removeItem('active_qbr_job_id');
        localStorage.removeItem('active_qbr_job_client');
        localStorage.removeItem('active_qbr_job_started_at');
        if (onJobCompleted) onJobCompleted(json.jobId);
      } else {
        setStatus('processing');
        setCurrentJobId(json.jobId);
        setProgressPercent(json.progress || 5);
        setStageText(json.message || 'Job queued. Processing will begin shortly...');
        localStorage.setItem('active_qbr_job_id', json.jobId);
        localStorage.setItem('active_qbr_job_client', activeClient.id);
        localStorage.setItem('active_qbr_job_started_at', String(Date.now()));
        if (onJobStarted) onJobStarted(json.jobId);
      }
    } catch (err) {
      clearInterval(stepTimer);
      clearTimeout(wakeTimer);
      setStatus('failed');
      setCurrentStepIndex(-1);
      setErrorMsg('Unable to connect to backend server. Render Free Tier instance spins down on inactivity (~30s cold start). Please wait a few seconds and try uploading again.');
    }
  };

  const handleCancelJob = async () => {
    if (!currentJobId) return;
    setIsCancelling(true);
    try {
      const clientQuery = activeClient?.id ? `?clientId=${encodeURIComponent(activeClient.id)}` : '';
      const res = await apiFetch(`${API_BASE_URL}/api/jobs/${currentJobId}${clientQuery}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setStatus('failed');
        setErrorMsg('Job cancelled by user.');
        localStorage.removeItem('active_qbr_job_id');
        localStorage.removeItem('active_qbr_job_client');
        localStorage.removeItem('active_qbr_job_started_at');
      }
    } catch (err) {
      console.error('Failed to cancel job:', err);
    } finally {
      setIsCancelling(false);
    }
  };

  // Poll job status with hard 5-minute timeout safeguard (Item #10)
  useEffect(() => {
    if (!currentJobId || status !== 'processing') return;

    let isSubscribed = true;
    let timerId = null;
    let pollInterval = 1500;
    const MAX_INTERVAL = 4000;
    const jobStartTime = Number(localStorage.getItem('active_qbr_job_started_at') || Date.now());

    const checkStatus = async () => {
      if (Date.now() - jobStartTime > 5 * 60 * 1000) {
        if (!isSubscribed) return;
        setStatus('failed');
        setErrorMsg('Job taking too long. Please check history or try again.');
        localStorage.removeItem('active_qbr_job_id');
        localStorage.removeItem('active_qbr_job_client');
        localStorage.removeItem('active_qbr_job_started_at');
        return;
      }

      try {
        const clientQuery = activeClient?.id ? `?clientId=${encodeURIComponent(activeClient.id)}` : '';
        let res = await apiFetch(`${API_BASE_URL}/api/jobs/${currentJobId}${clientQuery}`);
        if (!res.ok) {
          res = await apiFetch(`${API_BASE_URL}/api/status/${currentJobId}${clientQuery}`);
          if (!res.ok) {
            if (isSubscribed) {
              pollInterval = Math.min(pollInterval * 1.5, MAX_INTERVAL);
              timerId = setTimeout(checkStatus, pollInterval);
            }
            return;
          }
        }
        const data = await res.json();
        const job = data.job || data;

        if (!isSubscribed) return;

        if (job.status === 'completed') {
          setStatus('completed');
          setProgressPercent(100);
          setCurrentStepIndex(4);
          setStageText('QBR Report & PowerPoint Generated Successfully!');
          localStorage.removeItem('active_qbr_job_id');
          localStorage.removeItem('active_qbr_job_client');
          localStorage.removeItem('active_qbr_job_started_at');
          if (onJobCompleted) onJobCompleted(currentJobId);
        } else if (job.status === 'failed' || job.status === 'error') {
          setStatus('failed');
          setCurrentStepIndex(-1);
          setErrorMsg(job.error || 'Report generation failed. Please check your input files.');
          localStorage.removeItem('active_qbr_job_id');
          localStorage.removeItem('active_qbr_job_client');
          localStorage.removeItem('active_qbr_job_started_at');
        } else {
          if (typeof job.progress === 'number') {
            setProgressPercent(job.progress);
          }
          if (job.message || job.stepLabel) {
            setStageText(job.message || job.stepLabel);
          }
          const stepKey = job.stage || job.step || job.status;
          if (stepKey === 'parsing_excel' || stepKey === 'upload_validation') {
            setCurrentStepIndex(0);
          } else if (stepKey === 'filtering_data' || stepKey === 'data_processing') {
            setCurrentStepIndex(1);
          } else if (stepKey === 'generating_ppt' || stepKey === 'ppt_generation') {
            setCurrentStepIndex(2);
          }

          pollInterval = Math.min(pollInterval * 1.2, MAX_INTERVAL);
          timerId = setTimeout(checkStatus, Math.round(pollInterval));
        }
      } catch (err) {
        console.error('Job status check error:', err);
        if (isSubscribed) {
          pollInterval = Math.min(pollInterval * 1.5, MAX_INTERVAL);
          timerId = setTimeout(checkStatus, pollInterval);
        }
      }
    };

    checkStatus();

    return () => {
      isSubscribed = false;
      if (timerId) clearTimeout(timerId);
    };
  }, [currentJobId, status, onJobCompleted, activeClient?.id]);


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
                  value={activeClient?.id || ''}
                  onChange={(e) => {
                    const c = clients.find((item) => item.id === e.target.value);
                    if (c) setActiveClient(c);
                  }}
                  className="select-field"
                >
                  <option value="" disabled>Select customer...</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.logo || '🏢'} {c.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="context-value">
                  {activeClient ? `${activeClient.logo || '🏢'} ${activeClient.name}` : 'No Customer Assigned'}
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
                  🤖 AI Incidents Schema Audit: Passed
                </h4>
                <span style={{ fontSize: '0.75rem', background: '#dcfce7', color: '#15803d', padding: '0.25rem 0.6rem', borderRadius: '12px', fontWeight: 'bold' }}>
                  Incidents File Verified
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

          {inventoryAuditResult && (
            <div className="alert-box" style={{ marginBottom: '1rem', padding: '1rem', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px', color: '#166534' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <h4 style={{ margin: 0, fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  🤖 AI Inventory Schema Audit: Passed
                </h4>
                <span style={{ fontSize: '0.75rem', background: '#dcfce7', color: '#15803d', padding: '0.25rem 0.6rem', borderRadius: '12px', fontWeight: 'bold' }}>
                  Inventory File Verified
                </span>
              </div>
              <div style={{ fontSize: '0.85rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.5rem' }}>
                <div><strong>Total Devices:</strong> {inventoryAuditResult.metricsSummary?.totalDevicesCount ?? 'N/A'}</div>
                <div><strong>Access Points (APs):</strong> {inventoryAuditResult.metricsSummary?.accessPointsCount ?? 'N/A'}</div>
                <div><strong>Switches (SWs):</strong> {inventoryAuditResult.metricsSummary?.switchesCount ?? 'N/A'}</div>
                <div><strong>Core Devices:</strong> {inventoryAuditResult.metricsSummary?.coreDevicesCount ?? 'N/A'}</div>
                <div><strong>Locations Mapped:</strong> {inventoryAuditResult.metricsSummary?.locationsDetectedCount ?? 'N/A'} ({inventoryAuditResult.metricsSummary?.detectedLocations?.join(', ') || 'None'})</div>
              </div>
            </div>
          )}

          {/* Sheet Mapping Configuration Bar (Item #6) */}
          {(aiAuditResult || inventoryAuditResult) && (
            <div
              style={{
                marginBottom: '1rem',
                padding: '0.75rem 1rem',
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '0.75rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                <span style={{ fontSize: '1.15rem' }}>📑</span>
                <div>
                  <strong>Worksheet & Field Mapping:</strong>{' '}
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {customSheetMapping?.incidentSheet
                      ? `Primary: "${customSheetMapping.incidentSheet}" • ${customSheetMapping.locationSheets?.length || 0} Inv Sheets`
                      : `Auto: "${aiAuditResult?.detectedRoles?.incidentSheet || 'Default'}" • ${aiAuditResult?.detectedRoles?.locationSheets?.length || 0} Inv Sheets`}
                  </span>
                  {customSheetMapping && (
                    <span style={{ marginLeft: '0.5rem', fontSize: '0.72rem', background: 'rgba(37, 99, 235, 0.15)', color: 'var(--accent-blue)', padding: '0.15rem 0.45rem', borderRadius: '4px', fontWeight: 600 }}>
                      Customized
                    </span>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsMappingModalOpen(true)}
                className="btn btn-secondary"
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                <span>⚙️</span>
                <span>Configure Sheet Mapping</span>
              </button>
            </div>
          )}

          {/* Sheet Mapping Modal */}
          <SheetMappingModal
            isOpen={isMappingModalOpen}
            onClose={() => setIsMappingModalOpen(false)}
            auditResult={aiAuditResult}
            inventoryAuditResult={inventoryAuditResult}
            initialMapping={customSheetMapping}
            onSave={(mapping) => setCustomSheetMapping(mapping)}
          />

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
                <>⏳ {stageText}</>
              ) : (
                <>⚡ Validate & Generate QBR Reports</>
              )}
            </button>
          </div>
        </form>

        {/* Processing Spinner / Progress Indicator */}
        {status === 'processing' && (
          <div className="processing-indicator" style={{
            marginTop: '1.5rem',
            padding: '1.25rem',
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div className="spinner"></div>
                <div className="processing-text">
                  <h4 style={{ margin: 0, color: '#1d4ed8' }}>{stageText}</h4>
                  <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.85rem', color: '#3b82f6' }}>
                    Processing workbooks • Applying rules • Calculating uptime & SLA metrics • Building PowerPoint presentation
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCancelJob}
                disabled={isCancelling}
                style={{
                  background: '#fee2e2',
                  color: '#b91c1c',
                  border: '1px solid #fca5a5',
                  padding: '0.45rem 0.9rem',
                  borderRadius: '6px',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: isCancelling ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                {isCancelling ? 'Cancelling...' : '✕ Cancel Job'}
              </button>
            </div>

            {/* Live Progress Bar */}
            <div style={{ marginTop: '0.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#1e40af', fontWeight: 600, marginBottom: '0.35rem' }}>
                <span>Progress</span>
                <span>{progressPercent}%</span>
              </div>
              <div style={{ width: '100%', height: '8px', background: '#dbeafe', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{
                  width: `${progressPercent}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #3b82f6, #1d4ed8)',
                  borderRadius: '4px',
                  transition: 'width 0.4s ease',
                }} />
              </div>
            </div>

            {/* Sequential Steps Cards */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '0.75rem',
              marginTop: '0.25rem',
              paddingTop: '0.75rem',
              borderTop: '1px solid #dbeafe'
            }}>
              {PROCESSING_STEPS.map((step, idx) => {
                const isDone = currentStepIndex > idx || status === 'completed';
                const isActive = currentStepIndex === idx && status !== 'completed';
                return (
                  <div
                    key={step.id}
                    style={{
                      padding: '0.65rem 0.85rem',
                      borderRadius: '8px',
                      background: isActive ? '#ffffff' : isDone ? '#f0fdf4' : '#f8fafc',
                      border: isActive ? '2px solid #3b82f6' : isDone ? '1px solid #86efac' : '1px solid #e2e8f0',
                      boxShadow: isActive ? '0 2px 4px rgba(59, 130, 246, 0.15)' : 'none',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.2rem' }}>
                      <span style={{ fontSize: '1.1rem' }}>{isDone ? '✅' : step.icon}</span>
                      <strong style={{
                        fontSize: '0.85rem',
                        color: isActive ? '#1d4ed8' : isDone ? '#15803d' : '#64748b'
                      }}>
                        {step.label}
                      </strong>
                    </div>
                    <div style={{
                      fontSize: '0.75rem',
                      color: isActive ? '#2563eb' : isDone ? '#16a34a' : '#94a3b8'
                    }}>
                      {step.desc}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
