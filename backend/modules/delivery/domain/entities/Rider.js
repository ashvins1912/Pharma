import { Location } from '../value-objects/Location.js';

/**
 * Rider Domain Entity
 * Encapsulates Rider lifecycle, business constraints, and state transitions
 */
export class Rider {
    static STATUSES = Object.freeze({
        AVAILABLE: 'Available',
        BUSY: 'Busy',
        OFF_DUTY: 'Off-duty'
    });

    constructor({
        id,
        name,
        mobile,
        photoUrl = null,
        status = Rider.STATUSES.AVAILABLE,
        vehicleType = 'Bike',
        currentLocation = [77.5946, 12.9716],
        activeOrderIds = [],
        totalDeliveries = 0,
        rating = 4.9,
        createdAt = new Date(),
        updatedAt = new Date()
    }) {
        if (!name || typeof name !== 'string' || !name.trim()) {
            throw new Error('Rider name is required.');
        }
        if (!mobile || typeof mobile !== 'string' || !mobile.trim()) {
            throw new Error('Rider mobile number is required.');
        }

        const validStatuses = Object.values(Rider.STATUSES);
        if (!validStatuses.includes(status)) {
            throw new Error(`Invalid rider status: ${status}. Must be one of: ${validStatuses.join(', ')}`);
        }

        this.id = id ? String(id) : null;
        this.name = name.trim();
        this.mobile = mobile.trim();
        this.photoUrl = photoUrl;
        this.status = status;
        this.vehicleType = vehicleType;

        if (currentLocation instanceof Location) {
            this.currentLocation = currentLocation;
        } else if (Array.isArray(currentLocation)) {
            this.currentLocation = new Location(currentLocation[0], currentLocation[1]);
        } else if (currentLocation?.coordinates) {
            this.currentLocation = new Location(currentLocation.coordinates[0], currentLocation.coordinates[1]);
        } else {
            this.currentLocation = new Location(77.5946, 12.9716);
        }

        this.activeOrderIds = Array.isArray(activeOrderIds) ? [...activeOrderIds] : [];
        this.totalDeliveries = Number(totalDeliveries) || 0;
        this.rating = Number(rating) || 4.9;
        this.createdAt = createdAt instanceof Date ? createdAt : new Date(createdAt);
        this.updatedAt = updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
    }

    isAvailable() {
        return this.status === Rider.STATUSES.AVAILABLE;
    }

    isBusy() {
        return this.status === Rider.STATUSES.BUSY;
    }

    isOffDuty() {
        return this.status === Rider.STATUSES.OFF_DUTY;
    }

    assignOrder(orderId) {
        if (this.isOffDuty()) {
            throw new Error(`Cannot assign order to rider ${this.name} while Off-duty.`);
        }
        const strId = String(orderId);
        if (!this.activeOrderIds.includes(strId)) {
            this.activeOrderIds.push(strId);
        }
        this.status = Rider.STATUSES.BUSY;
        this.updatedAt = new Date();
    }

    completeOrder(orderId) {
        const strId = String(orderId);
        this.activeOrderIds = this.activeOrderIds.filter(id => id !== strId);
        if (this.activeOrderIds.length === 0 && this.status !== Rider.STATUSES.OFF_DUTY) {
            this.status = Rider.STATUSES.AVAILABLE;
        }
        this.totalDeliveries += 1;
        this.updatedAt = new Date();
    }

    updateStatus(newStatus) {
        const validStatuses = Object.values(Rider.STATUSES);
        if (!validStatuses.includes(newStatus)) {
            throw new Error(`Invalid status: ${newStatus}`);
        }
        this.status = newStatus;
        this.updatedAt = new Date();
    }

    updateLocation(longitude, latitude) {
        this.currentLocation = new Location(longitude, latitude);
        this.updatedAt = new Date();
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            mobile: this.mobile,
            photoUrl: this.photoUrl,
            status: this.status,
            vehicleType: this.vehicleType,
            currentLocation: this.currentLocation.toGeoJSON(),
            activeOrderIds: this.activeOrderIds,
            totalDeliveries: this.totalDeliveries,
            rating: this.rating,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }
}
