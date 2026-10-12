import React, { createContext, useContext, useState } from 'react';

const TenantContext = createContext(null);

export const TenantProvider = ({ children }) => {
  const [tenantId, setTenantIdState] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('pharma_tenant_id') || '65a1234567890abcdef12345';
    }
    return '65a1234567890abcdef12345';
  });

  const setTenantId = (id) => {
    setTenantIdState(id);
    if (typeof window !== 'undefined') {
      localStorage.setItem('pharma_tenant_id', id);
    }
  };

  return (
    <TenantContext.Provider value={{ tenantId, setTenantId }}>
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
