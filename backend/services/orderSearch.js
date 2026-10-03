import mongoose from 'mongoose';

export function classifyOrderSearch(input) {
    const raw = String(input || '').trim();
    if (!raw) throw Object.assign(new Error('Enter an Order ID, mobile number, or email address.'), { statusCode: 422 });
    if (raw.length > 254) throw Object.assign(new Error('Search input is too long.'), { statusCode: 422 });

    if (/^ORD-[A-Z0-9-]+$/i.test(raw)) return { type: 'orderId', value: { orderNumber: raw.toUpperCase() } };
    if (mongoose.isValidObjectId(raw)) return { type: 'orderId', value: { objectId: raw } };
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return { type: 'email', value: raw.toLowerCase() };

    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 15 && !/[^\d+().\s-]/.test(raw)) {
        return { type: 'mobile', value: { digits, raw } };
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
