import { EventEmitter } from 'node:events';
import QueuedMessage from '../../models/QueuedMessage.js';
import { sharedCache } from '../../../packages/shared-cache/index.js';

export class CacheService extends EventEmitter {
    constructor() {
        super();
        this.store = new Map();
        this.sharedCache = sharedCache;
        this.subscribers = new Set();
        this.telemetry = {
            putsCount: 0,
            publishesCount: 0,
            subscriptionsCount: 0,
            queueBacklogLength: 0,
            lastActivity: new Date().toISOString()
        };
        console.info('[CacheService] Initialized with telemetry and DB queue persistence.');
    }

    async set(key, value, ttlSeconds = 3600) {
        this.telemetry.putsCount += 1;
        this.telemetry.lastActivity = new Date().toISOString();
        if (this.sharedCache.enabled) {
            try { await this.sharedCache.set(key, value, ttlSeconds); return true; }
            catch (error) { console.warn('[CacheService] Shared cache write failed; using local fallback:', error.message); }
        }
        const expiresAt = Date.now() + ttlSeconds * 1000;
        this.store.set(key, { value, expiresAt });
        return true;
    }

    async get(key) {
        if (this.sharedCache.enabled) {
            try { return await this.sharedCache.get(key); }
            catch (error) { console.warn('[CacheService] Shared cache read failed; using local fallback:', error.message); }
        }
        const item = this.store.get(key);
        if (!item) return null;
        if (Date.now() > item.expiresAt) {
            this.store.delete(key);
            return null;
        }
        return item.value;
    }

    async del(key) {
        if (this.sharedCache.enabled) {
            try { return await this.sharedCache.del(key); }
            catch (error) { console.warn('[CacheService] Shared cache delete failed; clearing local fallback:', error.message); }
        }
        return this.store.delete(key);
    }

    // Publish event with telemetry & backlog persistence
    async publishEvent(channel, eventPayload, target = { userId: null, tenantId: null }) {
        this.telemetry.publishesCount += 1;
        this.telemetry.lastActivity = new Date().toISOString();

        const envelope = {
            channel,
            payload: eventPayload,
            publishedAt: new Date().toISOString()
        };

        this.emit('message', envelope);
        this.emit(channel, eventPayload);
        if (this.sharedCache.enabled) {
            try { await this.sharedCache.publishEvent(channel, eventPayload, target); }
            catch (error) { console.error('[CacheService] Shared event publish failed:', error.message); }
        }

        // If listeners are sparse or explicit user/tenant target, persist to DB queue backlog
        if (target.userId || target.tenantId || this.listenerCount('message') === 0) {
            try {
                await QueuedMessage.create({
                    userId: target.userId || eventPayload?.userId || null,
                    tenantId: target.tenantId || eventPayload?.tenantId || null,
                    channel,
                    payload: eventPayload,
                    status: 'PENDING'
                });
                this.telemetry.queueBacklogLength += 1;
            } catch (err) {
                console.warn('[CacheService] Failed to persist queued message to DB:', err.message);
            }
        }

        return envelope;
    }

    // Flush pending DB queue messages when user logs in
    async flushPendingMessagesForUser(userId, tenantId, deliverCallback) {
        if (!userId && !tenantId) return [];
        try {
            const query = { status: 'PENDING' };
            if (userId && tenantId) {
                query.$or = [{ userId }, { tenantId }];
            } else if (userId) {
                query.userId = userId;
            } else {
                query.tenantId = tenantId;
            }

            const pending = await QueuedMessage.find(query).limit(50);
            const delivered = [];

            for (const msg of pending) {
                if (deliverCallback) {
                    deliverCallback(msg.channel, msg.payload);
                }
                delivered.push(msg);
                msg.status = 'CONSUMED';
                await msg.save();
            }

            if (this.telemetry.queueBacklogLength >= delivered.length) {
                this.telemetry.queueBacklogLength -= delivered.length;
            } else {
                this.telemetry.queueBacklogLength = 0;
            }

            console.info(`[CacheService] Flushed and cleared ${delivered.length} queued backlog messages for user ${userId || 'N/A'}`);
            return delivered;
        } catch (error) {
            console.error('[CacheService] Error flushing pending backlog messages:', error);
            return [];
        }
    }

    subscribe(callback) {
        this.telemetry.subscriptionsCount += 1;
        this.on('message', callback);
        return () => {
            this.off('message', callback);
            if (this.telemetry.subscriptionsCount > 0) this.telemetry.subscriptionsCount -= 1;
        };
    }

    getTelemetry() {
        return {
            ...this.telemetry,
            storeSize: this.store.size,
            listeners: this.listenerCount('message')
        };
    }
}

export const cacheService = new CacheService();
