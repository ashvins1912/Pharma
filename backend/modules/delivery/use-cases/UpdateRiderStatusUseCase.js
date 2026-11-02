export class UpdateRiderStatusUseCase {
    constructor({ riderRepository }) {
        this.riderRepository = riderRepository;
    }

    async execute(riderId, newStatus, tenantId) {
        const rider = await this.riderRepository.findById(riderId, tenantId);
        if (!rider) {
            throw new Error(`Rider #${riderId} not found.`);
        }
        rider.updateStatus(newStatus);
        return await this.riderRepository.update(riderId, { status: rider.status }, tenantId);
    }
}
