import PaymentSnooze from '../../models/PaymentSnooze.js';

const DEFAULT_SNOOZE_HOURS = 24;

export const snoozeCustomerPaymentReminders = async (customerId, nonce, { now = new Date() } = {}) => {
    const configuredHours = Number(process.env.PAYMENT_REMINDER_SNOOZE_HOURS || DEFAULT_SNOOZE_HOURS);
    const hours = Number.isFinite(configuredHours) && configuredHours > 0 ? configuredHours : DEFAULT_SNOOZE_HOURS;
    const snoozedUntil = new Date(now.getTime() + hours * 60 * 60 * 1000);
    try {
        const updated = await PaymentSnooze.findOneAndUpdate(
            { customerId, lastActionNonce: { $ne: nonce } },
            { $set: { snoozedUntil, updatedAt: now, lastActionNonce: nonce } },
            { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
        ).lean();
        if (updated) return { snooze: updated, applied: true };
    } catch (error) {
        if (error.code !== 11000) throw error;
    }
    const existing = await PaymentSnooze.findOne({ customerId }).lean();
    if (existing) return { snooze: existing, applied: false };
    throw new Error('Could not safely update payment reminder preference.');
};

export const isCustomerPaymentSnoozed = async (customerId, { now = new Date() } = {}) => {
    const record = await PaymentSnooze.findOne({ customerId, snoozedUntil: { $gt: now } }).lean();
    return record || null;
};
