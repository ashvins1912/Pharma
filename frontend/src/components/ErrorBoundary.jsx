import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    // Log to console with rich detail
    console.error('Uncaught application runtime error caught by ErrorBoundary:', error, errorInfo?.componentStack);
    
    // Optional external error reporting hook if available
    if (window.__REPORT_ERROR__) {
      try {
        window.__REPORT_ERROR__(error, errorInfo);
      } catch (err) {
        console.error('Failed to report error:', err);
      }
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 font-sans">
          <div className="max-w-xl w-full bg-white rounded-3xl shadow-xl border border-slate-200/80 p-8 text-center">
            <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-5 text-3xl shadow-inner">
              ⚠️
            </div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              Application Error Encountered
            </h1>
            <p className="mt-3 text-sm text-slate-600 leading-relaxed">
              We encountered an unexpected runtime or loading error. To protect your data and prevent persistent crashes, the application has safely paused.
            </p>

            {this.state.error && (
              <div className="mt-6 text-left bg-slate-900 text-slate-100 p-4 rounded-2xl text-xs font-mono overflow-auto max-h-48 border border-slate-800 shadow-inner">
                <p className="font-bold text-red-400 mb-1">{this.state.error.toString()}</p>
                {this.state.errorInfo?.componentStack && (
                  <pre className="text-slate-400 whitespace-pre-wrap leading-tight">
                    {this.state.errorInfo.componentStack}
                  </pre>
                )}
              </div>
            )}

            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                type="button"
                onClick={this.handleReset}
                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm shadow-lg shadow-blue-600/25 transition-all active:scale-95"
              >
                Reload Application
              </button>
              <button
                type="button"
                onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm transition-all active:scale-95"
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
