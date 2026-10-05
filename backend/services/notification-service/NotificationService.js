/**
 * Centralized Notification Service
 * Dispatches domain events across IN_APP, WHATSAPP, SMS, and EMAIL channels
 */
import { domainEvents } from '../../shared/events/DomainEvents.js';
import { logger } from '../../shared/observability/logger.js';
import { emailService } from './EmailService.js';

export class NotificationService {
    constructor() {
        this.notifications = []; // in-app notifications
        this.deliveryEvents = []; // delivery push events history
        this.sseClients = new Map(); // clientId -> { res, context }
        this.emailService = emailService;
        this._bindDomainEvents();
    }

    addSseClient(clientId, res, context = {}) {
        this.sseClients.set(clientId, { res, context });
    }

    removeSseClient(clientId) {
        this.sseClients.delete(clientId);
    }

    getDeliveryEvents(tenantId = null, branchId = null) {
        return this.deliveryEvents.filter(e => {
            if (tenantId && e.tenantId && e.tenantId !== tenantId) return false;
            if (branchId && e.branchId && e.branchId !== branchId) return false;
            return true;
        });
    }

    _broadcastDeliveryEvent(eventData) {
        this.deliveryEvents.unshift(eventData);
        if (this.deliveryEvents.length > 500) this.deliveryEvents.pop();

        for (const [clientId, client] of this.sseClients.entries()) {
            try {
                if (!client.context.isSuperAdmin && client.context.tenantId && eventData.tenantId && client.context.tenantId !== eventData.tenantId) {
                    continue;
                }
                if (client.context.branchId && eventData.branchId && client.context.branchId !== eventData.branchId) {
                    continue;
                }
                client.res.write(`data: ${JSON.stringify(eventData)}\n\n`);
            } catch (err) {
                logger.warn(`Failed to push SSE event to client ${clientId}:`, err?.message);
                this.sseClients.delete(clientId);
            }
        }
    }

    _bindDomainEvents() {
        domainEvents.on('TENANT_CREATED', async (evt) => {
            const tenant = evt.payload;
            this.send({
                tenantId: evt.tenantId,
                title: `Pharmacy Tenant Onboarded: ${tenant?.name || evt.tenantId}`,
                body: `Tenant ${tenant?.name || evt.tenantId} has been successfully registered on the platform.`,
                channels: ['IN_APP', 'EMAIL']
            });
        });
        domainEvents.on('ORDER_CREATED', (evt) => {
            this.send({
                tenantId: evt.tenantId,
                branchId: evt.branchId,
                recipientUserId: evt.actor.userId,
                title: 'Order Confirmed',
                body: `Your order #${evt.payload.orderNumber} has been received and queued for pharmacy verification.`,
                channels: ['IN_APP', 'WHATSAPP']
            });
        });

        domainEvents.on('ORDER_ACCEPTED', (evt) => {
            this.send({
                tenantId: evt.tenantId,
                branchId: evt.branchId,
                recipientUserId: evt.actor.userId,
                title: 'Order Processing',
                body: `Pharmacist has verified your medicines and started packing.`,
                channels: ['IN_APP', 'WHATSAPP']
            });
        });

        domainEvents.on('RIDER_ASSIGNED', (evt) => {
            this.send({
                tenantId: evt.tenantId,
                branchId: evt.branchId,
                title: 'Delivery Partner Assigned',
                body: `Rider ${evt.payload.riderName} has been assigned to deliver your order.`,
                channels: ['IN_APP', 'WHATSAPP']
            });
            this._broadcastDeliveryEvent({
                type: 'DELIVERY_STATUS_CHANGED',
                eventType: 'RIDER_ASSIGNED',
                status: 'ASSIGNED',
                tenantId: evt.tenantId,
                branchId: evt.branchId,
                orderId: evt.aggregateId,
                riderId: evt.payload.riderId,
                riderName: evt.payload.riderName,
                jobId: evt.payload.jobId,
                timestamp: new Date().toISOString()
            });
        });

        domainEvents.on('DELIVERY_STATUS_CHANGED', (evt) => {
            this.send({
                tenantId: evt.tenantId,
                branchId: evt.branchId,
                title: `Delivery Update: ${evt.payload.status}`,
                body: `Order #${evt.payload.orderNumber || evt.aggregateId} status changed to ${evt.payload.status}.`,
                channels: ['IN_APP', 'WHATSAPP']
            });
            this._broadcastDeliveryEvent({
                type: 'DELIVERY_STATUS_CHANGED',
                eventType: 'DELIVERY_STATUS_CHANGED',
                status: evt.payload.status,
                tenantId: evt.tenantId,
                branchId: evt.branchId,
                orderId: evt.aggregateId || evt.payload.orderNumber,
                riderName: evt.payload.riderName,
                riderMobile: evt.payload.riderMobile,
                jobId: evt.payload.jobId,
                timestamp: new Date().toISOString()
            });
        });

        domainEvents.on('ORDER_DELIVERED', (evt) => {
            this.send({
                tenantId: evt.tenantId,
                branchId: evt.branchId,
                title: 'Order Delivered',
                body: `Order #${evt.payload.orderNumber} was delivered successfully. Stay healthy!`,
                channels: ['IN_APP', 'WHATSAPP']
            });
            this._broadcastDeliveryEvent({
                type: 'DELIVERY_STATUS_CHANGED',
                eventType: 'ORDER_DELIVERED',
                status: 'DELIVERED',
                tenantId: evt.tenantId,
                branchId: evt.branchId,
                orderId: evt.aggregateId || evt.payload.orderNumber,
                riderName: evt.payload.riderName,
                riderMobile: evt.payload.riderMobile,
                jobId: evt.payload.jobId,
                timestamp: new Date().toISOString()
            });
        });

        domainEvents.on('PROPOSAL_CREATED', (evt) => {
            this.send({
                tenantId: evt.tenantId,
                branchId: evt.branchId,
                title: 'Medicine Proposal Ready',
                body: `Pharmacy formulated a proposal for your medicine request. Please review and approve.`,
                channels: ['IN_APP', 'WHATSAPP']
            });
        });
    }

    send({
        tenantId = null,
        branchId = null,
        recipientUserId = null,
        title,
        body,
        channels = ['IN_APP']
    }) {
        const notification = {
            id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            tenantId,
            branchId,
            recipientUserId,
            title,
            body,
            channels,
            read: false,
            createdAt: new Date().toISOString()
        };

        this.notifications.unshift(notification);
        if (this.notifications.length > 200) this.notifications.pop();

        logger.info(`Notification dispatched: "${title}" via [${channels.join(', ')}]`, { tenantId, branchId });
        return notification;
    }

    getUserNotifications(userId) {
        return this.notifications.filter(n => !n.recipientUserId || n.recipientUserId === userId);
    }

    markAsRead(notificationId, userId) {
        const notif = this.notifications.find(n => n.id === notificationId && (!n.recipientUserId || n.recipientUserId === userId));
        if (notif) notif.read = true;
        return notif;
    }
}

export const notificationService = new NotificationService();
export default notificationService;
