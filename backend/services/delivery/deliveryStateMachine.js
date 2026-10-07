const DELIVERY_ACTIONS = new Set(['cash_received', 'cash_not_received', 'payment_pending', 'not_reachable', 'accept']);

const normalizeDeliveryStatus = order => {
    const rawStatus = String(order?.orderStatus || order?.status || '').trim().toLowerCase();
    if (rawStatus === 'dispatched' || rawStatus === 'out_for_delivery') return 'Dispatched';
    if (rawStatus === 'delivered') return 'Delivered';
    if (rawStatus === 'approved' || rawStatus === 'ready to dispatch' || rawStatus === 'accepted') return 'Assigned';
    return rawStatus;
};

export const evaluateDeliveryAction = (order, action, riderId) => {
    if (!DELIVERY_ACTIONS.has(action)) return { allowed: false, code: 'INVALID_ACTION' };
    if (!order?.rider?.riderId || String(order.rider.riderId) !== String(riderId)) {
        return { allowed: false, code: 'RIDER_MISMATCH' };
    }
    const currentStatus = normalizeDeliveryStatus(order);
    const isCod = /cash|cod/i.test(String(order.paymentMethod || ''));

    if (action === 'accept') {
        if (currentStatus === 'Delivered') return { allowed: false, code: 'ALREADY_DELIVERED' };
        if (currentStatus === 'Dispatched') {
            return { allowed: true, alreadyApplied: true, nextOrderStatus: 'Dispatched', nextPaymentStatus: order.paymentStatus };
        }
        return { allowed: true, nextOrderStatus: 'Dispatched', nextPaymentStatus: order.paymentStatus };
    }

    if (currentStatus === 'Delivered') {
        if (action === 'payment_pending' && ['PAID', 'REFUNDED', 'DISPUTED'].includes(order.paymentStatus)) {
            return { allowed: false, code: 'PAYMENT_ALREADY_SETTLED' };
        }
        if (action === 'cash_received' && order.paymentStatus === 'PAID' && isCod && order.cashCollectionStatus === 'CASH_RECEIVED') {
            return { allowed: true, alreadyApplied: true, nextOrderStatus: 'Delivered', nextPaymentStatus: 'PAID', cashCollectionStatus: 'CASH_RECEIVED' };
        }
        if (action === 'cash_not_received' && isCod && order.cashCollectionStatus === 'CASH_NOT_RECEIVED') {
            return { allowed: true, alreadyApplied: true, nextOrderStatus: 'Delivered', nextPaymentStatus: order.paymentStatus || 'PENDING', cashCollectionStatus: 'CASH_NOT_RECEIVED' };
        }
        if (action === 'payment_pending' && order.paymentStatus === 'PENDING_DIGITAL') {
            return { allowed: true, alreadyApplied: true, nextOrderStatus: 'Delivered', nextPaymentStatus: 'PENDING_DIGITAL', cashCollectionStatus: isCod ? 'CASH_NOT_RECEIVED' : 'NOT_APPLICABLE' };
        }
        return { allowed: false, code: 'INVALID_STATE' };
    }
    if (currentStatus !== 'Dispatched') return { allowed: false, code: 'INVALID_STATE' };
    if (action === 'cash_received') {
        if (!isCod) return { allowed: false, code: 'PAYMENT_METHOD_MISMATCH' };
        if (['PAID', 'REFUNDED', 'DISPUTED'].includes(order.paymentStatus)) return { allowed: false, code: 'PAYMENT_ALREADY_SETTLED' };
        return { allowed: true, nextOrderStatus: 'Delivered', nextPaymentStatus: 'PAID', cashCollectionStatus: 'CASH_RECEIVED' };
    }
    if (action === 'cash_not_received') {
        if (!isCod) return { allowed: false, code: 'PAYMENT_METHOD_MISMATCH' };
        return { allowed: true, nextOrderStatus: 'Delivered', nextPaymentStatus: order.paymentStatus === 'PAID' ? order.paymentStatus : 'PENDING', cashCollectionStatus: 'CASH_NOT_RECEIVED' };
    }
    if (action === 'payment_pending') {
        if (['PAID', 'REFUNDED', 'DISPUTED'].includes(order.paymentStatus)) return { allowed: false, code: 'PAYMENT_ALREADY_SETTLED' };
        return { allowed: true, nextOrderStatus: 'Delivered', nextPaymentStatus: 'PENDING_DIGITAL', cashCollectionStatus: isCod ? 'CASH_NOT_RECEIVED' : 'NOT_APPLICABLE' };
    }
    return { allowed: true, nextOrderStatus: 'Dispatched', nextPaymentStatus: order.paymentStatus, cashCollectionStatus: isCod ? (order.cashCollectionStatus || 'NOT_APPLICABLE') : 'NOT_APPLICABLE' };
};

export const deliveryActionNames = [...DELIVERY_ACTIONS];
