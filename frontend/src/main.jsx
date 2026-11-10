import React from 'react';

// A tab can remain open across a deployment. If a lazy-loaded Vite chunk (or
// its extracted CSS) was removed by that deployment, retry once with the
// current entry point instead of leaving the user on a broken lazy route.
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    const failedAsset = String(event.payload || 'unknown-asset');
    const retryKey = `pharma:vite-preload-retry:${failedAsset}`;

    try {
      if (window.sessionStorage.getItem(retryKey) === '1') {
        console.error('Vite asset preload failed again after a reload:', failedAsset);
        return;
      }
      window.sessionStorage.setItem(retryKey, '1');
    } catch {
      // Storage may be unavailable in strict privacy modes; still attempt one
      // recovery reload for this event.
    }

    window.location.reload();
  });
}
import { createRoot } from 'react-dom/client';
// SpeedInsights stripped for AI Studio environment
const SpeedInsights = () => null;
import './config/env.ts';
import App from './App.jsx';
import './index.css';
import './styles/design-system.css';
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
