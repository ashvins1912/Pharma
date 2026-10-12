import { randomUUID } from 'node:crypto';
import Order from '../models/Order.js';

export async function backfillOrderNumbers(batchSize = 500) {
    let updated = 0;
    for (;;) {
        const orders = await Order.find({
            $or: [
                { orderNumber: { $exists: false } },
                { orderNumber: null },
                { orderNumber: '' }
            ]
        }).select('_id').limit(batchSize).lean();
        if (!orders.length) return updated;
        const operations = orders.map(order => ({
            updateOne: {
                filter: {
                    _id: order._id,
                    $or: [
                        { orderNumber: { $exists: false } },
                        { orderNumber: null },
                        { orderNumber: '' }
                    ]
                },
                update: { $set: { orderNumber: `ORD-${randomUUID()}` } }
            }
        }));
        const result = await Order.bulkWrite(operations, { ordered: false });
        updated += result.modifiedCount;
    }
}
