import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

const LoadingContext = createContext(null);

export const LOADING_ACTIONS = Object.freeze({
  SIGN_IN: 'SIGN_IN',
  SIGN_OUT: 'SIGN_OUT',
  CREATE_ORDER: 'CREATE_ORDER',
  CANCEL_ORDER: 'CANCEL_ORDER',
  TRACK_ORDER: 'TRACK_ORDER',
  CREATE_MEDICINE: 'CREATE_MEDICINE',
  APPROVE_MEDICINE: 'APPROVE_MEDICINE',
  REJECT_MEDICINE: 'REJECT_MEDICINE',
  CONVERT_MEDICINE_TO_ORDER: 'CONVERT_MEDICINE_TO_ORDER',
  SAVE_ADDRESS: 'SAVE_ADDRESS',
  EDIT_ADDRESS: 'EDIT_ADDRESS',
  REMOVE_ADDRESS: 'REMOVE_ADDRESS',
  UPLOAD_PRESCRIPTION: 'UPLOAD_PRESCRIPTION',
  VIEW_PRESCRIPTION: 'VIEW_PRESCRIPTION',
  APPROVE_PRESCRIPTION: 'APPROVE_PRESCRIPTION',
  REJECT_PRESCRIPTION: 'REJECT_PRESCRIPTION',
  SAVE_PERSONAL_DETAILS: 'SAVE_PERSONAL_DETAILS',
  CREATE_RELATIVE: 'CREATE_RELATIVE',
  EDIT_RELATIVE: 'EDIT_RELATIVE',
  REMOVE_RELATIVE: 'REMOVE_RELATIVE'
});

export function LoadingProvider({ children }) {
  const [loadingAction, setLoadingAction] = useState(null);
  const loadingActionRef = useRef(null);

  const startAction = useCallback((action) => {
    if (!action || loadingActionRef.current) return false;
    loadingActionRef.current = action;
    setLoadingAction(action);
    return true;
  }, []);

  const stopAction = useCallback((action) => {
    if (!action || loadingActionRef.current === action) {
      loadingActionRef.current = null;
      setLoadingAction(null);
    }
  }, []);

  const runAction = useCallback(async (action, operation) => {
    if (!startAction(action)) return { skipped: true };
    try {
      return await operation();
    } finally {
      stopAction(action);
    }
  }, [startAction, stopAction]);

  const value = useMemo(() => ({
    loadingAction,
    isActionLoading: (action) => loadingAction === action,
    startAction,
    stopAction,
    runAction,
    // Backward-compatible flags for callers that only need to know whether
    // a targeted action is running. These no longer drive a global spinner.
    isLoading: Boolean(loadingAction),
    isBlocking: false
  }), [loadingAction, startAction, stopAction, runAction]);

  return <LoadingContext.Provider value={value}>{children}</LoadingContext.Provider>;
}

export function useActionLoading() {
  const context = useContext(LoadingContext);
  if (!context) throw new Error('useActionLoading must be used within a LoadingProvider.');
  return context;
}

// Intentionally no global spinner. Visible loading is rendered by the exact
// button/control that owns the action, while all other API calls remain silent.
export function GlobalLoadingIndicator() {
  return null;
}
