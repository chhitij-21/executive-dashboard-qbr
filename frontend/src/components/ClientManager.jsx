// frontend/src/components/ClientManager.jsx
import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL, apiFetch } from '../config/api';
import MFASetup from './MFASetup';
import ScheduleManagerModal from './ScheduleManagerModal';

export default function ClientManager() {
  const { clients, activeClient, activeLocation, setActiveClient, setActiveLocation, refreshClients, isAdmin, isBackendOffline } = useAuth();
  const [showAddModal, setShowAddModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [selectedClientForSchedule, setSelectedClientForSchedule] = useState(null);
  const [newClient, setNewClient] = useState({
    name: '',
    code: '',
    logo: '🏢',
    locationsStr: 'All Locations, Bangalore, Delhi',
    description: '',
  });

  const [locationInputs, setLocationInputs] = useState({});
  const [errorMsg, setErrorMsg] = useState(null);

  const [showRulesModal, setShowRulesModal] = useState(false);
  const [editingRulesYaml, setEditingRulesYaml] = useState('');
  const [loadingRules, setLoadingRules] = useState(false);
  const [savingRules, setSavingRules] = useState(false);
  const [rulesSuccessMsg, setRulesSuccessMsg] = useState(null);
  const [rulesErrorMsg, setRulesErrorMsg] = useState(null);
  const [selectedClientForRules, setSelectedClientForRules] = useState(null);

  // ── Tenant Whitelabel Branding & Template State (Item #8) ────────────────────
  const [showBrandingModal, setShowBrandingModal] = useState(false);
  const [selectedClientForBranding, setSelectedClientForBranding] = useState(null);
  const [brandingForm, setBrandingForm] = useState({
    slaTarget: 99.3,
    logo: '',
    primaryColor: '#1e3a8a',
    secondaryColor: '#3b82f6',
    accentColor: '#10b981',
  });
  const [brandingSuccessMsg, setBrandingSuccessMsg] = useState(null);
  const [brandingErrorMsg, setBrandingErrorMsg] = useState(null);
  const [savingBranding, setSavingBranding] = useState(false);
  const [uploadingTemplate, setUploadingTemplate] = useState(false);
  const [templateSuccessMsg, setTemplateSuccessMsg] = useState(null);
  const [templateVersions, setTemplateVersions] = useState([]);
  const [activeTemplateVersionId, setActiveTemplateVersionId] = useState(null);
  const [isGlobalFallback, setIsGlobalFallback] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templateActionMsg, setTemplateActionMsg] = useState(null);

const DEFAULT_RULES_YAML = `# Global business rules configuration
# All values are configurable — no hardcoding in application code.

# ── SLA ──────────────────────────────────────────────────────────────────────
sla:
  resolution_threshold_hours: 2
  uptime_target_percent: 99.3

# ── Health Score ─────────────────────────────────────────────────────────────
health_score:
  weights:
    uptime: 0.6
    incident_free: 0.4
  thresholds:
    excellent: 95
    good: 85
    fair: 70
    poor: 0

# ── Severity Mapping ──────────────────────────────────────────────────────────
severity_device_mapping:
  core: "High"
  non_core: "Medium"
  ap: "Low"
  access_point: "Low"

incident_severity_values:
  critical: ["P1", "Critical", "CRITICAL", "High", "HIGH", "1"]
  major:    ["P2", "Major", "MAJOR", "Medium", "MEDIUM", "2"]
  minor:    ["P3", "Minor", "MINOR", "Low", "LOW", "3"]
`;

  const handleOpenRulesModal = async (client) => {
    setSelectedClientForRules(client);
    setRulesSuccessMsg(null);
    setRulesErrorMsg(null);
    setShowRulesModal(true);
    setLoadingRules(true);

    const cachedYaml = localStorage.getItem('portal_rules_yaml');
    if (cachedYaml) {
      setEditingRulesYaml(cachedYaml);
    } else {
      setEditingRulesYaml(DEFAULT_RULES_YAML);
    }

    try {
      const res = await apiFetch(`${API_BASE_URL}/api/v1/rules`);
      if (res.ok) {
        const json = await res.json();
        if (json.yaml) {
          setEditingRulesYaml(json.yaml);
          localStorage.setItem('portal_rules_yaml', json.yaml);
        }
      }
    } catch (err) {
      console.warn('Backend rules API offline, using local rules:', err.message);
    } finally {
      setLoadingRules(false);
    }
  };

  const handleSaveRules = async (e) => {
    e.preventDefault();
    setRulesSuccessMsg(null);
    setRulesErrorMsg(null);
    setSavingRules(true);

    localStorage.setItem('portal_rules_yaml', editingRulesYaml);

    try {
      const res = await apiFetch(`${API_BASE_URL}/api/v1/rules`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yaml: editingRulesYaml }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save rules.yaml');

      setRulesSuccessMsg('✨ rules.yaml updated and reloaded successfully!');
      setTimeout(() => {
        setRulesSuccessMsg(null);
        setShowRulesModal(false);
      }, 1500);
    } catch (err) {
      console.warn('Backend save offline, saved to session:', err.message);
      setRulesSuccessMsg('✨ rules.yaml saved to local session context!');
      setTimeout(() => {
        setRulesSuccessMsg(null);
        setShowRulesModal(false);
      }, 1500);
    } finally {
      setSavingRules(false);
    }
  };

  const fetchTemplates = async (clientId) => {
    if (!clientId) return;
    setLoadingTemplates(true);
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/v1/tenants/${clientId}/templates`);
      if (res.ok) {
        const data = await res.json();
        setTemplateVersions(data.versions || []);
        setActiveTemplateVersionId(data.activeVersionId);
        setIsGlobalFallback(!!data.isGlobalFallback);
      }
    } catch (err) {
      console.warn('Could not fetch templates:', err.message);
    } finally {
      setLoadingTemplates(false);
    }
  };

  const handleOpenBrandingModal = async (client) => {
    setSelectedClientForBranding(client);
    setBrandingSuccessMsg(null);
    setBrandingErrorMsg(null);
    setTemplateSuccessMsg(null);
    setShowBrandingModal(true);

    fetchTemplates(client.id);

    try {
      const res = await apiFetch(`${API_BASE_URL}/api/v1/tenants/${client.id}/settings`);
      if (res.ok) {
        const json = await res.json();
        const s = json.settings || {};
        const b = s.branding || {};
        setBrandingForm({
          slaTarget: s.slaTarget !== undefined ? s.slaTarget : 99.3,
          logo: b.logo || client.logo || '',
          primaryColor: b.primaryColor || '#1e3a8a',
          secondaryColor: b.secondaryColor || '#3b82f6',
          accentColor: b.accentColor || '#10b981',
        });
      }
    } catch (err) {
      console.warn('Could not load tenant settings, using defaults:', err.message);
    }
  };

  const handleSaveBranding = async (e) => {
    e.preventDefault();
    if (!selectedClientForBranding) return;
    setSavingBranding(true);
    setBrandingSuccessMsg(null);
    setBrandingErrorMsg(null);

    try {
      const res = await apiFetch(`${API_BASE_URL}/api/v1/tenants/${selectedClientForBranding.id}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slaTarget: parseFloat(brandingForm.slaTarget),
          branding: {
            logo: brandingForm.logo,
            primaryColor: brandingForm.primaryColor,
            secondaryColor: brandingForm.secondaryColor,
            accentColor: brandingForm.accentColor,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update tenant branding');

      setBrandingSuccessMsg('✨ Tenant branding and SLA settings saved successfully!');
      refreshClients();
      setTimeout(() => {
        setBrandingSuccessMsg(null);
      }, 2000);
    } catch (err) {
      setBrandingErrorMsg(err.message);
    } finally {
      setSavingBranding(false);
    }
  };

  const handleOpenScheduleModal = (client) => {
    setSelectedClientForSchedule(client);
    setShowScheduleModal(true);
  };

  const handleUploadTemplate = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !selectedClientForBranding) return;

    setUploadingTemplate(true);
    setTemplateSuccessMsg(null);
    setBrandingErrorMsg(null);

    const formData = new FormData();
    formData.append('template', file);

    try {
      const res = await apiFetch(`${API_BASE_URL}/api/v1/tenants/${selectedClientForBranding.id}/templates`, {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to upload template');

      setTemplateSuccessMsg(`✅ Template version "${data.version?.versionId}" uploaded and activated!`);
      await fetchTemplates(selectedClientForBranding.id);
    } catch (err) {
      setBrandingErrorMsg(err.message);
    } finally {
      setUploadingTemplate(false);
      e.target.value = '';
    }
  };

  const handleActivateTemplate = async (versionId) => {
    if (!selectedClientForBranding) return;
    setTemplateActionMsg(`Activating ${versionId}...`);
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/v1/tenants/${selectedClientForBranding.id}/templates/${versionId}/activate`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Activation failed');
      setTemplateSuccessMsg(`✅ Template version ${versionId} is now active.`);
      await fetchTemplates(selectedClientForBranding.id);
    } catch (err) {
      setBrandingErrorMsg(err.message);
    } finally {
      setTemplateActionMsg(null);
    }
  };

  const handleDeleteTemplate = async (versionId) => {
    if (!selectedClientForBranding) return;
    if (!window.confirm(`Are you sure you want to delete template version ${versionId}?`)) return;
    setTemplateActionMsg(`Deleting ${versionId}...`);
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/v1/tenants/${selectedClientForBranding.id}/templates/${versionId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      setTemplateSuccessMsg(`🗑️ Template version ${versionId} deleted.`);
      await fetchTemplates(selectedClientForBranding.id);
    } catch (err) {
      setBrandingErrorMsg(err.message);
    } finally {
      setTemplateActionMsg(null);
    }
  };

  const handleCreateClient = async (e) => {
    e.preventDefault();
    setErrorMsg(null);

    const locations = newClient.locationsStr
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      const res = await apiFetch(`${API_BASE_URL}/api/v1/clients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newClient.name,
          code: newClient.code,
          logo: newClient.logo,
          locations,
          description: newClient.description,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to create client');

      setShowAddModal(false);
      setNewClient({
        name: '',
        code: '',
        logo: '🏢',
        locationsStr: 'All Locations, Bangalore, Delhi',
        description: '',
      });
      refreshClients();
    } catch (err) {
      setErrorMsg(err.message.includes('fetch') ? 'Backend Offline' : err.message);
    }
  };

  const handleToggleStatus = async (client) => {
    if (!isAdmin) return;
    const nextStatus = client.status === 'active' ? 'inactive' : 'active';
    try {
      await apiFetch(`${API_BASE_URL}/api/v1/clients/${client.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      refreshClients();
    } catch (err) {
      console.error('Error updating status:', err);
    }
  };

  const handleAddLocation = async (clientId) => {
    const locName = locationInputs[clientId];
    if (!locName || !locName.trim()) return;

    try {
      await apiFetch(`${API_BASE_URL}/api/v1/clients/${clientId}/locations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location: locName.trim() }),
      });
      setLocationInputs({ ...locationInputs, [clientId]: '' });
      refreshClients();
    } catch (err) {
      console.error('Error adding location:', err);
    }
  };

  return (
    <div className="client-manager-container">
      <div className="card">
        <div className="card-header border-bottom pad-md">
          <div>
            <h2 className="card-title">⚙️ Client & Location Management</h2>
            <p className="card-subtitle">
              Configure enterprise clients, isolated location sites, and customer-specific calculation engine rules.
            </p>
          </div>
          {isAdmin && (
            <button className="btn-primary" onClick={() => setShowAddModal(true)}>
              ➕ Register New Client
            </button>
          )}
        </div>

        {/* Clients Grid */}
        <div className="clients-grid pad-md">
          {clients.map((c) => {
            const isCurrentActive = activeClient?.id === c.id;

            return (
              <div
                key={c.id}
                className={`client-card ${c.status} ${isCurrentActive ? 'active-context-card' : ''}`}
              >
                <div className="client-card-header">
                  <div className="client-identity">
                    <span className="client-logo-avatar">{c.logo}</span>
                    <div>
                      <h3 className="client-name-title">{c.name}</h3>
                      <span className="client-code-tag">ID: {c.code}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                    {isCurrentActive ? (
                      <span className="badge-active-target">🎯 Selected Target</span>
                    ) : (
                      <button
                        className="btn-action-sm"
                        onClick={() => setActiveClient(c)}
                      >
                        Select Client
                      </button>
                    )}
                    <button
                      className={`status-toggle ${c.status}`}
                      onClick={() => handleToggleStatus(c)}
                      disabled={!isAdmin}
                      title={isAdmin ? 'Click to toggle Active/Inactive' : 'Client Status'}
                    >
                      {c.status === 'active' ? '🟢 Active' : '🔴 Inactive'}
                    </button>
                  </div>
                </div>

                <p className="client-desc">{c.description || 'Enterprise QBR Client'}</p>

                {/* ── Engine Calculation & Rules Configuration Summary ────────────────── */}
                <div className="rules-config-box">
                  <div className="rules-config-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div>
                      <span>🧮 Customer Calculation Logic &amp; Rule Engine Settings</span>
                      <code style={{ marginLeft: '0.5rem' }}>{c.ruleConfigFile || 'rules.yaml'}</code>
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                      <button
                        className="btn-secondary-sm"
                        onClick={() => handleOpenScheduleModal(c)}
                        style={{ background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', fontWeight: 600, padding: '0.25rem 0.65rem', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                        title="View and configure automated recurring QBR schedules"
                      >
                        📅 Schedules
                        {(c.lastScheduleStatus === 'FAILED' || c.hasScheduleFailure) && <span title="Last scheduled run failed">🔴</span>}
                      </button>
                      {isAdmin && (
                        <>
                          <button
                            className="btn-secondary-sm"
                            onClick={() => handleOpenBrandingModal(c)}
                            style={{ background: '#fdf2f8', color: '#9d174d', border: '1px solid #fbcfe8', fontWeight: 600, padding: '0.25rem 0.65rem', borderRadius: '6px', cursor: 'pointer' }}
                            title="Configure tenant branding colors, logo, and PPT template"
                          >
                            🎨 Branding &amp; Templates
                          </button>
                          <button
                            className="btn-secondary-sm"
                            onClick={() => handleOpenRulesModal(c)}
                            style={{ background: '#e0e7ff', color: '#3730a3', border: '1px solid #c7d2fe', fontWeight: 600, padding: '0.25rem 0.65rem', borderRadius: '6px', cursor: 'pointer' }}
                          >
                            ✏️ Edit rules.yaml
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="rules-specs-grid">
                    <div className="spec-item">
                      <span className="spec-label">SLA Target</span>
                      <span className="spec-val">99.30%</span>
                    </div>
                    <div className="spec-item">
                      <span className="spec-label">Health Weights</span>
                      <span className="spec-val">60% Uptime + 40% Inc-Free</span>
                    </div>
                    <div className="spec-item">
                      <span className="spec-label">Health Thresholds</span>
                      <span className="spec-val">≥95 Excellent, ≥85 Good, ≥70 Fair</span>
                    </div>
                    <div className="spec-item">
                      <span className="spec-label">Device Severity</span>
                      <span className="spec-val">Core=Critical, SW=Major, AP=Minor</span>
                    </div>
                  </div>
                </div>

                {/* Locations List */}
                <div className="client-locations-section">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label className="section-label">📍 ISOLATED LOCATIONS ({c.locations.length})</label>
                    <span className="location-hint">Click location to filter context</span>
                  </div>
                  <div className="location-pills">
                    {c.locations.map((loc) => {
                      const isLocActive = isCurrentActive && activeLocation === loc;
                      return (
                        <span
                          key={loc}
                          className={`loc-pill clickable ${isLocActive ? 'active-loc-pill' : ''}`}
                          onClick={() => {
                            if (!isCurrentActive) setActiveClient(c);
                            setActiveLocation(loc);
                          }}
                        >
                          📍 {loc} {isLocActive && '✓'}
                        </span>
                      );
                    })}
                  </div>

                  {/* Add location inline (Admin only) */}
                  {isAdmin && (
                    <div className="add-location-inline">
                      <input
                        type="text"
                        placeholder="Add new site location..."
                        value={locationInputs[c.id] || ''}
                        onChange={(e) => setLocationInputs({ ...locationInputs, [c.id]: e.target.value })}
                        className="input-field-sm"
                      />
                      <button
                        className="btn-secondary-sm"
                        onClick={() => handleAddLocation(c.id)}
                      >
                        + Add Site
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Enterprise Security & MFA Management */}
        <MFASetup />
      </div>

      {/* Add Client Modal */}
      {showAddModal && (
        <div className="modal-backdrop" onClick={() => setShowAddModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🏢 Register New Enterprise Client</h3>
              <button className="modal-close" onClick={() => setShowAddModal(false)}>
                ✕
              </button>
            </div>

            {errorMsg && <div className="alert-error">⚠️ {errorMsg}</div>}

            <form onSubmit={handleCreateClient} className="form-grid">
              <div className="form-group">
                <label>Client Name</label>
                <input
                  type="text"
                  placeholder="e.g. Acme Corp"
                  value={newClient.name}
                  onChange={(e) => setNewClient({ ...newClient, name: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label>Client Code</label>
                <input
                  type="text"
                  placeholder="e.g. ACM"
                  value={newClient.code}
                  onChange={(e) => setNewClient({ ...newClient, code: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label>Logo Icon / Emoji</label>
                <input
                  type="text"
                  value={newClient.logo}
                  onChange={(e) => setNewClient({ ...newClient, logo: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Locations / Sites (comma separated)</label>
                <input
                  type="text"
                  value={newClient.locationsStr}
                  onChange={(e) => setNewClient({ ...newClient, locationsStr: e.target.value })}
                  required
                />
              </div>

              <div className="form-group full-width">
                <label>Description</label>
                <textarea
                  rows="2"
                  value={newClient.description}
                  onChange={(e) => setNewClient({ ...newClient, description: e.target.value })}
                  placeholder="Client description..."
                ></textarea>
              </div>

              <button type="submit" className="btn-primary full-width">
                Register Client
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Rules Editor Modal */}
      {showRulesModal && (
        <div className="modal-backdrop" onClick={() => setShowRulesModal(false)}>
          <div className="modal-card" style={{ maxWidth: '780px', width: '90%' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🧮 Edit Business Rules ({selectedClientForRules?.name || 'rules.yaml'})</h3>
              <button className="modal-close" onClick={() => setShowRulesModal(false)}>
                ✕
              </button>
            </div>

            {rulesSuccessMsg && (
              <div className="alert-success" style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: '#d1fae5', color: '#065f46', borderRadius: '8px', border: '1px solid #a7f3d0' }}>
                {rulesSuccessMsg}
              </div>
            )}

            {rulesErrorMsg && (
              <div className="alert-error" style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: '#fee2e2', color: '#991b1b', borderRadius: '8px', border: '1px solid #fca5a5' }}>
                ⚠️ {rulesErrorMsg}
              </div>
            )}

            {loadingRules ? (
              <div style={{ padding: '2rem', textAlign: 'center' }}>⏳ Loading rules.yaml...</div>
            ) : (
              <form onSubmit={handleSaveRules}>
                <div className="form-group" style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
                    YAML Configuration Editor (<code style={{ color: 'var(--accent-primary)' }}>config/rules.yaml</code>)
                  </label>
                  <textarea
                    value={editingRulesYaml}
                    onChange={(e) => setEditingRulesYaml(e.target.value)}
                    rows={16}
                    style={{
                      width: '100%',
                      fontFamily: 'monospace',
                      fontSize: '0.88rem',
                      padding: '0.85rem',
                      borderRadius: '8px',
                      border: '1px solid #ccc',
                      background: '#1e1e1e',
                      color: '#d4d4d4',
                      lineHeight: '1.5',
                      boxSizing: 'border-box'
                    }}
                    placeholder="Enter valid YAML configuration..."
                  />
                </div>

                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                  <button type="button" className="btn-secondary" onClick={() => setShowRulesModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary" disabled={savingRules}>
                    {savingRules ? '⏳ Saving Rules...' : '💾 Save & Reload Rules'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── Whitelabel Branding & Master PPT Template Modal (Item #8) ──────────── */}
      {showBrandingModal && selectedClientForBranding && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: '640px', width: '100%' }}>
            <div className="modal-header">
              <div>
                <h3 className="modal-title">🎨 Whitelabel Branding &amp; Template Configuration</h3>
                <p className="card-subtitle" style={{ margin: 0 }}>
                  Customize logo, brand colors, SLA target, and PPT template for <strong>{selectedClientForBranding.name}</strong> ({selectedClientForBranding.code})
                </p>
              </div>
              <button
                className="btn-close"
                onClick={() => setShowBrandingModal(false)}
                title="Close"
              >
                ✕
              </button>
            </div>

            {brandingSuccessMsg && (
              <div className="alert alert-success" style={{ margin: '1rem 0' }}>
                {brandingSuccessMsg}
              </div>
            )}
            {brandingErrorMsg && (
              <div className="alert alert-danger" style={{ margin: '1rem 0' }}>
                ⚠️ {brandingErrorMsg}
              </div>
            )}
            {templateSuccessMsg && (
              <div className="alert alert-success" style={{ margin: '1rem 0' }}>
                {templateSuccessMsg}
              </div>
            )}

            <form onSubmit={handleSaveBranding} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginTop: '1rem' }}>
              {/* SLA Target */}
              <div className="form-group">
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.35rem' }}>
                  Contractual SLA Uptime Target (%)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  className="input-field"
                  value={brandingForm.slaTarget}
                  onChange={(e) => setBrandingForm({ ...brandingForm, slaTarget: e.target.value })}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                  required
                />
              </div>

              {/* Logo URL / Emoji */}
              <div className="form-group">
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.35rem' }}>
                  Client Logo (URL or Emoji)
                </label>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="https://example.com/logo.png or emoji"
                    value={brandingForm.logo}
                    onChange={(e) => setBrandingForm({ ...brandingForm, logo: e.target.value })}
                    style={{ flex: 1, padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                  />
                  <div
                    style={{
                      width: '44px',
                      height: '44px',
                      borderRadius: '8px',
                      border: '1px solid #e2e8f0',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1.25rem',
                      background: '#f8fafc',
                      overflow: 'hidden',
                    }}
                  >
                    {brandingForm.logo.startsWith('http') || brandingForm.logo.startsWith('data:') ? (
                      <img src={brandingForm.logo} alt="Preview" style={{ maxWidth: '100%', maxHeight: '100%' }} />
                    ) : (
                      brandingForm.logo || '🏢'
                    )}
                  </div>
                </div>
              </div>

              {/* Hex Brand Colors */}
              <div className="form-group">
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                  Tenant Brand Colors (Hex Codes)
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
                  {/* Primary Color */}
                  <div>
                    <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block', marginBottom: '0.2rem' }}>Primary</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <input
                        type="color"
                        value={brandingForm.primaryColor}
                        onChange={(e) => setBrandingForm({ ...brandingForm, primaryColor: e.target.value })}
                        style={{ width: '32px', height: '32px', border: 'none', cursor: 'pointer', borderRadius: '4px' }}
                      />
                      <input
                        type="text"
                        value={brandingForm.primaryColor}
                        onChange={(e) => setBrandingForm({ ...brandingForm, primaryColor: e.target.value })}
                        style={{ width: '100%', fontSize: '0.8rem', padding: '0.35rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                      />
                    </div>
                  </div>

                  {/* Secondary Color */}
                  <div>
                    <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block', marginBottom: '0.2rem' }}>Secondary</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <input
                        type="color"
                        value={brandingForm.secondaryColor}
                        onChange={(e) => setBrandingForm({ ...brandingForm, secondaryColor: e.target.value })}
                        style={{ width: '32px', height: '32px', border: 'none', cursor: 'pointer', borderRadius: '4px' }}
                      />
                      <input
                        type="text"
                        value={brandingForm.secondaryColor}
                        onChange={(e) => setBrandingForm({ ...brandingForm, secondaryColor: e.target.value })}
                        style={{ width: '100%', fontSize: '0.8rem', padding: '0.35rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                      />
                    </div>
                  </div>

                  {/* Accent Color */}
                  <div>
                    <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block', marginBottom: '0.2rem' }}>Accent</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <input
                        type="color"
                        value={brandingForm.accentColor}
                        onChange={(e) => setBrandingForm({ ...brandingForm, accentColor: e.target.value })}
                        style={{ width: '32px', height: '32px', border: 'none', cursor: 'pointer', borderRadius: '4px' }}
                      />
                      <input
                        type="text"
                        value={brandingForm.accentColor}
                        onChange={(e) => setBrandingForm({ ...brandingForm, accentColor: e.target.value })}
                        style={{ width: '100%', fontSize: '0.8rem', padding: '0.35rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Whitelabel PowerPoint Master Template & Version Management (Item #11) */}
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: '1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                    Whitelabel Master PPT Template (.pptx) &amp; Version History
                  </label>
                  <span
                    style={{
                      fontSize: '0.75rem',
                      padding: '0.2rem 0.5rem',
                      borderRadius: '4px',
                      background: isGlobalFallback ? '#fef3c7' : '#dcfce7',
                      color: isGlobalFallback ? '#92400e' : '#166534',
                      fontWeight: 600,
                    }}
                  >
                    {isGlobalFallback ? '🏢 Corporate Master (Default)' : `Active: ${activeTemplateVersionId || 'Custom'}`}
                  </span>
                </div>

                {/* Versions List */}
                <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', overflow: 'hidden' }}>
                  {loadingTemplates ? (
                    <div style={{ padding: '0.75rem', fontSize: '0.8rem', color: '#64748b', textAlign: 'center' }}>
                      ⏳ Loading template versions...
                    </div>
                  ) : templateVersions.length === 0 ? (
                    <div style={{ padding: '0.75rem', fontSize: '0.8rem', color: '#64748b', textAlign: 'center' }}>
                      No custom template versions uploaded yet. System automatically falls back to <code>templates/master_template.pptx</code>.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {templateVersions.map((v) => {
                        const isActive = v.versionId === activeTemplateVersionId || v.isActive;
                        return (
                          <div
                            key={v.versionId}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '0.5rem 0.75rem',
                              borderBottom: '1px solid #f1f5f9',
                              background: isActive ? '#f0fdf4' : 'transparent',
                              fontSize: '0.8rem',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                              <span style={{ fontWeight: 700, color: isActive ? '#15803d' : '#334155' }}>
                                {v.versionId}
                              </span>
                              <span style={{ color: '#1e293b' }}>{v.filename}</span>
                              <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
                                ({Math.round((v.sizeBytes || 0) / 1024)} KB &bull; {v.uploadedBy || 'Admin'})
                              </span>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              {isActive ? (
                                <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#16a34a', padding: '0.15rem 0.4rem', background: '#dcfce7', borderRadius: '4px' }}>
                                  ✓ Active
                                </span>
                              ) : (
                                isAdmin && (
                                  <button
                                    type="button"
                                    onClick={() => handleActivateTemplate(v.versionId)}
                                    disabled={Boolean(templateActionMsg)}
                                    style={{
                                      fontSize: '0.7rem',
                                      padding: '0.2rem 0.5rem',
                                      borderRadius: '4px',
                                      background: '#eff6ff',
                                      color: '#1d4ed8',
                                      border: '1px solid #bfdbfe',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    Activate
                                  </button>
                                )
                              )}

                              <a
                                href={`${API_BASE_URL}/api/v1/tenants/${selectedClientForBranding?.id}/templates/${v.versionId}/download`}
                                download
                                style={{
                                  fontSize: '0.7rem',
                                  padding: '0.2rem 0.5rem',
                                  borderRadius: '4px',
                                  background: '#f1f5f9',
                                  color: '#334155',
                                  border: '1px solid #cbd5e1',
                                  textDecoration: 'none',
                                }}
                              >
                                📥 Download
                              </a>

                              {!isActive && isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteTemplate(v.versionId)}
                                  disabled={Boolean(templateActionMsg)}
                                  style={{
                                    fontSize: '0.7rem',
                                    padding: '0.2rem 0.5rem',
                                    borderRadius: '4px',
                                    background: '#fef2f2',
                                    color: '#b91c1c',
                                    border: '1px solid #fecaca',
                                    cursor: 'pointer',
                                  }}
                                >
                                  🗑️
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {templateActionMsg && (
                  <div style={{ fontSize: '0.75rem', color: '#2563eb' }}>{templateActionMsg}</div>
                )}

                {/* Upload Form */}
                {isAdmin ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.25rem' }}>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#334155' }}>
                      Upload New Template Version (.pptx)
                    </label>
                    <input
                      type="file"
                      accept=".pptx"
                      disabled={uploadingTemplate}
                      onChange={handleUploadTemplate}
                      style={{ fontSize: '0.8rem' }}
                    />
                    <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
                      Enforces magic-byte verification (<code>PK\x03\x04</code>). Retention policy keeps max 5 versions per tenant; oldest version is pruned on 6th upload.
                    </span>
                  </div>
                ) : (
                  <span style={{ fontSize: '0.75rem', color: '#64748b', fontStyle: 'italic' }}>
                    Template version uploads and activations are restricted to Administrators.
                  </span>
                )}
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                <button type="button" className="btn-secondary" onClick={() => setShowBrandingModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={savingBranding}>
                  {savingBranding ? '⏳ Saving Branding...' : '💾 Save Tenant Branding'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Schedule Manager Modal (Item #13) */}
      <ScheduleManagerModal
        isOpen={showScheduleModal}
        onClose={() => setShowScheduleModal(false)}
        client={selectedClientForSchedule}
        isAdmin={isAdmin}
      />
    </div>
  );
}
