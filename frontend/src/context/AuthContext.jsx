// frontend/src/context/AuthContext.jsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import API_BASE from '../config/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('portal_user');
    return saved ? JSON.parse(saved) : {
      id: 'user-admin',
      email: 'admin@portal.com',
      name: 'System Admin',
      role: 'admin',
      assignedClient: 'all',
      avatar: '👨‍💼'
    };
  });

  const [clients, setClients] = useState([]);
  const [activeClient, setActiveClientState] = useState(null);
  const [activeLocation, setActiveLocation] = useState('All Locations');
  const [loadingClients, setLoadingClients] = useState(true);

  // Fetch client list from backend
  const refreshClients = async () => {
    try {
      setLoadingClients(true);
      const res = await fetch(`${API_BASE}/api/clients`);
      if (res.ok) {
        const json = await res.json();
        setClients(json.clients || []);
        if (!activeClient && json.clients && json.clients.length > 0) {
          // Set initial default client
          if (user?.role === 'client_user' && user?.assignedClient !== 'all') {
            const assigned = json.clients.find((c) => c.id === user.assignedClient) || json.clients[0];
            setActiveClientState(assigned);
          } else {
            setActiveClientState(json.clients[0]);
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch clients:', err);
    } finally {
      setLoadingClients(false);
    }
  };

  useEffect(() => {
    refreshClients();
  }, [user]);

  const setActiveClient = (client) => {
    setActiveClientState(client);
    setActiveLocation('All Locations'); // Reset location when switching client
  };

  const login = async (email, password) => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Login failed');

      setUser(json.user);
      localStorage.setItem('portal_user', JSON.stringify(json.user));
      localStorage.setItem('portal_token', json.token);

      // Auto-set client based on role
      if (json.user.role === 'client_user' && json.user.assignedClient !== 'all') {
        const target = clients.find((c) => c.id === json.user.assignedClient);
        if (target) setActiveClient(target);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('portal_user');
    localStorage.removeItem('portal_token');
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        clients,
        activeClient,
        activeLocation,
        loadingClients,
        setActiveClient,
        setActiveLocation,
        login,
        logout,
        refreshClients,
        isAdmin: user?.role === 'admin',
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
