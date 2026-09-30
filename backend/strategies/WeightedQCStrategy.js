import { RankingStrategy } from './RankingStrategy.js';

const DEFAULT_WEIGHTS = Object.freeze({
    velocity: 40,
    searchMomentum: 10,
    basket: 30,
    availability: 5,
    otcMargin: 8,
    discount: 7
});

export class WeightedQCStrategy extends RankingStrategy {
    constructor(weights = {}) {
        super();
        this.weights = Object.freeze({ ...DEFAULT_WEIGHTS, ...weights });

        const total = Object.values(this.weights).reduce((sum, weight) => sum + weight, 0);
        if (total !== 100 || Object.values(this.weights).some(weight => !Number.isFinite(weight) || weight < 0)) {
            throw new Error('Ranking weights must be non-negative numbers totaling 100.');
        }
    }

    buildAggregationStages(context = {}) {
        const cart = Array.isArray(context.activeCartSkus) ? context.activeCartSkus : [];
        const activeCartSkus = [...new Set(
            cart
                .filter(sku => typeof sku === 'string')
                .map(sku => sku.trim().toUpperCase())
                .filter(Boolean)
        )];

        return [
            {
                $set: {
                    _cartPairMatchCount: {
                        $size: {
                            $setIntersection: [
                                { $ifNull: ['$frequentPurchasePairs', []] },
                                activeCartSkus
                            ]
                        }
                    },
                    _velocityScore: {
                        $min: [1, { $max: [0, { $ifNull: ['$analytics.velocityScore', 0] }] }]
                    },
                    _searchMomentum: {
                        $min: [1, { $max: [0, { $ifNull: ['$analytics.searchMomentum', 0] }] }]
                    },
                    _discountRatio: {
                        $min: [
                            1,
                            {
                                $divide: [
                                    { $max: [0, { $ifNull: ['$pricing.discountPercentage', 0] }] },
                                    25
                                ]
                            }
                        ]
                    },
                    _availabilityRatio: {
                        $min: [
                            1,
                            { $divide: [{ $max: [0, { $ifNull: ['$availableQuantity', 0] }] }, 10] }
                        ]
                    }
                }
            },
            {
                $set: {
                    bundlePriority: { $cond: [{ $gt: ['$_cartPairMatchCount', 0] }, 1, 0] },
                    popularityPoints: {
                        $add: [
                            { $multiply: ['$_velocityScore', this.weights.velocity] },
                            { $multiply: ['$_searchMomentum', this.weights.searchMomentum] }
                        ]
                    },
                    bundlePoints: {
                        $cond: [
                            { $gt: ['$_cartPairMatchCount', 0] },
                            this.weights.basket,
                            0
                        ]
                    },
                    availabilityPoints: {
                        $multiply: ['$_availabilityRatio', this.weights.availability]
                    },
                    otcMarginPoints: {
                        $cond: [
                            { $eq: ['$isRxRequired', false] },
                            {
                                $switch: {
                                    branches: [
                                        { case: { $eq: ['$pricing.marginTier', 'HIGH'] }, then: this.weights.otcMargin },
                                        { case: { $eq: ['$pricing.marginTier', 'MID'] }, then: this.weights.otcMargin * 0.625 },
                                        { case: { $eq: ['$pricing.marginTier', 'LOW'] }, then: this.weights.otcMargin * 0.25 }
                                    ],
                                    default: 0
                                }
                            },
                            0
                        ]
                    },
                    discountPoints: { $multiply: ['$_discountRatio', this.weights.discount] }
                }
            },
            {
                $set: {
                    finalDiscoveryScore: {
                        $add: [
                            '$popularityPoints',
                            '$bundlePoints',
                            '$availabilityPoints',
                            '$otcMarginPoints',
                            '$discountPoints'
                        ]
                    }
                }
            },
            {
                $sort: {
                    bundlePriority: -1,
                    finalDiscoveryScore: -1,
                    'analytics.ordersLast7Days': -1,
                    skuId: 1
                }
            }
        ];
    }
}

export default WeightedQCStrategy;
