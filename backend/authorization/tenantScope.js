export const isSameTenant = (actorTenantId, resourceTenantId) => Boolean(
    actorTenantId
    && resourceTenantId
    && String(actorTenantId) === String(resourceTenantId)
);

export const tenantScopedFilter = (tenantId, filter = {}) => {
    if (!tenantId) return null;
    return { ...filter, tenantId: String(tenantId) };
};
