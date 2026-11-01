import { config } from './config.js';
import app from './server.js';

const server = app.listen(config.port, '0.0.0.0', () => {
  console.info(`API Gateway listening on port ${config.port}`);
  app.locals.healthMonitor.start();
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`Port ${config.port} is already in use. Releasing / restarting gracefully.`);
    process.exit(0);
  } else {
    console.error('Server error:', err);
    process.exit(1);
  }
});

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  await app.locals.healthMonitor.stop();
  server.close(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
