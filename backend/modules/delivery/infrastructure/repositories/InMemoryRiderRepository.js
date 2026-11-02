import { IRiderRepository } from '../../ports/IRiderRepository.js';
import { Rider } from '../../domain/entities/Rider.js';
import { Location } from '../../domain/value-objects/Location.js';

export class InMemoryRiderRepository extends IRiderRepository {
    constructor() {
        super();
        this.riders = new Map();
    }

    async findById(id, tenantId) {
        const rider = this.riders.get(String(id)) || null;
        return rider && tenantId && rider.tenantId === String(tenantId) ? rider : null;
    }

    async findByMobile(mobile, tenantId) {
        if (!tenantId) return null;
        const cleanMobile = String(mobile).trim();
        const digits = cleanMobile.replace(/\D/g, '');
        for (const rider of this.riders.values()) {
            if (rider.tenantId !== String(tenantId)) continue;
            if (rider.mobile === cleanMobile || (
                digits && rider.mobile.replace(/\D/g, '') === digits
            )) return rider;
        }
        return null;
    }

    async findAll(filter = {}) {
        if (!filter.tenantId) return [];
        let result = Array.from(this.riders.values()).filter(r => r.tenantId === String(filter.tenantId));
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

    async update(id, updateData, tenantId) {
        const existing = this.riders.get(String(id));
        if (!existing || !tenantId || existing.tenantId !== String(tenantId)) return null;

        const currentJson = existing.toJSON();
        const safeUpdates = { ...updateData };
        delete safeUpdates.tenantId;
        const updatedJson = { ...currentJson, ...safeUpdates, updatedAt: new Date() };
        if (updateData.currentLocation?.coordinates) {
            updatedJson.currentLocation = updateData.currentLocation.coordinates;
        }
        const updated = new Rider(updatedJson);
        this.riders.set(String(id), updated);
        return updated;
    }

    async findAvailableNearby(coordinates, maxDistanceInMeters = 15000, limit = 5, tenantId) {
        if (!tenantId) return [];
        const target = new Location(coordinates[0], coordinates[1]);
        const available = Array.from(this.riders.values())
            .filter(r => r.isAvailable() && r.tenantId === String(tenantId));

        const withDistances = available.map(rider => ({
            rider,
            distanceInMeters: rider.currentLocation.distanceTo(target)
        })).filter(item => item.distanceInMeters <= maxDistanceInMeters);

        withDistances.sort((a, b) => a.distanceInMeters - b.distanceInMeters);
        return withDistances.slice(0, limit);
    }
}
