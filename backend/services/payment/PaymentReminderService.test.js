import test from 'node:test';
import assert from 'node:assert/strict';
import { isEligibleForPaymentReminder } from './PaymentReminderService.js';

test('payment reminder eligibility requires an unpaid digital order with positive balance', () => {
    const eligible = { paymentStatus: 'PENDING_DIGITAL', orderStatus: 'Delivered', finalTotal: 125.5, amountPaid: 25.5 };
    assert.equal(isEligibleForPaymentReminder(eligible), true);
    assert.equal(isEligibleForPaymentReminder({ ...eligible, orderStatus: 'Cancelled' }), false);
    assert.equal(isEligibleForPaymentReminder({ ...eligible, paymentStatus: 'PAID' }), false);
    assert.equal(isEligibleForPaymentReminder({ ...eligible, amountPaid: 125.5 }), false);
    assert.equal(isEligibleForPaymentReminder({ ...eligible, orderStatus: 'Returned' }), false);
});
