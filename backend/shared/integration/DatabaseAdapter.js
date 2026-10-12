import { IntegrationAdapter } from './IntegrationAdapter.js';
import { IntegrationOutbox } from './models.js';
import { OutboxStatus, IntegrationProviderType } from './eventTypes.js';
import { randomUUID } from 'node:crypto';

/**
 * DATABASE adapter — durable outbox is the delivery mechanism (no Kafka required).
 * Callers should prefer enqueueInTransaction when already inside a Mongo session.
 */
export class DatabaseAdapter extends IntegrationAdapter {
  get providerName() {
    return IntegrationProviderType.DATABASE;
  }

  async publish(event, session = null) {
    const doc = {
      event_id: event.eventId || event.event_id || randomUUID(),
      event_type: event.eventType || event.event_type,
      aggregate_type: event.aggregateType || event.aggregate_type,
      aggregate_id: String(event.aggregateId || event.aggregate_id),
      tenant_id: String(event.tenantId || event.tenant_id || 'global'),
      branch_id: event.branchId || event.branch_id || null,
      correlation_id: event.correlationId || event.correlation_id || null,
      schema_version: event.schemaVersion || event.schema_version || 1,
      aggregate_version: event.aggregateVersion || event.aggregate_version || 1,
      payload: event.payload || {},
      status: OutboxStatus.PENDING,
      attempt_count: 0,
      available_at: new Date()
    };
    const opts = session ? { session } : {};
    try {
      await IntegrationOutbox.create([doc], opts);
    } catch (error) {
      if (error?.code === 11000) {
        return { duplicate: true, event_id: doc.event_id };
      }
      throw error;
    }
    return { duplicate: false, event_id: doc.event_id };
  }

  async healthCheck() {
    try {
      const state = IntegrationOutbox.db?.readyState;
      return { healthy: state === 1, provider: this.providerName };
    } catch {
      return { healthy: false, provider: this.providerName };
    }
  }

  /**
   * Claim next PENDING/RETRY outbox rows for a worker (lease-based).
   */
  async claimBatch({ workerId, limit = 20, leaseSeconds = 60 } = {}) {
    const now = new Date();
    const lockedUntil = new Date(now.getTime() + leaseSeconds * 1000);
    const results = [];
    for (let i = 0; i < limit; i += 1) {
      const doc = await IntegrationOutbox.findOneAndUpdate(
        {
          status: { $in: [OutboxStatus.PENDING, OutboxStatus.RETRY] },
          available_at: { $lte: now },
          $or: [{ locked_until: null }, { locked_until: { $lte: now } }]
        },
        {
          $set: {
            status: OutboxStatus.PROCESSING,
            locked_by: workerId,
            locked_until: lockedUntil
          },
          $inc: { attempt_count: 1 }
        },
        { sort: { available_at: 1 }, new: true }
      ).lean();
      if (!doc) break;
      results.push(doc);
    }
    return results;
  }

  async markSent(eventId) {
    await IntegrationOutbox.updateOne(
      { event_id: eventId },
      { $set: { status: OutboxStatus.SENT, processed_at: new Date(), locked_until: null, locked_by: null, last_error: null } }
    );
  }

  async markRetry(eventId, error, backoffMs = 30_000) {
    await IntegrationOutbox.updateOne(
      { event_id: eventId },
      {
        $set: {
          status: OutboxStatus.RETRY,
          last_error: String(error).slice(0, 2000),
          available_at: new Date(Date.now() + backoffMs),
          locked_until: null,
          locked_by: null
        }
      }
    );
  }
}

export default DatabaseAdapter;
