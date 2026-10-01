import { config } from './config.js';
import app from './server.js';

const server = app.listen(config.port, '0.0.0.0', () => {
  console.info(`API Gateway listening on port ${config.port}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
