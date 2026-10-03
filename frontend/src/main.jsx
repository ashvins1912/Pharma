import React from 'react';
import { createRoot } from 'react-dom/client';
import { SpeedInsights } from '@vercel/speed-insights/react';
import './config/env.ts';
import App from './App.jsx';
import './index.css';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { AppProvider } from './context/AppContext';
import CustomerErrorBoundary from './components/CustomerErrorBoundary';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <ToastProvider>
        <AppProvider>
          <CustomerErrorBoundary>
            <App />
          </CustomerErrorBoundary>
          <SpeedInsights />
        </AppProvider>
      </ToastProvider>
    </AuthProvider>
  </React.StrictMode>
);
