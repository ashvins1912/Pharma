import mongoose from 'mongoose';
import crypto from 'node:crypto';
import Order from '../../models/Order.js';
import DeliveryAction from '../../models/DeliveryAction.js';
import RiderLedger from '../../models/RiderLedger.js';
import { getIsConnected } from '../../config/db.js';
import { publishOrderEvent } from '../OrderEventService.js';
import { evaluateDeliveryAction, deliveryActionNames } from './deliveryStateMachine.js';

export const verifyDeliverySignature = (rawBody, providedSignature, providedTimestamp, { now = Date.now() } = {}) => {
    const secret = process.env.DELIVERY_EVENT_SECRET;
    if (typeof secret !== 'string' || secret.length < 32) {
        const error = new Error('Delivery event signing secret is not configured.');
        error.code = 'SIGNATURE_NOT_CONFIGURED';
        throw error;
    }
    const timestamp = Number(providedTimestamp);
    if (!Number.isSafeInteger(timestamp) || Math.abs(Math.floor(now / 1000) - timestamp) > 300) return false;
    if (!Buffer.isBuffer(rawBody) || typeof providedSignature !== 'string'
        || !/^[a-f0-9]{64}$/i.test(providedSignature)) return false;
    const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();
    const provided = Buffer.from(providedSignature, 'hex');
    return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
};

const validateInput = ({ eventId, action, orderId, riderId }) => {
    if (typeof eventId !== 'string' || eventId.length < 8 || eventId.length > 200
        || !deliveryActionNames.includes(action) || !mongoose.isValidObjectId(orderId)
        || typeof riderId !== 'string' || !riderId.trim() || riderId.length > 100) {
        const error = new Error('Delivery event is invalid.');
        error.statusCode = 400;
        error.code = 'INVALID_DELIVERY_EVENT';
        throw error;
    }
    if (action === 'not_reachable') {
        const maxAttempts = Number.parseInt(process.env.DELIVERY_MAX_ATTEMPTS || '', 10);
        if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
            const error = new Error('Delivery attempt policy is not configured.');
            error.statusCode = 503;
            error.code = 'DELIVERY_POLICY_NOT_CONFIGURED';
            throw error;
        }
    }
};

