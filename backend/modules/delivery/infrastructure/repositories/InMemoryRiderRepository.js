import { IRiderRepository } from '../../ports/IRiderRepository.js';
import { Rider } from '../../domain/entities/Rider.js';
import { Location } from '../../domain/value-objects/Location.js';

export class InMemoryRiderRepository extends IRiderRepository {
    constructor() {
        super();
        this.riders = new Map();
    }

    async findById(id) {
        return this.riders.get(String(id)) || null;
    }

    async findByMobile(mobile) {
        const cleanMobile = String(mobile).trim();
        const digits = cleanMobile.replace(/\D/g, '');
        for (const rider of this.riders.values()) {
            if (rider.mobile === cleanMobile || (
                digits && rider.mobile.replace(/\D/g, '') === digits
            )) return rider;
        }
        return null;
    }

    async findAll(filter = {}) {
        let result = Array.from(this.riders.values());
        if (!filter.includeDisabled) {
            result = result.filter(r => r.enabled);
        }
        if (filter.status) {
            result = result.filter(r => r.status === filter.status);
        }
        if (filter.search) {
            const term = filter.search.toLowerCase();
            result = result.filter(r => 
                r.name.toLowerCase().includes(term) ||
                r.mobile.includes(term)
            );
        }
        return result.sort((a, b) => a.name.localeCompare(b.name));
    }

    async create(rider) {
        const id = rider.id || `rider-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        const clone = new Rider({
            ...rider.toJSON(),
            id
        });
        this.riders.set(id, clone);
        return clone;
    }

    async update(id, updateData) {
        const existing = this.riders.get(String(id));
        if (!existing) return null;

        const currentJson = existing.toJSON();
        const updatedJson = { ...currentJson, ...updateData, updatedAt: new Date() };
        if (updateData.currentLocation?.coordinates) {
            updatedJson.currentLocation = updateData.currentLocation.coordinates;
        }
        const updated = new Rider(updatedJson);
        this.riders.set(String(id), updated);
        return updated;
    }

    async findAvailableNearby(coordinates, maxDistanceInMeters = 15000, limit = 5) {
        const target = new Location(coordinates[0], coordinates[1]);
        const available = Array.from(this.riders.values())
            .filter(r => r.isAvailable());

        const withDistances = available.map(rider => ({
            rider,
            distanceInMeters: rider.currentLocation.distanceTo(target)
        })).filter(item => item.distanceInMeters <= maxDistanceInMeters);

        withDistances.sort((a, b) => a.distanceInMeters - b.distanceInMeters);
        return withDistances.slice(0, limit);
    }
}
