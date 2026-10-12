import React from 'react';
import { createRoot } from 'react-dom/client';
// SpeedInsights stripped for AI Studio environment
const SpeedInsights = () => null;
import './config/env.ts';
import App from './App.jsx';
import './index.css';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { AppProvider } from './context/AppContext';
import { LoadingProvider } from './context/LoadingContext';
import { TenantProvider } from './context/TenantContext';
import ModalInteractionGuard from './components/ModalInteractionGuard';
import ErrorBoundary from './components/ErrorBoundary';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <LoadingProvider>
        <AuthProvider>
          <ToastProvider>
            <TenantProvider>
              <AppProvider>
                <ModalInteractionGuard />
                <App />
                <SpeedInsights />
              </AppProvider>
            </TenantProvider>
          </ToastProvider>
        </AuthProvider>
      </LoadingProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
