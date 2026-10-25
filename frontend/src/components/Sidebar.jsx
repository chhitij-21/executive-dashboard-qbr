import React from 'react';
import {
  Home,
  UploadCloud,
  AlertTriangle,
  Database,
  Settings,
  Clock,
  ShieldAlert
} from 'lucide-react';

export default function Sidebar({ activeTab, onTabChange, onSelectTab }) {
  const handleSelect = (id) => {
    if (typeof onTabChange === 'function') {
      onTabChange(id);
    }
    if (typeof onSelectTab === 'function') {
      onSelectTab(id);
    }
  };

  const navItems = [
    { id: 'overview', label: 'Overview', icon: Home },
    { id: 'upload', label: 'Upload Data', icon: UploadCloud },
    { id: 'history', label: 'Report History', icon: Clock },
    { id: 'incidents', label: 'Proactive Tickets & Engineer SLA Performance', icon: AlertTriangle },
    { id: 'inventory', label: 'Device Inventory', icon: Database },
    { id: 'vulnerabilities', label: 'Vulnerabilities', icon: ShieldAlert },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <aside
      className="w-[260px] bg-[#0f172a] flex flex-col text-white flex-shrink-0 select-none h-screen justify-between"
      style={{
        width: '260px',
        minWidth: '260px',
        maxWidth: '260px',
        backgroundColor: '#0f172a',
        display: 'flex',
        flexDirection: 'column',
        color: '#ffffff',
        flexShrink: 0,
        height: '100vh',
        borderRight: '1px solid #1e293b'
      }}
    >
      {/* Top Header / Logo Area */}
      <div>
        <div
          className="h-20 flex items-center px-6 border-b border-gray-800"
          style={{
            height: '80px',
            display: 'flex',
            alignItems: 'center',
            padding: '0 1.5rem',
            borderBottom: '1px solid #1e293b'
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div
                style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  backgroundColor: '#3b82f6',
                  boxShadow: '0 0 10px #3b82f6'
                }}
              />
              <h1
                className="font-bold text-lg leading-tight tracking-tight text-white m-0"
                style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, color: '#ffffff' }}
              >
                Proactive Reports
              </h1>
            </div>
            <span
              className="text-[10px] text-gray-400 font-medium"
              style={{ fontSize: '10px', color: '#94a3af', letterSpacing: '0.02em' }}
            >
              Predict. Prevent. Perform. - Smarter Network
            </span>
          </div>
        </div>

        {/* Nav List */}
        <nav
          className="flex-1 py-4 flex flex-col gap-1 overflow-y-auto"
          style={{ padding: '1rem 0', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              activeTab === item.id ||
              (item.id === 'overview' && activeTab === 'dashboard') ||
              (item.id === 'incidents' && activeTab === 'tickets');
            return (
              <button
                key={item.id}
                onClick={() => handleSelect(item.id)}
                className={`flex items-center gap-3 px-6 py-3 text-sm cursor-pointer transition-all text-left w-full border-none ${
                  isActive
                    ? 'bg-[#1d4ed8] text-white border-l-4 border-blue-400 font-semibold'
                    : 'text-gray-300 hover:text-white hover:bg-gray-800'
                }`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.75rem 1.5rem',
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                  border: 'none',
                  textAlign: 'left',
                  width: '100%',
                  backgroundColor: isActive ? '#1d4ed8' : 'transparent',
                  color: isActive ? '#ffffff' : '#cbd5e1',
                  borderLeft: isActive ? '4px solid #60a5fa' : '4px solid transparent',
                  fontWeight: isActive ? 600 : 400,
                  transition: 'background-color 0.15s ease, color 0.15s ease'
                }}
              >
                <Icon
                  size={18}
                  style={{
                    color: isActive ? '#ffffff' : '#94a3b8',
                    flexShrink: 0
                  }}
                />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
