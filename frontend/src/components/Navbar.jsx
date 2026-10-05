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
        <span className="nav-logo-icon">📊</span>
        <div>
          <span className="nav-logo">{t('app_title')}</span>
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
          className={activeTab === 'overview' ? 'active' : ''}
          onClick={() => setActiveTab('overview')}
        >
          🌐 {t('nav_overview')}
        </button>

        <button
          className={activeTab === 'upload' ? 'active' : ''}
          onClick={() => setActiveTab('upload')}
        >
          📤 {t('nav_upload')}
        </button>

        <button
          className={activeTab === 'dashboard' ? 'active' : ''}
          onClick={() => setActiveTab('dashboard')}
        >
          📈 {t('nav_sites')}
        </button>

        <button
          className={activeTab === 'tickets' ? 'active' : ''}
          onClick={() => setActiveTab('tickets')}
        >
          🎫 {t('nav_tickets')}
        </button>

        <button
          className={activeTab === 'history' ? 'active' : ''}
          onClick={() => setActiveTab('history')}
        >
          📜 Report History
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

      {/* Header Controls (Theme, Language, Notifications, Print) */}
      <div className="nav-controls no-print" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? t('theme_light') : t('theme_dark')}
          style={{
            background: 'var(--bg-card, #ffffff)',
            border: '1px solid var(--border-color, #e2e8f0)',
            borderRadius: '6px',
            padding: '6px 10px',
            cursor: 'pointer',
            fontSize: '0.85rem',
            color: 'var(--text-main, #334155)',
            minHeight: '44px'
          }}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>

        <button
          onClick={toggleLanguage}
          title="Toggle Language"
          style={{
            background: 'var(--bg-card, #ffffff)',
            border: '1px solid var(--border-color, #e2e8f0)',
            borderRadius: '6px',
            padding: '6px 10px',
            cursor: 'pointer',
            fontSize: '0.85rem',
            fontWeight: 'bold',
            color: 'var(--text-main, #334155)',
            minHeight: '44px'
          }}
        >
          {i18n.language === 'hi' ? 'EN' : 'हि'}
        </button>

        <NotificationBell />

        <button
          onClick={() => window.print()}
          title={t('btn_print_pdf')}
          style={{
            background: 'var(--accent-blue, #2563eb)',
            color: '#ffffff',
            border: 'none',
            borderRadius: '6px',
            padding: '6px 12px',
            cursor: 'pointer',
            fontSize: '0.85rem',
            fontWeight: '600',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            minHeight: '44px'
          }}
        >
          🖨️ {t('btn_print_pdf')}
        </button>
      </div>

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

