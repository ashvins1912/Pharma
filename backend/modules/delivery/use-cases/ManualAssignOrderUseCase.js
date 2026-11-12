export class ManualAssignOrderUseCase {
    constructor({ riderRepository, orderRepository }) {
        this.riderRepository = riderRepository;
        this.orderRepository = orderRepository;
    }

    async execute(orderId, riderId, dispatcherNotes = 'Manual Dispatch', tenantId) {
        if (!tenantId) throw new Error('Tenant context is required for rider assignment.');
        const [order, rider] = await Promise.all([
            this.orderRepository.findById(orderId, tenantId),
            this.riderRepository.findById(riderId, tenantId)
        ]);

        if (!order) throw new Error(`Order #${orderId} not found.`);
        if (!rider) throw new Error(`Rider #${riderId} not found.`);
        if (rider.isOffDuty()) throw new Error(`Rider ${rider.name} is currently Off-duty.`);

        // Calculate distance
        const distanceInKm = order.location.distanceInKm(rider.currentLocation);

        // Domain updates
        rider.assignOrder(order.id);
        order.assignToRider(rider, 'ManualDispatch', dispatcherNotes, distanceInKm, false);

        const [savedRider, savedOrder] = await Promise.all([
            this.riderRepository.update(rider.id, {
                status: rider.status,
                activeOrderIds: rider.activeOrderIds
            }, tenantId),
            this.orderRepository.update(order.id, {
                orderStatus: order.orderStatus,
                assignmentType: order.assignmentType,
                rider: order.rider,
                assignmentDetails: order.assignmentDetails
            }, tenantId)
        ]);

        return { order: savedOrder, rider: savedRider };
    }
}
