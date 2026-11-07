import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { OutboxStatus, IntegrationProviderType } from './eventTypes.js';

const outboxSchema = new mongoose.Schema({
  event_id: { type: String, required: true, unique: true, default: () => randomUUID() },
  event_type: { type: String, required: true, index: true },
  aggregate_type: { type: String, required: true, index: true },
  aggregate_id: { type: String, required: true, index: true },
  tenant_id: { type: String, required: true, index: true },
  branch_id: { type: String, default: null, index: true },
  correlation_id: { type: String, default: null, index: true },
  schema_version: { type: Number, default: 1 },
  aggregate_version: { type: Number, default: 1 },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  status: {
    type: String,
    enum: Object.values(OutboxStatus),
    default: OutboxStatus.PENDING,
    index: true
  },
  attempt_count: { type: Number, default: 0 },
  available_at: { type: Date, default: () => new Date(), index: true },
  locked_until: { type: Date, default: null, index: true },
  locked_by: { type: String, default: null },
  last_error: { type: String, default: null },
  processed_at: { type: Date, default: null }
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

outboxSchema.index({ status: 1, available_at: 1 });
outboxSchema.index({ tenant_id: 1, event_type: 1, created_at: -1 });
outboxSchema.index(
  { event_type: 1, aggregate_id: 1, aggregate_version: 1 },
  { unique: true }
);

const providerSchema = new mongoose.Schema({
  provider: {
    type: String,
    enum: Object.values(IntegrationProviderType),
    required: true
  },
  scope: { type: String, enum: ['GLOBAL', 'TENANT', 'BRANCH'], default: 'GLOBAL' },
  tenant_id: { type: String, default: null, index: true },
  branch_id: { type: String, default: null, index: true },
  enabled: { type: Boolean, default: true },
  priority: { type: Number, default: 100 },
  config_reference: { type: String, default: null },
  secret_reference: { type: String, default: null },
  event_types: { type: [String], default: [] },
  version: { type: Number, default: 1 }
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

providerSchema.index({ enabled: 1, priority: 1 });
providerSchema.index({ tenant_id: 1, branch_id: 1, provider: 1 });

export const IntegrationOutbox = mongoose.models.IntegrationOutbox
  || mongoose.model('IntegrationOutbox', outboxSchema, 'integration_outbox');

export const IntegrationProvider = mongoose.models.IntegrationProvider
  || mongoose.model('IntegrationProvider', providerSchema, 'integration_provider');
