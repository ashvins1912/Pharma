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
        this.emailService = emailService;
        this._bindDomainEvents();
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
        });

        domainEvents.on('ORDER_DELIVERED', (evt) => {
            this.send({
                tenantId: evt.tenantId,
                branchId: evt.branchId,
                title: 'Order Delivered',
                body: `Order #${evt.payload.orderNumber} was delivered successfully. Stay healthy!`,
                channels: ['IN_APP', 'WHATSAPP']
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
