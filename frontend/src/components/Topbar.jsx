// frontend/src/components/Topbar.jsx
import React from 'react';
import { useAuth } from '../context/AuthContext';
import { Calendar, ChevronDown, Building2 } from 'lucide-react';

export default function Topbar({ onOpenUpload, data }) {
  const { user, clients, activeClient, setActiveClient } = useAuth();

  const handleClientChange = (e) => {
    const selected = clients.find((c) => c.id === e.target.value);
    if (selected) {
      setActiveClient(selected);
    }
  };

  const getInitials = (name) => {
    if (!name) return 'JD';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <header
      className="h-20 bg-white border-b border-gray-200 flex items-center justify-between px-8 flex-shrink-0"
      style={{
        height: '80px',
        backgroundColor: '#ffffff',
        borderBottom: '1px solid #e2e8f0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 2rem',
        flexShrink: 0
      }}
    >
      {/* Left Greeting */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
        <h2
          className="text-2xl font-bold text-gray-900 m-0 leading-tight"
          style={{ fontSize: '1.4rem', fontWeight: 700, color: '#0f172a', margin: 0 }}
        >
          Welcome back, {user?.name || 'John'}!
        </h2>
        <p
          className="text-sm text-gray-500 m-0"
          style={{ fontSize: '0.85rem', color: '#64748b', margin: 0 }}
        >
          Here's what's happening across your network and services.
        </p>
      </div>

      {/* Right Controls */}
      <div
        className="flex gap-4 items-center"
        style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}
      >
        {data?.report_period?.display_label && (
          <div className="border rounded px-3 py-2 text-sm flex items-center gap-2 bg-[#f8fafc] text-gray-700 border-gray-200" style={{ border: '1px solid #e2e8f0', borderRadius: '0.5rem', padding: '0.45rem 0.85rem', fontSize: '0.825rem', display: 'flex', alignItems: 'center', gap: '0.5rem', backgroundColor: '#f8fafc', color: '#334155', fontWeight: 500 }}>
            <Calendar size={15} style={{ color: '#64748b' }} />
            <span>{data.report_period.display_label}</span>
          </div>
        )}

        {/* Client Switcher */}
        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center'
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: '10px',
              pointerEvents: 'none',
              color: '#3b82f6',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <Building2 size={16} />
          </div>
          <select
            value={activeClient?.id || ''}
            onChange={handleClientChange}
            className="border rounded px-3 py-2 text-sm bg-white text-gray-800 border-gray-200 cursor-pointer font-medium"
            style={{
              border: '1px solid #cbd5e1',
              borderRadius: '0.5rem',
              padding: '0.45rem 1.75rem 0.45rem 2.2rem',
              fontSize: '0.85rem',
              backgroundColor: '#ffffff',
              color: '#0f172a',
              cursor: 'pointer',
              fontWeight: 600,
              appearance: 'auto',
              outline: 'none',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
            }}
            title="Switch Active Customer Context"
          >
            {clients && clients.length > 0 ? (
              clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.id}
                </option>
              ))
            ) : (
              <option value="">{activeClient?.name || 'JFL'}</option>
            )}
          </select>
        </div>

        {/* Divider */}
        <div style={{ width: '1px', height: '28px', backgroundColor: '#e2e8f0' }} />

        {/* User Profile */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            paddingLeft: '0.25rem'
          }}
        >
          {/* Avatar circle */}
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '50%',
              backgroundColor: '#1e40af',
              backgroundImage: 'linear-gradient(135deg, #3b82f6 0%, #1e3a8a 100%)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: '0.85rem',
              boxShadow: '0 2px 4px rgba(30, 58, 138, 0.2)',
              flexShrink: 0
            }}
          >
            {getInitials(user?.name)}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span
              style={{
                fontSize: '0.875rem',
                fontWeight: 600,
                color: '#0f172a',
                lineHeight: 1.2
              }}
            >
              {user?.name || 'John Doe'}
            </span>
            <div
              className="text-xs"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                fontSize: '0.75rem',
                color: '#16a34a',
                fontWeight: 500
              }}
            >
              <span
                style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  backgroundColor: '#22c55e',
                  boxShadow: '0 0 6px #22c55e'
                }}
              />
              <span>Online</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
