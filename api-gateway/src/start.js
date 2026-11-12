import { config } from './config.js';
import app from './server.js';

let retries = 0;
const maxRetries = 30;

const startServer = () => {
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.info(`API Gateway listening on port ${config.port}`);
    app.locals.healthMonitor?.start?.();
  });

  server.on('error', (err) => {
    try { server.close(); } catch {}
    if (err.code === 'EADDRINUSE' && retries < maxRetries) {
      retries++;
      console.warn(`API Gateway port ${config.port} busy, retrying in 1000ms (${retries}/${maxRetries})...`);
      setTimeout(startServer, 1000);
    } else {
      console.error('API Gateway server error:', err);
      process.exit(1);
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
