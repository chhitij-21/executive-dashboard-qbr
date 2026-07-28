// frontend/src/components/LoginModal.jsx
import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

export default function LoginModal({ isOpen, onClose }) {
  const { login } = useAuth();
  const [email, setEmail] = useState('admin@portal.com');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState(null);
  const [demoAccounts, setDemoAccounts] = useState([]);

  useEffect(() => {
    fetch('/api/auth/demo-accounts')
      .then((res) => res.json())
      .then((data) => setDemoAccounts(data.users || []))
      .catch(() => {});
  }, []);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    const res = await login(email, password);
    if (res.success) {
      onClose();
    } else {
      setError(res.error);
    }
  };

  const handleDemoClick = async (demoUser) => {
    setError(null);
    setEmail(demoUser.email);
    setPassword(demoUser.password);
    const res = await login(demoUser.email, demoUser.password);
    if (res.success) {
      onClose();
    } else {
      setError(res.error);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>🔐 Enterprise Portal Sign In</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {error && <div className="alert-error">⚠️ {error}</div>}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label>Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
