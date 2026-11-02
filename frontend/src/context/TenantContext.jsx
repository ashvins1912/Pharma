import React, { createContext, useContext, useState } from 'react';

const TenantContext = createContext(null);

export const TenantProvider = ({ children }) => {
  // A customer must explicitly select a pharmacy. This ID is a selector only;
  // the backend revalidates tenant status, inventory and membership.
  const [tenantId, setTenantIdState] = useState(() => {
    if (typeof window === 'undefined') return null;
    const saved = localStorage.getItem('pharma_tenant_id');
    return saved && saved !== 'null' && saved !== 'undefined' ? saved : null;
  });
  const [activeTenant, setActiveTenantState] = useState(null);

  const setTenantId = (value) => {
    const id = value == null ? null
      : typeof value === 'object' ? (value._id || value.id || null)
      : String(value);
    setTenantIdState(id);
    if (typeof window !== 'undefined') {
      if (id) localStorage.setItem('pharma_tenant_id', String(id));
      else localStorage.removeItem('pharma_tenant_id');
    }
    if (value && typeof value === 'object') setActiveTenantState(value);
    else if (!id) setActiveTenantState(null);
  };

  const setActiveTenant = (tenant) => {
    setActiveTenantState(tenant || null);
    setTenantId(tenant ? (tenant._id || tenant.id) : null);
  };

  return <TenantContext.Provider value={{ tenantId, setTenantId, activeTenant, setActiveTenant }}>{children}</TenantContext.Provider>;
};

export const useTenant = () => {
  const context = useContext(TenantContext);
  if (!context) throw new Error('useTenant must be used within a TenantProvider');
  return context;
};

export default TenantContext;
