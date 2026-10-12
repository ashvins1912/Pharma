import { IAssignmentStrategy, AssignmentResult } from '../ports/IAssignmentStrategy.js';

/**
 * Strategy 2: Closest Available Rider Proximity Strategy
 * Standard fallback auto-assignment using Geo-queries to find the closest Available rider.
 */
export class ClosestRiderStrategy extends IAssignmentStrategy {
    constructor({ maxSearchRadiusMeters = 20000 } = {}) {
        super();
        this.maxSearchRadiusMeters = maxSearchRadiusMeters;
    }

    get name() {
        return 'ClosestRiderStrategy';
    }

    get priority() {
        return 20; // Fallback runs after clubbing
    }

    async execute({ order, riderRepository }) {
        const orderCoords = [order.location.longitude, order.location.latitude];

        // Search for closest available rider
        const nearbyRiders = await riderRepository.findAvailableNearby(
            orderCoords,
            this.maxSearchRadiusMeters,
            1 // Nearest candidate
        );

        if (!nearbyRiders || nearbyRiders.length === 0) {
            return AssignmentResult.pass({
                strategyName: this.name,
                reason: `No 'Available' riders found within ${(this.maxSearchRadiusMeters / 1000).toFixed(0)} km radius.`
            });
        }

        const { rider, distanceInMeters } = nearbyRiders[0];
        const distanceInKm = Number((distanceInMeters / 1000).toFixed(2));

        return AssignmentResult.success({
            rider,
            strategyName: this.name,
            reason: `Closest available rider located ${distanceInKm} km from delivery point.`,
            distanceInKm,
            metadata: {
                distanceInMeters,
                vehicleType: rider.vehicleType
            }
        });
    }
}
