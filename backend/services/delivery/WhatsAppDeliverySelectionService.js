import WhatsAppMessage from '../../models/WhatsAppMessage.js';
import Order from '../../models/Order.js';
import { processDeliveryEvent } from './DeliveryEventService.js';
import { isDeliveryMenuAction } from './DeliveryWhatsAppMenu.js';

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

    const sentMenu = await WhatsAppMessage.findOne({
        messageId: String(messageId),
        eventType: 'Dispatched',
        status: 'SENT',
        recipient: normalizePhone(senderPhone),
        'deliveryMenu.buttonText': 'Select Action',
        expiresAt: { $gt: new Date() }
    }).lean();
    if (!sentMenu) return { processed: false, reason: 'MENU_NOT_FOUND' };

    const order = await Order.findById(sentMenu.orderId).select('_id rider').lean();
    const rider = order?.rider;
    if (!order || !rider?.riderId || normalizePhone(rider.riderMobile) !== normalizePhone(senderPhone)) {
        return { processed: false, reason: 'SENDER_NOT_ASSIGNED_RIDER' };
    }

    // Stable per-menu/action key makes retries idempotent while allowing a
    // later dispatch to create a distinct not-reachable attempt.
    const eventId = `wa:${String(messageId)}:${action}`;
    const result = await processDeliveryEvent({
        eventId,
        action,
        orderId: String(order._id),
        riderId: String(rider.riderId)
    }, { requestId: `wa:${String(messageId)}` });
    return { processed: true, result };
};
