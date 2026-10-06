/**
 * Integration adapter port — business code depends on this, not on Kafka/SQS SDKs.
 */
export class IntegrationAdapter {
  get providerName() {
    throw new Error('providerName not implemented');
  }

  async publish(_event) {
    throw new Error('publish not implemented');
  }

  async healthCheck() {
    return { healthy: false, provider: this.providerName };
  }
}

export default IntegrationAdapter;
