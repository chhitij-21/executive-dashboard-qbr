// frontend/src/components/ClientManager.jsx
import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL, apiFetch } from '../config/api';

export default function ClientManager() {
  const { clients, activeClient, activeLocation, setActiveClient, setActiveLocation, refreshClients, isAdmin, isBackendOffline } = useAuth();
  const [showAddModal, setShowAddModal] = useState(false);
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
      const res = await apiFetch(`${API_BASE_URL}/api/rules`);
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
      const res = await apiFetch(`${API_BASE_URL}/api/rules`, {
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

  const handleCreateClient = async (e) => {
    e.preventDefault();
    setErrorMsg(null);

    const locations = newClient.locationsStr
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      const res = await apiFetch(`${API_BASE_URL}/api/clients`, {
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
      await apiFetch(`${API_BASE_URL}/api/clients/${client.id}`, {
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
      await apiFetch(`${API_BASE_URL}/api/clients/${clientId}/locations`, {
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
                    {isAdmin && (
                      <button
                        className="btn-secondary-sm"
                        onClick={() => handleOpenRulesModal(c)}
                        style={{ background: '#e0e7ff', color: '#3730a3', border: '1px solid #c7d2fe', fontWeight: 600, padding: '0.25rem 0.65rem', borderRadius: '6px', cursor: 'pointer' }}
                      >
                        ✏️ Edit rules.yaml
                      </button>
                    )}
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
    </div>
  );
}
