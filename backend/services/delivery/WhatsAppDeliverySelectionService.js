import WhatsAppMessage from '../../models/WhatsAppMessage.js';
import Order from '../../models/Order.js';
import { processDeliveryEvent } from './DeliveryEventService.js';
import { isDeliveryMenuAction } from './DeliveryWhatsAppMenu.js';
import { getIsConnected } from '../../config/db.js';
import { getNotificationLog } from '../../config/whatsapp.js';
import dataStore from '../../dataStore.js';

/**
 * Resolve a WhatsApp list reply to the exact sent rider menu before applying
 * it. The stored recipient, order assignment, and current state machine all
 * have to agree; a customer or forwarded menu cannot update an order.
 */
export const processWhatsAppDeliverySelection = async ({
    messageId,
    action,
    senderPhone,
    normalizePhone
}) => {
    if (!messageId || !isDeliveryMenuAction(action) || !senderPhone || typeof normalizePhone !== 'function') {
        return { processed: false, reason: 'INVALID_SELECTION' };
    }

    let sentMenu = null;
    const normSender = normalizePhone(senderPhone);

    if (getIsConnected()) {
        sentMenu = await WhatsAppMessage.findOne({
            messageId: String(messageId),
            eventType: 'Dispatched',
            status: 'SENT',
            recipient: normSender,
            'deliveryMenu.buttonText': 'Select Action',
            expiresAt: { $gt: new Date() }
        }).lean();
    }

    if (!sentMenu) {
        const memLog = getNotificationLog();
        sentMenu = memLog.find(n =>
            String(n.messageId) === String(messageId) &&
            n.eventType === 'Dispatched' &&
            n.status === 'SENT' &&
            normalizePhone(n.recipient) === normSender
        ) || null;
    }

    if (!sentMenu) return { processed: false, reason: 'MENU_NOT_FOUND' };

    let order = null;
    if (getIsConnected()) {
        order = await Order.findById(sentMenu.orderId).select('_id rider').lean();
    } else {
        order = await dataStore.getOrderById(sentMenu.orderId);
    }

    const rider = order?.rider;
    if (!order || !rider?.riderId || normalizePhone(rider.riderMobile) !== normSender) {
        return { processed: false, reason: 'SENDER_NOT_ASSIGNED_RIDER' };
    }

    // Stable per-menu/action key makes retries idempotent while allowing a
    // later dispatch to create a distinct not-reachable attempt.
    const eventId = `wa:${String(messageId)}:${action}`;
    const result = await processDeliveryEvent({
        eventId,
        action,
        orderId: String(order._id || order.id),
        riderId: String(rider.riderId)
    }, { requestId: `wa:${String(messageId)}` });
    return { processed: true, result };
};
