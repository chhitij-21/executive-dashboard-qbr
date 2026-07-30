// frontend/src/components/Navbar.jsx
import React from 'react';
import { useAuth } from '../context/AuthContext';

export default function Navbar({ activeTab, setActiveTab, onOpenLogin, reportSites = [] }) {
  const { user, clients, activeClient, activeLocation, setActiveClient, setActiveLocation, isAdmin, logout } = useAuth();

  const locationsList = React.useMemo(() => {
    const defaultLocs = activeClient?.locations || ['All Locations'];
    const validReportSites = (reportSites || []).filter(s =>
      s && !['sla_compliance_report', 'raw', 'sheet1', 'jfl', 'unknown'].includes(String(s).trim().toLowerCase())
    );
    const merged = Array.from(new Set(['All Locations', ...validReportSites, ...defaultLocs]));
    return merged;
  }, [activeClient, reportSites]);

  return (
    <header className="nav-bar">
      <div className="nav-brand">
        <span className="nav-logo-icon">📊</span>
        <div>
          <span className="nav-logo">Executive QBR Portal</span>
          <span className="nav-subtitle">Multi-Client Enterprise Operations</span>
        </div>
      </div>

      {/* Client & Location Context Selectors */}
      <div className="nav-selectors">
        {/* Client Selector */}
        <div className="selector-group">
          <label className="selector-label">CLIENT</label>
          {isAdmin ? (
            <select
              className="nav-select"
              value={activeClient?.id || ''}
              onChange={(e) => {
                const found = clients.find((c) => c.id === e.target.value);
                if (found) setActiveClient(found);
              }}
            >
              {clients && clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.logo} {c.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="read-only-badge">
              {activeClient?.logo || '🏢'} {activeClient?.name || 'Assigned Client'}
            </div>
          )}
        </div>

        {/* Location Selector */}
        <div className="selector-group">
          <label className="selector-label">LOCATION</label>
          <select
            className="nav-select"
            value={activeLocation}
            onChange={(e) => setActiveLocation(e.target.value)}
          >
            {locationsList.map((loc) => (
              <option key={loc} value={loc}>
                📍 {loc}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Navigation Tabs */}
      <nav className="nav-tabs">
        <button
          className={activeTab === 'upload' ? 'active' : ''}
          onClick={() => setActiveTab('upload')}
        >
          📤 Upload & Generate
        </button>

        <button
          className={activeTab === 'dashboard' ? 'active' : ''}
          onClick={() => setActiveTab('dashboard')}
        >
          📈 Executive Dashboard
        </button>

        <button
          className={activeTab === 'history' ? 'active' : ''}
          onClick={() => setActiveTab('history')}
        >
          📜 Report History
        </button>

        <button
          className={activeTab === 'analyzer' ? 'active' : ''}
          onClick={() => setActiveTab('analyzer')}
        >
          🤖 AI Excel Audit
        </button>

        {isAdmin && (
          <button
            className={activeTab === 'clients' ? 'active' : ''}
            onClick={() => setActiveTab('clients')}
          >
            ⚙️ Client Management
          </button>
        )}
      </nav>

      {/* User Profile Pill */}
      <div className="nav-user">
        {user ? (
          <div className="user-profile">
            <span className="user-avatar">{user.avatar || '👨‍💼'}</span>
            <div className="user-info">
              <span className="user-name">{user.name}</span>
              <span className={`user-role-badge ${user.role}`}>
                {user.role === 'admin' ? 'System Admin' : 'Client User'}
              </span>
            </div>
            <button className="btn-logout" onClick={logout} title="Sign Out">
              🚪
            </button>
          </div>
        ) : (
          <button className="btn-login" onClick={onOpenLogin}>
            🔑 Sign In
          </button>
        )}
      </div>
    </header>
  );
}
