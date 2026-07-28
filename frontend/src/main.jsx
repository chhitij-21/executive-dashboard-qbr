// frontend/src/main.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/index.css';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Unhandled React Error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '2rem',
          maxWidth: '800px',
          margin: '2rem auto',
          background: '#161B22',
          color: '#F85149',
          border: '1px solid #F85149',
          borderRadius: '8px',
          fontFamily: 'monospace'
        }}>
          <h2>⚠️ React Application Error</h2>
          <p style={{ margin: '1rem 0', color: '#E6EDF3' }}>
            {this.state.error?.toString()}
          </p>
          <pre style={{
            background: '#0D1117',
            padding: '1rem',
            borderRadius: '4px',
            overflowX: 'auto',
            color: '#8B949E',
            fontSize: '0.85rem'
          }}>
            {this.state.errorInfo?.componentStack || this.state.error?.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
