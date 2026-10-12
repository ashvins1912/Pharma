import React, { createContext, useContext, useState } from 'react';

const TenantContext = createContext(null);

export const TenantProvider = ({ children }) => {
  const [tenantId, setTenantIdState] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('pharma_tenant_id') || '65a1234567890abcdef12345';
    }
    return '65a1234567890abcdef12345';
  });

  const [activeTenant, setActiveTenantState] = useState(null);

  const setTenantId = (id) => {
    const stringId = typeof id === 'object' && id !== null ? (id._id || id.id || String(id)) : String(id);
    setTenantIdState(stringId);
    if (typeof window !== 'undefined') {
      localStorage.setItem('pharma_tenant_id', stringId);
    }
    if (typeof id === 'object' && id !== null) {
      setActiveTenantState(id);
    }
  };

  const setActiveTenant = (tenant) => {
    setActiveTenantState(tenant);
    if (tenant) {
      const id = tenant._id || tenant.id || String(tenant);
      setTenantId(id);
    }
  };

  return (
    <TenantContext.Provider value={{ tenantId, setTenantId, activeTenant, setActiveTenant }}>
      {children}
    </TenantContext.Provider>
  );
};

export const useTenant = () => {
  const context = useContext(TenantContext);
  if (!context) {
    throw new Error('useTenant must be used within a TenantProvider');
  }
  return context;
};

export default TenantContext;
