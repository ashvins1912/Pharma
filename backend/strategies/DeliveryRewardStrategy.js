export class DeliveryRewardStrategy {
    getPointsForCompletedDelivery(_order) {
        throw new Error('DeliveryRewardStrategy.getPointsForCompletedDelivery() must be implemented.');
    }
}

export class FixedDeliveryRewardStrategy extends DeliveryRewardStrategy {
    constructor(pointsPerDelivery = 25) {
        super();
        if (!Number.isSafeInteger(pointsPerDelivery) || pointsPerDelivery < 0) {
            throw new RangeError('Delivery reward points must be a non-negative whole number.');
        }
        this.pointsPerDelivery = pointsPerDelivery;
    }

    getPointsForCompletedDelivery() {
        return this.pointsPerDelivery;
    }
}

export default FixedDeliveryRewardStrategy;
