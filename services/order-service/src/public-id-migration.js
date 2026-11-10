import { Order } from './models.js';

export async function backfillServiceOrderNumbers(batchSize = 500) {
  const counters = Order.db.collection('applicationCounters');
  const [latest] = await Order.aggregate([
    { $match: { orderNumber: /^ORD-[0-9]+$/ } },
    { $project: { sequence: { $convert: {
      input: { $arrayElemAt: [{ $split: ['$orderNumber', '-'] }, 1] },
      to: 'long', onError: 0, onNull: 0
    } } } },
    { $group: { _id: null, sequence: { $max: '$sequence' } } }
  ]);
  const highest = Math.max(10025, Number(latest?.sequence) || 0);
  await counters.updateOne({ _id: 'order' }, { $max: { sequence: highest } }, { upsert: true });

  let updated = 0;
  for (;;) {
    const records = await Order.find({
      $or: [
        { orderNumber: { $exists: false } },
        { orderNumber: null },
        { orderNumber: '' },
        { orderNumber: { $not: /^ORD-[0-9]+$/ } }
      ]
    }).sort({ createdAt: 1, _id: 1 }).limit(batchSize).select('_id').lean();
    if (!records.length) return updated;

    for (const record of records) {
      const result = await counters.findOneAndUpdate(
        { _id: 'order' }, { $inc: { sequence: 1 } }, { returnDocument: 'after' }
      );
      const counter = result?.value || result;
      if (!Number.isSafeInteger(Number(counter?.sequence))) throw new Error('Unable to allocate a migrated order number.');
      const migrationId = `ORD-${counter.sequence}`;
      const write = await Order.updateOne(
        { _id: record._id, $or: [
          { orderNumber: { $exists: false } }, { orderNumber: null }, { orderNumber: '' },
          { orderNumber: { $not: /^ORD-[0-9]+$/ } }
        ] },
        { $set: { orderNumber: migrationId } }
      );
      updated += write.modifiedCount || 0;
    }
  }
}
