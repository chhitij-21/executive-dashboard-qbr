// frontend/src/components/ClientManager.jsx
import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../config/api';

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

  const handleCreateClient = async (e) => {
    e.preventDefault();
    setErrorMsg(null);

    const locations = newClient.locationsStr
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      const res = await fetch(`${API_BASE_URL}/api/clients`, {
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
      await fetch(`${API_BASE_URL}/api/clients/${client.id}`, {
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
      await fetch(`${API_BASE_URL}/api/clients/${clientId}/locations`, {
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
                  <div className="rules-config-title">
                    <span>🧮 Customer Calculation Logic &amp; Rule Engine Settings</span>
                    <code>{c.ruleConfigFile || 'rules.yaml'}</code>
                  </div>
                  <div className="rules-specs-grid">
                    <div className="spec-item">
                      <span className="spec-label">SLA Target</span>
                      <span className="spec-val">99.90%</span>
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
    </div>
  );
}
