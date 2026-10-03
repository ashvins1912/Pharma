import crypto from 'node:crypto';
import mongoose from 'mongoose';
import Order from '../../models/Order.js';
import UserProfile from '../../models/UserProfile.js';
import PaymentReminder from '../../models/PaymentReminder.js';
import PaymentSnooze from '../../models/PaymentSnooze.js';
import { createPaymentSnoozeToken } from './SignedPaymentActionService.js';
import { sendWhatsAppDirectMessage } from '../../config/whatsapp.js';
import { getIsConnected } from '../../config/db.js';

const MAX_ORDER_SCAN = 5000;
const CLOSED_STATUSES = new Set(['cancelled', 'canceled', 'rejected', 'refunded', 'returned', 'disputed']);
const toMinorUnits = value => Math.round(Number(value || 0) * 100);
const fail = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code });

export const isEligibleForPaymentReminder = order => order.paymentStatus === 'PENDING_DIGITAL'
    && !CLOSED_STATUSES.has(String(order.orderStatus || order.status || '').toLowerCase())
    && toMinorUnits(order.finalTotal ?? order.totalAmount) > toMinorUnits(order.amountPaid);

const summarizeOrder = order => ({
    orderId: String(order._id),
    invoiceReference: order.orderNumber || null,
    amountOutstanding: (toMinorUnits(order.finalTotal ?? order.totalAmount) - toMinorUnits(order.amountPaid)) / 100,
    paymentStatus: order.paymentStatus,
    orderStatus: order.orderStatus || order.status,
    createdAt: order.createdAt
});

export const getOutstandingPayments = async ({ customerId = null, limit = 100 } = {}) => {
    if (!getIsConnected()) throw fail(503, 'SERVICE_UNAVAILABLE', 'Payment data is temporarily unavailable.');
    const boundedLimit = Math.min(500, Math.max(1, Number.parseInt(limit, 10) || 100));
    const filter = { paymentStatus: 'PENDING_DIGITAL' };
    if (customerId) filter.customerId = String(customerId);
    const orders = await Order.find(filter).sort({ createdAt: 1 }).limit(MAX_ORDER_SCAN + 1).lean();
    const truncated = orders.length > MAX_ORDER_SCAN;
    const groups = new Map();
    for (const order of orders.slice(0, MAX_ORDER_SCAN)) {
        if (!isEligibleForPaymentReminder(order)) continue;
        const id = String(order.customerId || order.userId || '');
        if (!id) continue;
        if (!groups.has(id)) groups.set(id, { customerId: id, amountOutstandingMinor: 0, invoices: [] });
        const group = groups.get(id);
        group.amountOutstandingMinor += toMinorUnits(order.finalTotal ?? order.totalAmount) - toMinorUnits(order.amountPaid);
        group.invoices.push(summarizeOrder(order));
    }
    const customerIds = [...groups.keys()];
    const now = new Date();
    const [snoozes, recentReminders] = await Promise.all([
        customerIds.length ? PaymentSnooze.find({ customerId: { $in: customerIds }, snoozedUntil: { $gt: now } }).lean() : [],
        customerIds.length ? PaymentReminder.aggregate([
            { $match: { customerId: { $in: customerIds } } },
            { $sort: { createdAt: -1 } },
            { $group: { _id: '$customerId', reminder: { $first: '$$ROOT' } } }
        ]) : []
    ]);
    const snoozeByCustomer = new Map(snoozes.map(record => [record.customerId, record]));
    const reminderByCustomer = new Map(recentReminders.map(record => [record._id, record.reminder]));
    const customers = [...groups.values()].map(group => {
        const snooze = snoozeByCustomer.get(group.customerId);
        const lastReminder = reminderByCustomer.get(group.customerId);
        return {
            customerId: group.customerId,
            amountOutstanding: group.amountOutstandingMinor / 100,
            invoiceCount: group.invoices.length,
            invoices: group.invoices,
            snoozedUntil: snooze?.snoozedUntil || null,
            lastReminder: lastReminder ? { status: lastReminder.status, sentAt: lastReminder.sentAt, createdAt: lastReminder.createdAt } : null
        };
    }).sort((a, b) => b.amountOutstanding - a.amountOutstanding);
    return {
        customers: customers.slice(0, boundedLimit),
        totalOutstanding: truncated ? null : customers.reduce((sum, customer) => sum + customer.amountOutstanding, 0),
        truncated: truncated || customers.length > boundedLimit
    };
};

