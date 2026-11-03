import React, { createContext, useContext, useState } from 'react';

const TenantContext = createContext(null);

const readSavedTenant = () => {
  if (typeof window === 'undefined') return null;
  try {
    const value = localStorage.getItem('pharma_active_tenant');
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
};

export const TenantProvider = ({ children }) => {
  // The saved tenant is a customer preference, never authorization evidence.
  const [tenantId, setTenantIdState] = useState(() => {
    if (typeof window === 'undefined') return null;
    const saved = localStorage.getItem('pharma_tenant_id');
    const legacyDefaults = new Set(['tenant-ashvin-main', 'tenant-default-1', '65a1234567890abcdef12345']);
    if (!saved || saved === 'null' || saved === 'undefined' || legacyDefaults.has(saved)) {
      localStorage.removeItem('pharma_tenant_id');
      localStorage.removeItem('pharma_active_tenant');
      return null;
    }
    return saved;
  });
  const [activeTenant, setActiveTenantState] = useState(readSavedTenant);
  const [branchId, setBranchIdState] = useState(() => {
    if (typeof window === 'undefined') return 'branch-1';
    return localStorage.getItem('pharma_branch_id') || 'branch-1';
  });

  const setTenantId = (value) => {
    const id = value == null ? null
      : typeof value === 'object' ? (value._id || value.id || null)
      : String(value);
    setTenantIdState(id);
    if (typeof window !== 'undefined') {
      if (id) localStorage.setItem('pharma_tenant_id', String(id));
      else localStorage.removeItem('pharma_tenant_id');
    }
    if (value && typeof value === 'object') {
      setActiveTenantState(value);
      if (typeof window !== 'undefined') localStorage.setItem('pharma_active_tenant', JSON.stringify(value));
    } else if (!id || (activeTenant && String(activeTenant._id || activeTenant.id) !== String(id))) {
      setActiveTenantState(null);
      if (typeof window !== 'undefined') localStorage.removeItem('pharma_active_tenant');
    }
  };

  const setActiveTenant = (tenant) => {
    setActiveTenantState(tenant || null);
    setTenantId(tenant ? (tenant._id || tenant.id) : null);
  };

  const setBranchId = (id) => {
    const nextBranchId = id ? String(id).trim() : '';
    setBranchIdState(nextBranchId);
    if (typeof window !== 'undefined') {
      if (nextBranchId) localStorage.setItem('pharma_branch_id', nextBranchId);
      else localStorage.removeItem('pharma_branch_id');
    }
  };

  return (
    <TenantContext.Provider value={{ tenantId, setTenantId, activeTenant, setActiveTenant, branchId, setBranchId }}>
      {children}
    </TenantContext.Provider>
  );
};

export const useTenant = () => {
  const context = useContext(TenantContext);
  if (!context) throw new Error('useTenant must be used within a TenantProvider');
  return context;
};

export default TenantContext;
