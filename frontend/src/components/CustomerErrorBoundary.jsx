import React from 'react';

export default class CustomerErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    if (import.meta.env.DEV) console.error('Customer portal render failure:', error, info.componentStack);
    else console.error('Customer portal render failure.', { componentStack: info.componentStack });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <main className="mx-auto my-16 max-w-lg rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm" role="alert">
        <h1 className="text-lg font-extrabold text-slate-900">Something went wrong.</h1>
        <p className="mt-2 text-sm text-slate-600">Please try again.</p>
        <button type="button" onClick={() => this.setState({ hasError: false })} className="mt-5 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white">Try Again</button>
      </main>
    );
  }
}
