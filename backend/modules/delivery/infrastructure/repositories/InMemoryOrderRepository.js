import { IOrderRepository } from '../../ports/IOrderRepository.js';
import { Order } from '../../domain/entities/Order.js';
import dataStore from '../../../../dataStore.js';

export class InMemoryOrderRepository extends IOrderRepository {
    _toDomain(rawOrder) {
        if (!rawOrder) return null;
        const id = rawOrder._id?.toString() || rawOrder.id;

        let coords = [77.5946, 12.9716];
        if (rawOrder.location?.coordinates && rawOrder.location.coordinates.length === 2) {
            coords = rawOrder.location.coordinates;
        } else if (rawOrder.coordinates?.lng && rawOrder.coordinates?.lat) {
            coords = [rawOrder.coordinates.lng, rawOrder.coordinates.lat];
        }

        return new Order({
            id,
            customerName: rawOrder.customerName || rawOrder.addressDetails?.fullName || 'Customer',
            customerMobile: rawOrder.customerMobile || rawOrder.addressDetails?.mobile || rawOrder.addressDetails?.phone || '',
            deliveryAddress: rawOrder.deliveryAddress || 'Central Dispensary Area',
            addressDetails: rawOrder.addressDetails || {},
            paymentMethod: rawOrder.paymentMethod || 'Cash on Delivery (COD)',
            location: coords,
            orderStatus: rawOrder.orderStatus || 'Pending_Review',
            assignmentType: rawOrder.assignmentType || 'Unassigned',
            assignedRiderId: rawOrder.rider?.riderId || rawOrder.assignedRiderId,
            rider: rawOrder.rider,
            expectedOutForDeliveryAt: rawOrder.expectedOutForDeliveryAt,
            outForDeliveryAt: rawOrder.outForDeliveryAt,
            deliveredAt: rawOrder.deliveredAt,
            finalTotal: rawOrder.finalTotal || 0,
            items: rawOrder.items || [],
            assignmentDetails: rawOrder.assignmentDetails || {},
            createdAt: rawOrder.createdAt || new Date(),
            updatedAt: rawOrder.updatedAt || new Date()
        });
    }

    async findById(id) {
        if (typeof dataStore.getOrderById === 'function') {
            const raw = await dataStore.getOrderById(id);
            return this._toDomain(raw);
        }
        const rawList = typeof dataStore.getAllOrders === 'function'
            ? await dataStore.getAllOrders()
            : [];
        const raw = rawList.find(o => String(o._id || o.id) === String(id));
        return this._toDomain(raw);
    }

    async findAll(filter = {}) {
        const rawList = typeof dataStore.getAllOrders === 'function'
            ? await dataStore.getAllOrders(filter.orderStatus)
            : [];
        let orders = rawList.map(o => this._toDomain(o));

        if (filter.assignmentType) {
            orders = orders.filter(o => o.assignmentType === filter.assignmentType);
        }
        if (filter.assignedRiderId) {
            orders = orders.filter(o => o.assignedRiderId === filter.assignedRiderId);
        }
        return orders;
    }

    async update(id, updateData) {
        // Deep-merge into dataStore order
        const rawList = typeof dataStore.getAllOrders === 'function'
            ? await dataStore.getAllOrders()
            : [];
        const raw = rawList.find(o => String(o._id || o.id) === String(id));
        if (!raw) return null;

        Object.assign(raw, updateData);
        raw.updatedAt = new Date();

        if (updateData.rider) {
            raw.rider = { ...raw.rider, ...updateData.rider };
            raw.deliveryPersonMobile = raw.rider.riderMobile;
        }

        if (updateData.orderStatus) {
            raw.orderStatus = updateData.orderStatus;
        }

        if (updateData.assignmentDetails) {
            raw.assignmentDetails = updateData.assignmentDetails;
        }

        return this._toDomain(raw);
    }

    async findActiveOrdersInProximity(coordinates, maxDistanceInMeters = 2000, statuses = ['Ready to Dispatch', 'Dispatched']) {
        const allOrders = await this.findAll();
        const activeWithRiders = allOrders.filter(o => 
            statuses.includes(o.orderStatus) && Boolean(o.assignedRiderId)
        );

        const targetLng = Number(coordinates[0]);
        const targetLat = Number(coordinates[1]);

        const results = [];
        for (const order of activeWithRiders) {
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
