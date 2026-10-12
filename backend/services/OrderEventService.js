import { randomUUID } from 'node:crypto';
import { getIsConnected } from '../config/db.js';
import { sendCustomWhatsAppAlert } from '../config/whatsapp.js';
import OrderEvent from '../models/OrderEvent.js';

const eventToWhatsAppStatus = {
    OrderCreated: 'Placed',
    OrderReadyForDispatch: 'Ready to Dispatch',
    OrderAssigned: 'Assigned',
    OrderReassigned: 'Assigned',
    OrderDispatched: 'Dispatched',
    OrderDelivered: 'Delivered'
};

const memoryEvents = [];
let workerTimer;
let workerRunning = false;

export const toOrderEventType = status => ({
    Pending_Review: 'OrderCreated',
    Approved: 'OrderApproved',
    Rejected: 'OrderRejected',
    'Processing Order': 'OrderProcessing',
    'Ready to Dispatch': 'OrderReadyForDispatch',
    Dispatched: 'OrderDispatched',
    Delivered: 'OrderDelivered',
    Cancelled: 'OrderCancelled'
}[status] || null);

export async function publishOrderEvent(order, event, metadata = {}) {
    const { session, ...eventMetadata } = metadata;
    const plainOrder = order?.toObject ? order.toObject({ virtuals: true }) : { ...order };
    const orderId = String(plainOrder?._id || plainOrder?.id || '');
    if (!orderId) throw new Error('Cannot publish an Order event without an order ID.');

    const historyTimestamp = plainOrder.statusHistory?.at(-1)?.timestamp;
    const occurredAt = eventMetadata.occurredAt || plainOrder.updatedAt || historyTimestamp || new Date();
    const eventKey = eventMetadata.eventKey
        || `${orderId}:${event}:${new Date(occurredAt).toISOString()}`;
    const record = {
        eventId: randomUUID(),
        eventKey,
        event,
        orderId,
        source: plainOrder.source || 'DIRECT',
        externalReference: plainOrder.externalReference || null,
        occurredAt,
        payload: {
            order: plainOrder,
            ...(eventMetadata.payload || {})
        }
    };

    if (!getIsConnected()) {
        const existing = memoryEvents.find(item => item.eventKey === eventKey);
        if (existing) return existing;
        const memoryRecord = { ...record, _memoryOnly: true, status: 'QUEUED', attempts: 0 };
        memoryEvents.push(memoryRecord);
        return memoryRecord;
    }

    try {
        return await OrderEvent.findOneAndUpdate(
            { eventKey },
            { $setOnInsert: record },
            { upsert: true, new: true, ...(session ? { session } : {}) }
        ).lean();
    } catch (error) {
        if (error.code === 11000) {
            const existing = await OrderEvent.findOne({ eventKey }).lean();
            if (existing) return existing;
        }
        if (!session && eventToWhatsAppStatus[event] && !record.payload.notificationSuppressed) {
            console.error('Order event could not be persisted; attempting the legacy notification path:', {
                eventId: record.eventId,
                event,
                orderId,
                error: error.message
            });
            try {
                await deliverEvent(record);
                return { ...record, status: 'PROCESSED', fallbackDelivery: true };
            } catch (notificationError) {
                console.error('Order notification fallback failed:', {
                    eventId: record.eventId,
                    event,
                    orderId,
                    error: notificationError.message
                });
                return { ...record, status: 'FAILED', lastError: notificationError.message, fallbackDelivery: true };
            }
        }
        throw error;
    }
}

async function deliverEvent(eventRecord) {
    if (eventRecord.payload?.notificationSuppressed) return;
    const whatsappStatus = eventToWhatsAppStatus[eventRecord.event];
    if (!whatsappStatus) return;
    const order = eventRecord.payload?.order;
    if (!order) throw new Error(`Order event ${eventRecord.eventId} has no order snapshot.`);
    const notification = await sendCustomWhatsAppAlert(
        order,
        whatsappStatus,
        eventRecord.payload?.riderMobile || order.rider?.riderMobile
    );
    const failures = (notification || []).filter(record => record.status === 'FAILED');
    if (failures.length) throw new Error(`WhatsApp delivery failed for ${failures.length} recipient(s).`);
}

async function claimNextEvent() {
    const queued = memoryEvents.find(event => event.status === 'QUEUED'
        && new Date(event.nextAttemptAt || 0) <= new Date());
    if (queued) {
        queued.status = 'PROCESSING';
        queued.attempts += 1;
        return queued;
    }
    if (!getIsConnected()) return null;
    return OrderEvent.findOneAndUpdate({
        status: 'QUEUED',
        nextAttemptAt: { $lte: new Date() }
    }, {
        $set: { status: 'PROCESSING' },
        $inc: { attempts: 1 }
    }, {
        sort: { createdAt: 1 },
        new: true
    });
}

async function updateEvent(eventRecord, update) {
    if (eventRecord._memoryOnly) {
        Object.assign(eventRecord, update);
        return;
    }
    await OrderEvent.updateOne({ eventId: eventRecord.eventId }, { $set: update });
}

export async function processOrderEvents() {
    if (workerRunning) return;
    workerRunning = true;
    try {
        for (let count = 0; count < 20; count += 1) {
            const eventRecord = await claimNextEvent();
            if (!eventRecord) break;
            try {
                await deliverEvent(eventRecord);
                await updateEvent(eventRecord, { status: 'PROCESSED', processedAt: new Date(), lastError: null });
            } catch (error) {
                const attempts = Number(eventRecord.attempts || 1);
                const permanentlyFailed = attempts >= 8;
                await updateEvent(eventRecord, {
                    status: permanentlyFailed ? 'FAILED' : 'QUEUED',
                    attempts,
                    nextAttemptAt: new Date(Date.now() + Math.min(1000 * (2 ** attempts), 15 * 60 * 1000)),
                    lastError: error.message
                });
                console.error('Order event delivery failed:', {
                    eventId: eventRecord.eventId,
                    event: eventRecord.event,
                    orderId: eventRecord.orderId,
                    attempts,
                    error: error.message
                });
            }
        }
    } catch (error) {
        console.error('Order event outbox processing failed:', error);
    } finally {
        workerRunning = false;
    }
}

export async function recoverOrderEvents() {
    if (!getIsConnected()) return;
    await OrderEvent.updateMany({
        status: 'PROCESSING',
        updatedAt: { $lte: new Date(Date.now() - 2 * 60 * 1000) }
    }, {
        $set: { status: 'QUEUED', nextAttemptAt: new Date() }
    });
}

export function startOrderEventWorker() {
    if (workerTimer) return;
    workerTimer = setInterval(() => void processOrderEvents(), 1000);
    workerTimer.unref();
}

export function getWhatsAppStatusForOrderEvent(event) {
    return eventToWhatsAppStatus[event] || null;
}
