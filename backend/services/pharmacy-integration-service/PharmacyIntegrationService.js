/**
 * Pharmacy Integration Service
 * Manages branch POS / C-Square integration configuration, sync operations, and health
 */
import { csquareAdapter } from './adapters/CSquareAdapter.js';
import { inventoryClient } from '../inventory-client/InventoryClient.js';
import { domainEvents } from '../../shared/events/DomainEvents.js';
import { logger } from '../../shared/observability/logger.js';
import { IntegrationStatus, IntegrationProvider } from '../../shared/contracts/index.js';

export class PharmacyIntegrationService {
    constructor() {
        this.integrations = new Map(); // branchId -> BranchIntegration
        this.adapters = new Map();
        this.adapters.set(IntegrationProvider.CSQUARE, csquareAdapter);
        this._seedSampleIntegration();
    }

    _seedSampleIntegration() {
        // Sample integration configured for Indore Central Branch
        const branchId = 'branch-indore-central';
        const tenantId = 'tenant-ashvin-main';

        const integration = {
            id: 'integ-indore-central',
            tenantId,
            branchId,
            provider: IntegrationProvider.CSQUARE,
            status: IntegrationStatus.CONNECTED,
            capabilities: {
                productSync: true,
                stockSync: true,
                priceSync: true,
                orderSync: true,
                invoiceSync: true
            },
            config: {
                apiUrl: 'https://api.csquarepharma.example.com',
                clientId: 'CSQ-ASHVIN-INDORE',
                storeId: 'STORE-PALASIA-01',
                apiKey: 'csq_live_key_9824f8d9b1a0',
                syncIntervalMinutes: 15
            },
            lastSuccessfulSyncAt: new Date(Date.now() - 900000).toISOString(),
            lastFailedSyncAt: null,
            syncHistory: [
                {
                    jobId: 'sync-hist-01',
                    timestamp: new Date(Date.now() - 900000).toISOString(),
                    type: 'STOCK_SYNC',
                    status: 'SUCCESS',
                    itemsProcessed: 5
                }
            ]
        };

        this.integrations.set(branchId, integration);
    }

    async getBranchIntegration(tenantId, branchId) {
        const integ = this.integrations.get(branchId);
        if (!integ || integ.tenantId !== tenantId) return null;

        // Mask sensitive API Key when returning
        const masked = {
            ...integ,
            config: {
                ...integ.config,
                apiKey: integ.config?.apiKey ? `••••••••••••${integ.config.apiKey.slice(-4)}` : ''
            }
        };
        return masked;
    }

    async updateBranchIntegration(tenantId, branchId, payload, actor = null) {
        let integ = this.integrations.get(branchId);
        if (!integ) {
            integ = {
                id: `integ-${Date.now()}`,
                tenantId,
                branchId,
                provider: payload.provider || IntegrationProvider.CSQUARE,
                status: IntegrationStatus.DISCONNECTED,
                capabilities: {
                    productSync: true,
                    stockSync: true,
                    priceSync: true,
                    orderSync: true,
                    invoiceSync: true
                },
                config: {
                    apiUrl: '',
                    clientId: '',
                    storeId: '',
                    apiKey: '',
                    syncIntervalMinutes: 15
                },
                lastSuccessfulSyncAt: null,
                lastFailedSyncAt: null,
                syncHistory: []
            };
            this.integrations.set(branchId, integ);
        }

        if (payload.capabilities) {
            integ.capabilities = { ...integ.capabilities, ...payload.capabilities };
        }

        if (payload.config) {
            integ.config = {
                ...integ.config,
                ...payload.config,
                // Only overwrite apiKey if new non-masked value is provided
                apiKey: payload.config.apiKey && !payload.config.apiKey.includes('••••')
                    ? payload.config.apiKey
                    : integ.config.apiKey
            };
        }

        if (payload.provider) integ.provider = payload.provider;

        domainEvents.emitDomainEvent('INTEGRATION_SETTINGS_UPDATED', integ.id, { branchId }, actor, tenantId, branchId);
        return this.getBranchIntegration(tenantId, branchId);
    }

