const DELIVERY_ACTIONS = new Set(['cash_received', 'payment_pending', 'not_reachable']);

export const evaluateDeliveryAction = (order, action, riderId) => {
    if (!DELIVERY_ACTIONS.has(action)) return { allowed: false, code: 'INVALID_ACTION' };
    if (!order?.rider?.riderId || String(order.rider.riderId) !== String(riderId)) {
        return { allowed: false, code: 'RIDER_MISMATCH' };
    }
    if (String(order?.orderStatus || '') === 'Delivered') {
        if (action === 'payment_pending' && ['PAID', 'REFUNDED', 'DISPUTED'].includes(order.paymentStatus)) {
            return { allowed: false, code: 'PAYMENT_ALREADY_SETTLED' };
        }
        if (action === 'cash_received' && order.paymentStatus === 'PAID' && /cash|cod/i.test(String(order.paymentMethod || ''))) {
            return { allowed: true, alreadyApplied: true, nextOrderStatus: 'Delivered', nextPaymentStatus: 'PAID' };
        }
        if (action === 'payment_pending' && order.paymentStatus === 'PENDING_DIGITAL') {
            return { allowed: true, alreadyApplied: true, nextOrderStatus: 'Delivered', nextPaymentStatus: 'PENDING_DIGITAL' };
        }
        return { allowed: false, code: 'INVALID_STATE' };
    }
    if (String(order?.orderStatus || '') !== 'Dispatched') return { allowed: false, code: 'INVALID_STATE' };
    if (action === 'cash_received') {
        if (!/cash|cod/i.test(String(order.paymentMethod || ''))) return { allowed: false, code: 'PAYMENT_METHOD_MISMATCH' };
        if (['PAID', 'REFUNDED', 'DISPUTED'].includes(order.paymentStatus)) return { allowed: false, code: 'PAYMENT_ALREADY_SETTLED' };
        return { allowed: true, nextOrderStatus: 'Delivered', nextPaymentStatus: 'PAID' };
    }
    if (action === 'payment_pending') {
        if (['PAID', 'REFUNDED', 'DISPUTED'].includes(order.paymentStatus)) return { allowed: false, code: 'PAYMENT_ALREADY_SETTLED' };
        return { allowed: true, nextOrderStatus: 'Delivered', nextPaymentStatus: 'PENDING_DIGITAL' };
    }
    return { allowed: true, nextOrderStatus: 'Dispatched', nextPaymentStatus: order.paymentStatus };
};

export const deliveryActionNames = [...DELIVERY_ACTIONS];
