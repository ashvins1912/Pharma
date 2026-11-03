import React, { useState, useEffect } from 'react';
import apiClient from '../../api/apiClient';
import AdminFulfillmentKanban from './AdminFulfillmentKanban';
import AdminInventoryTable from './AdminInventoryTable';
import AdminRouteOptimizer from './AdminRouteOptimizer';

import RiderFleetView from './riders/RiderFleetView';
import AdminOrderFinancials from './AdminOrderFinancials';
import AdminMedicineRequestsTab from './requests/AdminMedicineRequestsTab';
import AdminPaymentReminders from './AdminPaymentReminders';
import AdminCSquareTab from './AdminCSquareTab';
import CustomerPromotionsView from './CustomerPromotionsView';
import SurplusSavingsManager from './SurplusSavingsManager';
import AdminOfferZoneManager from './AdminOfferZoneManager';
import PlatformTenantsView from './PlatformTenantsView';
import PlatformAccessControl from './PlatformAccessControl';
import LiveTelemetryTab from './LiveTelemetryTab';
import RoleFeatureMatrixTab from './RoleFeatureMatrixTab';
import TenantProfileDashboard from './TenantProfileDashboard';
import { useLanguage } from '../../context/LanguageContext';
import { getAdminMedicineRequests, getAdminPendingMedicineRequestCount } from '../../api/medicineRequestService';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import Pagination from '../common/Pagination';

function PendingMedicineRequestsNotice({ count, onOpen }) {
  const { t } = useLanguage();
  if (count < 1) return null;
  const plural = count !== 1;

  return (
    <aside className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-950 shadow-sm" aria-live="polite">
      <h3 className="text-sm font-black">
        {count} Medicine Request{plural ? 's' : ''} Pending
      </h3>
      <p className="mt-1 text-xs text-rose-800">
        {plural
          ? `You have ${count} medicine requests waiting for review.`
          : 'A medicine request is waiting for review.'}
      </p>
      <button
        type="button"
        onClick={onOpen}
        className="mt-3 text-xs font-extrabold text-rose-800 underline underline-offset-2 hover:text-rose-950"
      >
        Open {t('medicineRequests')} &amp; Proposals →
      </button>
    </aside>
  );
}

