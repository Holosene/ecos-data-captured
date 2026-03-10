import React from 'react';
import { colors, Button } from '@echos/ui';

interface Props {
  children: React.ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ViewerErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[VolumeViewer] Crash caught by ErrorBoundary:', error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '60vh',
          padding: '48px 24px',
          textAlign: 'center',
          background: colors.black,
        }}>
          <h2 style={{
            color: colors.text1,
            fontSize: '22px',
            fontWeight: 600,
            marginBottom: '12px',
          }}>
            Erreur de rendu 3D
          </h2>
          <p style={{
            color: colors.text3,
            fontSize: '14px',
            maxWidth: '480px',
            lineHeight: 1.6,
            marginBottom: '8px',
          }}>
            Le visualiseur volumique a rencontré une erreur. Cela peut arriver si le GPU
            est surchargé ou si le contexte WebGL a été perdu.
          </p>
          {this.state.error && (
            <pre style={{
              color: colors.error,
              fontSize: '12px',
              background: 'rgba(255,0,0,0.08)',
              border: `1px solid ${colors.error}`,
              borderRadius: '8px',
              padding: '12px 16px',
              maxWidth: '600px',
              overflow: 'auto',
              marginBottom: '24px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {this.state.error.message}
            </pre>
          )}
          <Button variant="primary" size="md" onClick={this.handleRetry}>
            Réessayer
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
