import React from "react";
import { AlertTriangle, X } from "lucide-react";

interface Props {
  children: React.ReactNode;
  onClose: () => void;
  hasWebGL2?: boolean;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class AnimatorErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[AnimatorErrorBoundary] caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError || this.props.hasWebGL2 === false) {
      return (
        <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-300">
          <button 
            onClick={this.props.onClose}
            className="absolute top-4 right-4 text-white/60 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors"
          >
            <X size={24} />
          </button>
          
          <div className="bg-red-500/20 text-red-400 p-4 rounded-full mb-6">
            <AlertTriangle size={48} />
          </div>
          
          <h2 className="text-xl font-bold text-white mb-2">
            Studio Unavailable
          </h2>
          <p className="text-white/60 max-w-sm mb-8 text-sm leading-relaxed">
            {this.props.hasWebGL2 === false 
              ? "The Animation Studio requires a modern browser with WebGL2 support. Please try again on a desktop computer or a more recent device."
              : "The Animation Studio ran out of memory or encountered a graphics error. Please try again or use a device with more memory."}
          </p>
          
          <button 
            onClick={this.props.onClose}
            className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-full font-bold transition-all active:scale-95"
          >
            Go Back
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
