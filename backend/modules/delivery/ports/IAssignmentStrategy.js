/**
 * Abstract Port: IAssignmentStrategy (Chain of Responsibility / Strategy Pattern)
 * Defines the contract for an expandable order assignment strategy.
 * Open for extension: new strategies (DroneDelivery, PriorityCustomer, etc.)
 * simply implement this interface and are added to the OrderAssignmentEngine pipeline.
 */
export class IAssignmentStrategy {
    /**
     * Unique name identifying the strategy in logs and order audit trails
     * @returns {string}
     */
    get name() {
        throw new Error('Getter IAssignmentStrategy.name must be implemented.');
    }

    /**
     * Integer priority order in the execution chain (lower runs earlier)
     * @returns {number}
     */
    get priority() {
        return 100;
    }

    /**
     * Evaluates whether this strategy can and should fulfill the order assignment.
     * @param {object} context
     * @param {import('../domain/entities/Order.js').Order} context.order - The target order being assigned
     * @param {import('./IRiderRepository.js').IRiderRepository} context.riderRepository
     * @param {import('./IOrderRepository.js').IOrderRepository} context.orderRepository
     * @param {object} [context.options] - Optional execution parameters
     * @returns {Promise<AssignmentResult>}
     */
    async execute(context) {
        throw new Error(`Strategy ${this.name} must implement execute(context).`);
    }
}

/**
 * Result structure returned by strategies
 */
export class AssignmentResult {
    /**
     * @param {boolean} matched - Whether the strategy successfully assigned a rider
     * @param {import('../domain/entities/Rider.js').Rider|null} rider - The assigned rider
     * @param {string} strategyName - The strategy that resolved it
     * @param {string} reason - Detailed explanation for logs and UI audit
     * @param {number|null} distanceInKm - Distance in km
     * @param {object} [metadata] - Additional details (e.g. clubbedOrderId)
     */
    constructor({
        matched = false,
        rider = null,
        strategyName = '',
        reason = '',
        distanceInKm = null,
        metadata = {}
    }) {
        this.matched = matched;
        this.rider = rider;
        this.strategyName = strategyName;
        this.reason = reason;
        this.distanceInKm = distanceInKm;
        this.metadata = metadata;
    }

    static success({ rider, strategyName, reason, distanceInKm = null, metadata = {} }) {
        return new AssignmentResult({
            matched: true,
            rider,
            strategyName,
            reason,
            distanceInKm,
            metadata
        });
    }

    static pass({ strategyName, reason }) {
        return new AssignmentResult({
            matched: false,
            rider: null,
            strategyName,
            reason
        });
    }
}
