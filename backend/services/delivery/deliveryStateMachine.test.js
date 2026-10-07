import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDeliveryAction } from './deliveryStateMachine.js';

const dispatchedOrder = {
    orderStatus: 'Dispatched',
    paymentMethod: 'Cash on Delivery (COD)',
    paymentStatus: 'PENDING',
    rider: { riderId: 'rider-1' }
};

test('cash received requires the assigned rider, dispatched state, and COD payment', () => {
    assert.deepEqual(evaluateDeliveryAction(dispatchedOrder, 'cash_received', 'rider-1'), {
        allowed: true, nextOrderStatus: 'Delivered', nextPaymentStatus: 'PAID', cashCollectionStatus: 'CASH_RECEIVED'
    });
    assert.equal(evaluateDeliveryAction(dispatchedOrder, 'cash_received', 'rider-2').code, 'RIDER_MISMATCH');
    assert.equal(evaluateDeliveryAction({ ...dispatchedOrder, orderStatus: 'Cancelled' }, 'cash_received', 'rider-1').code, 'INVALID_STATE');
    assert.equal(evaluateDeliveryAction({ ...dispatchedOrder, paymentMethod: 'UPI' }, 'cash_received', 'rider-1').code, 'PAYMENT_METHOD_MISMATCH');
});

test('cash not received records delivered status with unpaid COD and is idempotent', () => {
    const outcome = evaluateDeliveryAction(dispatchedOrder, 'cash_not_received', 'rider-1');
    assert.equal(outcome.allowed, true);
    assert.equal(outcome.nextOrderStatus, 'Delivered');
    assert.equal(outcome.nextPaymentStatus, 'PENDING');
    assert.equal(outcome.cashCollectionStatus, 'CASH_NOT_RECEIVED');

    // Replay after delivered
    const deliveredNotReceived = {
        ...dispatchedOrder,
        orderStatus: 'Delivered',
        paymentStatus: 'PENDING',
        cashCollectionStatus: 'CASH_NOT_RECEIVED'
    };
    const idempotentOutcome = evaluateDeliveryAction(deliveredNotReceived, 'cash_not_received', 'rider-1');
    assert.equal(idempotentOutcome.allowed, true);
    assert.equal(idempotentOutcome.alreadyApplied, true);
    assert.equal(idempotentOutcome.cashCollectionStatus, 'CASH_NOT_RECEIVED');

    // Non-COD rejects cash collection
    const upiOrder = { ...dispatchedOrder, paymentMethod: 'UPI' };
    assert.equal(evaluateDeliveryAction(upiOrder, 'cash_not_received', 'rider-1').code, 'PAYMENT_METHOD_MISMATCH');
});

test('accept delivery action allows rider to confirm assigned delivery', () => {
    const assignedOrder = { ...dispatchedOrder, orderStatus: 'Ready to Dispatch' };
    const outcome = evaluateDeliveryAction(assignedOrder, 'accept', 'rider-1');
    assert.equal(outcome.allowed, true);
    assert.equal(outcome.nextOrderStatus, 'Dispatched');
});

test('payment pending transitions delivery and is safe to replay after delivery', () => {
    assert.equal(evaluateDeliveryAction(dispatchedOrder, 'payment_pending', 'rider-1').nextPaymentStatus, 'PENDING_DIGITAL');
    const delivered = { ...dispatchedOrder, orderStatus: 'Delivered', paymentStatus: 'PENDING_DIGITAL' };
    assert.equal(evaluateDeliveryAction(delivered, 'payment_pending', 'rider-1').alreadyApplied, true);
    assert.equal(evaluateDeliveryAction({ ...delivered, paymentStatus: 'PAID' }, 'payment_pending', 'rider-1').code, 'PAYMENT_ALREADY_SETTLED');
});

test('not reachable preserves the existing Dispatched order status', () => {
    const transition = evaluateDeliveryAction(dispatchedOrder, 'not_reachable', 'rider-1');
    assert.equal(transition.allowed, true);
    assert.equal(transition.nextOrderStatus, 'Dispatched');
});

test('delivery accepts persisted legacy and uppercase out-for-delivery status values', () => {
    assert.equal(evaluateDeliveryAction({ ...dispatchedOrder, orderStatus: 'DISPATCHED' }, 'payment_pending', 'rider-1').allowed, true);
    assert.equal(evaluateDeliveryAction({ ...dispatchedOrder, orderStatus: 'out_for_delivery' }, 'payment_pending', 'rider-1').allowed, true);
    assert.equal(evaluateDeliveryAction({ ...dispatchedOrder, orderStatus: undefined, status: 'out_for_delivery' }, 'cash_received', 'rider-1').allowed, true);
});
