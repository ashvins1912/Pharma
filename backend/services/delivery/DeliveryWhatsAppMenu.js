const DISPATCHED_ACTION_ROWS = [
    { id: 'cash_received', title: '💵 Delivered - Cash Collected', description: 'Mark delivered and record cash collection.' },
    { id: 'cash_not_received', title: '❌ Delivered - Cash Not Received', description: 'Mark delivered but cash was not collected.' },
    { id: 'payment_pending', title: '🟢 Delivered - Payment Pending', description: 'Mark delivered with digital payment pending.' },
    { id: 'not_reachable', title: '🟡 Customer Not Responding', description: 'Record an unsuccessful delivery attempt.' }
];

const ASSIGNED_ACTION_ROWS = [
    { id: 'accept', title: '✅ Accept Delivery', description: 'Confirm assignment and start delivery trip.' },
    { id: 'view_delivery', title: '📍 View Delivery Details', description: 'Check customer location and items.' },
    { id: 'navigate', title: '🗺️ Navigate to Address', description: 'Open Google Maps for delivery address.' },
    { id: 'not_reachable', title: '🟡 Customer Not Responding', description: 'Record difficulty reaching customer.' }
];

const ALL_ACTION_ROWS = [...DISPATCHED_ACTION_ROWS, ...ASSIGNED_ACTION_ROWS];

/** Use only actions already supported by the delivery state machine. */
export const buildDeliveryActionMenu = (order, stage = 'Dispatched') => {
    const orderId = String(order?.orderNumber || order?._id || order?.id || '');
    const displayId = order?.orderNumber || (orderId ? `#${orderId.slice(-6).toUpperCase()}` : '');
    const rows = stage === 'Assigned' ? ASSIGNED_ACTION_ROWS : DISPATCHED_ACTION_ROWS;
    return {
        title: `Delivery Action ${displayId}`.trim(),
        description: stage === 'Assigned' ? 'Select an action for this assigned delivery.' : 'Choose the result for this delivery.',
        buttonText: 'Select Action',
        listType: 1,
        sections: [{ title: 'Select Status', rows: rows.map(row => ({ ...row })) }]
    };
};

export const getDeliveryActionFromListReply = message => {
    let content = message?.message;
    // WhatsApp may wrap the actual response in an ephemeral message envelope.
    for (let depth = 0; depth < 3 && content; depth += 1) {
        const response = content.listResponseMessage;
        if (response) return response;
        content = content.ephemeralMessage?.message || content.viewOnceMessage?.message || content.viewOnceMessageV2?.message;
    }
    return null;
};

export const isDeliveryMenuAction = action => ALL_ACTION_ROWS.some(row => row.id === action);
