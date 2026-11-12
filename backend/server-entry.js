import app from './server.js';
import { env } from './config/env.js';
import { refreshStockWaitlistCases } from './services/intelligentFulfillment/waitlistMonitor.js';

let retries = 0;
const maxRetries = 30;

const startServer = () => {
  const server = app.listen(env.PORT, '0.0.0.0', () => {
    console.info(`Ashvin Pharmacy API listening on port ${env.PORT}`);
  });

  server.on('error', (err) => {
    try { server.close(); } catch {}
    if (err.code === 'EADDRINUSE' && retries < maxRetries) {
      retries++;
      console.warn(`Backend API port ${env.PORT} busy, retrying in 1000ms (${retries}/${maxRetries})...`);
      setTimeout(startServer, 1000);
    } else {
      console.error('Backend API server error:', err);
      process.exit(1);
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
