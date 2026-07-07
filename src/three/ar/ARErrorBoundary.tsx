/**
 * src/three/ar/ARErrorBoundary.tsx — AR_PET_SIM_SPEC §9 / AR9
 * Wraps the AR canvas so a WebGL/AR failure shows a recoverable message instead
 * of crashing the whole app. Report hook lets us forward errors (H6 observability).
 */

import React from "react";

interface Props {
  children: React.ReactNode;
  onError?: (error: Error, info: React.ErrorInfo) => void;
  fallback?: React.ReactNode;
}
interface State {
  hasError: boolean;
  message: string;
}

export default class ARErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.message || "AR failed to start." };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.props.onError?.(error, info);
    // eslint-disable-next-line no-console
    console.error("[ARErrorBoundary]", error?.message, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="w-full h-full flex flex-col items-center justify-center text-center gap-2 p-6">
            <p className="text-sm font-bold">AR couldn’t start on this device.</p>
            <p className="text-xs opacity-60 max-w-xs">{this.state.message}</p>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
