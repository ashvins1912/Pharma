const ACTION_ROWS = [
    { id: 'cash_received', title: '💵 Delivered - Cash Collected', description: 'Mark delivered and record cash collection.' },
    { id: 'payment_pending', title: '🟢 Delivered - Payment Pending', description: 'Mark delivered with digital payment pending.' },
    { id: 'not_reachable', title: '🟡 Customer Not Responding', description: 'Record an unsuccessful delivery attempt.' }
];

/** Use only actions already supported by the delivery state machine. */
export const buildDeliveryActionMenu = order => {
    const orderId = String(order?._id || order?.id || '');
    return {
        title: `Delivery update${orderId ? ` #${orderId.slice(-6).toUpperCase()}` : ''}`,
        description: 'Choose the result for this delivery.',
        buttonText: 'Select Action',
        listType: 1,
        sections: [{ title: 'Select Status', rows: ACTION_ROWS.map(row => ({ ...row })) }]
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

export const isDeliveryMenuAction = action => ACTION_ROWS.some(row => row.id === action);
