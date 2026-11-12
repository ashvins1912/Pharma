import app from './server.js';
import { env } from './config/env.js';
import { refreshStockWaitlistCases } from './services/intelligentFulfillment/waitlistMonitor.js';

let retries = 0;

const startServer = () => {
  const server = app.listen(env.PORT, '0.0.0.0', () => {
    retries = 0;
    console.info(`Ashvin Pharmacy API listening on port ${env.PORT}`);
  });

  server.on('error', (err) => {
    try { server.close(); } catch {}
    if (err.code === 'EADDRINUSE') {
      retries++;
      const delay = Math.min(500 * Math.pow(1.2, Math.min(retries, 10)), 3000);
      console.warn(`Backend API port ${env.PORT} busy (EADDRINUSE), retrying in ${Math.round(delay)}ms (attempt ${retries})...`);
      setTimeout(startServer, delay);
    } else {
      console.error('Backend API server error:', err);
      if (process.env.NODE_ENV === 'production') {
        process.exit(1);
      } else {
        setTimeout(startServer, 2000);
      }
    }
  });

  const waitlistMonitor = setInterval(() => {
    refreshStockWaitlistCases().catch(error => console.error('[FulfillmentWaitlist] Monitor failed:', error.message));
  }, 5 * 60 * 1000);
  waitlistMonitor.unref?.();
  refreshStockWaitlistCases().catch(error => console.error('[FulfillmentWaitlist] Initial monitor failed:', error.message));

  const shutdown = () => {
    clearInterval(waitlistMonitor);
    server.close(() => process.exit(0));
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
};

startServer();
