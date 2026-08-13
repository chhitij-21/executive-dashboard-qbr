// frontend/src/components/ErrorBoundary.jsx
// FINDING-033 FIX: React ErrorBoundary to prevent full SPA white-screen crashes.
// Wraps the entire application so any unhandled rendering error is caught and
// displayed gracefully with a recovery option.

import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    // Log to console for debugging; in production, send to an error reporting service
    console.error('[ErrorBoundary] Caught unhandled error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          background: '#f8fafc',
          padding: '2rem',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}>
          <div style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '2.5rem',
            maxWidth: '560px',
            width: '100%',
            textAlign: 'center',
            boxShadow: '0 4px 24px rgba(0,0,0,0.07)',
          }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
            <h2 style={{ color: '#0f172a', fontSize: '1.4rem', fontWeight: 700, marginBottom: '0.75rem' }}>
              An Unexpected Error Occurred
            </h2>
            <p style={{ color: '#64748b', fontSize: '0.95rem', marginBottom: '1.5rem' }}>
              A component error was caught and isolated. Your data is safe.
              Click below to attempt recovery, or refresh the page if the issue persists.
            </p>
            {process.env.NODE_ENV !== 'production' && this.state.error && (
              <details style={{ textAlign: 'left', marginBottom: '1.5rem', background: '#f1f5f9', borderRadius: '6px', padding: '1rem' }}>
                <summary style={{ cursor: 'pointer', color: '#475569', fontWeight: 600, fontSize: '0.85rem' }}>
                  Error Details (dev only)
                </summary>
                <pre style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: '#ef4444', overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {this.state.error.toString()}
                  {'\n\n'}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <button
                onClick={this.handleReset}
                style={{
                  background: '#1e5fa8', color: '#fff', border: 'none',
                  borderRadius: '8px', padding: '0.6rem 1.5rem',
                  fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer',
                }}
              >
                Try to Recover
              </button>
              <button
                onClick={() => window.location.reload()}
                style={{
                  background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1',
                  borderRadius: '8px', padding: '0.6rem 1.5rem',
                  fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer',
                }}
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
