import { IOrderRepository } from '../../ports/IOrderRepository.js';
import { Order } from '../../domain/entities/Order.js';
import dataStore from '../../../../dataStore.js';

export class InMemoryOrderRepository extends IOrderRepository {
    constructor(store = dataStore) {
        super();
        this.dataStore = store;
    }

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
            tenantId: rawOrder.tenantId,
            branchId: rawOrder.branchId || null,
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

    async findById(id, tenantId) {
        if (!tenantId) return null;
        if (typeof this.dataStore.getOrderById === 'function') {
            const raw = await this.dataStore.getOrderById(id, { tenantId });
            if (!raw || String(raw.tenantId || '') !== String(tenantId)) return null;
            return this._toDomain(raw);
        }
        const rawList = typeof this.dataStore.getAllOrders === 'function'
            ? await this.dataStore.getAllOrders()
            : [];
        const raw = rawList.find(o => String(o._id || o.id) === String(id) && String(o.tenantId || '') === String(tenantId));
        return this._toDomain(raw);
    }

    async findAll(filter = {}) {
        if (!filter.tenantId) return [];
        const rawList = typeof this.dataStore.getAllOrders === 'function'
            ? await this.dataStore.getAllOrders({
                tenantId: filter.tenantId,
                branchId: filter.branchId,
                orderStatus: filter.orderStatus,
                assignmentType: filter.assignmentType,
                assignedRiderId: filter.assignedRiderId,
                limit: filter.limit,
                select: '_id tenantId branchId customerName customerMobile addressDetails deliveryAddress paymentMethod location coordinates orderStatus assignmentType rider assignedRiderId expectedOutForDeliveryAt outForDeliveryAt deliveredAt finalTotal items assignmentDetails createdAt updatedAt',
                from: filter.from,
                to: filter.to
            })
            : [];
        // Keep a defensive in-process scope check for injected/test adapters;
        // the production datastore also applies these predicates in MongoDB.
        let orders = rawList
            .filter(order => String(order.tenantId || '') === String(filter.tenantId))
            .filter(order => !filter.branchId || String(order.branchId || '') === String(filter.branchId))
            .filter(order => !filter.orderStatus || order.orderStatus === filter.orderStatus)
            .filter(order => !filter.assignmentType || order.assignmentType === filter.assignmentType)
            .filter(order => !filter.assignedRiderId || String(order.rider?.riderId || order.assignedRiderId || '') === String(filter.assignedRiderId))
            .map(o => this._toDomain(o));
        return orders;
    }

    async update(id, updateData, tenantId) {
        if (!tenantId) return null;
        if (typeof this.dataStore.updateOrderForTenant === 'function') {
            const updated = await this.dataStore.updateOrderForTenant(id, tenantId, updateData);
            return this._toDomain(updated);
        }
        // Compatibility fallback for older injected stores; production dataStore
        // supports scoped updates and never scans the full order collection here.
        const rawList = typeof this.dataStore.getAllOrders === 'function'
            ? await this.dataStore.getAllOrders({ tenantId, limit: 500 })
            : [];
        const raw = rawList.find(o => String(o._id || o.id) === String(id));
        if (!raw) return null;
        const safeUpdates = { ...updateData };
        delete safeUpdates.tenantId;
        Object.assign(raw, safeUpdates);
        raw.updatedAt = new Date();
        if (updateData.rider) raw.rider = { ...raw.rider, ...updateData.rider };
        if (updateData.assignmentDetails) raw.assignmentDetails = { ...raw.assignmentDetails, ...updateData.assignmentDetails };
        return this._toDomain(raw);
    }

    async findActiveOrdersInProximity(coordinates, maxDistanceInMeters = 2000, statuses = ['Ready to Dispatch', 'Dispatched'], tenantId) {
        if (!tenantId) return [];
        const allOrders = await this.findAll({ tenantId });
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
