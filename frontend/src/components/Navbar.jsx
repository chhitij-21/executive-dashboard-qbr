// frontend/src/components/Navbar.jsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../hooks/useTheme';
import { NotificationBell } from './NotificationBell';

export default function Navbar({ activeTab, setActiveTab, onOpenLogin, reportSites = [] }) {
  const { t, i18n } = useTranslation();
  const { user, clients, activeClient, activeLocation, setActiveClient, setActiveLocation, isAdmin, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const locationsList = React.useMemo(() => {
    const defaultLocs = activeClient?.locations || ['All Locations'];
    const validReportSites = (reportSites || []).filter(s =>
      s && !['sla_compliance_report', 'raw', 'sheet1', 'jfl', 'unknown'].includes(String(s).trim().toLowerCase())
    );
    const merged = Array.from(new Set(['All Locations', ...validReportSites, ...defaultLocs]));
    return merged;
  }, [activeClient, reportSites]);

  const toggleLanguage = () => {
    const nextLang = i18n.language === 'hi' ? 'en' : 'hi';
    i18n.changeLanguage(nextLang);
  };

  return (
    <header className="nav-bar">
      <div className="nav-brand">
        <div className="nav-logo-badge">
          <span className="nav-logo-icon">📊</span>
        </div>
        <div className="nav-brand-text">
          <span className="nav-logo-title">{t('app_title')}</span>
          <span className="nav-subtitle">Multi-Client Enterprise Reporting Platform</span>
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
          className={`nav-tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          <span className="nav-tab-icon">🌐</span>
          <span className="nav-tab-label">{t('nav_overview')}</span>
        </button>

        <button
          className={`nav-tab-btn ${activeTab === 'upload' ? 'active' : ''}`}
          onClick={() => setActiveTab('upload')}
        >
          <span className="nav-tab-icon">📤</span>
          <span className="nav-tab-label">{t('nav_upload')}</span>
        </button>

        <button
          className={`nav-tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('dashboard')}
        >
          <span className="nav-tab-icon">📈</span>
          <span className="nav-tab-label">{t('nav_sites')}</span>
        </button>

        <button
          className={`nav-tab-btn ${activeTab === 'tickets' ? 'active' : ''}`}
          onClick={() => setActiveTab('tickets')}
        >
          <span className="nav-tab-icon">🎫</span>
          <span className="nav-tab-label">{t('nav_tickets')}</span>
        </button>

        <button
          className={`nav-tab-btn ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          <span className="nav-tab-icon">📜</span>
          <span className="nav-tab-label">Report History</span>
        </button>

        {isAdmin && (
          <button
            className={`nav-tab-btn ${activeTab === 'clients' ? 'active' : ''}`}
            onClick={() => setActiveTab('clients')}
          >
            <span className="nav-tab-icon">⚙️</span>
            <span className="nav-tab-label">Client Management</span>
          </button>
        )}
      </nav>

      {/* Cleaner Right Side Controls & Profile */}
      <div className="nav-right-container">
        <div className="nav-controls-group no-print">
          <button
            className="nav-action-btn nav-theme-btn"
            onClick={toggleTheme}
            title={theme === 'dark' ? t('theme_light') : t('theme_dark')}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>

          <button
            className="nav-action-btn nav-lang-btn"
            onClick={toggleLanguage}
            title="Toggle Language"
          >
            {i18n.language === 'hi' ? 'EN' : 'हि'}
          </button>

          <NotificationBell />

          <button
            className="nav-action-btn nav-print-btn"
            onClick={() => window.print()}
            title={t('btn_print_pdf')}
          >
            <span className="print-icon">🖨️</span>
            <span>{t('btn_print_pdf')}</span>
          </button>
        </div>

        {/* User Profile Pill */}
        <div className="nav-user-container">
          {user ? (
            <div className="user-profile-pill">
              <span className="user-avatar-badge">{user.avatar || '👨‍💼'}</span>
              <div className="user-details">
                <span className="user-display-name">{user.name}</span>
                <span className={`user-role-tag ${user.role}`}>
                  {user.role === 'admin' ? 'System Admin' : 'Client User'}
                </span>
              </div>
              <button className="btn-logout-icon" onClick={logout} title="Sign Out">
                🚪
              </button>
            </div>
          ) : (
            <button className="btn-login-action" onClick={onOpenLogin}>
              🔑 Sign In
            </button>
          )}
        </div>
      </div>
    </header>
  );
}


