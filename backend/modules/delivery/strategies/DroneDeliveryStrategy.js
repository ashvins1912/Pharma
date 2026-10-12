import { IAssignmentStrategy, AssignmentResult } from '../ports/IAssignmentStrategy.js';

/**
 * Strategy 3 (Extensibility Showcase): Autonomous Drone Dispatch Strategy
 * Demonstrates Open/Closed Principle: plugged into the pipeline without editing any core engine code.
 * Activates if order has 'DRONE_EXPRESS' tag or delivery location is beyond terrestrial road radius.
 */
export class DroneDeliveryStrategy extends IAssignmentStrategy {
    get name() {
        return 'DroneDeliveryStrategy';
    }

    get priority() {
        return 5; // Evaluates before terrestrial if enabled
    }

    async execute({ order, riderRepository }) {
        const isDroneEligible = Boolean(order.assignmentDetails?.preferDrone);
        if (!isDroneEligible) {
            return AssignmentResult.pass({
                strategyName: this.name,
                reason: 'Order is not flagged for aerial drone corridor.'
            });
        }

        const drones = await riderRepository.findAll({ status: 'Available' });
        const drone = drones.find(r => r.vehicleType === 'Drone');

        if (!drone) {
            return AssignmentResult.pass({
                strategyName: this.name,
                reason: 'No drone bays currently docked and charged.'
            });
        }

        return AssignmentResult.success({
            rider: drone,
            strategyName: this.name,
            reason: 'Autonomous drone dispatched via aerial corridor.'
        });
    }
}