export const processDeliveryEvent = async (event, { requestId = null } = {}) => {
    const startedAt = Date.now();
    validateInput(event);
    if (!getIsConnected()) {
        const error = new Error('Delivery event processing requires MongoDB.');
        error.statusCode = 503;
        error.code = 'SERVICE_UNAVAILABLE';
        throw error;
    }
    const prior = await DeliveryAction.findOne({ eventId: event.eventId, action: event.action }).lean();
    if (prior) {
        console.info('Delivery event processed', JSON.stringify({ requestId, eventId: event.eventId, orderId: event.orderId, action: event.action, result: 'duplicate', durationMs: Date.now() - startedAt }));
        return { duplicate: true, result: prior.result };
    }

    const session = await mongoose.startSession();
    let result;
    try {
        await session.withTransaction(async () => {
            result = null;
            const alreadyProcessed = await DeliveryAction.findOne({ eventId: event.eventId, action: event.action }).session(session).lean();
            if (alreadyProcessed) {
                result = { duplicate: true, result: alreadyProcessed.result };
                return;
            }
            const order = await Order.findById(event.orderId).session(session);
            if (!order) {
                const error = new Error('Order not found.');
                error.statusCode = 404;
                error.code = 'ORDER_NOT_FOUND';
                throw error;
            }
            const transition = evaluateDeliveryAction(order, event.action, event.riderId);
            if (!transition.allowed) {
                const error = new Error('Delivery event does not match the current order state.');
                error.statusCode = 409;
                error.code = transition.code;
                throw error;
            }
            const now = new Date();
            if (event.action === 'not_reachable') {
                order.deliveryAttempts = Number(order.deliveryAttempts || 0) + 1;
                order.statusHistory.push({
                    previousStatus: order.orderStatus,
                    newStatus: order.orderStatus,
                    changedBy: `Rider:${event.riderId}`,
                    timestamp: now,
                    notes: `Delivery attempt ${order.deliveryAttempts} failed: customer not reachable.`
                });
                await order.save({ session });
            } else if (!transition.alreadyApplied) {
                const previousStatus = order.orderStatus;
                order.orderStatus = transition.nextOrderStatus;
                order.paymentStatus = transition.nextPaymentStatus;
                if (event.action === 'cash_received') {
                    const amount = Number(order.finalTotal ?? order.totalAmount);
                    if (!Number.isFinite(amount) || amount < 0) {
                        const error = new Error('Order total is unavailable for cash reconciliation.');
                        error.statusCode = 409;
                        error.code = 'INVALID_ORDER_TOTAL';
                        throw error;
                    }
                    order.amountPaid = amount;
                    await RiderLedger.create([{
                        orderId: order._id,
                        riderId: event.riderId,
                        eventId: event.eventId,
                        amount,
                        type: 'CASH_COLLECTED',
                        occurredAt: now
                    }], { session });
                }
                order.deliveredAt = now;
                order.statusHistory.push({
                    previousStatus,
                    newStatus: transition.nextOrderStatus,
                    changedBy: `Rider:${event.riderId}`,
                    timestamp: now,
                    notes: event.action === 'cash_received' ? 'Rider confirmed cash collection.' : 'Rider confirmed delivery; digital payment remains pending.'
                });
                await order.save({ session });
                await publishOrderEvent(order, 'OrderDelivered', {
                    session,
                    eventKey: `delivery:${event.eventId}:${event.action}`,
                    payload: { deliveryAction: event.action }
                });
            } else {
                result = { duplicate: true, alreadyApplied: true, orderId: String(order._id), orderStatus: order.orderStatus };
            }
            const maxAttempts = Number.parseInt(process.env.DELIVERY_MAX_ATTEMPTS || '', 10);
            const safeResult = result || {
                duplicate: false,
                orderId: String(order._id),
                orderStatus: order.orderStatus,
                paymentStatus: order.paymentStatus || null,
                deliveryAttempts: Number(order.deliveryAttempts || 0),
                manualReviewRequired: event.action === 'not_reachable'
                    && Number.isSafeInteger(maxAttempts) && maxAttempts > 0
                    && Number(order.deliveryAttempts || 0) >= maxAttempts
            };
            const [actionRecord] = await DeliveryAction.create([{
                eventId: event.eventId,
                action: event.action,
                orderId: order._id,
                riderId: event.riderId,
                requestId,
                status: 'COMPLETED',
                result: safeResult,
                processedAt: now
            }], { session });
            result = { duplicate: actionRecord.result.duplicate === true, result: actionRecord.result };
        });
    } catch (error) {
        if (error.code === 11000) {
            const existing = await DeliveryAction.findOne({ eventId: event.eventId, action: event.action }).lean();
            if (existing) return { duplicate: true, result: existing.result };
        }
        if (error.hasErrorLabel?.('TransientTransactionError') || error.hasErrorLabel?.('UnknownTransactionCommitResult')) {
            error.statusCode = 503;
            error.code = 'TRANSACTION_RETRY_REQUIRED';
        }
        if (/Transaction numbers are only allowed|replica set|does not support transactions/i.test(error.message || '')) {
            error.statusCode = 503;
            error.code = 'TRANSACTIONS_UNAVAILABLE';
            error.message = 'Delivery event processing is unavailable because MongoDB transactions are not supported.';
        }
        throw error;
    } finally {
        await session.endSession();
    }
    console.info('Delivery event processed', JSON.stringify({
        requestId,
        eventId: event.eventId,
        orderId: event.orderId,
        action: event.action,
        riderId: event.riderId,
        result: result?.duplicate ? 'already_applied' : 'success',
        durationMs: Date.now() - startedAt
    }));
    return result;
};
