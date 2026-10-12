import app from './server.js';
import { env } from './config/env.js';

const server = app.listen(env.PORT, '0.0.0.0', () => {
  console.info(`Ashvin Pharmacy API listening on port ${env.PORT}`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
