import { config } from './config.js';
import app from './server.js';

let retries = 0;
const startServer = () => {
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.info(`API Gateway listening on port ${config.port}`);
    app.locals.healthMonitor.start();
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && retries < 10) {
      retries++;
      console.warn(`API Gateway port ${config.port} busy, retrying in 500ms (${retries}/10)...`);
      setTimeout(startServer, 500);
    } else {
      console.error('API Gateway server error:', err);
      process.exit(1);
    }
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await app.locals.healthMonitor.stop().catch(() => {});
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
};

startServer();
