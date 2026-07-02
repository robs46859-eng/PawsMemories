import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-surface px-4 text-center">
          <div className="bg-surface-container p-8 rounded-3xl shadow-xl max-w-md w-full">
            <span className="text-5xl mb-4 block text-error">🚨</span>
            <h1 className="text-2xl font-bold mb-2 text-on-surface">Something went wrong</h1>
            <p className="text-on-surface-variant mb-6">
              The application encountered an unexpected error. Please refresh the page to try again.
            </p>
            <button
              className="bg-primary text-on-primary px-6 py-3 rounded-full font-bold shadow hover:bg-primary/90 transition-colors"
              onClick={() => window.location.reload()}
            >
              🔄 Refresh Page
            </button>
            {process.env.NODE_ENV !== "production" && this.state.error && (
              <pre className="mt-6 text-left text-xs bg-black/10 p-4 rounded-xl overflow-auto text-on-surface max-h-32">
                {this.state.error.toString()}
              </pre>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
