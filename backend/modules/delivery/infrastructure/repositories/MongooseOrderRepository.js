import { IOrderRepository } from '../../ports/IOrderRepository.js';
import { Order } from '../../domain/entities/Order.js';
import OrderModel from '../../../../models/Order.js';

export class MongooseOrderRepository extends IOrderRepository {
    _toDomain(doc) {
        if (!doc) return null;
        const obj = doc.toObject ? doc.toObject() : doc;

        // Resolve coordinates
        let coords = [77.5946, 12.9716];
        if (obj.location?.coordinates && obj.location.coordinates.length === 2) {
            coords = obj.location.coordinates;
        } else if (obj.coordinates?.lng && obj.coordinates?.lat) {
            coords = [obj.coordinates.lng, obj.coordinates.lat];
        }

        return new Order({
            id: obj._id?.toString() || obj.id,
            customerName: obj.customerName,
            customerMobile: obj.customerMobile || obj.addressDetails?.mobile || '',
            deliveryAddress: obj.deliveryAddress,
            addressDetails: obj.addressDetails || {},
            paymentMethod: obj.paymentMethod || 'Cash on Delivery (COD)',
            location: coords,
            orderStatus: obj.orderStatus,
            assignmentType: obj.assignmentType || 'Unassigned',
            assignedRiderId: obj.rider?.riderId || obj.assignedRiderId,
            rider: obj.rider,
            expectedOutForDeliveryAt: obj.expectedOutForDeliveryAt,
            outForDeliveryAt: obj.outForDeliveryAt,
            deliveredAt: obj.deliveredAt,
            finalTotal: obj.finalTotal,
            items: obj.items || [],
            assignmentDetails: obj.assignmentDetails || {},
            createdAt: obj.createdAt,
            updatedAt: obj.updatedAt
        });
    }

    async findById(id) {
        const doc = await OrderModel.findById(id);
        return this._toDomain(doc);
    }

    async findAll(filter = {}) {
        const query = {};
        if (filter.orderStatus) query.orderStatus = filter.orderStatus;
        if (filter.assignmentType) query.assignmentType = filter.assignmentType;
        if (filter.assignedRiderId) query['rider.riderId'] = filter.assignedRiderId;

        const docs = await OrderModel.find(query).sort({ createdAt: -1 });
        return docs.map(d => this._toDomain(d));
    }

    async update(id, updateData) {
        const updates = { ...updateData, updatedAt: new Date() };

        if (updates.rider) {
            updates.rider = {
                riderId: updates.rider.riderId,
                riderName: updates.rider.riderName,
                riderMobile: updates.rider.riderMobile,
                assignedAt: updates.rider.assignedAt || new Date()
            };
        }

        if (updates.location?.coordinates) {
            updates.location = {
                type: 'Point',
                coordinates: updates.location.coordinates
            };
            updates.coordinates = {
                lng: updates.location.coordinates[0],
                lat: updates.location.coordinates[1]
            };
        }

        const doc = await OrderModel.findByIdAndUpdate(id, { $set: updates }, { new: true });
        return this._toDomain(doc);
    }

    async findActiveOrdersInProximity(coordinates, maxDistanceInMeters = 2000, statuses = ['Ready to Dispatch', 'Dispatched']) {
        const docs = await OrderModel.find({
            orderStatus: { $in: statuses },
            'rider.riderId': { $exists: true, $ne: null }
        });

        const targetLng = Number(coordinates[0]);
        const targetLat = Number(coordinates[1]);

        const results = [];
        for (const doc of docs) {
            const order = this._toDomain(doc);
            const dist = order.location.distanceTo({
                coordinates: [targetLng, targetLat]
            });
            if (dist <= maxDistanceInMeters) {
                results.push({
                    order,
                    distanceInMeters: dist
                });
            }
        }

        results.sort((a, b) => a.distanceInMeters - b.distanceInMeters);
        return results;
    }
}
