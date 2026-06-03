import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', backgroundColor: '#fef2f2', color: '#991b1b', fontFamily: 'monospace', minHeight: '100vh' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>Application Crashed</h1>
          <p style={{ marginBottom: '1rem' }}>Please copy this error and send it to the developer:</p>
          <div style={{ backgroundColor: 'white', padding: '1rem', border: '1px solid #f87171', borderRadius: '0.5rem', overflow: 'auto' }}>
            <h3 style={{ fontWeight: 'bold' }}>{this.state.error && this.state.error.toString()}</h3>
            <pre style={{ marginTop: '1rem', whiteSpace: 'pre-wrap', fontSize: '0.875rem' }}>
              {this.state.errorInfo && this.state.errorInfo.componentStack}
            </pre>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
