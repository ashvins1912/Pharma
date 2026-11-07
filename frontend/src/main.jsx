import React from 'react';
import { createRoot } from 'react-dom/client';
// SpeedInsights stripped for AI Studio environment
const SpeedInsights = () => null;
import './config/env.ts';
import App from './App.jsx';
import './index.css';
import { AuthProvider } from './context/AuthContext';
import { LanguageProvider } from './context/LanguageContext';
import { ToastProvider } from './context/ToastContext';
import { AppProvider } from './context/AppContext';
import { LoadingProvider } from './context/LoadingContext';
import { TenantProvider } from './context/TenantContext';
import { TranslationProvider } from './context/TranslationContext';
import { DashboardAnalyticsProvider } from './context/DashboardAnalyticsContext';
import ModalInteractionGuard from './components/ModalInteractionGuard';
import ErrorBoundary from './components/ErrorBoundary';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <LanguageProvider>
      <LoadingProvider>
        <AuthProvider>
          <ToastProvider>
            <TenantProvider>
              <AppProvider>
                <TranslationProvider>
                  <DashboardAnalyticsProvider>
                    <ModalInteractionGuard />
                    <App />
                    <SpeedInsights />
                  </DashboardAnalyticsProvider>
                </TranslationProvider>
              </AppProvider>
            </TenantProvider>
          </ToastProvider>
        </AuthProvider>
      </LoadingProvider>
      </LanguageProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