    async testConnection(tenantId, branchId) {
        const integ = this.integrations.get(branchId);
        if (!integ) throw new Error('No integration configured for this branch');

        const adapter = this.adapters.get(integ.provider);
        if (!adapter) throw new Error(`Provider adapter for ${integ.provider} not found`);

        const result = await adapter.testConnection(integ.config);
        integ.status = result.success ? IntegrationStatus.CONNECTED : IntegrationStatus.ERROR;
        if (!result.success) {
            integ.lastFailedSyncAt = new Date().toISOString();
        }
        return result;
    }

    async triggerSync(tenantId, branchId, syncType = 'STOCK', actor = null) {
        const integ = this.integrations.get(branchId);
        if (!integ) throw new Error('No integration configured for this branch');

        const adapter = this.adapters.get(integ.provider);
        if (!adapter) throw new Error(`Provider adapter for ${integ.provider} not found`);

        const jobId = `sync-${Date.now()}`;
        try {
            const syncResult = await adapter.syncInventory(integ.config);

            // Persist supplier stock through the Inventory Service authority.
            if (Array.isArray(syncResult.stockItems) && syncResult.stockItems.length) {
                const productIds = syncResult.stockItems
                    .map(item => item.productId)
                    .filter(Boolean);
                const current = productIds.length
                    ? await inventoryClient.lookup({ productIds, tenantId, branchId, userId: actor?.userId || 'integration-service' })
                    : { items: [] };
                const currentById = new Map((current.items || []).map(item => [String(item.productId), item]));

                for (const item of syncResult.stockItems) {
                    const existing = currentById.get(String(item.productId));
                    if (!existing?.sku) continue;
                    await inventoryClient.adjust({
                        sku: existing.sku,
                        tenantId,
                        branchId,
                        stockQuantity: Math.max(0, Math.floor(Number(item.availableQuantity) || 0)),
                        price: Math.max(0, Number(item.price ?? existing.price ?? 0)),
                        batchNumber: item.batchNumber || existing.batchNumber || '',
                        expiryDate: item.expiryDate || existing.expiryDate || null,
                        userId: actor?.userId || 'integration-service',
                        operationKey: `csquare:${tenantId}:${branchId}:${existing.sku}:${String(item.availableQuantity)}`
                    });
                }
            }

            integ.lastSuccessfulSyncAt = new Date().toISOString();
            integ.status = IntegrationStatus.CONNECTED;
            integ.syncHistory.unshift({
                jobId,
                timestamp: integ.lastSuccessfulSyncAt,
                type: `${syncType}_SYNC`,
                status: 'SUCCESS',
                itemsProcessed: syncResult.itemsProcessed || 0
            });
            if (integ.syncHistory.length > 20) integ.syncHistory.pop();

            domainEvents.emitDomainEvent('STOCK_SYNC_COMPLETED', jobId, { itemsProcessed: syncResult.itemsProcessed }, actor, tenantId, branchId);

            return {
                success: true,
                message: `Successfully synchronized ${syncResult.itemsProcessed} records from ${integ.provider}.`,
                jobId,
                timestamp: integ.lastSuccessfulSyncAt
            };
        } catch (err) {
            integ.lastFailedSyncAt = new Date().toISOString();
            integ.status = IntegrationStatus.ERROR;
            integ.syncHistory.unshift({
                jobId,
                timestamp: integ.lastFailedSyncAt,
                type: `${syncType}_SYNC`,
                status: 'FAILED',
                itemsProcessed: 0,
                error: err.message
            });
            domainEvents.emitDomainEvent('STOCK_SYNC_FAILED', jobId, { error: err.message }, actor, tenantId, branchId);
            throw err;
        }
    }
}

export const pharmacyIntegrationService = new PharmacyIntegrationService();
export default pharmacyIntegrationService;
