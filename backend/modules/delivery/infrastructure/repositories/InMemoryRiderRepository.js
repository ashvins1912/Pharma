import { IRiderRepository } from '../../ports/IRiderRepository.js';
import { Rider } from '../../domain/entities/Rider.js';
import { Location } from '../../domain/value-objects/Location.js';

export class InMemoryRiderRepository extends IRiderRepository {
    constructor() {
        super();
        this.riders = new Map();
        this._seedDefaultRiders();
    }

    _seedDefaultRiders() {
        const seedData = [
            {
                id: 'rider-001',
                name: 'Rahul Sharma',
                mobile: '+91 98765 43210',
                photoUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
                status: Rider.STATUSES.AVAILABLE,
                vehicleType: 'EV Bike',
                currentLocation: [77.5950, 12.9720], // ~100m from Central Hub
                totalDeliveries: 142,
                rating: 4.95
            },
            {
                id: 'rider-002',
                name: 'Priya Nair',
                mobile: '+91 98111 22334',
                photoUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=200&auto=format&fit=crop&q=80',
                status: Rider.STATUSES.AVAILABLE,
                vehicleType: 'Scooter',
                currentLocation: [77.6010, 12.9750], // ~800m North-East
                totalDeliveries: 98,
                rating: 4.9
            },
            {
                id: 'rider-003',
                name: 'Vikram Patel',
                mobile: '+91 99000 55667',
                photoUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80',
                status: Rider.STATUSES.BUSY,
                vehicleType: 'Bike',
                currentLocation: [77.5910, 12.9690], // ~650m South-West
                activeOrderIds: [],
                totalDeliveries: 230,
                rating: 4.88
            },
            {
                id: 'rider-004',
                name: 'Karan Joshi',
                mobile: '+91 97444 33221',
                photoUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&auto=format&fit=crop&q=80',
                status: Rider.STATUSES.AVAILABLE,
                vehicleType: 'Bike',
                currentLocation: [77.6120, 12.9810], // ~2.1km
                totalDeliveries: 67,
                rating: 4.82
            },
            {
                id: 'rider-005',
                name: 'Ananya Deshmukh',
                mobile: '+91 98333 44556',
                photoUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&auto=format&fit=crop&q=80',
                status: Rider.STATUSES.OFF_DUTY,
                vehicleType: 'Scooter',
                currentLocation: [77.5850, 12.9640],
                totalDeliveries: 185,
                rating: 4.96
            }
        ];

        for (const data of seedData) {
            const rider = new Rider(data);
            this.riders.set(rider.id, rider);
        }
    }

    async findById(id) {
        return this.riders.get(String(id)) || null;
    }

    async findByMobile(mobile) {
        const cleanMobile = String(mobile).trim();
        for (const rider of this.riders.values()) {
            if (rider.mobile === cleanMobile) return rider;
        }
        return null;
    }

    async findAll(filter = {}) {
        let result = Array.from(this.riders.values());
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