export default function AdminDashboardView() {
  const { t } = useLanguage();
  const {
    isSuperAdmin,
    canAccessOperations,
    hasPermission,
    hasAnyPermission,
    role,
    loading: authLoading
  } = useAuth();
  const { inventoryAlerts, loadInventoryAlerts, whatsappStatus, setWhatsappModalOpen, setAdminBulkImportModalOpen, setAdminNewStockModalOpen } = useApp();
  const [adminTab, setAdminTab] = useState('tenantProfile');

  // Navigation visibility and component rendering share these exact permission gates.
  const canViewFulfillment = hasPermission('orders.read') && hasPermission('orders.manage');
  const canViewAdminRequests = hasPermission('medicine_requests.read')
    && hasAnyPermission(['medicine_requests.pending_count', 'medicine_requests.manage', 'medicine_requests.proposal']);
  const canViewCSquare = hasPermission('csquare.read');
  const canManageRiders = hasPermission('delivery.read') && hasPermission('delivery.manage');
  const canViewPromotions = hasPermission('promotions.read');
  const canViewSurplusSavings = hasPermission('promotions.read');
  const canViewPayments = hasPermission('billing.read');
  const canManagePayments = hasPermission('billing.write');
  const canViewInventory = canAccessOperations || isSuperAdmin || hasPermission('inventory.read');
  const canImportInventory = canAccessOperations || isSuperAdmin || hasPermission('inventory.import');
  const canManageRoutes = hasPermission('delivery.manage') && hasPermission('orders.manage');
  const canViewAudits = hasPermission('inventory.read');
  const canViewTenants = isSuperAdmin && hasPermission('tenants.read');
  const canManagePlatformAccess = isSuperAdmin && hasPermission('users.manage');
  const canReadWhatsApp = hasPermission('whatsapp.read');
  const canManageWhatsApp = hasPermission('whatsapp.manage');
  const [orders, setOrders] = useState([]);
  const [recentOrders, setRecentOrders] = useState([]);
  const [totalOrders, setTotalOrders] = useState(0);
  const [deliveredCount, setDeliveredCount] = useState(0);
  const [pendingMedicineRequestCount, setPendingMedicineRequestCount] = useState(0);
  const [initialMedicineRequests, setInitialMedicineRequests] = useState(null);
  const [medicinePreloadLoading, setMedicinePreloadLoading] = useState(false);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [ordersError, setOrdersError] = useState('');

  const [auditLogs, setAuditLogs] = useState([]);
  const [auditPagination, setAuditPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false });
  const [activeOrdersPage, setActiveOrdersPage] = useState(1);
  const [snapshotPagination, setSnapshotPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false });

  // Preload the medicine-request first page as soon as the authenticated dashboard lands.
  // The tab consumes this snapshot so opening the tab does not issue a second list request.
  useEffect(() => {
    if (authLoading || !canAccessOperations || !canViewAdminRequests) return;
    let cancelled = false;
    setMedicinePreloadLoading(true);
    getAdminMedicineRequests({ page: 1, pageSize: 15, status: undefined, search: undefined })
      .then((data) => {
        if (!cancelled) setInitialMedicineRequests(data);
      })
      .catch((error) => {
        console.error('Failed to preload medicine requests:', error);
      })
      .finally(() => {
        if (!cancelled) setMedicinePreloadLoading(false);
      });
    return () => { cancelled = true; };
  }, [authLoading, canAccessOperations, canViewAdminRequests]);

  const loadPendingMedicineRequestCount = async () => {
    setPendingMedicineRequestCount(0);
  };

  const loadAllOrders = async () => {
    if (authLoading || !canViewFulfillment) return;
    try {
      setLoadingOrders(true);
      setOrdersError('');
      const res = await apiClient.get('/api/orders/admin/all', { params: { fulfillmentSnapshot: 'true', page: activeOrdersPage, limit: 10 } });
      const snapshot = res.data || {};
      setOrders(Array.isArray(snapshot.items) ? snapshot.items : []);
      setRecentOrders(Array.isArray(snapshot.recentOrders) ? snapshot.recentOrders : []);
      setTotalOrders(Number(snapshot.total) || 0);
      setActiveOrdersPage(Number(snapshot.pagination?.page) || activeOrdersPage);
      setSnapshotPagination(snapshot.pagination || { page: 1, limit: 10, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false });
      setDeliveredCount(Number(snapshot.deliveredCount) || 0);
    } catch (err) {
      setOrdersError(err.message || 'Could not load the order queue.');
    } finally {
      setLoadingOrders(false);
    }
  };

  const loadAuditLogs = async () => {
    if (authLoading || !canViewAudits) return;
    try {
      const res = await apiClient.get('/api/medicines/audits', { params: { page: auditPagination.page, limit: 10 } });
      const data = res.data || {};
      setAuditLogs(Array.isArray(data.items) ? data.items : []);
      setAuditPagination(data.pagination || { page: 1, limit: 10, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false });
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (authLoading || !canAccessOperations || !hasPermission('medicine_requests.pending_count')) return;
    loadPendingMedicineRequestCount();
    const timer = window.setInterval(loadPendingMedicineRequestCount, 15000);
    return () => window.clearInterval(timer);
  }, [authLoading, canAccessOperations, hasPermission]);

  useEffect(() => {
    if (authLoading || !canViewFulfillment || adminTab !== 'fulfillment') return;
    loadAllOrders();
  }, [adminTab, authLoading, canViewFulfillment, activeOrdersPage]);

  // Inventory alerts are loaded once by AppContext for the authenticated staff
  // session and shared with both the header alert bell and this dashboard.

  useEffect(() => {
    if (authLoading || !canViewAudits || adminTab !== 'audits') return;
    loadAuditLogs();
  }, [adminTab, authLoading, canViewAudits, auditPagination.page]);

  // Keep the active tab valid when the server-side permission snapshot changes.
  useEffect(() => {
    const allowedTabs = [
      canViewFulfillment && 'fulfillment',
      canViewCSquare && 'csquare',
      canViewAdminRequests && 'requests',
      canManageRiders && 'riders',
      canViewPromotions && 'promotions',
      canViewSurplusSavings && 'surplusSavings',
      canViewPromotions && 'offerZone',
      canViewPayments && 'payments',
      canViewInventory && 'inventory',
      canManageRoutes && 'routes',
      canViewAudits && 'audits',
      canViewTenants && 'tenants',
      canManagePlatformAccess && 'access',
      isSuperAdmin && 'telemetry',
      isSuperAdmin && 'matrix'
    ].filter(Boolean);
    if (!allowedTabs.includes(adminTab)) setAdminTab(allowedTabs[0] || '');
  }, [
    adminTab, canViewFulfillment, canViewCSquare, canViewAdminRequests,
    canManageRiders, canViewPromotions, canViewSurplusSavings, canViewPayments, canViewInventory,
    canManageRoutes, canViewAudits, canViewTenants, canManagePlatformAccess, isSuperAdmin
  ]);

  // Derived Metrics
  const processingCount = orders.filter(o => o.orderStatus === 'Processing Order').length;
  const pendingReviewCount = orders.filter(o => o.orderStatus === 'Pending_Review').length;
  const approvedCount = orders.filter(o => o.orderStatus === 'Approved').length;
  const readyCount = orders.filter(o => o.orderStatus === 'Ready to Dispatch').length;
  const dispatchedCount = orders.filter(o => o.orderStatus === 'Dispatched').length;
  const activeCount = processingCount + pendingReviewCount + approvedCount + readyCount + dispatchedCount;
  const totalRevenue = orders.reduce((sum, o) => sum + (Number(o.finalTotal) || 0), 0);

  if (!authLoading && !canAccessOperations) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center" role="status">
        <div className="text-sm font-black text-amber-900">{t('accessRestricted')}</div>
        <p className="mt-1 text-xs text-amber-700">Your current permissions do not allow access to the operations dashboard.</p>
      </div>
    );
  }

  if (role === 'pharmacy' && canViewAdminRequests) {
    return (
      <div className="min-w-0 space-y-6 animate-fade-in">
        <div className="bg-slate-950 text-white rounded-3xl p-6 shadow-md">
          <span className="text-[11px] font-black uppercase tracking-wider text-blue-400">
            {t('pharmacyReview')}
          </span>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight">
            {t('medicineRequests')}
          </h2>
          <p className="mt-2 text-sm text-slate-300">
            Review requests, prepare proposals, and wait for the customer to decide.
          </p>
        </div>
        <PendingMedicineRequestsNotice
          count={pendingMedicineRequestCount}
          onOpen={() => document.getElementById('admin-medicine-requests')?.scrollIntoView({ behavior: 'smooth' })}
        />
        <div id="admin-medicine-requests">
          <AdminMedicineRequestsTab initialData={initialMedicineRequests} initialLoading={medicinePreloadLoading} onPendingCountRefresh={loadPendingMedicineRequestCount} />
        </div>
        {canViewSurplusSavings && (
          <SurplusSavingsManager canManage={hasPermission('promotions.manage')} />
        )}
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-6 animate-fade-in">
      
      {/* Top Banner & Metric Cards */}
      <div className="bg-slate-950 text-white rounded-3xl p-6 shadow-md space-y-5">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <span className="text-[11px] font-black uppercase tracking-wider text-blue-400">
              {t('dispensaryControlHub')}
            </span>
            <h2 className="text-xl sm:text-2xl font-black tracking-tight">
              {t('operationsDashboard')}
            </h2>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            {/* Each action is shown only when its effective permission is granted. */}
            {canReadWhatsApp && (canManageWhatsApp ? (
              <button
                onClick={() => setWhatsappModalOpen(true)}
                className={`font-extrabold text-xs px-3.5 py-2.5 rounded-xl transition cursor-pointer flex items-center gap-1.5 shadow-sm ${
                  whatsappStatus.isConnected
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    : 'bg-amber-500 hover:bg-amber-400 text-slate-900 animate-pulse'
                }`}
                title="Manage WhatsApp connection"
              >
                <span>📲</span>
                <span>{whatsappStatus.isConnected ? 'WhatsApp: Connected' : 'WhatsApp: Offline'}</span>
              </button>
            ) : (
              <span className="rounded-xl bg-slate-800 px-3.5 py-2.5 text-xs font-bold text-slate-200">
                WhatsApp: {whatsappStatus.isConnected ? 'Connected' : 'Offline'}
              </span>
            ))}

            {canImportInventory && (
              <button
                onClick={() => setAdminBulkImportModalOpen(true)}
                className="bg-blue-600 hover:bg-blue-500 text-white font-extrabold text-xs px-4 py-2.5 rounded-xl shadow-md transition cursor-pointer flex items-center gap-2"
              >
                <span>📥</span>
                <span>{t('bulkExcelIngestion')}</span>
              </button>
            )}

            {canAccessOperations && (
              <button
                type="button"
                onClick={() => setAdminNewStockModalOpen(true)}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs px-4 py-2.5 rounded-xl shadow-md transition cursor-pointer flex items-center gap-2"
              >
                <span>+</span>
                <span>{t('addMedicine')}</span>
              </button>
            )}
          </div>
        </div>

        {/* 4 Metric Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-slate-800">
          {canViewFulfillment && (<div className="bg-white/95 rounded-2xl p-3.5 backdrop-blur-sm shadow-sm">
            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">
              All Orders
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-slate-900">{totalOrders}</span>
              <span className="text-[11px] font-bold text-amber-600">({activeCount} ongoing)</span>
            </div>
          </div>)}

          {hasPermission('inventory.read') && (<div className="bg-white/95 rounded-2xl p-3.5 backdrop-blur-sm shadow-sm">
            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">
              Low Stock Warnings
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-yellow-600">{inventoryAlerts.lowStockCount || 0}</span>
              <span className="text-[11px] text-slate-400">medicines ≤ 3</span>
            </div>
          </div>)}

          {hasPermission('inventory.read') && (<div className="bg-white/95 rounded-2xl p-3.5 backdrop-blur-sm shadow-sm">
            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">
              Expiring ≤ 30 Days
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-amber-600">{inventoryAlerts.expiringSoonCount || 0}</span>
              <span className="text-[11px] text-red-500 font-bold">({inventoryAlerts.expiredCount || 0} expired)</span>
            </div>
          </div>)}

          {canViewFulfillment && (<div className="bg-white/95 rounded-2xl p-3.5 backdrop-blur-sm shadow-sm">
            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">
              Gross Queue Value
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-emerald-600">₹{totalRevenue.toFixed(0)}</span>
              <span className="text-[11px] text-slate-400">{deliveredCount} delivered</span>
            </div>
          </div>)}
        </div>
      </div>

      {/* WhatsApp Disconnection Warning Banner */}
      {!whatsappStatus.isConnected && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-amber-900 shadow-sm animate-fade-in">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-200 text-amber-900 flex items-center justify-center text-xl flex-shrink-0">
              ⚠️
            </div>
            <div>
              <h4 className="font-extrabold text-xs sm:text-sm text-amber-950">
                {t('missDeliveryUpdatesTitle')}
              </h4>
              <p className="text-[11px] text-amber-800 mt-0.5">
                {t('whatsappDisconnectedDesc')}
              </p>
            </div>
          </div>
          {canManageWhatsApp && (
            <button
              onClick={() => setWhatsappModalOpen(true)}
              className="bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-xs px-4 py-2 rounded-xl transition cursor-pointer flex items-center gap-1.5 flex-shrink-0 shadow-sm"
            >
              <span>📲</span>
              <span>{t('linkWhatsAppQr')}</span>
            </button>
          )}
        </div>
      )}

      {/* Dispensary Command Center & Operations Hub - Wrapped Grid */}
      <div className="bg-white dark:bg-gray-900 rounded-3xl p-4 sm:p-5 shadow-sm border border-slate-200 dark:border-gray-800 space-y-3">
        <div className="flex items-center justify-between px-1">
          <div>
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Dispensary Command Center &amp; Operations Hub
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">Real-time dispensary workflows, logistics routing, and platform governance</p>
          </div>
          <span className="text-[10px] font-extrabold px-2.5 py-1 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-full">
            Active Workspace
          </span>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          {canViewFulfillment && <button
            onClick={() => setAdminTab('fulfillment')}
            className={`px-4 py-2.5 rounded-2xl text-xs font-black transition cursor-pointer flex items-center gap-2 ${
              adminTab === 'fulfillment'
                ? 'bg-blue-600 text-white shadow-md'
                : 'bg-slate-50 dark:bg-gray-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-gray-700 border border-slate-200 dark:border-gray-700'
            }`}
          >
            <span>📦</span>
            <span>{t('fulfillmentQueue')}</span>
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${adminTab === 'fulfillment' ? 'bg-blue-700 text-white' : 'bg-slate-200 dark:bg-gray-700 text-slate-700 dark:text-slate-300'}`}>
              {orders.length}
            </span>
          </button>}

          {canViewCSquare && (
            <button
              onClick={() => setAdminTab('csquare')}
              className={`px-4 py-2.5 rounded-2xl text-xs font-black transition cursor-pointer flex items-center gap-2 ${
                adminTab === 'csquare'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-slate-50 dark:bg-gray-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-gray-700 border border-slate-200 dark:border-gray-700'
              }`}
            >
              <span>🔗</span>
              <span>C-Square</span>
            </button>
          )}

          {canViewAdminRequests && (
            <button
              onClick={() => setAdminTab('requests')}
              className={`px-4 py-2.5 rounded-2xl text-xs font-black transition cursor-pointer flex items-center gap-2 ${
                adminTab === 'requests'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-slate-50 dark:bg-gray-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-gray-700 border border-slate-200 dark:border-gray-700'
              }`}
            >
              <span>📋</span>
              <span>{t('medicineRequests')}</span>
              <span
                aria-hidden={pendingMedicineRequestCount === 0}
                className={`inline-flex min-w-5 h-5 items-center justify-center rounded-full bg-rose-600 px-1.5 text-[10px] font-black leading-none text-white ${pendingMedicineRequestCount === 0 ? 'invisible' : ''}`}
              >
                {pendingMedicineRequestCount || 0}
              </span>
            </button>
          )}

          {canManageRiders && (
            <button
              onClick={() => setAdminTab('riders')}
              className={`px-4 py-2.5 rounded-2xl text-xs font-black transition cursor-pointer flex items-center gap-2 ${
                adminTab === 'riders'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-slate-50 dark:bg-gray-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-gray-700 border border-slate-200 dark:border-gray-700'
              }`}
            >
              <span>🛵</span>
              <span>{t('riderFleet')}</span>
            </button>
          )}

          {canViewPromotions && (
            <button
              onClick={() => setAdminTab('promotions')}
              className={`px-4 py-2.5 rounded-2xl text-xs font-black transition cursor-pointer flex items-center gap-2 ${
                adminTab === 'promotions'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-slate-50 dark:bg-gray-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-gray-700 border border-slate-200 dark:border-gray-700'
              }`}
            >
              <span>🏷️</span>
              <span>{t('customerOffers')}</span>
            </button>
          )}

          {canViewSurplusSavings && (
            <button
              onClick={() => setAdminTab('surplusSavings')}
              className={`px-4 py-2.5 rounded-2xl text-xs font-black transition cursor-pointer flex items-center gap-2 ${adminTab === 'surplusSavings'
                ? 'bg-blue-600 text-white shadow-md'
                : 'bg-slate-50 dark:bg-gray-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-gray-700 border border-slate-200 dark:border-gray-700'}`}
            >
              <span>⚡</span>
              <span>{t('surplusSavings')}</span>
            </button>
          )}

          {canViewPromotions && (
            <button
              onClick={() => setAdminTab('offerZone')}
              className={`px-4 py-2.5 rounded-2xl text-xs font-black transition cursor-pointer flex items-center gap-2 ${
                adminTab === 'offerZone'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-slate-50 dark:bg-gray-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-gray-700 border border-slate-200 dark:border-gray-700'
              }`}
            >
              <span>⚡</span>
              <span>{t('offerZone')}</span>
            </button>
          )}

          {canViewPayments && (
            <button
              onClick={() => setAdminTab('payments')}
              className={`px-4 py-2.5 rounded-2xl text-xs font-black transition cursor-pointer flex items-center gap-2 ${
                adminTab === 'payments'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-slate-50 dark:bg-gray-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-gray-700 border border-slate-200 dark:border-gray-700'
              }`}
            >
              <span>💳</span>
              <span>{t('paymentReminders')}</span>
            </button>
          )}

          {canViewInventory && (
            <button
              onClick={() => setAdminTab('inventory')}
              className={`px-4 py-2.5 rounded-2xl text-xs font-black transition cursor-pointer flex items-center gap-2 ${
                adminTab === 'inventory'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-slate-50 dark:bg-gray-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-gray-700 border border-slate-200 dark:border-gray-700'
              }`}
            >
              <span>📊</span>
              <span>{t('inventoryCatalog')}</span>
            </button>
          )}

          {canManageRoutes && (
            <button
              onClick={() => setAdminTab('routes')}
              className={`px-4 py-2.5 rounded-2xl text-xs font-black transition cursor-pointer flex items-center gap-2 ${
                adminTab === 'routes'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-slate-50 dark:bg-gray-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-gray-700 border border-slate-200 dark:border-gray-700'
              }`}
            >
              <span>🗺️</span>
              <span>{t('smartRoute')}</span>
            </button>
          )}

          {canViewAudits && (
            <button
              onClick={() => setAdminTab('audits')}
              className={`px-4 py-2.5 rounded-2xl text-xs font-black transition cursor-pointer flex items-center gap-2 ${
                adminTab === 'audits'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-slate-50 dark:bg-gray-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-gray-700 border border-slate-200 dark:border-gray-700'
              }`}
            >
              <span>📜</span>
              <span>{t('inventoryAudits')}</span>
            </button>
          )}

          {canViewTenants && (
            <button
              onClick={() => setAdminTab('tenants')}
              className={`px-4 py-2.5 rounded-2xl text-xs font-black transition cursor-pointer flex items-center gap-2 ${
                adminTab === 'tenants'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-slate-50 dark:bg-gray-800 text-blue-600 dark:text-blue-400 hover:bg-slate-100 dark:hover:bg-gray-700 border border-blue-200 dark:border-gray-700'
              }`}
            >
              <span>🌐</span>
              <span>{t('platformTenants')}</span>
            </button>
          )}

          {canManagePlatformAccess && (
            <button
              onClick={() => setAdminTab('access')}
              className={`px-4 py-2.5 rounded-2xl text-xs font-black transition cursor-pointer flex items-center gap-2 ${
                adminTab === 'access'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-slate-50 dark:bg-gray-800 text-blue-600 dark:text-blue-400 hover:bg-slate-100 dark:hover:bg-gray-700 border border-blue-200 dark:border-gray-700'
              }`}
            >
              <span>🛡️</span>
              <span>{t('securityAccess')}</span>
            </button>
          )}

          {isSuperAdmin && (
            <button
              onClick={() => setAdminTab('telemetry')}
              className={`px-4 py-2.5 rounded-2xl text-xs font-black transition cursor-pointer flex items-center gap-2 ${
                adminTab === 'telemetry'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'bg-slate-50 dark:bg-gray-800 text-indigo-600 dark:text-indigo-400 hover:bg-slate-100 dark:hover:bg-gray-700 border border-indigo-200 dark:border-gray-700'
              }`}
            >
              <span>📡</span>
              <span>{t('liveTelemetry')}</span>
            </button>
          )}

          {isSuperAdmin && (
            <button
              onClick={() => setAdminTab('matrix')}
              className={`px-4 py-2.5 rounded-2xl text-xs font-black transition cursor-pointer flex items-center gap-2 ${
                adminTab === 'matrix'
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'bg-slate-50 dark:bg-gray-800 text-purple-600 dark:text-purple-400 hover:bg-slate-100 dark:hover:bg-gray-700 border border-purple-200 dark:border-gray-700'
              }`}
            >
              <span>📐</span>
              <span>{t('roleFeatureMatrix')}</span>
            </button>
          )}

          <button
            onClick={() => setAdminTab('tenantProfile')}
            className={`px-4 py-2.5 rounded-2xl text-xs font-black transition cursor-pointer flex items-center gap-2 ${
              adminTab === 'tenantProfile'
                ? 'bg-blue-600 text-white shadow-md'
                : 'bg-slate-50 dark:bg-gray-800 text-blue-600 dark:text-blue-400 hover:bg-slate-100 dark:hover:bg-gray-700 border border-blue-200 dark:border-gray-700'
            }`}
          >
            <span>🏢</span>
            <span>{t('tenantProfileBranches')}</span>
          </button>
        </div>
      </div>

      {/* Tab Content Display */}
      {adminTab === 'tenants' && canViewTenants && (
        <PlatformTenantsView />
      )}
      {adminTab === 'access' && canManagePlatformAccess && (
        <PlatformAccessControl />
      )}
      {adminTab === 'telemetry' && isSuperAdmin && (
        <LiveTelemetryTab />
      )}
      {adminTab === 'matrix' && isSuperAdmin && (
        <RoleFeatureMatrixTab />
      )}
      {adminTab === 'tenantProfile' && (
        <TenantProfileDashboard />
      )}
      {adminTab === 'csquare' && canViewCSquare && <AdminCSquareTab />}
      {adminTab === 'promotions' && canViewPromotions && <CustomerPromotionsView canManage={hasPermission('promotions.manage')} />}
      {adminTab === 'surplusSavings' && canViewSurplusSavings && <SurplusSavingsManager canManage={hasPermission('promotions.manage')} />}

      {adminTab === 'fulfillment' && canViewFulfillment && (
        <div className="space-y-3">
          {ordersError && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
              <span>{ordersError}</span>
              <button
                type="button"
                onClick={loadAllOrders}
                disabled={loadingOrders}
                className="shrink-0 font-bold underline disabled:opacity-50"
              >
                Retry
              </button>
            </div>
          )}
          {loadingOrders && orders.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white py-12 text-center text-sm text-slate-500">
              Loading ongoing and delivered orders…
            </div>
          ) : (
            <>
              <AdminFulfillmentKanban orders={orders} onRefresh={loadAllOrders} />
              {!loadingOrders && !ordersError && (
                <Pagination
                  page={activeOrdersPage}
                  totalPages={Number(snapshotPagination?.totalPages || 0)}
                  total={Number(snapshotPagination?.total || 0)}
                  pageSize={10}
                  onPageChange={setActiveOrdersPage}
                  loading={loadingOrders}
                  label="active orders"
                />
              )}
            </>
          )}
          {!loadingOrders && recentOrders.length > 0 && (
            <section aria-labelledby="admin-financial-insights" className="space-y-3 pt-3">
              <div>
                <h3 id="admin-financial-insights" className="text-base font-black text-slate-900">
                  Order financial insights
                </h3>
                <p className="text-xs text-slate-500">
                  Margin, discounts and loyalty activity for recent orders.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {recentOrders.map(order => (
                  <AdminOrderFinancials key={order._id} order={order} />
                ))}
              </div>
            </section>
          )}
          {!loadingOrders && !ordersError && orders.length > 0 && (
            <p className="text-center text-[11px] text-slate-500">
              Showing all orders: {activeCount} ongoing and {deliveredCount} delivered.
            </p>
          )}
        </div>
      )}

      {adminTab === 'requests' && canViewAdminRequests && (
        <AdminMedicineRequestsTab initialData={initialMedicineRequests} onPendingCountRefresh={loadPendingMedicineRequestCount} />
      )}

      {adminTab === 'riders' && canManageRiders && (
        <RiderFleetView />
      )}

      {adminTab === 'offerZone' && canViewPromotions && (
        <AdminOfferZoneManager />
      )}

      {adminTab === 'payments' && canViewPayments && (
        <AdminPaymentReminders canManage={canManagePayments} />
      )}

      {adminTab === 'inventory' && canViewInventory && (
        <AdminInventoryTable
          onOpenBulkImport={() => setImportModalOpen(true)}
          canManage={canAccessOperations || isSuperAdmin || hasPermission('inventory.write') || hasPermission('*')}
          canImport={canImportInventory}
        />
      )}

      {adminTab === 'routes' && canManageRoutes && (
        <AdminRouteOptimizer onRefresh={loadAllOrders} />
      )}

      {adminTab === 'audits' && canViewAudits && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-base font-black text-slate-900">📜 {t('inventoryMergeAuditTrail')}</h3>
              <p className="text-xs text-slate-500">{t('bulkInventoryChangesDesc')}</p>
            </div>
            <button
              onClick={() => { setAuditPagination(p => ({ ...p, page: 1 })); void loadAuditLogs(); }}
              className="text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-xl cursor-pointer"
            >
              🔄 {t('refresh')}
            </button>
          </div>

          {auditLogs.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              {t('noInventoryChangesRecorded')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-400 text-[10px] font-extrabold uppercase tracking-wider">
                    <th className="py-2.5 px-3">{t('timestamp')}</th>
                    <th className="py-2.5 px-3">{t('eventReference')}</th>
                    <th className="py-2.5 px-3">{t('skuMedicine')}</th>
                    <th className="py-2.5 px-3">{t('stockShift')}</th>
                    <th className="py-2.5 px-3">{t('priceShift')}</th>
                    <th className="py-2.5 px-3">{t('authorizedBy')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {auditLogs.map((log, idx) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 text-slate-500 text-[11px]">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500">
                        <span className="block">{log.eventType === 'DELIVERY' ? 'Delivered order' : 'Bulk import'}</span>
                        {log.importId}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="font-bold text-slate-900 block">{log.name}</span>
                        <span className="text-[10px] text-slate-400 font-mono">{log.sku}</span>
                      </td>
                      <td className="py-2.5 px-3">
                        {log.eventType === 'DELIVERY' ? (
                          <strong className="font-bold text-rose-700">−{log.quantity} delivered</strong>
                        ) : (
                          <>
                            <span className="text-slate-400">{log.previousStock}</span> →{' '}
                            <strong className="text-emerald-700 font-bold">{log.newStock}</strong>
                          </>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        {log.eventType === 'DELIVERY' ? (
                          <span className="text-slate-500">₹{log.newPrice} per unit</span>
                        ) : (
                          <>
                            <span className="text-slate-400">₹{log.previousPrice}</span> →{' '}
                            <strong className="text-slate-900 font-bold">₹{log.newPrice}</strong>
                          </>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 font-medium">{log.adminId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination
            page={auditPagination.page}
            totalPages={auditPagination.totalPages}
            total={auditPagination.total}
            pageSize={10}
            onPageChange={(page) => setAuditPagination(current => ({ ...current, page }))}
            loading={loadingOrders}
            label="audit records"
          />
        </div>
      )}



    </div>
  );
}
