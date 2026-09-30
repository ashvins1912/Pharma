import { Location } from '../value-objects/Location.js';

/**
 * Order Domain Entity (Delivery Perspective)
 * Encapsulates delivery assignment, dispatch logic, and location tracking
 */
export class Order {
    static STATUSES = Object.freeze({
        PENDING_REVIEW: 'Pending_Review',
        APPROVED: 'Approved',
        PROCESSING: 'Processing Order',
        READY_TO_DISPATCH: 'Ready to Dispatch',
        DISPATCHED: 'Dispatched',
        DELIVERED: 'Delivered',
        CANCELLED: 'Cancelled'
    });

    static ASSIGNMENT_TYPES = Object.freeze({
        MANUAL: 'Manual',
        AUTO: 'Auto',
        UNASSIGNED: 'Unassigned'
    });

    constructor({
        id,
        customerName = 'Customer',
        customerMobile = '',
        deliveryAddress = '',
        addressDetails = {},
        paymentMethod = 'Cash on Delivery (COD)',
        coordinates = null,
        location = null,
        orderStatus = Order.STATUSES.PENDING_REVIEW,
        assignmentType = Order.ASSIGNMENT_TYPES.UNASSIGNED,
        assignedRiderId = null,
        rider = null,
        expectedOutForDeliveryAt = null,
        outForDeliveryAt = null,
        deliveredAt = null,
        finalTotal = 0,
        items = [],
        assignmentDetails = {},
        createdAt = new Date(),
        updatedAt = new Date()
    }) {
        this.id = id ? String(id) : null;
        this.customerName = customerName;
        this.customerMobile = customerMobile;
        this.deliveryAddress = deliveryAddress;
        this.addressDetails = addressDetails || {};
        this.paymentMethod = paymentMethod;

        // Resolve GeoJSON Location
        if (location instanceof Location) {
            this.location = location;
        } else if (location?.coordinates) {
            this.location = new Location(location.coordinates[0], location.coordinates[1]);
        } else if (coordinates?.lng && coordinates?.lat) {
            this.location = new Location(coordinates.lng, coordinates.lat);
        } else {
            // Default center if no coordinates provided
            this.location = new Location(77.5946, 12.9716);
        }

        this.orderStatus = orderStatus;
        this.assignmentType = assignmentType;
        this.assignedRiderId = assignedRiderId ? String(assignedRiderId) : (rider?.riderId ? String(rider.riderId) : null);
        this.rider = rider || null;

        this.expectedOutForDeliveryAt = expectedOutForDeliveryAt ? new Date(expectedOutForDeliveryAt) : null;
        this.outForDeliveryAt = outForDeliveryAt ? new Date(outForDeliveryAt) : null;
        this.deliveredAt = deliveredAt ? new Date(deliveredAt) : null;
        this.finalTotal = Number(finalTotal) || 0;
        this.items = Array.isArray(items) ? items : [];
        this.assignmentDetails = assignmentDetails || {};
        this.createdAt = createdAt instanceof Date ? createdAt : new Date(createdAt);
        this.updatedAt = updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
    }

    /**
     * Checks if the order is expected out for delivery within the given minute threshold
     * @param {number} minutes 
     * @returns {boolean}
     */
    isExpectedWithinMinutes(minutes = 15) {
        if (!this.expectedOutForDeliveryAt) {
            // If not specified, default to creation time + 15 min window (express 30 min order)
            const targetTime = new Date(this.createdAt.getTime() + 15 * 60 * 1000);
            return (targetTime.getTime() - Date.now()) <= minutes * 60 * 1000;
        }
        const diffMs = this.expectedOutForDeliveryAt.getTime() - Date.now();
        return diffMs <= minutes * 60 * 1000;
    }

    /**
     * Assigns this order to a rider
     */
    assignToRider(riderEntity, strategyName = 'Manual', note = '', distanceInKm = null, isAuto = true) {
        this.assignedRiderId = riderEntity.id;
        this.rider = {
            riderId: riderEntity.id,
            riderName: riderEntity.name,
            riderMobile: riderEntity.mobile,
            assignedAt: new Date()
        };
        this.assignmentType = isAuto ? Order.ASSIGNMENT_TYPES.AUTO : Order.ASSIGNMENT_TYPES.MANUAL;
        this.orderStatus = Order.STATUSES.READY_TO_DISPATCH;
        this.assignmentDetails = {
            strategyUsed: strategyName,
            note: note || `Assigned via ${strategyName}`,
            assignedAt: new Date(),
            distanceInKm
        };
        this.updatedAt = new Date();
    }

    toJSON() {
        return {
            id: this.id,
            customerName: this.customerName,
            customerMobile: this.customerMobile,
            deliveryAddress: this.deliveryAddress,
            addressDetails: this.addressDetails,
            paymentMethod: this.paymentMethod,
            location: this.location.toGeoJSON(),
            coordinates: { lat: this.location.latitude, lng: this.location.longitude },
            orderStatus: this.orderStatus,
            assignmentType: this.assignmentType,
            assignedRiderId: this.assignedRiderId,
            rider: this.rider,
            expectedOutForDeliveryAt: this.expectedOutForDeliveryAt,
            outForDeliveryAt: this.outForDeliveryAt,
            deliveredAt: this.deliveredAt,
            finalTotal: this.finalTotal,
            items: this.items,
            assignmentDetails: this.assignmentDetails,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }
}
