import { DatabaseAdapter } from './DatabaseAdapter.js';
import { IntegrationProvider } from './models.js';
import { IntegrationProviderType } from './eventTypes.js';

/** Future stubs — intentionally disabled. */
export class KafkaAdapter {
  get providerName() { return IntegrationProviderType.KAFKA; }
  async publish() { throw new Error('KafkaAdapter is not enabled in this deployment.'); }
  async healthCheck() { return { healthy: false, provider: this.providerName, reason: 'not_implemented' }; }
}
export class RabbitMQAdapter {
  get providerName() { return IntegrationProviderType.RABBITMQ; }
  async publish() { throw new Error('RabbitMQAdapter is not enabled in this deployment.'); }
  async healthCheck() { return { healthy: false, provider: this.providerName, reason: 'not_implemented' }; }
}
export class SqsAdapter {
  get providerName() { return IntegrationProviderType.AWS_SQS; }
  async publish() { throw new Error('SqsAdapter is not enabled in this deployment.'); }
  async healthCheck() { return { healthy: false, provider: this.providerName, reason: 'not_implemented' }; }
}
export class WebhookAdapter {
  get providerName() { return IntegrationProviderType.WEBHOOK; }
  async publish() { throw new Error('WebhookAdapter is not enabled in this deployment.'); }
  async healthCheck() { return { healthy: false, provider: this.providerName, reason: 'not_implemented' }; }
}

const FACTORIES = {
  [IntegrationProviderType.DATABASE]: () => new DatabaseAdapter(),
  [IntegrationProviderType.KAFKA]: () => new KafkaAdapter(),
  [IntegrationProviderType.RABBITMQ]: () => new RabbitMQAdapter(),
  [IntegrationProviderType.AWS_SQS]: () => new SqsAdapter(),
  [IntegrationProviderType.WEBHOOK]: () => new WebhookAdapter()
};

export class IntegrationAdapterRegistry {
  constructor() {
    this._cache = new Map();
    this.register(IntegrationProviderType.DATABASE, FACTORIES[IntegrationProviderType.DATABASE]());
  }

  register(provider, adapter) {
    this._cache.set(provider, adapter);
  }

  get(provider = IntegrationProviderType.DATABASE) {
    if (!this._cache.has(provider)) {
      const factory = FACTORIES[provider];
      if (!factory) throw new Error(`Unknown integration provider: ${provider}`);
      this._cache.set(provider, factory());
    }
    return this._cache.get(provider);
  }

  async resolveAdapter(tenantId = null, branchId = null, eventType = null) {
    try {
      const filter = { enabled: true };
      if (eventType) filter.$or = [{ event_types: { $size: 0 } }, { event_types: eventType }];
      const candidates = await IntegrationProvider.find(filter).sort({ priority: 1 }).lean();
      const match = candidates.find(row => {
        if (row.scope === 'BRANCH') return row.tenant_id === tenantId && row.branch_id === branchId;
        if (row.scope === 'TENANT') return row.tenant_id === tenantId;
        return true;
      });
      const provider = match?.provider || IntegrationProviderType.DATABASE;
      if (provider !== IntegrationProviderType.DATABASE) {
        // Future providers are registered but not required — fall back safely.
        const adapter = this.get(provider);
        const health = await adapter.healthCheck();
        if (!health.healthy) return this.get(IntegrationProviderType.DATABASE);
        return adapter;
      }
      return this.get(IntegrationProviderType.DATABASE);
    } catch {
      return this.get(IntegrationProviderType.DATABASE);
    }
  }

  async healthCheckAll() {
    const results = {};
    for (const [name, adapter] of this._cache.entries()) {
      results[name] = await adapter.healthCheck();
    }
    return results;
  }
}

export const integrationAdapterRegistry = new IntegrationAdapterRegistry();
export default integrationAdapterRegistry;
