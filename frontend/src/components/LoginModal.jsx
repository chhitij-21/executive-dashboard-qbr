// frontend/src/components/LoginModal.jsx
import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../config/api';

export default function LoginModal({ isOpen, onClose }) {
  const { login, isBackendOffline } = useAuth();
  const [email, setEmail] = useState(import.meta.env.VITE_ADMIN_EMAIL || 'admin@portal.com');
  const [password, setPassword] = useState(import.meta.env.VITE_ADMIN_PASSWORD || 'admin123');
  const [error, setError] = useState(null);
  const [demoAccounts, setDemoAccounts] = useState([]);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/auth/demo-accounts`)
      .then((res) => {
        if (!res.ok) throw new Error('Backend Offline');
        return res.json();
      })
      .then((data) => setDemoAccounts(data.users || []))
      .catch(() => {
        setError('Backend Offline');
      });
  }, []);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    const res = await login(email, password);
    if (res.success) {
      onClose();
    } else {
      setError(res.error || 'Backend Offline');
    }
  };

  const handleDemoClick = async (demoUser) => {
    setError(null);
    const pass = demoUser.password || 'admin123';
    setEmail(demoUser.email);
    setPassword(pass);
    const res = await login(demoUser.email, pass);
    if (res.success) {
      onClose();
    } else {
      setError(res.error || 'Backend Offline');
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>🔐 Enterprise Portal Sign In</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {(error || isBackendOffline) && (
          <div className="alert-error">⚠️ {error || 'Backend Offline'}</div>
        )}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label>Username / Email</label>
            <input
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Username or Email"
              required
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="btn-primary full-width">
            Sign In to Portal
          </button>
        </form>

        <div className="demo-divider">
          <span>OR QUICK SIGN-IN AS</span>
        </div>

        <div className="demo-accounts-grid">
          {demoAccounts.map((acc) => (
            <button
              key={acc.email}
              className="btn-demo-account"
              onClick={() => handleDemoClick(acc)}
            >
              <div className="demo-role">{acc.role === 'admin' ? '👨‍💼 Admin' : '👩‍💻 Client User'}</div>
              <div className="demo-name">{acc.name}</div>
              <div className="demo-email">{acc.email}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
