export class SetRiderEnabledUseCase {
    constructor({ riderRepository }) {
        this.riderRepository = riderRepository;
    }

    async execute(riderId, enabled, action, remark) {
        const rider = await this.riderRepository.findById(riderId);
        if (!rider) {
            throw new Error(`Rider #${riderId} not found.`);
        }

        if (enabled && rider.enabled) return rider;

        if (enabled) {
            rider.enable();
        } else {
            rider.disable(action, remark);
        }

        return this.riderRepository.update(riderId, {
            enabled: rider.enabled,
            disabledAction: rider.disabledAction,
            disabledReason: rider.disabledReason,
            disabledAt: rider.disabledAt,
            status: rider.status
        });
    }
}
