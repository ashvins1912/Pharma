import MedicineDataMart from '../models/MedicineDataMart.js';
import WeightedQCStrategy from '../strategies/WeightedQCStrategy.js';

const normalizeList = value => {
    const values = Array.isArray(value) ? value : value == null ? [] : [value];
    return [...new Set(values
        .filter(item => typeof item === 'string')
        .map(item => item.trim())
        .filter(Boolean))];
};

const parsePositiveInteger = (value, fallback, fieldName) => {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
        const error = new RangeError(`${fieldName} must be a positive whole number.`);
        error.statusCode = 400;
        throw error;
    }
    return parsed;
};

const buildCategoryMatch = (categoryFilters = {}, userContext = {}) => {
    const filter = { isActive: true, availableQuantity: { $gt: 0 } };
    const categories = normalizeList(categoryFilters.categories ?? categoryFilters.category);
    const subCategories = normalizeList(categoryFilters.subCategories ?? categoryFilters.subCategory);
    const activeCartSkus = normalizeList(userContext.activeCartSkus).map(sku => sku.toUpperCase());

    if (categories.length === 1) filter.therapeuticCategory = categories[0];
    if (categories.length > 1) filter.therapeuticCategory = { $in: categories };
    if (subCategories.length === 1) filter.subCategory = subCategories[0];
    if (subCategories.length > 1) filter.subCategory = { $in: subCategories };

    const priceTier = userContext.priceTier ?? categoryFilters.priceTier;
    if (['LOW', 'MID', 'HIGH'].includes(priceTier)) filter['pricing.priceTier'] = priceTier;
    if (typeof categoryFilters.isRxRequired === 'boolean') filter.isRxRequired = categoryFilters.isRxRequired;
    if (Number.isFinite(categoryFilters.maxPrice) && categoryFilters.maxPrice >= 0) {
        filter['pricing.currentPrice'] = { $lte: categoryFilters.maxPrice };
    }
    if (activeCartSkus.length > 0) filter.skuId = { $nin: activeCartSkus };
    return filter;
};

export class ProductDiscoveryService {
    constructor({ model = MedicineDataMart, strategy = new WeightedQCStrategy() } = {}) {
        this.model = model;
        this.rankingStrategy = strategy;
    }

    async getPrioritizedMedicines(categoryFilters = {}, userContext = {}, pagination = {}) {
        const page = parsePositiveInteger(pagination.page, 1, 'page');
        const limit = Math.min(100, parsePositiveInteger(pagination.limit, 20, 'limit'));
        const skip = (page - 1) * limit;
        if (!Number.isSafeInteger(skip)) {
            const error = new RangeError('Pagination offset is too large.');
            error.statusCode = 400;
            throw error;
        }

        const pipeline = [
            { $match: buildCategoryMatch(categoryFilters, userContext) },
            {
                $project: {
                    skuId: 1,
                    name: 1,
                    manufacturer: 1,
                    composition: 1,
                    imageUrl: 1,
                    therapeuticCategory: 1,
                    subCategory: 1,
                    isRxRequired: 1,
                    pricing: 1,
                    analytics: 1,
                    frequentPurchasePairs: 1,
                    availableQuantity: 1,
                    popularitySegment: 1
                }
            },
            ...this.rankingStrategy.buildAggregationStages(userContext),
            { $skip: skip },
            { $limit: limit },
            {
                $project: {
                    _cartPairMatchCount: 0,
                    _velocityScore: 0,
                    _searchMomentum: 0,
                    _discountRatio: 0,
                    _availabilityRatio: 0
                }
            }
        ];

        return this.model.aggregate(pipeline).exec();
    }
}

export default ProductDiscoveryService;
