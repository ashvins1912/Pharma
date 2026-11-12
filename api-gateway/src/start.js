import { config } from './config.js';
import app from './server.js';

let retries = 0;

const startServer = () => {
  const server = app.listen(config.port, '0.0.0.0', () => {
    retries = 0;
    console.info(`API Gateway listening on port ${config.port}`);
    app.locals.healthMonitor?.start?.();
  });

  server.on('error', (err) => {
    try { server.close(); } catch {}
    if (err.code === 'EADDRINUSE') {
      retries++;
      const delay = Math.min(500 * Math.pow(1.2, Math.min(retries, 10)), 3000);
      console.warn(`API Gateway port ${config.port} busy (EADDRINUSE), retrying in ${Math.round(delay)}ms (attempt ${retries})...`);
      setTimeout(startServer, delay);
    } else {
      console.error('API Gateway server error:', err);
      if (process.env.NODE_ENV === 'production') {
        process.exit(1);
      } else {
        setTimeout(startServer, 2000);
      }
    }
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await app.locals.healthMonitor?.stop?.().catch(() => {});
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
};

startServer();
