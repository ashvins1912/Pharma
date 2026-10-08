import { IRiderRepository } from '../../ports/IRiderRepository.js';
import { Rider } from '../../domain/entities/Rider.js';
import RiderModel from '../../../../models/Rider.js';

export class MongooseRiderRepository extends IRiderRepository {
    _toDomain(doc) {
        if (!doc) return null;
        const obj = doc.toObject ? doc.toObject() : doc;
        return new Rider({
            id: obj._id?.toString() || obj.id,
            name: obj.name,
            mobile: obj.mobile,
            photoUrl: obj.photoUrl,
            status: obj.status,
            vehicleType: obj.vehicleType,
            currentLocation: obj.currentLocation?.coordinates || [77.5946, 12.9716],
            activeOrderIds: obj.activeOrderIds || [],
            totalDeliveries: obj.totalDeliveries || 0,
            rating: obj.rating || 4.9,
            enabled: obj.enabled !== false,
            disabledAction: obj.disabledAction,
            disabledReason: obj.disabledReason,
            disabledAt: obj.disabledAt,
            createdAt: obj.createdAt,
            updatedAt: obj.updatedAt
        });
    }

    async findById(id) {
        const doc = await RiderModel.findById(id);
        return this._toDomain(doc);
    }

    async findByMobile(mobile) {
        const cleanMobile = String(mobile).trim();
        let doc = await RiderModel.findOne({ mobile: cleanMobile });
        if (!doc) {
            const digits = cleanMobile.replace(/\D/g, '');
            if (digits) {
                const formattedMobile = new RegExp(`^\\D*${digits.split('').join('\\D*')}\\D*$`);
                doc = await RiderModel.findOne({ mobile: formattedMobile });
            }
        }
        return this._toDomain(doc);
    }

    async findAll(filter = {}) {
        const query = {};
        if (!filter.includeDisabled) query.enabled = { $ne: false };
        if (filter.status) {
            const compatibleStatuses = {
                Available: ['Available', 'available'],
                Busy: ['Busy', 'delivering'],
                'Off-duty': ['Off-duty', 'offline']
            }[filter.status];
            query.status = compatibleStatuses ? { $in: compatibleStatuses } : filter.status;
        }
        if (filter.search) {
            query.$or = [
                { name: { $regex: filter.search, $options: 'i' } },
                { mobile: { $regex: filter.search, $options: 'i' } }
            ];
        }
        const docs = await RiderModel.find(query).sort({ status: 1, name: 1 });
        return docs.map(d => this._toDomain(d));
    }

    async create(riderEntity) {
        const raw = riderEntity.toJSON();
        delete raw.id;
        const created = await RiderModel.create(raw);
        return this._toDomain(created);
    }

    async update(id, updateData) {
        const updates = { ...updateData, updatedAt: new Date() };
        if (updates.currentLocation?.coordinates) {
            updates.currentLocation = {
                type: 'Point',
                coordinates: updates.currentLocation.coordinates
            };
        }
        const doc = await RiderModel.findByIdAndUpdate(id, { $set: updates }, { new: true });
        return this._toDomain(doc);
    }

    async findAvailableNearby(coordinates, maxDistanceInMeters = 15000, limit = 5) {
        const targetLng = Number(coordinates?.[0]);
        const targetLat = Number(coordinates?.[1]);
        const maxDistance = Number(maxDistanceInMeters) || 15000;
        if (!Number.isFinite(targetLng) || !Number.isFinite(targetLat)) return [];

        const buildResults = docs => docs
            .map(doc => {
                const rider = this._toDomain(doc);
                const location = rider.currentLocation;
                const distanceInMeters = location.distanceTo({ coordinates: [targetLng, targetLat] });
                return { rider, distanceInMeters };
            })
            .filter(item => item.distanceInMeters <= maxDistance)
            .sort((a, b) => a.distanceInMeters - b.distanceInMeters)
            .slice(0, limit);

        try {
            const docs = await RiderModel.find({
                enabled: { $ne: false },
                status: { $in: [Rider.STATUSES.AVAILABLE, 'available'] },
                currentLocation: {
                    $near: {
                        $geometry: {
                            type: 'Point',
                            coordinates: [targetLng, targetLat]
                        },
                        $maxDistance: maxDistance
                    }
                }
            }).limit(limit);
            return buildResults(docs);
        } catch (error) {
            // A missing/stale 2dsphere index must not make auto-assignment fail.
            // Fall back to an application-side distance calculation.
            console.warn('[RiderRepository] Geo-near query failed; using distance fallback:', error.message);
            const docs = await RiderModel.find({
                enabled: { $ne: false },
                status: { $in: [Rider.STATUSES.AVAILABLE, 'available'] }
            }).limit(100).lean();
            return buildResults(docs);
        }
    }
}
