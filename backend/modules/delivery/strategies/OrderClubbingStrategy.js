import { IAssignmentStrategy, AssignmentResult } from '../ports/IAssignmentStrategy.js';

/**
 * Strategy 1: Order Clubbing / Time-Window Strategy
 * Evaluates whether the new order can be grouped with an existing rider already
 * delivering in the same micro-zone within a 15-minute dispatch window.
 */
export class OrderClubbingStrategy extends IAssignmentStrategy {
    constructor({ timeWindowMinutes = 15, maxProximityMeters = 2000 } = {}) {
        super();
        this.timeWindowMinutes = timeWindowMinutes;
        this.maxProximityMeters = maxProximityMeters;
    }

    get name() {
        return 'OrderClubbingStrategy';
    }

    get priority() {
        return 10; // Executes first
    }

    async execute({ order, riderRepository, orderRepository }) {
        // Step 1: Evaluate if expected Out-for-Delivery is within time window (< 15 mins)
        const isUrgentWindow = order.isExpectedWithinMinutes(this.timeWindowMinutes);
        if (!isUrgentWindow) {
            return AssignmentResult.pass({
                strategyName: this.name,
                reason: `Order delivery window is > ${this.timeWindowMinutes} minutes away; passing to next strategy.`
            });
        }

        // Step 2: Query for nearby orders already assigned to a rider heading to the same zone
        const orderCoords = [order.location.longitude, order.location.latitude];
        const nearbyAssignedOrders = await orderRepository.findActiveOrdersInProximity(
            orderCoords,
            this.maxProximityMeters,
            ['Ready to Dispatch', 'Dispatched']
        );

        if (!nearbyAssignedOrders || nearbyAssignedOrders.length === 0) {
            return AssignmentResult.pass({
                strategyName: this.name,
                reason: `No active delivery routes found within ${(this.maxProximityMeters / 1000).toFixed(1)} km radius.`
            });
        }

        // Step 3: Find a suitable active rider from the nearby clubbed orders
        for (const candidate of nearbyAssignedOrders) {
            const clubbedOrder = candidate.order;
            const riderId = clubbedOrder.assignedRiderId;
            if (!riderId) continue;

            const activeRider = await riderRepository.findById(riderId);
            if (!activeRider || activeRider.isOffDuty()) continue;

            // Maximum orders a rider can carry simultaneously in clubbing (e.g. up to 4 orders)
            if (activeRider.activeOrderIds.length >= 4) continue;

            const distanceInKm = Number((candidate.distanceInMeters / 1000).toFixed(2));

            return AssignmentResult.success({
                rider: activeRider,
                strategyName: this.name,
                reason: `Smart-clubbed with Order #${clubbedOrder.id.slice(-6).toUpperCase()} (${distanceInKm} km away in same drop zone)`,
                distanceInKm,
                metadata: {
                    clubbedWithOrderId: clubbedOrder.id,
                    clubbedWithCustomer: clubbedOrder.customerName,
                    proximityMeters: candidate.distanceInMeters
                }
            });
        }

        return AssignmentResult.pass({
            strategyName: this.name,
            reason: `Nearby orders found within zone, but riders at capacity or unavailable.`
        });
    }
}
