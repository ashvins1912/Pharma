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
        allowed: true, nextOrderStatus: 'Delivered', nextPaymentStatus: 'PAID'
    });
    assert.equal(evaluateDeliveryAction(dispatchedOrder, 'cash_received', 'rider-2').code, 'RIDER_MISMATCH');
    assert.equal(evaluateDeliveryAction({ ...dispatchedOrder, orderStatus: 'Cancelled' }, 'cash_received', 'rider-1').code, 'INVALID_STATE');
    assert.equal(evaluateDeliveryAction({ ...dispatchedOrder, paymentMethod: 'UPI' }, 'cash_received', 'rider-1').code, 'PAYMENT_METHOD_MISMATCH');
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
