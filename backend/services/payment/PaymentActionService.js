import PaymentActionNonce from '../../models/PaymentActionNonce.js';
import PaymentSnooze from '../../models/PaymentSnooze.js';
import { snoozeCustomerPaymentReminders } from './PaymentSnoozeService.js';

export const applySnoozeActionOnce = async ({ customerId, nonce, expiresAt }) => {
    let ownsProcessing = false;
    try {
        await PaymentActionNonce.create({ customerId, nonce, action: 'PAYMENT_SNOOZE', status: 'PROCESSING', expiresAt });
        ownsProcessing = true;
    } catch (error) {
        if (error.code !== 11000) throw error;
        const existing = await PaymentActionNonce.findOne({ nonce }).lean();
        if (!existing || existing.customerId !== customerId || existing.action !== 'PAYMENT_SNOOZE') {
            return { status: 'INVALID' };
        }
        if (existing.status === 'COMPLETED') {
            const snooze = await PaymentSnooze.findOne({ customerId }).lean();
            return { status: 'COMPLETED', snoozedUntil: snooze?.snoozedUntil || null, applied: false };
        }
        const stale = new Date(existing.updatedAt).getTime() < Date.now() - 5 * 60 * 1000;
        if (existing.status === 'PROCESSING' && !stale) return { status: 'PROCESSING' };
        const claim = await PaymentActionNonce.updateOne({
            nonce,
            status: existing.status,
            updatedAt: existing.updatedAt
        }, { $set: { status: 'PROCESSING' } });
        if (!claim.modifiedCount) return { status: 'PROCESSING' };
        ownsProcessing = true;
    }

    try {
        const result = await snoozeCustomerPaymentReminders(customerId, nonce);
        await PaymentActionNonce.updateOne({ nonce, status: 'PROCESSING' }, { $set: { status: 'COMPLETED' } });
        return { status: 'COMPLETED', snoozedUntil: result.snooze.snoozedUntil, applied: result.applied };
    } catch (error) {
        if (ownsProcessing) {
            await PaymentActionNonce.updateOne({ nonce, status: 'PROCESSING' }, { $set: { status: 'FAILED_RETRYABLE' } }).catch(() => {});
        }
        throw error;
    }
};
