// frontend/src/context/AuthContext.jsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import { API_BASE_URL, apiFetch } from '../config/api';

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

  // On load: validate stored token against backend, or auto-login with default admin credentials
  useEffect(() => {
    const checkSession = async () => {
      const storedToken = localStorage.getItem('portal_token');
      if (storedToken) {
        try {
          const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
            headers: { Authorization: `Bearer ${storedToken}` },
          });

          if (res.ok) {
            const json = await res.json();
            const userObj = json.user || json;
            setUser(userObj);
            setSession({ user: userObj, token: storedToken });
            setToken(storedToken);
            setIsBackendOffline(false);
            setAuthenticating(false);
            return;
          }
        } catch (err) {
          console.warn('Session check failed, attempting auto-login fallback:', err.message);
        }
      }

      // Explicit Login Enforcement: No automatic login fallback.
      // Unauthenticated users must log in via the login modal.
      setAuthenticating(false);

    };

    checkSession();
  }, []);

  // Fetch client list from backend with auto-retry for Render cold starts
  const refreshClients = async (retryCount = 0) => {
    try {
      setLoadingClients(true);
      const res = await apiFetch(`${API_BASE_URL}/api/clients`);
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
      } else if (retryCount < 8) {
        // Render cold start retry: wait 3s and retry up to 8 times (~24s window)
        setTimeout(() => refreshClients(retryCount + 1), 3000);
      } else {
        setIsBackendOffline(true);
      }
    } catch (err) {
      console.warn(`[AuthContext] Connection attempt ${retryCount + 1} failed (server spinning up...):`, err.message);
      if (retryCount < 8) {
        // Render cold start retry: wait 3s and retry up to 8 times (~24s window)
        setTimeout(() => refreshClients(retryCount + 1), 3000);
      } else {
        setIsBackendOffline(true);
      }
    } finally {
      setLoadingClients(false);
    }
  };

  useEffect(() => {
    refreshClients();
  }, [user]);

  useEffect(() => {
    if (!activeClient && clients && clients.length > 0) {
      setActiveClientState(clients[0]);
    }
  }, [clients, activeClient]);

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

      const safeUserStorage = {
        email: userObj.email,
        name: userObj.name,
        role: userObj.role,
        assignedClient: userObj.assignedClient,
      };
      localStorage.setItem('portal_user', JSON.stringify(safeUserStorage));
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

  const logout = async () => {
    // Invalidate token on the server
    try {
      await apiFetch(`${API_BASE_URL}/api/auth/logout`, { method: 'POST' });
    } catch (_) { /* ignore network errors on logout */ }

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
