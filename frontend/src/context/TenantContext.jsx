import React from 'react';
import { create } from 'zustand';

const STORAGE_KEY = 'pharma_tenant_selection_v2';

function safeRead(key) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function readInitialSelection() {
  if (typeof window === 'undefined') return { tenantId: null, activeTenant: null, branchId: null, branchTenantId: null };
  try {
    const versioned = safeRead(STORAGE_KEY);
    if (versioned) {
      const saved = JSON.parse(versioned);
      const tenantId = saved?.tenantId ? String(saved.tenantId) : null;
      const tenantObjectId = saved?.activeTenant?._id || saved?.activeTenant?.id;
      const activeTenant = tenantId && tenantObjectId && String(tenantObjectId) === tenantId
        ? saved.activeTenant : null;
      const branchTenantId = saved?.branchTenantId ? String(saved.branchTenantId) : null;
      const branchId = tenantId && branchTenantId === tenantId && saved?.branchId
        ? String(saved.branchId) : null;
      return { tenantId, activeTenant, branchId, branchTenantId: branchId ? branchTenantId : null };
    }
  } catch {
    // Fall through to the previous storage keys.
  }

  const savedTenantId = safeRead('pharma_tenant_id');
  const legacyDefaults = new Set(['tenant-ashvin-main', 'tenant-default-1', '65a1234567890abcdef12345']);
  const tenantId = savedTenantId && !['null', 'undefined'].includes(savedTenantId)
    && !legacyDefaults.has(savedTenantId) ? savedTenantId : null;
  let activeTenant = null;
  try {
    const parsed = JSON.parse(safeRead('pharma_active_tenant') || 'null');
    if (tenantId && String(parsed?._id || parsed?.id || '') === String(tenantId)) activeTenant = parsed;
  } catch {}
  // Older branch IDs were not associated with a tenant. Do not restore one
  // blindly: it could belong to a different pharmacy after a refresh.
  return { tenantId, activeTenant, branchId: null, branchTenantId: null };
}

function persistSelection(state) {
  if (typeof window === 'undefined') return;
  const snapshot = {
    tenantId: state.tenantId || null,
    activeTenant: state.activeTenant || null,
    branchId: state.branchId || null,
    branchTenantId: state.branchTenantId || null,
    updatedAt: Date.now()
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    if (snapshot.tenantId) window.localStorage.setItem('pharma_tenant_id', snapshot.tenantId);
    else window.localStorage.removeItem('pharma_tenant_id');
    if (snapshot.activeTenant) window.localStorage.setItem('pharma_active_tenant', JSON.stringify(snapshot.activeTenant));
    else window.localStorage.removeItem('pharma_active_tenant');
    if (snapshot.branchId) window.localStorage.setItem('pharma_branch_id', snapshot.branchId);
    else window.localStorage.removeItem('pharma_branch_id');
  } catch {
    // Persistence is a convenience; in-memory selection must keep working.
  }
}

export const useTenantStore = create((set, get) => ({
  ...readInitialSelection(),

  setTenantId: value => {
    const id = value == null ? null
      : typeof value === 'object' ? (value._id || value.id || null)
      : String(value).trim();
    const current = get();
    const changed = String(current.tenantId || '') !== String(id || '');
    const activeTenant = value && typeof value === 'object'
      ? value
      : (!id ? null : (current.activeTenant && String(current.activeTenant._id || current.activeTenant.id) === String(id) ? current.activeTenant : null));
    const next = {
      tenantId: id ? String(id) : null,
      activeTenant,
      branchId: changed ? null : current.branchId,
      branchTenantId: changed ? null : current.branchTenantId
    };
    set(next);
    persistSelection(next);
  },

  setActiveTenant: tenant => {
    const id = tenant?._id || tenant?.id || null;
    const current = get();
    const changed = String(current.tenantId || '') !== String(id || '');
    const next = {
      tenantId: id ? String(id) : null,
      activeTenant: tenant || null,
      branchId: changed ? null : current.branchId,
      branchTenantId: changed ? null : current.branchTenantId
    };
    set(next);
    persistSelection(next);
  },

  setBranchId: value => {
    const current = get();
    const id = value ? String(value).trim() : null;
    const next = {
      ...current,
      branchId: id,
      branchTenantId: id ? current.tenantId : null
    };
    set(next);
    persistSelection(next);
  },

  clearSelection: () => {
    const next = { tenantId: null, activeTenant: null, branchId: null, branchTenantId: null };
    set(next);
    persistSelection(next);
  }
}));

export const TenantProvider = ({ children }) => <>{children}</>;

export const useTenant = () => {
  const tenantId = useTenantStore(state => state.tenantId);
  const activeTenant = useTenantStore(state => state.activeTenant);
  const branchId = useTenantStore(state => state.branchId);
  const setTenantId = useTenantStore(state => state.setTenantId);
  const setActiveTenant = useTenantStore(state => state.setActiveTenant);
  const setBranchId = useTenantStore(state => state.setBranchId);
  const clearSelection = useTenantStore(state => state.clearSelection);
  return { tenantId, activeTenant, branchId, setTenantId, setActiveTenant, setBranchId, clearSelection };
};

export default TenantProvider;
