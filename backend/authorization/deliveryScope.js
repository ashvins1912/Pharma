import { isSameTenant } from './tenantScope.js';

export const isRiderOwnedByOrderTenant = (rider, order) => Boolean(
    rider
    && order
    && isSameTenant(rider.tenantId, order.tenantId)
);

export const isAssignedRiderForOrder = (rider, order) => {
    if (!isRiderOwnedByOrderTenant(rider, order)) return false;
    const assignedRiderId = order.rider?.riderId || order.riderId || '';
    const riderId = rider._id || rider.id;
    return Boolean(assignedRiderId && riderId && String(assignedRiderId) === String(riderId));
};
