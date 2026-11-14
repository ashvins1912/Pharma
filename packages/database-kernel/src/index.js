import { resolveServiceDatabaseConfig } from './registry.js';
import { createMongooseDatabaseAdapter } from './adapters/mongoose.js';

export { DATABASE_PROVIDERS, SERVICE_DATABASE_REGISTRY, resolveServiceDatabaseConfig } from './registry.js';
export { createMongooseDatabaseAdapter } from './adapters/mongoose.js';
export { createPostgresDatabaseAdapter } from './adapters/postgres.js';

export function createServiceDatabase({ serviceName, mongoose, env = process.env, provider, mongoOptions = {} } = {}) {
  const config = resolveServiceDatabaseConfig({ serviceName, env, provider });
  if (config.provider !== 'mongodb') {
    throw new Error(`No runtime adapter is wired for provider "${config.provider}" in ${serviceName}.`);
  }
  const adapter = createMongooseDatabaseAdapter({
    mongoose,
    uri: config.uri,
    database: config.database,
    options: mongoOptions
  });
  return Object.freeze({ ...adapter, service: serviceName, owner: config.owner, config });
}
