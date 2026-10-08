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
import ModalInteractionGuard from './components/ModalInteractionGuard';
import CustomerErrorBoundary from './components/CustomerErrorBoundary';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <LoadingProvider>
      <AuthProvider>
        <ToastProvider>
          <AppProvider>
            <ModalInteractionGuard />
            <CustomerErrorBoundary>
              <App />
            </CustomerErrorBoundary>
            <SpeedInsights />
          </AppProvider>
        </ToastProvider>
      </AuthProvider>
    </LoadingProvider>
  </React.StrictMode>
);
