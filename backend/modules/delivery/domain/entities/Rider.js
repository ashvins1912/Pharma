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
        enabled = true,
        disabledAction = null,
        disabledReason = null,
        disabledAt = null,
        createdAt = new Date(),
        updatedAt = new Date()
    }) {
        const normalizedStatus = {
            offline: Rider.STATUSES.OFF_DUTY,
            available: Rider.STATUSES.AVAILABLE,
            delivering: Rider.STATUSES.BUSY
        }[status] || status;
        if (!name || typeof name !== 'string' || !name.trim()) {
            throw new Error('Rider name is required.');
        }
        if (!mobile || typeof mobile !== 'string' || !mobile.trim()) {
            throw new Error('Rider mobile number is required.');
        }

        const validStatuses = Object.values(Rider.STATUSES);
        if (!validStatuses.includes(normalizedStatus)) {
            throw new Error(`Invalid rider status: ${status}. Must be one of: ${validStatuses.join(', ')}`);
        }

        this.id = id ? String(id) : null;
        this.name = name.trim();
        this.mobile = mobile.trim();
        this.photoUrl = photoUrl;
        this.status = normalizedStatus;
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
        this.enabled = enabled !== false;
        this.disabledAction = disabledAction || null;
        this.disabledReason = disabledReason || null;
        this.disabledAt = disabledAt ? new Date(disabledAt) : null;
        this.createdAt = createdAt instanceof Date ? createdAt : new Date(createdAt);
        this.updatedAt = updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
    }

    isAvailable() {
        return this.enabled && this.status === Rider.STATUSES.AVAILABLE;
    }

    isBusy() {
        return this.enabled && this.status === Rider.STATUSES.BUSY;
    }

    isOffDuty() {
        return !this.enabled || this.status === Rider.STATUSES.OFF_DUTY;
    }

    disable(action, reason) {
        if (!['Suspended', 'Removed'].includes(action)) {
            throw new Error('Rider action must be Suspended or Removed.');
        }
        if (!reason?.trim()) {
            throw new Error('A remark is required to suspend or remove a rider.');
        }
        this.enabled = false;
        this.disabledAction = action;
        this.disabledReason = reason.trim();
        this.disabledAt = new Date();
        this.status = Rider.STATUSES.OFF_DUTY;
        this.updatedAt = new Date();
    }

    enable() {
        this.enabled = true;
        this.disabledAction = null;
        this.disabledReason = null;
        this.disabledAt = null;
        this.status = this.activeOrderIds.length
            ? Rider.STATUSES.BUSY
            : Rider.STATUSES.AVAILABLE;
        this.updatedAt = new Date();
    }

    assignOrder(orderId) {
        if (!this.enabled) {
            throw new Error(`Cannot assign order to disabled rider ${this.name}.`);
        }
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
        if (!this.enabled) {
            throw new Error(`Cannot update status for disabled rider ${this.name}.`);
        }
        const validStatuses = Object.values(Rider.STATUSES);
        if (!validStatuses.includes(newStatus)) {
            throw new Error(`Invalid status: ${newStatus}`);
        }
        this.status = newStatus;
        this.updatedAt = new Date();
    }

    updateLocation(longitude, latitude) {
        if (!this.enabled) {
            throw new Error(`Cannot update location for disabled rider ${this.name}.`);
        }
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
            enabled: this.enabled,
            disabledAction: this.disabledAction,
            disabledReason: this.disabledReason,
            disabledAt: this.disabledAt,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }
}
