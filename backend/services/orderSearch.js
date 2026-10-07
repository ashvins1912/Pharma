import mongoose from 'mongoose';

export function classifyOrderSearch(input) {
    let raw = String(input || '').trim();
    if (!raw) throw Object.assign(new Error('Enter an Order ID, mobile number, or email address.'), { statusCode: 422 });
    if (raw.length > 254) throw Object.assign(new Error('Search input is too long.'), { statusCode: 422 });

    // Strip leading '#' if present (e.g., "#434EA1", "#ORD-12345")
    if (raw.startsWith('#')) {
        raw = raw.slice(1).trim();
    }
    if (!raw) throw Object.assign(new Error('Enter an Order ID, mobile number, or email address.'), { statusCode: 422 });

    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return { type: 'email', value: raw.toLowerCase() };

    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 15 && !/[^\d+().\s-]/.test(raw) && !/^[A-Za-z]/.test(raw)) {
        return { type: 'mobile', value: { digits, raw } };
    }

    if (/^(ORD|ASH)-[A-Z0-9-]+$/i.test(raw)) {
        return { type: 'orderId', value: { orderNumber: raw.toUpperCase(), raw } };
    }
    if (mongoose.isValidObjectId(raw)) {
        return { type: 'orderId', value: { objectId: raw, orderNumber: raw.toUpperCase(), raw } };
    }
    // 6-character hex suffix as displayed on order cards (e.g., 434EA1)
    if (/^[a-fA-F0-9]{6,24}$/i.test(raw)) {
        return { type: 'orderId', value: { orderNumber: raw.toUpperCase(), hexSuffix: raw.toUpperCase(), raw } };
    }

    throw Object.assign(new Error('Enter a valid Order ID, mobile number, or email address.'), { statusCode: 422 });
}

export function paginationResult(items, total, page, limit) {
    const totalPages = Math.ceil(total / limit);
    return {
        items,
        pagination: {
            page,
            limit,
            total,
            totalPages,
            hasNextPage: page < totalPages,
            hasPreviousPage: page > 1
        }
    };
}
