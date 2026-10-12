/**
 * Domain Event System with in-memory dispatcher and observable registry
 */
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';

class DomainEventEmitter extends EventEmitter {
    constructor() {
        super();
        this.setMaxListeners(50);
        this.eventHistory = [];
        this.maxHistory = 200;
    }

    emitDomainEvent(eventType, entityId, payload = {}, actor = null, tenantId = null, branchId = null) {
        const event = {
            eventId: `evt-${crypto.randomUUID()}`,
            eventType,
            entityId: String(entityId),
            tenantId: tenantId ? String(tenantId) : null,
            branchId: branchId ? String(branchId) : null,
            timestamp: new Date().toISOString(),
            actor: actor ? {
                userId: actor.sub || actor.userId || actor.id || 'system',
                role: actor.role || actor.app_metadata?.role || 'system'
            } : { userId: 'system', role: 'system' },
            payload
        };

        this.eventHistory.unshift(event);
        if (this.eventHistory.length > this.maxHistory) {
            this.eventHistory.pop();
        }

        this.emit(eventType, event);
        this.emit('*', event);
        return event;
    }

    getRecentEvents(filter = {}) {
        return this.eventHistory.filter(evt => {
            if (filter.tenantId && evt.tenantId !== filter.tenantId) return false;
            if (filter.branchId && evt.branchId !== filter.branchId) return false;
            if (filter.eventType && evt.eventType !== filter.eventType) return false;
            if (filter.entityId && evt.entityId !== filter.entityId) return false;
            return true;
        });
    }

    clearHistory() {
        this.eventHistory = [];
    }
}

export const domainEvents = new DomainEventEmitter();
export default domainEvents;
