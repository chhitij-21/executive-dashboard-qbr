// frontend/src/context/AuthContext.jsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import { API_BASE_URL } from '../config/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem('portal_token') || null);
  const [clients, setClients] = useState([]);
  const [activeClient, setActiveClientState] = useState(null);
  const [activeLocation, setActiveLocation] = useState('All Locations');
  const [loadingClients, setLoadingClients] = useState(true);
  const [authenticating, setAuthenticating] = useState(true);
  const [isBackendOffline, setIsBackendOffline] = useState(false);

  // Requirement 4: On load, automatically call GET /api/auth/me if token exists
  useEffect(() => {
    const checkSession = async () => {
      const savedToken = localStorage.getItem('portal_token');
      if (!savedToken) {
        setUser(null);
        setSession(null);
        setAuthenticating(false);
        return;
      }

      try {
        const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${savedToken}` },
        });

        if (res.ok) {
          const data = await res.json();
          const sessionUser = data.user || data;
          setUser(sessionUser);
          setSession(data);
          setToken(savedToken);
          setIsBackendOffline(false);
        } else {
          // Token expired or invalid session
          logout();
        }
      } catch (err) {
        console.error('Error verifying session:', err);
        const savedUser = localStorage.getItem('portal_user');
        if (savedUser) {
          setUser(JSON.parse(savedUser));
        } else {
          logout();
        }
      } finally {
        setAuthenticating(false);
      }
    };

    checkSession();
  }, []);

  // Fetch client list from backend
  const refreshClients = async () => {
    try {
      setLoadingClients(true);
      const res = await fetch(`${API_BASE_URL}/api/clients`);
      if (res.ok) {
        const json = await res.json();
        setClients(json.clients || []);
        setIsBackendOffline(false);
        if (!activeClient && json.clients && json.clients.length > 0) {
          if (user?.role === 'client_user' && user?.assignedClient !== 'all') {
            const assigned = json.clients.find((c) => c.id === user.assignedClient) || json.clients[0];
            setActiveClientState(assigned);
          } else {
            setActiveClientState(json.clients[0]);
          }
        }
      } else {
        setIsBackendOffline(true);
      }
    } catch (err) {
      console.error('Failed to fetch clients:', err);
      setIsBackendOffline(true);
    } finally {
      setLoadingClients(false);
    }
  };

  useEffect(() => {
    refreshClients();
  }, [user]);

  const setActiveClient = (client) => {
    setActiveClientState(client);
    setActiveLocation('All Locations');
  };

  // Requirement 1, 2, 3: POST /api/auth/login with API_BASE_URL and store state
  const login = async (email, password) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const json = await res.json();

      if (!res.ok || res.status === 401) {
        // Requirement 3: Return "Invalid username or password" on Unauthorized / error
        return { success: false, error: 'Invalid username or password' };
      }

      // Requirement 2: Store name, role, client, location, session inside AuthContext
      const sessionData = json;
      const userObj = json.user || json;

      setUser(userObj);
      setSession(sessionData);
      if (json.token) setToken(json.token);
      setIsBackendOffline(false);

      localStorage.setItem('portal_user', JSON.stringify(userObj));
      if (json.token) localStorage.setItem('portal_token', json.token);

      if (userObj.role === 'client_user' && userObj.assignedClient !== 'all') {
        const target = clients.find((c) => c.id === userObj.assignedClient);
        if (target) setActiveClient(target);
      }

      return { success: true };
    } catch (err) {
      if (err.name === 'TypeError' || err.message.includes('fetch') || err.message.includes('NetworkError')) {
        setIsBackendOffline(true);
        return { success: false, error: 'Backend Offline' };
      }
      return { success: false, error: 'Invalid username or password' };
    }
  };

  const logout = () => {
    setUser(null);
    setSession(null);
    setToken(null);
    localStorage.removeItem('portal_user');
    localStorage.removeItem('portal_token');
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        token,
        clients,
        activeClient,
        activeLocation,
        loadingClients,
        authenticating,
        isBackendOffline,
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
