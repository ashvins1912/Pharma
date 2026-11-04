import app from './server.js';
import { env } from './config/env.js';
import { refreshStockWaitlistCases } from './services/intelligentFulfillment/waitlistMonitor.js';

const server = app.listen(env.PORT, '0.0.0.0', () => {
  console.info(`Ashvin Pharmacy API listening on port ${env.PORT}`);
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
