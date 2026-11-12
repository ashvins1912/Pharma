/**
 * Central Dashboard Analytics State Management Context
 * Ensures live, non-hardcoded data flow for Order and Offer analytics across the application.
 */

import React, { createContext, useContext, useMemo } from 'react';
import { useApp } from './AppContext';
import { computeSpendingAnalytics, analyzeCustomerOffers } from '../services/analystService';

const DashboardAnalyticsContext = createContext(null);

export function DashboardAnalyticsProvider({ children }) {
  const { orders, medicines, loadingOrders } = useApp();

  // Compute live spending analytics from real-time order data
  const spendingAnalytics = useMemo(() => {
    return computeSpendingAnalytics(orders);
  }, [orders]);

  // Compute live customer offers and smart refills from real-time order and catalog data
  const offerAnalytics = useMemo(() => {
    return analyzeCustomerOffers(orders, medicines);
  }, [orders, medicines]);

  const value = useMemo(() => ({
    ...spendingAnalytics,
    ...offerAnalytics,
    loadingOrders,
    rawOrdersCount: Array.isArray(orders) ? orders.length : 0,
    rawCatalogCount: Array.isArray(medicines) ? medicines.length : 0
  }), [spendingAnalytics, offerAnalytics, loadingOrders, orders, medicines]);

  return (
    <DashboardAnalyticsContext.Provider value={value}>
      {children}
    </DashboardAnalyticsContext.Provider>
  );
}

export function useDashboardAnalytics() {
  const context = useContext(DashboardAnalyticsContext);
  if (!context) {
    throw new Error('useDashboardAnalytics must be used within a DashboardAnalyticsProvider.');
  }
  return context;
}
