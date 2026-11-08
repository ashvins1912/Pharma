export function isActiveTenantAdmin(membership) {
  return String(membership?.role || '').toUpperCase() === 'TENANT_ADMIN'
    && String(membership?.status || '').toUpperCase() === 'ACTIVE'
    && !membership?.branchId;
}

export function wouldRemoveLastActiveTenantAdmin(current, updates = {}, activeAdminCount = 0) {
  if (!isActiveTenantAdmin(current)) return false;
  const nextRole = String(updates.role ?? current.role).toUpperCase();
  const nextStatus = String(updates.status ?? current.status).toUpperCase();
  const remainsActiveAdmin = nextRole === 'TENANT_ADMIN' && nextStatus === 'ACTIVE';
  return !remainsActiveAdmin && Number(activeAdminCount) <= 1;
}

export function lastActiveTenantAdminError() {
  return Object.assign(
    new Error('This change would leave the pharmacy without an active tenant administrator. Assign and activate another TENANT_ADMIN first.'),
    { code: 'LAST_ACTIVE_TENANT_ADMIN', statusCode: 409 }
  );
}
