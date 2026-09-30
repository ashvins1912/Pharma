export class UpdateRiderLocationUseCase {
    constructor({ riderRepository }) {
        this.riderRepository = riderRepository;
    }

    async execute(riderId, longitude, latitude) {
        const rider = await this.riderRepository.findById(riderId);
        if (!rider) {
            throw new Error(`Rider #${riderId} not found.`);
        }
        rider.updateLocation(longitude, latitude);
        return await this.riderRepository.update(riderId, {
            currentLocation: rider.currentLocation.toGeoJSON()
        });
    }
}
