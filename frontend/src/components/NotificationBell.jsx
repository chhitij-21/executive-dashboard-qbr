import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

export function NotificationBell() {
  const { t } = useTranslation();
  const [notifications, setNotifications] = useState([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const loadNotifs = () => {
      try {
        const saved = localStorage.getItem('qbr-notifications');
        if (saved) setNotifications(JSON.parse(saved));
      } catch (e) {}
    };
    loadNotifs();

    window.addEventListener('storage', loadNotifs);
    window.addEventListener('qbr-report-uploaded', (e) => {
      const timestamp = new Date().toLocaleTimeString();
      const newNotif = {
        id: Date.now(),
        message: `${t('notification_new_report')} — ${timestamp}`,
        read: false,
        time: timestamp
      };
      setNotifications(prev => {
        const updated = [newNotif, ...prev].slice(0, 10);
        localStorage.setItem('qbr-notifications', JSON.stringify(updated));
        return updated;
      });
    });

    return () => window.removeEventListener('storage', loadNotifs);
  }, [t]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAllAsRead = () => {
    const updated = notifications.map(n => ({ ...n, read: true }));
    setNotifications(updated);
    localStorage.setItem('qbr-notifications', JSON.stringify(updated));
  };

  const toggleOpen = () => {
    if (!isOpen && unreadCount > 0) {
      markAllAsRead();
    }
    setIsOpen(prev => !prev);
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={toggleOpen}
        aria-label="Notifications"
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '8px',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.2rem',
          position: 'relative',
          color: 'var(--text-main, #334155)',
          minWidth: '44px',
          minHeight: '44px',
        }}
      >
        🔔
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: '4px',
              right: '4px',
              background: '#ef4444',
              color: '#ffffff',
              borderRadius: '50%',
              padding: '2px 6px',
              fontSize: '0.68rem',
              fontWeight: 'bold',
            }}
          >
            {unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          className="no-print"
          style={{
            position: 'absolute',
            right: 0,
            top: '50px',
            width: '280px',
            background: 'var(--bg-card, #ffffff)',
            border: '1px solid var(--border-color, #e2e8f0)',
            borderRadius: '8px',
            boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)',
            zIndex: 1000,
            padding: '12px',
          }}
        >
          <div style={{ fontWeight: 'bold', marginBottom: '8px', fontSize: '0.9rem', color: 'var(--text-main, #0f172a)' }}>
            {t('notifications_title')}
          </div>
          {notifications.length === 0 ? (
            <div style={{ fontSize: '0.8rem', color: '#64748b', textAlign: 'center', padding: '12px 0' }}>
              {t('notifications_empty')}
            </div>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {notifications.map(n => (
                <li
                  key={n.id}
                  style={{
                    padding: '8px 0',
                    borderBottom: '1px solid var(--border-color, #f1f5f9)',
                    fontSize: '0.8rem',
                    color: 'var(--text-main, #334155)',
                  }}
                >
                  {n.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
