import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

const LoadingContext = createContext(null);

export function LoadingProvider({ children }) {
  const [activeRequests, setActiveRequests] = useState(0);
  const [blockingRequests, setBlockingRequests] = useState(0);

  useEffect(() => {
    const handleStart = (event) => {
      setActiveRequests((count) => count + 1);
      if (event.detail?.blocking) setBlockingRequests((count) => count + 1);
    };

    const handleStop = (event) => {
      setActiveRequests((count) => Math.max(0, count - 1));
      if (event.detail?.blocking) setBlockingRequests((count) => Math.max(0, count - 1));
    };

    window.addEventListener('pharma:request-start', handleStart);
    window.addEventListener('pharma:request-stop', handleStop);

    return () => {
      window.removeEventListener('pharma:request-start', handleStart);
      window.removeEventListener('pharma:request-stop', handleStop);
    };
  }, []);

  const value = useMemo(() => ({
    isLoading: activeRequests > 0,
    isBlocking: blockingRequests > 0
  }), [activeRequests, blockingRequests]);

  return (
    <LoadingContext.Provider value={value}>
      {children}
    </LoadingContext.Provider>
  );
}

export function useGlobalLoading() {
  const context = useContext(LoadingContext);
  if (!context) {
    throw new Error('useGlobalLoading must be used within a LoadingProvider.');
  }
  return context;
}

export function GlobalLoadingIndicator() {
  const { isLoading, isBlocking } = useGlobalLoading();

  if (!isLoading) return null;

  return (
    <>
      <div
        className="fixed top-0 left-0 right-0 z-[9999] h-0.5 overflow-hidden bg-blue-100"
        role="progressbar"
        aria-label="Loading"
        aria-busy="true"
      >
        <div className="h-full w-1/3 bg-blue-600 animate-[loading-slide_1.1s_ease-in-out_infinite]" />
      </div>

      {isBlocking && (
        <div
          className="fixed inset-0 z-[9998] flex items-center justify-center bg-slate-950/10 backdrop-blur-[1px]"
          role="status"
          aria-live="polite"
          aria-label="Please wait"
        >
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-3 shadow-xl">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
            <span className="text-sm font-bold text-slate-700">Please wait...</span>
          </div>
        </div>
      )}
    </>
  );
}
