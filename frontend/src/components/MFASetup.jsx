// frontend/src/components/MFASetup.jsx
// Enterprise MFA configuration card supporting QR code scanning and TOTP token verification.

import React, { useState, useEffect } from 'react';
import { API_BASE_URL, apiFetch } from '../config/api';
import { useAuth } from '../context/AuthContext';

export default function MFASetup() {
  const { user } = useAuth();
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [setupData, setSetupData] = useState(null); // { secret, qrCode }
  const [verificationCode, setVerificationCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [copied, setCopied] = useState(false);

  // Fetch current MFA status
  const loadMfaStatus = async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/mfa/status`);
      if (res.ok) {
        const json = await res.json();
        setMfaEnabled(!!json.mfaEnabled);
      }
    } catch (err) {
      console.warn('Failed to fetch MFA status:', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMfaStatus();
  }, [user]);

  // Start setup: fetch QR code and secret
  const handleStartSetup = async () => {
    setError(null);
    setSuccessMsg(null);
    setLoading(true);
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/mfa/setup`, { method: 'POST' });
      const json = await res.json();
      if (res.ok && json.success) {
        setSetupData(json);
      } else {
        setError(json.error || 'Failed to start MFA setup.');
      }
    } catch (err) {
      setError('Connection error while initializing MFA setup.');
    } finally {
      setLoading(false);
    }
  };

  // Verify 6-digit code and enable MFA
  const handleVerifyCode = async (e) => {
    e.preventDefault();
    const clean = verificationCode.replace(/\s+/g, '').trim();
    if (!clean || clean.length !== 6) {
      setError('Please enter a valid 6-digit code.');
      return;
    }

    setVerifying(true);
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/mfa/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: clean }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setMfaEnabled(true);
        setSetupData(null);
        setVerificationCode('');
        setSuccessMsg('Two-Factor Authentication has been successfully enabled on your account!');
      } else {
        setError(json.error || 'Invalid 6-digit code. Please try again.');
      }
    } catch (err) {
      setError('Network error during verification.');
    } finally {
      setVerifying(false);
    }
  };

  // Disable MFA
  const handleDisableMfa = async () => {
    if (!window.confirm('Are you sure you want to disable Two-Factor Authentication? Your account will only be protected by password.')) {
      return;
    }

    setDisabling(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/mfa/disable`, { method: 'POST' });
      const json = await res.json();
      if (res.ok && json.success) {
        setMfaEnabled(false);
        setSetupData(null);
        setSuccessMsg('Two-Factor Authentication has been disabled.');
      } else {
        setError(json.error || 'Failed to disable MFA.');
      }
    } catch (err) {
      setError('Network error while disabling MFA.');
    } finally {
      setDisabling(false);
    }
  };

  const handleCopySecret = () => {
    if (setupData?.secret) {
      navigator.clipboard.writeText(setupData.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '1.25rem', color: 'var(--text-secondary)' }}>
        Loading security settings...
      </div>
    );
  }

  return (
    <div
      style={{
        background: 'var(--bg-card, #1e293b)',
        border: '1px solid var(--border, #334155)',
        borderRadius: '12px',
        padding: '1.5rem',
        marginTop: '1.5rem',
        boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ fontSize: '1.75rem' }}>🔐</div>
          <div>
            <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>Two-Factor Authentication (TOTP)</h4>
            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Protect your account using standard Authenticator Apps (Google Authenticator, Microsoft Authenticator, 1Password).
            </p>
          </div>
        </div>

        <div>
          {mfaEnabled ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                background: 'rgba(16, 185, 129, 0.15)',
                color: '#10b981',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                padding: '0.35rem 0.8rem',
                borderRadius: '9999px',
                fontSize: '0.85rem',
                fontWeight: 600,
              }}
            >
              🛡️ Active & Protected
            </span>
          ) : (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#ef4444',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                padding: '0.35rem 0.8rem',
                borderRadius: '9999px',
                fontSize: '0.85rem',
                fontWeight: 600,
              }}
            >
              ⚠️ Disabled
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="alert-error" style={{ marginBottom: '1rem' }}>
          ⚠️ {error}
        </div>
      )}

      {successMsg && (
        <div
          style={{
            background: 'rgba(16, 185, 129, 0.15)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            color: '#10b981',
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            marginBottom: '1rem',
            fontSize: '0.88rem',
          }}
        >
          ✓ {successMsg}
        </div>
      )}

      {!mfaEnabled && !setupData && (
        <div>
          <button
            onClick={handleStartSetup}
            className="btn-primary"
            style={{ padding: '0.6rem 1.25rem', fontSize: '0.9rem', fontWeight: 600 }}
          >
            ➕ Setup Two-Factor Authentication
          </button>
        </div>
      )}

      {/* Setup Step: Show QR Code & Form */}
      {!mfaEnabled && setupData && (
        <div
          style={{
            background: 'var(--bg-input, #0f172a)',
            border: '1px solid var(--border, #334155)',
            borderRadius: '10px',
            padding: '1.25rem',
            marginTop: '1rem',
          }}
        >
          <h5 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            Step 1: Scan QR Code in your Authenticator App
          </h5>
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1.25rem' }}>
            <div
              style={{
                background: '#ffffff',
                padding: '0.75rem',
                borderRadius: '8px',
                display: 'inline-block',
                boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
              }}
            >
              <img
                src={setupData.qrCode}
                alt="MFA QR Code"
                style={{ width: '160px', height: '160px', display: 'block' }}
              />
            </div>

            <div style={{ maxWidth: '380px' }}>
              <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Cannot scan QR code? Enter this setup key manually into your app:
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <code
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    padding: '0.4rem 0.6rem',
                    borderRadius: '4px',
                    fontSize: '0.85rem',
                    letterSpacing: '0.08rem',
                    color: 'var(--accent, #6366f1)',
                    wordBreak: 'break-all',
                  }}
                >
                  {setupData.secret}
                </code>
                <button
                  type="button"
                  onClick={handleCopySecret}
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                    padding: '0.35rem 0.6rem',
                    borderRadius: '4px',
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                  }}
                >
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            </div>
          </div>

          <h5 style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            Step 2: Enter 6-digit confirmation code from your app
          </h5>
          <form onSubmit={handleVerifyCode} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              maxLength={6}
              value={verificationCode}
              onChange={(e) => setVerificationCode(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="000000"
              required
              style={{
                width: '130px',
                fontSize: '1.25rem',
                letterSpacing: '0.2rem',
                textAlign: 'center',
                fontWeight: 700,
                padding: '0.5rem',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
              }}
            />

            <button
              type="submit"
              disabled={verifying || verificationCode.length !== 6}
              className="btn-primary"
              style={{
                padding: '0.6rem 1.25rem',
                fontWeight: 600,
                cursor: verifying || verificationCode.length !== 6 ? 'not-allowed' : 'pointer',
                opacity: verifying || verificationCode.length !== 6 ? 0.65 : 1,
              }}
            >
              {verifying ? 'Verifying...' : 'Enable Two-Factor Auth'}
            </button>

            <button
              type="button"
              onClick={() => {
                setSetupData(null);
                setVerificationCode('');
                setError(null);
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: '0.85rem',
                textDecoration: 'underline',
              }}
            >
              Cancel
            </button>
          </form>
        </div>
      )}

      {/* When MFA is enabled: show option to disable */}
      {mfaEnabled && (
        <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Your account requires a 6-digit Authenticator code on every sign-in.
          </p>
          <button
            type="button"
            onClick={handleDisableMfa}
            disabled={disabling}
            style={{
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#ef4444',
              padding: '0.4rem 0.9rem',
              borderRadius: '6px',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: disabling ? 'not-allowed' : 'pointer',
            }}
          >
            {disabling ? 'Disabling...' : 'Disable Two-Factor Auth'}
          </button>
        </div>
      )}
    </div>
  );
}
