import React from 'react';
import { createRoot } from 'react-dom/client';
import AppProviders from './app/AppProviders.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './bootstrap/startupDiagnostics.js';
import './config/env.ts';
import './index.css';
import './styles/design-system.css';
import './styles/responsive-layout.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Pharma startup failed: #root element is missing from index.html.');
}

createRoot(rootElement).render(
  <ErrorBoundary>
    <AppProviders />
  </ErrorBoundary>
);
