import Medicine from '../models/Medicine.js';
import Order from '../models/Order.js';
import MedicineDataMart from '../models/MedicineDataMart.js';
import MedicineDailyMetric from '../models/MedicineDailyMetric.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const quantileValue = (sortedValues, fraction) => {
    if (sortedValues.length === 0) return 0;
    return sortedValues[Math.min(sortedValues.length - 1, Math.floor((sortedValues.length - 1) * fraction))];
};

const deliveredOrderCounts = async (orderModel, since30Days, since7Days) => orderModel.aggregate([
    { $match: { orderStatus: 'Delivered', createdAt: { $gte: since30Days } } },
    { $unwind: '$medicineItems' },
    {
        $set: {
            _skuId: {
                $toUpper: {
                    $trim: { input: { $ifNull: ['$medicineItems.sku', ''] } }
                }
            }
        }
    },
    { $match: { _skuId: { $ne: '' } } },
    {
        $group: {
            _id: { orderId: '$_id', skuId: '$_skuId' },
            createdAt: { $first: '$createdAt' }
        }
    },
    {
        $group: {
            _id: '$_id.skuId',
            ordersLast30Days: { $sum: 1 },
            ordersLast7Days: {
                $sum: { $cond: [{ $gte: ['$createdAt', since7Days] }, 1, 0] }
            }
        }
    }
]).exec();

const frequentPurchasePairs = async (orderModel, since30Days) => orderModel.aggregate([
    { $match: { orderStatus: 'Delivered', createdAt: { $gte: since30Days } } },
    {
        $project: {
            allSkuIds: {
                $setUnion: [
                    {
                        $map: {
                            input: { $ifNull: ['$medicineItems', []] },
                            as: 'item',
                            in: {
                                $toUpper: {
                                    $trim: { input: { $ifNull: ['$$item.sku', ''] } }
                                }
                            }
                        }
                    },
                    []
                ]
            }
        }
    },
    { $set: { skuIds: '$allSkuIds' } },
    { $unwind: '$skuIds' },
    { $match: { skuIds: { $ne: '' } } },
    {
        $set: {
            pairSkuIds: {
                $filter: {
                    input: '$allSkuIds',
                    as: 'pairSkuId',
                    cond: { $ne: ['$$pairSkuId', '$skuIds'] }
                }
            }
        }
    },
    { $unwind: '$pairSkuIds' },
    {
        $group: {
            _id: { skuId: '$skuIds', pairSkuId: '$pairSkuIds' },
            orderCount: { $sum: 1 }
        }
    },
    { $sort: { '_id.skuId': 1, orderCount: -1, '_id.pairSkuId': 1 } },
    {
        $group: {
            _id: '$_id.skuId',
            pairs: { $push: { skuId: '$_id.pairSkuId', count: '$orderCount' } }
        }
    },
    { $project: { pairs: { $slice: ['$pairs', 10] } } }
]).exec();

export class DataMartRefreshService {
    constructor({
        medicineModel = Medicine,
        orderModel = Order,
        dataMartModel = MedicineDataMart,
        dailyMetricModel = MedicineDailyMetric
    } = {}) {
        this.medicineModel = medicineModel;
        this.orderModel = orderModel;
        this.dataMartModel = dataMartModel;
        this.dailyMetricModel = dailyMetricModel;
    }

