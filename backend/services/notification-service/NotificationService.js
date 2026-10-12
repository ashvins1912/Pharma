/**
 * Centralized Notification Service
 * Dispatches domain events across IN_APP, WHATSAPP, SMS, and EMAIL channels
 * and consumes data from Redis/Cache broker on getting message alerts from WebSockets.
 */
import { domainEvents } from '../../shared/events/DomainEvents.js';
import { logger } from '../../shared/observability/logger.js';
import { emailService } from './EmailService.js';
import { sendCustomWhatsAppAlert, sendWhatsAppMedicineRequestAlert } from '../../config/whatsapp.js';
import { cacheService } from '../cache/CacheService.js';

export class NotificationService {
    constructor() {
        this.notifications = []; // in-app notifications
        this.deliveryEvents = []; // delivery push events history
        this.sseClients = new Map(); // clientId -> { res, context }
        this.emailService = emailService;
        this._bindDomainEvents();
        this._bindCacheConsumer();
    }

    _bindCacheConsumer() {
        try {
            cacheService.subscribe((envelope) => {
                const { channel, payload } = envelope;
                if (payload?.source === 'notification-service' || payload?.source === 'whatsapp-service') return;
                logger.info(`[NotificationService] Consuming message from cache/Redis broker on channel [${channel}]`);
                if (payload && (payload.title || payload.body || payload.message)) {
                    this.send({
                        tenantId: payload.tenantId || null,
                        branchId: payload.branchId || null,
                        recipientUserId: payload.userId || payload.recipientUserId || null,
                        title: payload.title || 'WebSocket Message Alert',
                        body: payload.body || payload.message || JSON.stringify(payload),
                        channels: ['IN_APP']
                    });
                }
            });
        } catch (err) {
            logger.warn('[NotificationService] Failed to bind cache/Redis consumer:', err?.message);
        }
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

    _recipientUserId(evt) {
        const payload = evt?.payload || {};
        const order = payload.order || {};
        return payload.customerUserId || payload.customerId || payload.recipientUserId || payload.userId
            || order.userId || order.customerId
            || (evt?.eventType === 'ORDER_CREATED' ? evt?.actor?.userId : null) || null;
    }

    _bindDomainEvents() {
        domainEvents.on('MEDICINE_REQUEST_CREATED', (evt) => {
            this.send({
                tenantId: evt.tenantId, branchId: evt.branchId,
                recipientUserId: this._recipientUserId(evt),
                title: 'New Medicine Request',
                body: `Medicine request ${evt.payload?.requestNumber || evt.entityId} was created for ${evt.payload?.medicineName || 'a medicine'}.`,
                eventType: 'MEDICINE_REQUEST_CREATED', medicineRequestId: evt.entityId, channels: ['IN_APP', 'WHATSAPP']
            });
            if (evt.payload?.request) sendWhatsAppMedicineRequestAlert(evt.payload.request, 'MedicineRequestCreated').catch(err => logger.warn('[WhatsApp] Medicine request creation alert failed:', err?.message));
        });

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
                recipientUserId: this._recipientUserId(evt),
                title: 'Order Confirmed',
                body: `Your order #${evt.payload?.orderNumber || evt.entityId} has been received and queued for pharmacy verification.`,
                eventType: 'ORDER_CREATED', orderId: evt.entityId,
                channels: ['IN_APP', 'WHATSAPP']
            });
            if (evt.payload?.order) {
                sendCustomWhatsAppAlert(evt.payload.order, 'Placed').catch(err => logger.warn('[WhatsApp] OrderCreated alert failed:', err?.message));
            }
        });

        domainEvents.on('ORDER_STATUS_CHANGED', (evt) => {
            const status = evt.payload?.newStatus || 'updated';
            this.send({
                tenantId: evt.tenantId,
                branchId: evt.branchId,
                recipientUserId: this._recipientUserId(evt),
                title: `Order Status Updated: ${status}`,
                body: `Order #${evt.payload?.orderNumber || evt.entityId} changed from ${evt.payload?.previousStatus || 'previous status'} to ${status}.`,
                eventType: 'ORDER_STATUS_CHANGED',
                orderId: evt.entityId,
                status,
                channels: ['IN_APP', 'WHATSAPP']
            });
            if (['delivered', 'order delivered'].includes(String(status).trim().toLowerCase())) {
                this.send({
                    tenantId: evt.tenantId,
                    branchId: evt.branchId,
                    recipientUserId: this._recipientUserId(evt),
                    title: 'How was your delivery?',
                    body: 'Your order has been delivered. Tap to rate your experience.',
                    eventType: 'ORDER_DELIVERED_RATING_PROMPT',
                    orderId: evt.entityId,
                    status: 'Delivered',
                    channels: ['IN_APP']
                });
            } else if (['dispatched', 'out_for_delivery'].includes(String(status).trim().toLowerCase())) {
                this.send({
                    tenantId: evt.tenantId,
                    branchId: evt.branchId,
                    recipientUserId: this._recipientUserId(evt),
                    title: 'Order out for delivery',
                    body: 'Your 4-digit delivery verification code has been sent to WhatsApp. Share it with your rider at handover.',
                    eventType: 'ORDER_OUT_FOR_DELIVERY_OTP_SENT',
                    orderId: evt.entityId,
                    status: 'Dispatched',
                    channels: ['IN_APP']
                });
            }
        });

        domainEvents.on('ORDER_ACCEPTED', (evt) => {
            this.send({
                tenantId: evt.tenantId,
                branchId: evt.branchId,
                recipientUserId: this._recipientUserId(evt),
                title: 'Order Processing',
                body: `Pharmacist has verified your medicines and started packing.`,
                eventType: 'ORDER_ACCEPTED', orderId: evt.entityId,
                channels: ['IN_APP', 'WHATSAPP']
            });
            if (evt.payload?.order) {
                sendCustomWhatsAppAlert(evt.payload.order, 'Ready to Dispatch').catch(err => logger.warn('[WhatsApp] OrderAccepted alert failed:', err?.message));
            }
        });

        domainEvents.on('RIDER_ASSIGNED', (evt) => {
            this.send({
                tenantId: evt.tenantId,
                branchId: evt.branchId,
                recipientUserId: this._recipientUserId(evt),
                title: 'Delivery Partner Assigned',
                body: `Rider ${evt.payload?.riderName} has been assigned to deliver your order.`,
                eventType: 'RIDER_ASSIGNED', orderId: evt.entityId, riderId: evt.payload?.riderId,
                channels: ['IN_APP', 'WHATSAPP']
            });
            this._broadcastDeliveryEvent({
                type: 'DELIVERY_STATUS_CHANGED',
                eventType: 'RIDER_ASSIGNED',
                status: 'ASSIGNED',
                tenantId: evt.tenantId,
                branchId: evt.branchId,
                orderId: evt.aggregateId,
                riderId: evt.payload?.riderId,
                riderName: evt.payload?.riderName,
                jobId: evt.payload?.jobId,
                timestamp: new Date().toISOString()
            });
            if (evt.payload?.order) {
                sendCustomWhatsAppAlert(evt.payload.order, 'Assigned', evt.payload?.riderMobile).catch(err => logger.warn('[WhatsApp] RiderAssigned alert failed:', err?.message));
            }
        });

        domainEvents.on('DELIVERY_STATUS_CHANGED', (evt) => {
            this.send({
                tenantId: evt.tenantId,
                branchId: evt.branchId,
                recipientUserId: this._recipientUserId(evt),
                title: `Delivery Update: ${evt.payload?.status}`,
                body: `Order #${evt.payload?.orderNumber || evt.entityId} status changed to ${evt.payload?.status}.`,
                eventType: 'DELIVERY_STATUS_CHANGED', orderId: evt.entityId, status: evt.payload?.status,
                channels: ['IN_APP', 'WHATSAPP']
            });
            this._broadcastDeliveryEvent({
                type: 'DELIVERY_STATUS_CHANGED',
                eventType: 'DELIVERY_STATUS_CHANGED',
                status: evt.payload?.status,
                tenantId: evt.tenantId,
                branchId: evt.branchId,
                orderId: evt.aggregateId || evt.payload?.orderNumber,
                riderName: evt.payload?.riderName,
                riderMobile: evt.payload?.riderMobile,
                jobId: evt.payload?.jobId,
                timestamp: new Date().toISOString()
            });
            if (evt.payload?.order) {
                sendCustomWhatsAppAlert(evt.payload.order, evt.payload?.status, evt.payload?.riderMobile).catch(err => logger.warn('[WhatsApp] DeliveryStatus alert failed:', err?.message));
            }
        });

        domainEvents.on('ORDER_DELIVERED', (evt) => {
            this.send({
                tenantId: evt.tenantId,
                branchId: evt.branchId,
                recipientUserId: this._recipientUserId(evt),
                title: 'Order Delivered',
                body: `Order #${evt.payload?.orderNumber || evt.entityId} was delivered successfully. Stay healthy!`,
                eventType: 'ORDER_DELIVERED', orderId: evt.entityId, status: 'DELIVERED',
                channels: ['IN_APP', 'WHATSAPP']
            });
            this._broadcastDeliveryEvent({
                type: 'DELIVERY_STATUS_CHANGED',
                eventType: 'ORDER_DELIVERED',
                status: 'DELIVERED',
                tenantId: evt.tenantId,
                branchId: evt.branchId,
                orderId: evt.aggregateId || evt.payload?.orderNumber,
                riderName: evt.payload?.riderName,
                riderMobile: evt.payload?.riderMobile,
                jobId: evt.payload?.jobId,
                timestamp: new Date().toISOString()
            });
            if (evt.payload?.order) {
                sendCustomWhatsAppAlert(evt.payload.order, 'Delivered', evt.payload?.riderMobile).catch(err => logger.warn('[WhatsApp] OrderDelivered alert failed:', err?.message));
            }
        });

        domainEvents.on('PROPOSAL_CREATED', (evt) => {
            this.send({
                tenantId: evt.tenantId,
                branchId: evt.branchId,
                recipientUserId: this._recipientUserId(evt),
                title: 'Medicine Proposal Ready',
                body: `Pharmacy formulated a proposal for your medicine request. Please review and approve.`,
                eventType: 'PROPOSAL_CREATED', medicineRequestId: evt.entityId,
                channels: ['IN_APP', 'WHATSAPP']
            });
            if (evt.payload?.request) {
                sendWhatsAppMedicineRequestAlert(evt.payload.request, 'MedicineProposalReady').catch(err => logger.warn('[WhatsApp] Proposal alert failed:', err?.message));
            }
        });
        domainEvents.on('PROPOSAL_APPROVED', (evt) => {
            this.send({
                tenantId: evt.tenantId, branchId: evt.branchId,
                recipientUserId: this._recipientUserId(evt),
                title: 'Medicine Request Approved',
                body: `Request ${evt.payload?.requestNumber || evt.entityId} was approved and converted to order ${evt.payload?.orderId || ''}.`,
                eventType: 'PROPOSAL_APPROVED', medicineRequestId: evt.entityId, orderId: evt.payload?.orderId,
                channels: ['IN_APP', 'WHATSAPP']
            });
            if (evt.payload?.request) sendWhatsAppMedicineRequestAlert(evt.payload.request, 'MedicineRequestApproved').catch(err => logger.warn('[WhatsApp] Medicine request approval alert failed:', err?.message));
        });
        domainEvents.on('PROPOSAL_REJECTED', (evt) => {
            this.send({
                tenantId: evt.tenantId, branchId: evt.branchId,
                recipientUserId: this._recipientUserId(evt),
                title: 'Medicine Proposal Rejected',
                body: `The proposal for request ${evt.payload?.requestNumber || evt.entityId} was rejected.`,
                eventType: 'PROPOSAL_REJECTED', medicineRequestId: evt.entityId,
                channels: ['IN_APP', 'WHATSAPP']
            });
            if (evt.payload?.request) sendWhatsAppMedicineRequestAlert(evt.payload.request, 'MedicineRequestRejected').catch(err => logger.warn('[WhatsApp] Medicine request rejection alert failed:', err?.message));
        });
        domainEvents.on('REQUEST_CANCELLED', (evt) => {
            this.send({
                tenantId: evt.tenantId, branchId: evt.branchId,
                recipientUserId: this._recipientUserId(evt),
                title: 'Medicine Request Cancelled',
                body: `Medicine request ${evt.payload?.requestNumber || evt.entityId} was cancelled.`,
                eventType: 'REQUEST_CANCELLED', medicineRequestId: evt.entityId,
                channels: ['IN_APP', 'WHATSAPP']
            });
            if (evt.payload?.request) sendWhatsAppMedicineRequestAlert(evt.payload.request, 'MedicineRequestCancelled').catch(err => logger.warn('[WhatsApp] Medicine request cancellation alert failed:', err?.message));
        });
    }

    send({
        tenantId = null,
        branchId = null,
        recipientUserId = null,
        title,
        body,
        channels = ['IN_APP'],
        eventType = 'NOTIFICATION_CREATED',
        orderId = null,
        riderId = null,
        medicineRequestId = null,
        status = null,
        promotionId = null,
        pharmacyName = null,
        actionUrl = null
    }) {
        const notification = {
            id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            tenantId,
            branchId,
            recipientUserId,
            title,
            body,
            channels,
            eventType,
            orderId: orderId ? String(orderId) : null,
            riderId: riderId ? String(riderId) : null,
            medicineRequestId: medicineRequestId ? String(medicineRequestId) : null,
            promotionId: promotionId ? String(promotionId) : null,
            pharmacyName: pharmacyName ? String(pharmacyName) : null,
            actionUrl: typeof actionUrl === 'string' && actionUrl.startsWith('/') ? actionUrl : null,
            status,
            read: false,
            createdAt: new Date().toISOString()
        };

        this.notifications.unshift(notification);
        if (this.notifications.length > 200) this.notifications.pop();

        logger.info(`Notification dispatched: "${title}" via [${channels.join(', ')}]`, { tenantId, branchId });

        // Publish only to a verified user or tenant audience. Never send private
        // notification bodies as unscoped/global WebSocket events.
        if (recipientUserId || tenantId) {
            const eventPayload = { ...notification, userId: recipientUserId, tenantId, source: 'notification-service' };
            const target = { userId: recipientUserId, tenantId, riderId };
            void cacheService.publishEvent('notification', eventPayload, target);
            if (channels.includes('WHATSAPP')) {
                void cacheService.publishEvent('whatsapp_notification', { ...eventPayload, deliveryState: 'REQUESTED' }, target);
            }
            if (orderId && ['ORDER_CREATED', 'ORDER_ACCEPTED', 'ORDER_STATUS_CHANGED', 'RIDER_ASSIGNED', 'DELIVERY_STATUS_CHANGED', 'ORDER_DELIVERED', 'ORDER_DELIVERED_RATING_PROMPT', 'ORDER_OUT_FOR_DELIVERY_OTP_SENT', 'PROPOSAL_APPROVED'].includes(eventType)) {
                void cacheService.publishEvent('order_status_changed', eventPayload, target);
            }
            if (medicineRequestId || eventType.startsWith('MEDICINE_REQUEST') || eventType.startsWith('PROPOSAL_') || eventType.startsWith('REQUEST_')) {
                void cacheService.publishEvent('medicine_request_updated', eventPayload, target);
            }
        }
        return notification;
    }

    getUserNotifications(userId, { tenantId = null, branchId = null, isSuperAdmin = false } = {}) {
        return this.notifications.filter(notification => {
            if (!isSuperAdmin && notification.recipientUserId && notification.recipientUserId !== userId) return false;
            if (!isSuperAdmin && !notification.recipientUserId && notification.tenantId && notification.tenantId !== tenantId) return false;
            if (!isSuperAdmin && !notification.recipientUserId && notification.branchId && notification.branchId !== branchId) return false;
            // Untargeted platform notifications must not leak to ordinary tenant users.
            if (!isSuperAdmin && !notification.recipientUserId && !notification.tenantId) return false;
            return true;
        });
    }

    markAsRead(notificationId, userId, { tenantId = null, branchId = null, isSuperAdmin = false } = {}) {
        const notif = this.notifications.find(notification => {
            if (notification.id !== notificationId) return false;
            if (!isSuperAdmin && notification.recipientUserId && notification.recipientUserId !== userId) return false;
            if (!isSuperAdmin && notification.tenantId && notification.tenantId !== tenantId) return false;
            if (!isSuperAdmin && notification.branchId && notification.branchId !== branchId) return false;
            if (!isSuperAdmin && !notification.recipientUserId && !notification.tenantId) return false;
            return true;
        });
        if (notif) notif.read = true;
        return notif || null;
    }
}

export const notificationService = new NotificationService();
export default notificationService;