export const dispatchPaymentReminder = async ({ customerId, orderIds, requestedBy, requestId = null }) => {
    if (!getIsConnected()) throw fail(503, 'SERVICE_UNAVAILABLE', 'Payment reminders are temporarily unavailable.');
    const normalizedCustomerId = typeof customerId === 'string' ? customerId.trim() : '';
    const normalizedOrderIds = Array.isArray(orderIds) ? [...new Set(orderIds.map(String))] : [];
    if (!normalizedCustomerId || !normalizedOrderIds.length || normalizedOrderIds.length > 100
        || normalizedOrderIds.some(id => !mongoose.isValidObjectId(id))) {
        throw fail(400, 'INVALID_REMINDER_REQUEST', 'Provide a customer and 1 to 100 valid invoice IDs.');
    }
    let reminder = null;
    try {
        const orders = await Order.find({ _id: { $in: normalizedOrderIds } }).lean();
        const ordersById = new Map(orders.map(order => [String(order._id), order]));
        const rejectedIds = normalizedOrderIds.filter(id => {
            const order = ordersById.get(id);
            return !order || String(order.customerId || order.userId || '') !== normalizedCustomerId || !isEligibleForPaymentReminder(order);
        });
        if (rejectedIds.length) {
            console.warn('Rejected payment reminder invoice association.', { requestId, customerId: normalizedCustomerId, rejectedCount: rejectedIds.length });
            throw fail(422, 'INVALID_INVOICE_ASSOCIATION', 'Every invoice must belong to this customer and have an eligible outstanding digital payment.');
        }
        const snooze = await PaymentSnooze.findOne({ customerId: normalizedCustomerId, snoozedUntil: { $gt: new Date() } }).lean();
        if (snooze) throw fail(409, 'CUSTOMER_SNOOZED', 'This customer has postponed payment reminders.');

        const profile = await UserProfile.findOne({ supabase_user_id: normalizedCustomerId }).select('name mobile').lean();
        const phone = String(profile?.mobile || '').replace(/[^\d+]/g, '');
        if (!profile || phone.replace(/\D/g, '').length < 10) {
            throw fail(422, 'CUSTOMER_PHONE_UNAVAILABLE', 'A valid customer phone number is not available.');
        }
        const amountMinor = orders.reduce((sum, order) => sum
            + toMinorUnits(order.finalTotal ?? order.totalAmount) - toMinorUnits(order.amountPaid), 0);
        const sortedIds = normalizedOrderIds.slice().sort();
        const throttleHours = Number.parseInt(process.env.PAYMENT_REMINDER_THROTTLE_HOURS || '24', 10);
        const throttleWindowMs = (Number.isSafeInteger(throttleHours) && throttleHours > 0 ? throttleHours : 24) * 60 * 60 * 1000;
        const timeBucket = Math.floor(Date.now() / throttleWindowMs);
        const idempotencyKey = crypto.createHash('sha256')
            .update(`${normalizedCustomerId}:PAYMENT_OUTSTANDING:${sortedIds.join(',')}:${timeBucket}`).digest('hex');
        const existing = await PaymentReminder.findOne({ idempotencyKey }).lean();
        if (existing) return { reminderId: String(existing._id), status: existing.status, duplicate: true };
        [reminder] = await PaymentReminder.create([{
            idempotencyKey,
            customerId: normalizedCustomerId,
            orderIds: sortedIds,
            channel: 'WHATSAPP',
            amount: amountMinor / 100,
            requestedBy: String(requestedBy)
        }]);

        const actionBaseUrl = process.env.PAYMENT_ACTION_BASE_URL;
        if (!actionBaseUrl) throw fail(503, 'PAYMENT_ACTION_NOT_CONFIGURED', 'Payment reminder actions are not configured.');
        const token = createPaymentSnoozeToken(normalizedCustomerId);
        const snoozeUrl = new URL(actionBaseUrl);
        if (snoozeUrl.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
            throw fail(503, 'PAYMENT_ACTION_NOT_CONFIGURED', 'Payment action links must use HTTPS in production.');
        }
        snoozeUrl.searchParams.set('token', token);
        const invoiceReferences = orders.map(order => order.orderNumber).filter(Boolean);
        const message = [
            `Hello ${profile.name || 'Customer'}, Ashvin Pharmacy payment reminder: ₹${(amountMinor / 100).toFixed(2)} is outstanding across ${orders.length} invoice(s).`,
            invoiceReferences.length ? `Invoices: ${invoiceReferences.join(', ')}` : '',
            'Please contact Ashvin Pharmacy to arrange payment.',
            `Will do later: ${snoozeUrl.toString()}`
        ].filter(Boolean).join('\n');
        const delivery = await sendWhatsAppDirectMessage({
            recipient: phone,
            message,
            dedupeKey: `PAYMENT:${idempotencyKey}`,
            referenceId: `PAYMENT:${String(reminder._id)}`
        });
        const status = delivery.status === 'SENT' ? 'SENT'
            : delivery.status === 'QUEUED_OFFLINE' ? 'QUEUED_OFFLINE' : 'FAILED';
        await PaymentReminder.updateOne({ _id: reminder._id }, { $set: {
            status,
            providerMessageId: delivery.providerMessageId || null,
            sentAt: status === 'SENT' ? new Date() : null,
            failureReason: delivery.error || null
        } });
        console.info('Payment reminder dispatch completed', JSON.stringify({
            requestId,
            reminderId: String(reminder._id),
            customerId: normalizedCustomerId,
            orderIds: sortedIds,
            channel: 'WHATSAPP',
            requestedBy: String(requestedBy),
            providerMessageId: delivery.providerMessageId || null,
            result: status
        }));
        return { reminderId: String(reminder._id), status, duplicate: false };
    } catch (error) {
        if (error.code === 11000) {
            const key = error.keyValue?.idempotencyKey;
            const existing = key ? await PaymentReminder.findOne({ idempotencyKey: key }).lean() : null;
            if (existing) return { reminderId: String(existing._id), status: existing.status, duplicate: true };
        }
        if (reminder) {
            await PaymentReminder.updateOne({ _id: reminder._id, status: 'SENDING' }, {
                $set: { status: 'FAILED', failureReason: error.statusCode ? error.code : 'Reminder dispatch failed before provider confirmation.' }
            }).catch(() => {});
        }
        throw error;
    }
};
