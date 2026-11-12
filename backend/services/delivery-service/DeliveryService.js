/**
 * Multi-Tenant Delivery Service & Branch Radius Serviceability Calculator
 */
import { domainEvents } from '../../shared/events/DomainEvents.js';
import { logger } from '../../shared/observability/logger.js';
import { OutOfServiceRadiusError, TenantAccessDeniedError } from '../../shared/errors/DomainErrors.js';
import { tenantService } from '../tenant-service/TenantService.js';
import { RiderStatus } from '../../shared/contracts/index.js';

// Haversine formula to compute great-circle distance between two GPS coordinates in kilometers
export const calculateDistanceKm = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c * 100) / 100;
};

export class DeliveryService {
    constructor() {
        this.riders = new Map(); // riderId -> Rider
        this.deliveryJobs = new Map(); // jobId -> DeliveryJob
        this._seedRiders();
    }

    _seedRiders() {
        // Indore Central Branch Riders
        const r1 = {
            id: 'rider-ind-01',
            tenantId: 'tenant-ashvin-main',
            branchId: 'branch-indore-central',
            name: 'Rahul Verma',
            mobile: '+91 98261 11223',
            vehicleType: 'EV Bike',
            status: RiderStatus.AVAILABLE,
            currentLocation: { lat: 22.7200, lng: 75.8580 },
            rating: 4.9,
            activeOrdersCount: 0
        };
        this.riders.set(r1.id, r1);

        const r2 = {
            id: 'rider-ind-02',
            tenantId: 'tenant-ashvin-main',
            branchId: 'branch-indore-central',
            name: 'Suresh Patidar',
            mobile: '+91 98262 22334',
            vehicleType: 'Motorcycle',
            status: RiderStatus.AVAILABLE,
            currentLocation: { lat: 22.7250, lng: 75.8620 },
            rating: 4.8,
            activeOrdersCount: 0
        };
        this.riders.set(r2.id, r2);

        // Vijay Nagar Branch Rider
        const r3 = {
            id: 'rider-vn-01',
            tenantId: 'tenant-ashvin-main',
            branchId: 'branch-indore-vijaynagar',
            name: 'Amit Joshi',
            mobile: '+91 98263 33445',
            vehicleType: 'EV Scooter',
            status: RiderStatus.AVAILABLE,
            currentLocation: { lat: 22.7530, lng: 75.8940 },
            rating: 4.9,
            activeOrdersCount: 0
        };
        this.riders.set(r3.id, r3);
    }

    async checkServiceability(branchId, customerCoordinates) {
        const branch = await tenantService.getBranchById(branchId);
        if (!branch) {
            throw new Error(`Branch ${branchId} not found`);
        }

        const bLat = branch.address?.coordinates?.lat || 22.7196;
        const bLng = branch.address?.coordinates?.lng || 75.8577;
        const cLat = Number(customerCoordinates?.lat);
        const cLng = Number(customerCoordinates?.lng);

        if (!Number.isFinite(cLat) || !Number.isFinite(cLng)) {
            // If coordinates are omitted, allow with standard radius check warning
            return {
                serviceable: true,
                distanceKm: 2.5,
                radiusKm: branch.serviceRadiusKm,
                branchName: branch.name,
                deliveryFee: branch.deliveryFee
            };
        }

        const distanceKm = calculateDistanceKm(bLat, bLng, cLat, cLng);
        const radiusKm = branch.serviceRadiusKm || 10.0;
        const serviceable = distanceKm <= radiusKm;

        return {
            serviceable,
            distanceKm,
            radiusKm,
            branchName: branch.name,
            deliveryFee: branch.deliveryFee
        };
    }

    async validateServiceabilityOrThrow(branchId, customerCoordinates) {
        const result = await this.checkServiceability(branchId, customerCoordinates);
        if (!result.serviceable) {
            throw new OutOfServiceRadiusError(result.distanceKm, result.radiusKm, result.branchName);
        }
        return result;
    }

    async getBranchRiders(tenantId, branchId) {
        return Array.from(this.riders.values()).filter(
            r => r.tenantId === tenantId && r.branchId === branchId && r.status !== RiderStatus.SUSPENDED
        );
    }

    async assignRiderToOrder(tenantId, branchId, orderId, riderId, actor = null) {
        const rider = this.riders.get(riderId);
        if (!rider) throw new Error('Rider not found');

        // Isolation guard
        if (rider.tenantId !== tenantId || rider.branchId !== branchId) {
            throw new Error('Rider belongs to a different branch or pharmacy fleet.');
        }

        rider.status = RiderStatus.ASSIGNED;
        rider.activeOrdersCount += 1;

        const job = {
            id: `job-del-${Date.now()}`,
            orderId,
            tenantId,
            branchId,
            riderId,
            riderName: rider.name,
            riderMobile: rider.mobile,
            status: 'ASSIGNED',
            assignedAt: new Date().toISOString(),
            deliveredAt: null
        };
        this.deliveryJobs.set(orderId, job);

        domainEvents.emitDomainEvent('RIDER_ASSIGNED', orderId, {
            riderId,
            riderName: rider.name,
            jobId: job.id
        }, actor, tenantId, branchId);

        logger.info(`Rider ${rider.name} assigned to order #${orderId}`, { tenantId, branchId, orderId });
        return job;
    }

    async updateJobStatus(orderId, status, actor = null) {
        const job = this.deliveryJobs.get(orderId);
        if (!job) throw new Error('Delivery job not found for order');

        // Isolation guard: non-platform staff cannot update jobs for other tenants
        if (actor?.tenantId && job.tenantId !== actor.tenantId && !actor.isPlatformUser) {
            throw new TenantAccessDeniedError('Cannot update delivery job belonging to another pharmacy tenant.');
        }

        job.status = status;
        const rider = this.riders.get(job.riderId);

        if (status === 'DELIVERED') {
            job.deliveredAt = new Date().toISOString();
            if (rider) {
                rider.activeOrdersCount = Math.max(0, rider.activeOrdersCount - 1);
                rider.status = rider.activeOrdersCount === 0 ? RiderStatus.AVAILABLE : RiderStatus.ASSIGNED;
            }
            domainEvents.emitDomainEvent('ORDER_DELIVERED', orderId, {
                jobId: job.id,
                orderNumber: orderId,
                riderName: rider?.name || job.riderName || 'Assigned Courier',
                riderMobile: rider?.mobile || job.riderMobile
            }, actor, job.tenantId, job.branchId);
        } else {
            domainEvents.emitDomainEvent('DELIVERY_STATUS_CHANGED', orderId, {
                status,
                jobId: job.id,
                orderNumber: orderId,
                riderName: rider?.name || job.riderName || 'Assigned Courier',
                riderMobile: rider?.mobile || job.riderMobile
            }, actor, job.tenantId, job.branchId);
        }
        return job;
    }
}

export const deliveryService = new DeliveryService();
export default deliveryService;
