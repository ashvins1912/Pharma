/**
 * Domain Event System with in-memory dispatcher and observable registry
 */
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import AuditEvent from '../../models/AuditEvent.js';

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

        // Keep the fast in-process event stream while persisting a safe audit
        // projection for tenant activity screens and post-restart history.
        if (event.tenantId && AuditEvent.db.readyState === 1) {
            const allowedMetadata = ['status', 'role', 'branchId', 'orderNumber', 'campaignId', 'jobId', 'caseNumber', 'itemCount', 'cancelledLineCount'];
            const metadata = {};
            for (const key of allowedMetadata) {
                const value = event.payload?.[key];
                if (['string', 'number', 'boolean'].includes(typeof value)) metadata[key] = value;
            }
            const summary = eventType.toLowerCase().replaceAll('_', ' ');
            void AuditEvent.create({
                eventId: event.eventId,
                eventType,
                entityId: event.entityId,
                tenantId: event.tenantId,
                branchId: event.branchId,
                actor: event.actor,
                summary,
                metadata
            }).catch(error => {
                console.warn('[AuditEvent] Could not persist domain event:', error.message);
            });
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
