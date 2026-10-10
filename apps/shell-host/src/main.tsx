import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Detect if application runtime context is mounted within a hybrid mobile wrapper shell
if (window.location.search.includes('platform=native') || (window as any).Capacitor) {
  document.body.classList.add('is-native-app');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
