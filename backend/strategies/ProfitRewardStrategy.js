export class ProfitRewardStrategy {
    getMinimumRedemptionMargin() {
        throw new Error('ProfitRewardStrategy.getMinimumRedemptionMargin() must be implemented.');
    }

    getProfitPointMultiplier(_marginTier) {
        throw new Error('ProfitRewardStrategy.getProfitPointMultiplier() must be implemented.');
    }

    getMaximumProfitRedemptionRatio() {
        throw new Error('ProfitRewardStrategy.getMaximumProfitRedemptionRatio() must be implemented.');
    }
}

export class DefaultProfitRewardStrategy extends ProfitRewardStrategy {
    getMinimumRedemptionMargin() {
        return 15;
    }

    getProfitPointMultiplier(marginTier) {
        if (marginTier === 'HIGH') return 3;
        if (marginTier === 'MID') return 1;
        return 0;
    }

    getMaximumProfitRedemptionRatio() {
        return 0.4;
    }
}

export default DefaultProfitRewardStrategy;
