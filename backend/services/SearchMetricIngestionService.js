import MedicineDailyMetric from '../models/MedicineDailyMetric.js';

export class SearchMetricIngestionService {
    async recordImpressions({ skuId, count = 1, date = new Date() }) {
        return this.recordImpressionsForSkus({ skuIds: [skuId], count, date });
    }

    async recordImpressionsForSkus({ skuIds, count = 1, date = new Date() }) {
        if (!Array.isArray(skuIds)) {
            throw new TypeError('SKU IDs must be provided as an array.');
        }
        if (!Number.isSafeInteger(count) || count < 1) {
            throw new RangeError('Impression count must be a positive safe integer.');
        }
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
            throw new TypeError('Metric date must be a valid Date.');
        }
        const normalizedSkuIds = [...new Set(skuIds.map(skuId => {
            if (typeof skuId !== 'string' || !skuId.trim()) {
                throw new TypeError('Every SKU ID must be a non-empty string.');
            }
            return skuId.trim().toUpperCase();
        }))];
        if (normalizedSkuIds.length === 0) return [];

        const metricDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
        const operations = normalizedSkuIds.map(skuId => ({
            updateOne: {
                filter: { skuId, metricDate },
                update: {
                    $inc: { searchImpressions: count },
                    $setOnInsert: { skuId, metricDate }
                },
                upsert: true
            }
        }));
        return MedicineDailyMetric.bulkWrite(operations, { ordered: false });
    }
}

export default SearchMetricIngestionService;
