import { config } from './config.js';
import app from './server.js';

const server = app.listen(config.port, '0.0.0.0', () => {
  console.info(`API Gateway listening on port ${config.port}`);
  app.locals.healthMonitor.start();
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
