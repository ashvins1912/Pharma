import DefaultProfitRewardStrategy from './ProfitRewardStrategy.js';

const toMoney = value => Math.round((value + Number.EPSILON) * 100) / 100;

export class ProfitMarginRewardEngine {
    constructor({
        strategy = new DefaultProfitRewardStrategy(),
        pointsPerCurrencyUnit = 1,
        cashValuePerPoint = 0.1
    } = {}) {
        if (!Number.isFinite(pointsPerCurrencyUnit) || pointsPerCurrencyUnit <= 0
            || !Number.isFinite(cashValuePerPoint) || cashValuePerPoint <= 0) {
            throw new RangeError('Point conversion rates must be positive finite numbers.');
        }
        this.strategy = strategy;
        this.pointsPerCurrencyUnit = pointsPerCurrencyUnit;
        this.cashValuePerPoint = cashValuePerPoint;
    }

    calculateBasketMetrics(cartItems) {
        if (!Array.isArray(cartItems) || cartItems.length === 0) {
            throw new TypeError('Basket must contain at least one item.');
        }

        let totalRevenue = 0;
        let totalCostPrice = 0;
        for (const item of cartItems) {
            const { currentPrice, baseCostPrice, quantity, marginTier } = item;
            if (![currentPrice, baseCostPrice, quantity].every(Number.isFinite)
                || currentPrice < 0 || baseCostPrice < 0 || !Number.isInteger(quantity) || quantity < 1
                || !['LOW', 'MID', 'HIGH'].includes(marginTier)) {
                throw new TypeError('Basket items need valid server-priced values, quantity, and margin tier.');
            }
            totalRevenue += currentPrice * quantity;
            totalCostPrice += baseCostPrice * quantity;
        }
        const netProfit = totalRevenue - totalCostPrice;
        return {
            totalRevenue: toMoney(totalRevenue),
            totalCostPrice: toMoney(totalCostPrice),
            netProfit: toMoney(netProfit),
            netMarginPercentage: totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0
        };
    }

    calculateEarnedPoints(cartItems) {
        const metrics = this.calculateBasketMetrics(cartItems);
        const pointsToAssign = cartItems.reduce((points, item) => {
            const itemProfit = Math.max(0, item.currentPrice - item.baseCostPrice) * item.quantity;
            const multiplier = item.isDiscounted
                ? 0
                : this.strategy.getProfitPointMultiplier(item.marginTier);
            return points + itemProfit * multiplier
                * this.pointsPerCurrencyUnit;
        }, 0);
        return { ...metrics, pointsToAssign: Math.floor(pointsToAssign) };
    }

    validateRedemptionEligibility(cartItems, pointsToRedeem, availablePoints) {
        const metrics = this.calculateBasketMetrics(cartItems);
        if (!Number.isSafeInteger(pointsToRedeem) || pointsToRedeem < 0) {
            throw new RangeError('Points requested for redemption must be a non-negative whole number.');
        }
        if (!Number.isSafeInteger(availablePoints) || availablePoints < 0) {
            throw new RangeError('Available points must be a non-negative whole number.');
        }
        const minimumMargin = this.strategy.getMinimumRedemptionMargin();
        if (metrics.netMarginPercentage < minimumMargin) {
            return {
                eligible: false,
                partiallyEligible: false,
                allowedPoints: 0,
                allowedDiscountAmount: 0,
                reason: `Redemption is blocked because basket margin (${metrics.netMarginPercentage.toFixed(1)}%) is below ${minimumMargin}%.`,
                ...metrics
            };
        }
        if (pointsToRedeem === 0) {
            return {
                eligible: true,
                partiallyEligible: false,
                allowedPoints: 0,
                allowedDiscountAmount: 0,
                reason: null,
                ...metrics
            };
        }

        const maximumDiscount = Math.max(0, metrics.netProfit)
            * this.strategy.getMaximumProfitRedemptionRatio();
        const maximumPoints = Math.floor(maximumDiscount / this.cashValuePerPoint);
        const allowedPoints = Math.min(pointsToRedeem, availablePoints, maximumPoints);
        const allowedDiscountAmount = toMoney(allowedPoints * this.cashValuePerPoint);
        const reason = pointsToRedeem > availablePoints
            ? 'Redemption was reduced to your available points balance.'
            : allowedPoints < pointsToRedeem
                ? 'Redemption was reduced to keep the discount within 40% of order profit.'
                : null;
        return {
            eligible: true,
            partiallyEligible: allowedPoints < pointsToRedeem,
            allowedPoints,
            allowedDiscountAmount,
            reason,
            ...metrics
        };
    }
}

export default ProfitMarginRewardEngine;
