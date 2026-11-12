// Lightweight startup diagnostics. These listeners do not suppress browser
// errors or change application behaviour; they make failures before the first
// API request visible in the browser console.
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    console.error('[Pharma startup] Uncaught browser error', {
      message: event.message,
      filename: event.filename,
      line: event.lineno,
      column: event.colno,
      error: event.error
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error('[Pharma startup] Unhandled promise rejection', event.reason);
  });

  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    const failedAsset = String(event.payload || 'unknown-asset');
    const retryKey = `pharma:vite-preload-retry:${failedAsset}`;

    try {
      if (window.sessionStorage.getItem(retryKey) === '1') {
        console.error('[Pharma startup] Asset preload failed again after reload', failedAsset);
        return;
      }
      window.sessionStorage.setItem(retryKey, '1');
    } catch {
      // Storage may be unavailable in privacy modes; still attempt one reload.
    }

    window.location.reload();
  });
}
