export const DATABASE_PROVIDERS = Object.freeze({
  MONGODB: 'mongodb',
  POSTGRESQL: 'postgresql'
});

export const SERVICE_DATABASE_REGISTRY = Object.freeze({
  'inventory-service': Object.freeze({
    owner: 'Inventory',
    providerEnv: 'INVENTORY_DATABASE_PROVIDER',
    uriEnv: 'INVENTORY_DATABASE_URL',
    legacyUriEnv: ['INVENTORY_MONGO_URI'],
    databaseEnv: 'INVENTORY_DB_NAME',
    defaultDatabase: 'pharma_inventory',
    supportedProviders: Object.freeze(['mongodb']),
    plannedProviders: Object.freeze(['postgresql'])
  }),
  'medicine-master-service': Object.freeze({
    owner: 'Medicine Master catalogue and import processing',
    providerEnv: 'MEDICINE_MASTER_DATABASE_PROVIDER',
    uriEnv: 'MEDICINE_MASTER_DATABASE_URL',
    legacyUriEnv: ['MEDICINE_MASTER_MONGO_URI', 'INVENTORY_MONGO_URI'],
    databaseEnv: 'MEDICINE_MASTER_DB_NAME',
    defaultDatabase: 'pharma_inventory',
    supportedProviders: Object.freeze(['mongodb']),
    plannedProviders: Object.freeze(['postgresql'])
  }),
  'order-service': Object.freeze({
    owner: 'Order lifecycle and order events',
    providerEnv: 'ORDER_DATABASE_PROVIDER',
    uriEnv: 'ORDER_DATABASE_URL',
    legacyUriEnv: ['ORDER_MONGO_URI'],
    databaseEnv: 'ORDER_DB_NAME',
    defaultDatabase: 'pharma_orders',
    supportedProviders: Object.freeze(['mongodb']),
    plannedProviders: Object.freeze(['postgresql'])
  }),
  'prescription-service': Object.freeze({
    owner: 'Prescription documents and verification lifecycle',
    runtime: 'python',
    providerEnv: 'PRESCRIPTION_DATABASE_PROVIDER',
    uriEnv: 'PRESCRIPTION_DATABASE_URL',
    legacyUriEnv: ['PRESCRIPTION_MONGO_URI', 'MONGO_URI'],
    databaseEnv: 'PRESCRIPTION_DB_NAME',
    defaultDatabase: 'prescriptions',
    supportedProviders: Object.freeze(['mongodb']),
    plannedProviders: Object.freeze(['postgresql'])
  })
});

export function resolveServiceDatabaseConfig({ serviceName, env = process.env, provider } = {}) {
  const service = SERVICE_DATABASE_REGISTRY[serviceName];
  if (!service) throw new Error(`No database ownership/adapter registration exists for service "${serviceName}".`);

  const selectedProvider = String(provider || env[service.providerEnv] || env.DATABASE_PROVIDER || 'mongodb')
    .trim().toLowerCase();
  if (!service.supportedProviders.includes(selectedProvider)) {
    const reason = service.plannedProviders.includes(selectedProvider)
      ? 'The provider adapter exists, but this service repository/use-case migration is not complete.'
      : 'The provider is not registered for this service.';
    throw new Error(`Database provider "${selectedProvider}" is not enabled for ${serviceName}. ${reason} Enabled providers: ${service.supportedProviders.join(', ')}.`);
  }

  const uriCandidates = [service.uriEnv, ...service.legacyUriEnv].filter(Boolean);
  const uri = uriCandidates.map(key => env[key]).find(value => typeof value === 'string' && value.trim());
  if (!uri) throw new Error(`Missing database connection URI for ${serviceName}. Configure ${uriCandidates.join(' or ')}.`);

  return Object.freeze({
    serviceName,
    owner: service.owner,
    provider: selectedProvider,
    uri: uri.trim(),
    database: env[service.databaseEnv] || service.defaultDatabase,
    runtime: service.runtime || 'node',
    supportedProviders: service.supportedProviders
  });
}
