import Order from '../models/Order.js';
import MedicineRequest from '../models/MedicineRequest.js';

const nextSequence = async (collection, counterId, prefix, field, floor = 10025) => {
    const [latest] = await collection.aggregate([
        { $match: { [field]: new RegExp(`^${prefix}-[0-9]+$`) } },
        { $project: { sequence: { $convert: {
            input: { $arrayElemAt: [{ $split: [`$${field}`, '-'] }, 1] },
            to: 'long', onError: 0, onNull: 0
        } } } },
        { $group: { _id: null, sequence: { $max: '$sequence' } } }
    ]).toArray();
    const counters = collection.s.db.collection('applicationCounters');
    const highest = Math.max(floor, Number(latest?.sequence) || 0);
    try {
        await counters.updateOne({ _id: counterId }, { $max: { sequence: highest } }, { upsert: true });
    } catch (error) {
        if (error.code !== 11000) throw error;
        await counters.updateOne({ _id: counterId }, { $max: { sequence: highest } });
    }
    const result = await counters.findOneAndUpdate(
        { _id: counterId }, { $inc: { sequence: 1 } }, { returnDocument: 'after' }
    );
    const counter = result?.value || result;
    if (!Number.isSafeInteger(Number(counter?.sequence))) throw new Error(`Unable to allocate ${prefix} public ID.`);
    return `${prefix}-${counter.sequence}`;
};

async function migrateCollection(Model, field, prefix, counterId, batchSize) {
    const sequenceFloor = prefix === 'MR' ? 10024 : 10025;
    const collection = Model.collection;
    let updated = 0;
    for (;;) {
        const records = await Model.find({
            $or: [
                { [field]: { $exists: false } },
                { [field]: null },
                { [field]: '' },
                { [field]: { $not: new RegExp(`^${prefix}-[0-9]+$`) } }
            ]
        }).sort({ createdAt: 1, _id: 1 }).limit(batchSize).select('_id').lean();
        if (!records.length) return updated;
        for (const record of records) {
            const publicId = await nextSequence(collection, counterId, prefix, field, sequenceFloor);
            const result = await Model.updateOne(
                { _id: record._id, $or: [
                    { [field]: { $exists: false } }, { [field]: null }, { [field]: '' },
                    { [field]: { $not: new RegExp(`^${prefix}-[0-9]+$`) } }
                ] },
                { $set: { [field]: publicId } }
            );
            updated += result.modifiedCount || 0;
        }
    }
}

export async function backfillOrderNumbers(batchSize = 500) {
    return migrateCollection(Order, 'orderNumber', 'ORD', 'order', batchSize);
}

export async function backfillMedicineRequestNumbers(batchSize = 500) {
    return migrateCollection(MedicineRequest, 'requestNumber', 'MR', 'medicineRequest', batchSize);
}

export async function migratePublicIds(batchSize = 500) {
    const orders = await backfillOrderNumbers(batchSize);
    const medicineRequests = await backfillMedicineRequestNumbers(batchSize);
    return { orders, medicineRequests };
}