    async refresh({ now = new Date() } = {}) {
        const since7Days = new Date(now.getTime() - 7 * DAY_MS);
        const since30Days = new Date(now.getTime() - 30 * DAY_MS);
        const refreshId = now.toISOString();
        const metricSince = new Date(since30Days);
        metricSince.setUTCHours(0, 0, 0, 0);
        const [medicines, orderCounts, searchCounts, pairRows] = await Promise.all([
            this.medicineModel.find({})
                .select('sku code name manufacturer brand composition category subCategory price basePrice baseCostPrice discountPercentage marginTier imageUrl isPrescriptionRequired requiresPrescription stockQuantity stock reservedQuantity quantity expiryDate isActive')
                .lean()
                .exec(),
            deliveredOrderCounts(this.orderModel, since30Days, since7Days),
            this.dailyMetricModel.aggregate([
                { $match: { metricDate: { $gte: metricSince, $lt: now } } },
                {
                    $group: {
                        _id: '$skuId',
                        searchImpressionsCount: { $sum: '$searchImpressions' },
                        searchImpressionsLast7Days: {
                            $sum: { $cond: [{ $gte: ['$metricDate', since7Days] }, '$searchImpressions', 0] }
                        }
                    }
                }
            ]).exec(),
            frequentPurchasePairs(this.orderModel, since30Days)
        ]);

        const orderBySku = new Map(orderCounts.map(row => [row._id, row]));
        const searchesBySku = new Map(searchCounts.map(row => [row._id, row]));
        const pairsBySku = new Map();
        for (const row of pairRows) {
            pairsBySku.set(row._id, row.pairs.map(pair => pair.skuId));
        }

        const sourceBySku = new Map();
        for (const medicine of medicines) {
            const skuId = String(medicine.sku || medicine.code || medicine._id || '').trim().toUpperCase();
            if (!skuId) continue;
            if (sourceBySku.has(skuId)) {
                throw new Error(`Duplicate source medicine SKU found while refreshing data mart: ${skuId}`);
            }
            sourceBySku.set(skuId, medicine);
        }

        const products = [...sourceBySku.entries()].map(([skuId, medicine]) => {
            const orders = orderBySku.get(skuId) || {};
            const searches = searchesBySku.get(skuId) || {};
            const dailySearchRate = Number(searches.searchImpressionsLast7Days || 0) / 7;
            const baselineSearchRate = Number(searches.searchImpressionsCount || 0) / 30;
            const searchMomentum = clamp((dailySearchRate - baselineSearchRate) / Math.max(1, baselineSearchRate));
            const physicalStock = Number(medicine.stockQuantity ?? medicine.stock ?? medicine.quantity ?? 0);
            const reservedStock = Number(medicine.reservedQuantity || 0);
            const expiryTime = medicine.expiryDate ? new Date(medicine.expiryDate).getTime() : null;
            const currentPrice = Number(medicine.price ?? 0);
            const basePrice = Number(medicine.basePrice ?? medicine.price ?? currentPrice);
            const discountPercentage = Number(
                medicine.discountPercentage
                ?? (basePrice > 0 ? Math.max(0, ((basePrice - currentPrice) / basePrice) * 100) : 0)
            );
            const composition = Array.isArray(medicine.composition)
                ? medicine.composition
                : [medicine.composition].filter(Boolean);

            return {
                skuId,
                medicine,
                therapeuticCategory: String(medicine.category || '').trim() || 'Unclassified',
                price: currentPrice,
                ordersLast7Days: Number(orders.ordersLast7Days || 0),
                ordersLast30Days: Number(orders.ordersLast30Days || 0),
                searchImpressionsLast7Days: Number(searches.searchImpressionsLast7Days || 0),
                searchImpressionsCount: Number(searches.searchImpressionsCount || 0),
                searchMomentum,
                frequentPurchasePairs: pairsBySku.get(skuId) || [],
                availableQuantity: Math.max(0, physicalStock - reservedStock),
                isActive: medicine.isActive !== false
                    && (expiryTime === null || (Number.isFinite(expiryTime) && expiryTime > now.getTime())),
                basePrice,
                baseCostPrice: Number(medicine.baseCostPrice ?? currentPrice),
                currentPrice,
                discountPercentage: clamp(discountPercentage, 0, 100),
                marginTier: ['LOW', 'MID', 'HIGH'].includes(medicine.marginTier) ? medicine.marginTier : 'LOW',
                composition
            };
        });

        const byCategory = new Map();
        for (const product of products) {
            const categoryItems = byCategory.get(product.therapeuticCategory) || [];
            categoryItems.push(product);
            byCategory.set(product.therapeuticCategory, categoryItems);
        }

        const operations = [];
        for (const categoryItems of byCategory.values()) {
            const sortedByPrice = [...categoryItems].sort((left, right) => left.price - right.price);
            const sortedByDemand = [...categoryItems].sort((left, right) =>
                (right.ordersLast30Days + right.searchImpressionsCount)
                - (left.ordersLast30Days + left.searchImpressionsCount)
            );
            const maxDemand = categoryItems.reduce((maximum, item) => Math.max(
                maximum,
                Math.log1p(item.ordersLast30Days) + Math.log1p(item.searchImpressionsCount)
            ), 1);
            const priceCuts = [
                quantileValue(sortedByPrice.map(item => item.price), 1 / 3),
                quantileValue(sortedByPrice.map(item => item.price), 2 / 3)
            ];
            const segmentBySku = new Map(sortedByDemand.map((item, index) => {
                const hasDemand = item.ordersLast30Days > 0 || item.searchImpressionsCount > 0;
                const percentile = index / Math.max(1, sortedByDemand.length - 1);
                return [
                    item.skuId,
                    !hasDemand
                        ? 'LOW_VELOCITY'
                        : percentile < 0.2
                            ? 'HYPER_VELOCITY'
                            : percentile >= 0.8 ? 'LOW_VELOCITY' : 'STEADY_DEMAND'
                ];
            }));

            for (const product of categoryItems) {
                const demand = Math.log1p(product.ordersLast30Days) + Math.log1p(product.searchImpressionsCount);
                const velocityScore = clamp(demand / maxDemand * 0.8 + product.searchMomentum * 0.2);
                const priceTier = product.price <= priceCuts[0]
                    ? 'LOW'
                    : product.price <= priceCuts[1] ? 'MID' : 'HIGH';
                const medicine = product.medicine;

                operations.push({
                    updateOne: {
                        filter: { skuId: product.skuId },
                        update: {
                            $set: {
                                sourceMedicineId: medicine._id,
                                name: medicine.name,
                                manufacturer: medicine.manufacturer || medicine.brand || 'Unknown',
                                composition: product.composition,
                                imageUrl: medicine.imageUrl || '',
                                therapeuticCategory: product.therapeuticCategory,
                                subCategory: String(medicine.subCategory || '').trim() || 'Unclassified',
                                isRxRequired: Boolean(medicine.isPrescriptionRequired ?? medicine.requiresPrescription),
                                pricing: {
                                    basePrice: product.basePrice,
                                    currentPrice: product.currentPrice,
                                    baseCostPrice: product.baseCostPrice,
                                    discountPercentage: product.discountPercentage,
                                    marginTier: product.marginTier,
                                    priceTier,
                                    isPriceSensitive: priceTier === 'LOW'
                                },
                                analytics: {
                                    ordersLast7Days: product.ordersLast7Days,
                                    ordersLast30Days: product.ordersLast30Days,
                                    searchImpressionsLast7Days: product.searchImpressionsLast7Days,
                                    searchImpressionsCount: product.searchImpressionsCount,
                                    searchMomentum: product.searchMomentum,
                                    velocityScore
                                },
                                frequentPurchasePairs: product.frequentPurchasePairs,
                                popularitySegment: segmentBySku.get(product.skuId),
                                availableQuantity: product.availableQuantity,
                                isActive: product.isActive,
                                refreshId,
                                metricsComputedAt: now
                            }
                        },
                        upsert: true
                    }
                });
            }
        }

        if (operations.length > 0) await this.dataMartModel.bulkWrite(operations, { ordered: false });
        await this.dataMartModel.updateMany(
            { refreshId: { $ne: refreshId } },
            { $set: { isActive: false, refreshId, metricsComputedAt: now } }
        ).exec();

        return { refreshedCount: operations.length, refreshId, metricsComputedAt: now };
    }
}

export default DataMartRefreshService;
