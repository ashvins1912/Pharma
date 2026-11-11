import React from 'react';
import App from '../App.jsx';
import { AuthProvider } from '../context/AuthContext.jsx';
import { LanguageProvider } from '../context/LanguageContext.jsx';
import { ToastProvider } from '../context/ToastContext.jsx';
import { AppProvider } from '../context/AppContext.jsx';
import { LoadingProvider } from '../context/LoadingContext.jsx';
import { TenantProvider } from '../context/TenantContext.jsx';
import { TranslationProvider } from '../context/TranslationContext.jsx';
import { DashboardAnalyticsProvider } from '../context/DashboardAnalyticsContext.jsx';
import ModalInteractionGuard from '../components/ModalInteractionGuard.jsx';

/**
 * Keep application-wide providers in one place and make their dependency order
 * explicit. The order is intentional: Auth depends on Loading; Tenant and App
 * depend on Auth; the UI consumes all providers below them.
 */
export default function AppProviders() {
  return (
    <React.StrictMode>
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
                    </DashboardAnalyticsProvider>
                  </TranslationProvider>
                </AppProvider>
              </TenantProvider>
            </ToastProvider>
          </AuthProvider>
        </LoadingProvider>
      </LanguageProvider>
    </React.StrictMode>
  );
}
