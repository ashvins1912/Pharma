import React, { useState, useEffect } from 'react';
import apiClient from '../../api/apiClient';
import AdminFulfillmentKanban from './AdminFulfillmentKanban';
import AdminInventoryTable from './AdminInventoryTable';
import MedicineCatalogueImportModal from './MedicineCatalogueImportModal';
import MedicineMasterCatalogueView from './MedicineMasterCatalogueView';
import AdminRouteOptimizer from './AdminRouteOptimizer';
import TenantActivityFeed from './TenantActivityFeed';
import TenantStaffManager from './TenantStaffManager';
import ServiceLogsTab from './ServiceLogsTab';

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
import AutomationTestCenterTab from './AutomationTestCenterTab';
import FeatureHealthDashboard from './FeatureHealthDashboard';
import TenantProfileDashboard from './TenantProfileDashboard';
import { useLanguage } from '../../context/LanguageContext';
import { getAdminMedicineRequests, getAdminPendingMedicineRequestCount } from '../../api/medicineRequestService';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import Pagination from '../common/Pagination';
import { ComponentLoader, TableSkeleton, CardSkeleton, ErrorState, EmptyState } from '../common/ComponentLoader';
import { DASHBOARD_PERIODS, getDashboardDateRange } from '../../utils/dashboardDateRange';
import './AdminDashboardView.css';

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
    user,
    canAccessOperations,
    hasPermission,
    hasAnyPermission,
    role,
    loading: authLoading
  } = useAuth();
  const { inventoryAlerts, loadInventoryAlerts, whatsappStatus, setWhatsappModalOpen, setAdminBulkImportModalOpen, setAdminNewStockModalOpen } = useApp();
  const { tenantId: contextTenantId } = useTenant();
  const activeTenantId = contextTenantId || user?.tenantId || user?.app_metadata?.tenantId || '';
  const canImportMedicineMaster = ['SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(String(user?.app_metadata?.role || user?.role || role || '').toUpperCase());
  const [adminTab, setAdminTab] = useState('tenantProfile');
  const [catalogueImportOpen, setCatalogueImportOpen] = useState(false);
  const [dashboardPeriod, setDashboardPeriod] = useState('today');
  const dashboardRange = getDashboardDateRange(dashboardPeriod);

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
  const canManageMembers = Boolean(activeTenantId && hasPermission('tenant.branches.manage'));
  const canViewTenants = isSuperAdmin && hasPermission('tenants.read');

  useEffect(() => {
    if (canViewTenants && adminTab === 'tenantProfile') setAdminTab('tenants');
  }, [canViewTenants, adminTab]);

  useEffect(() => {
    if (String(role).toLowerCase() !== 'pharmacy' || adminTab !== 'tenantProfile' || canViewTenants) return;
    if (canViewFulfillment) setAdminTab('fulfillment');
    else if (canViewAdminRequests) setAdminTab('requests');
  }, [role, adminTab, canViewTenants, canViewFulfillment, canViewAdminRequests]);
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
    try {
      const count = await getAdminPendingMedicineRequestCount();
      setPendingMedicineRequestCount(count);
    } catch (error) {
      console.error('Failed to refresh pending medicine request count:', error);
    }
  };

  const loadAllOrders = async () => {
    if (authLoading || !canViewFulfillment) return;
    try {
      setLoadingOrders(true);
      setOrdersError('');
      const res = await apiClient.get('/api/orders/admin/all', { params: { fulfillmentSnapshot: 'true', page: activeOrdersPage, limit: 10, ...dashboardRange } });
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
    // One initial snapshot, then refresh only when the server publishes a
    // medicine_request_updated event (including reconnect recovery).
    void loadPendingMedicineRequestCount();
    const handleMedicineRequestUpdated = () => { void loadPendingMedicineRequestCount(); };
    window.addEventListener('pharma:medicine-request-updated', handleMedicineRequestUpdated);
    return () => window.removeEventListener('pharma:medicine-request-updated', handleMedicineRequestUpdated);
  }, [authLoading, canAccessOperations, hasPermission]);

  useEffect(() => {
    if (authLoading || !canViewFulfillment || adminTab !== 'fulfillment') return;
    loadAllOrders();
  }, [adminTab, authLoading, canViewFulfillment, activeOrdersPage, dashboardPeriod]);

  // Inventory alerts are loaded once by AppContext for the authenticated staff
  // session and shared with both the header alert bell and this dashboard.

  useEffect(() => {
    if (authLoading || !canViewAudits || adminTab !== 'audits') return;
    loadAuditLogs();
  }, [adminTab, authLoading, canViewAudits, auditPagination.page]);

  // Keep the active tab valid when the server-side permission snapshot changes.
  useEffect(() => {
    const allowedTabs = [
      'tenantProfile',
      canViewFulfillment && 'fulfillment',
      canViewCSquare && 'csquare',
      canViewAdminRequests && 'requests',
      canManageRiders && 'riders',
      canViewPromotions && 'promotions',
      canViewSurplusSavings && 'surplusSavings',
      canViewPromotions && 'offerZone',
      canViewPayments && 'payments',
      canViewInventory && 'inventory',
      canImportMedicineMaster && 'medicineCatalogue',
      canManageRoutes && 'routes',
      canViewAudits && 'audits',
      canManageMembers && 'members',
      canViewTenants && 'tenants',
      canManagePlatformAccess && 'access',
      isSuperAdmin && 'serviceLogs',
      isSuperAdmin && 'telemetry',
      isSuperAdmin && 'matrix',
      isSuperAdmin && 'automation',
      isSuperAdmin && 'featureHealth'
    ].filter(Boolean);
    if (!allowedTabs.includes(adminTab)) setAdminTab(allowedTabs[0] || '');
  }, [
    adminTab, canViewFulfillment, canViewCSquare, canViewAdminRequests,
    canManageRiders, canViewPromotions, canViewSurplusSavings, canViewPayments, canViewInventory,
    canImportMedicineMaster, canManageRoutes, canViewAudits, canManageMembers, canViewTenants, canManagePlatformAccess, isSuperAdmin
  ]);

  // Derived Metrics
  const processingCount = orders.filter(o => o.orderStatus === 'Processing Order').length;
  const pendingReviewCount = orders.filter(o => o.orderStatus === 'Pending_Review').length;
  const approvedCount = orders.filter(o => o.orderStatus === 'Approved').length;
  const readyCount = orders.filter(o => o.orderStatus === 'Ready to Dispatch').length;
  const dispatchedCount = orders.filter(o => o.orderStatus === 'Dispatched').length;
  const activeCount = processingCount + pendingReviewCount + approvedCount + readyCount + dispatchedCount;
  const totalRevenue = orders.reduce((sum, o) => sum + (Number(o.finalTotal) || 0), 0);

  const renderWorkspaceItem = (tab, label, icon, count = null, tone = 'default') => {
    const active = adminTab === tab;
    return (
      <button
        key={tab}
        type="button"
        onClick={() => setAdminTab(tab)}
        aria-current={active ? 'page' : undefined}
        className={`dashboard-nav-item${active ? ' is-active' : ''}${tone === 'governance' ? ' is-governance' : ''}`}
      >
        <span className="dashboard-nav-item-icon" aria-hidden="true">{icon}</span>
        <span className="dashboard-nav-item-label">{label}</span>
        {count !== null && count !== undefined && (
          <span className={`dashboard-nav-item-count${tone === 'attention' && count > 0 ? ' is-attention' : ''}`} aria-label={`${count} items`}>
            {count}
          </span>
        )}
        <span className="dashboard-nav-item-chevron" aria-hidden="true">›</span>
      </button>
    );
  };

  if (!authLoading && !canAccessOperations) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center" role="status">
        <div className="text-sm font-black text-amber-900">{t('accessRestricted')}</div>
        <p className="mt-1 text-xs text-amber-700">Your current permissions do not allow access to the operations dashboard.</p>
      </div>
    );
  }

  return (
    <div className="dashboard-shell dashboard-shell--command-center min-w-0 space-y-4 animate-fade-in">
      
      {/* Top Banner & Metric Cards */}
      <div className="dashboard-hero bg-slate-950 text-white rounded-3xl p-4 sm:p-5 shadow-md space-y-4">
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

            {canImportMedicineMaster && (
              <button type="button" onClick={() => { setAdminTab('medicineCatalogue'); document.getElementById('admin-workspace-content')?.scrollIntoView({ behavior: 'smooth' }); }} className="rounded-xl border border-violet-300 bg-violet-50 px-3.5 py-2.5 text-xs font-extrabold text-violet-800 transition hover:bg-violet-100">
                <span aria-hidden="true">🧬</span> <span>Medicine Master Import</span>
              </button>
            )}

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

            {isSuperAdmin && (
              <button
                type="button"
                onClick={() => {
                  setAdminTab('automation');
                  const el = document.getElementById('admin-workspace-content');
                  if (el) el.scrollIntoView({ behavior: 'smooth' });
                }}
                className="bg-purple-600 hover:bg-purple-500 text-white font-extrabold text-xs px-4 py-2.5 rounded-xl shadow-md transition cursor-pointer flex items-center gap-2"
              >
                <span>🧪</span>
                <span>Launch Automation Test</span>
              </button>
            )}
          </div>
        </div>

        {/* 4 Metric Cards */}
        <div className="dashboard-metrics grid grid-cols-2 md:grid-cols-4 gap-3 text-slate-800">
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

      {(canViewFulfillment || canViewAdminRequests) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3">
          <label htmlFor="operations-date-range" className="text-xs font-bold text-slate-700">Operations period</label>
          <select id="operations-date-range" value={dashboardPeriod}
            onChange={event => { setDashboardPeriod(event.target.value); setActiveOrdersPage(1); }}
            className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800">
            {DASHBOARD_PERIODS.map(period => <option key={period.value} value={period.value}>{period.label}</option>)}
          </select>
        </div>
      )}

      {/* Compact command center: permission-filtered task groups share the available width. */}
      <section className="dashboard-workspace dashboard-workspace--command-center" aria-labelledby="operations-workspace-title">
        <header className="dashboard-workspace-header">
          <div className="dashboard-workspace-heading">
            <span className="dashboard-workspace-eyebrow">PHARMA / OPERATIONS</span>
            <h3 id="operations-workspace-title">Dispensary Command Center</h3>
            <p>Real-time dispensary workflows, logistics routing, and platform governance.</p>
          </div>
          <div className="dashboard-workspace-header-actions">
            <span className="dashboard-workspace-context"><span className="dashboard-workspace-context-dot" aria-hidden="true" /> Operations hub</span>
            <span className="dashboard-workspace-tab-hint">Choose a workspace below</span>
          </div>
        </header>

        <nav className="dashboard-workspace-nav dashboard-workspace-nav--dense" aria-label="Operations command center">
          {[
            {
              id: 'orders',
              title: 'Orders & requests',
              description: 'Fulfillment and procurement',
              items: [
                canViewFulfillment && { tab: 'fulfillment', label: t('fulfillmentQueue'), icon: '📦', count: orders.length },
                canViewAdminRequests && { tab: 'requests', label: t('medicineRequests'), icon: '📋', count: pendingMedicineRequestCount, tone: 'attention' },
                canViewCSquare && { tab: 'csquare', label: 'C-Square', icon: '🔗' }
              ]
            },
            {
              id: 'delivery',
              title: 'Delivery & logistics',
              description: 'Riders, dispatch and routes',
              items: [
                canManageRiders && { tab: 'riders', label: t('riderFleet'), icon: '🛵' },
                canManageRoutes && { tab: 'routes', label: t('smartRoute'), icon: '🗺️' }
              ]
            },
            {
              id: 'inventory',
              title: 'Inventory',
              description: 'Stock and traceability',
              items: [
                canViewInventory && { tab: 'inventory', label: t('inventoryCatalog'), icon: '📊' },
                canImportMedicineMaster && { tab: 'medicineCatalogue', label: 'Medicine Master Catalogue', icon: '🧬', tone: 'governance' },
                canViewAudits && { tab: 'audits', label: t('inventoryAudits'), icon: '📜' }
              ]
            },
            {
              id: 'growth',
              title: 'Finance & growth',
              description: 'Payments, offers and savings',
              items: [
                canViewPromotions && { tab: 'promotions', label: t('customerOffers'), icon: '🏷️' },
                canViewSurplusSavings && { tab: 'surplusSavings', label: t('surplusSavings'), icon: '⚡' },
                canViewPromotions && { tab: 'offerZone', label: t('offerZone'), icon: '✨' },
                canViewPayments && { tab: 'payments', label: t('paymentReminders'), icon: '💳' }
              ]
            },
            {
              id: 'workspace',
              title: 'People & workspace',
              description: 'Team and pharmacy profile',
              items: [
                canManageMembers && { tab: 'members', label: 'Members & Staff', icon: '👥' },
                !isSuperAdmin && { tab: 'tenantProfile', label: t('tenantProfileBranches'), icon: '🏢' }
              ]
            },
            {
              id: 'governance',
              title: 'Platform governance',
              description: 'Security and platform oversight',
              items: [
                canViewTenants && { tab: 'tenants', label: t('platformTenants'), icon: '🌐', tone: 'governance' },
                canManagePlatformAccess && { tab: 'access', label: t('securityAccess'), icon: '🛡️', tone: 'governance' },
                isSuperAdmin && { tab: 'serviceLogs', label: 'Service logs', icon: '🧾', tone: 'governance' },
                isSuperAdmin && { tab: 'telemetry', label: t('liveTelemetry'), icon: '📡', tone: 'governance' },
                isSuperAdmin && { tab: 'matrix', label: t('roleFeatureMatrix'), icon: '📐', tone: 'governance' },
                isSuperAdmin && { tab: 'automation', label: 'Automation test engine', icon: '🧪', tone: 'governance' },
                isSuperAdmin && { tab: 'featureHealth', label: 'Feature health & blockers', icon: '🩺', tone: 'governance' }
              ]
            }
          ].map(group => {
            const items = group.items.filter(Boolean);
            if (!items.length) return null;
            return (
              <section key={group.id} className={`dashboard-nav-group dashboard-nav-group--${group.id}`} aria-label={group.title}>
                <div className="dashboard-nav-group-heading">
                  <h4 className="dashboard-nav-group-title">{group.title}</h4>
                  <p>{group.description}</p>
                </div>
                <div className="dashboard-nav-group-items">
                  {items.map(item => renderWorkspaceItem(item.tab, item.label, item.icon, item.count === 0 && item.tone === 'attention' ? null : item.count, item.tone || 'default'))}
                </div>
              </section>
            );
          })}
        </nav>
      </section>

      {/* Tab Content Display */}
      <main className="dashboard-content" id="admin-workspace-content" tabIndex="-1">
      {adminTab === 'tenants' && canViewTenants && (
        <div className="admin-screen admin-screen--tenants"><PlatformTenantsView /></div>
      )}
      {adminTab === 'access' && canManagePlatformAccess && (
        <div className="admin-screen admin-screen--access"><PlatformAccessControl /></div>
      )}
      {adminTab === 'telemetry' && isSuperAdmin && (
        <div className="admin-screen admin-screen--telemetry"><LiveTelemetryTab /></div>
      )}
      {adminTab === 'matrix' && isSuperAdmin && (
        <div className="admin-screen admin-screen--matrix"><RoleFeatureMatrixTab /></div>
      )}
      {adminTab === 'automation' && isSuperAdmin && (
        <div className="admin-screen admin-screen--automation"><AutomationTestCenterTab /></div>
      )}
      {adminTab === 'featureHealth' && isSuperAdmin && (
        <div className="admin-screen admin-screen--feature-health"><FeatureHealthDashboard /></div>
      )}
      {adminTab === 'members' && canManageMembers && <div className="admin-screen admin-screen--members"><TenantStaffManager tenantId={activeTenantId} /></div>}
      {adminTab === 'serviceLogs' && isSuperAdmin && <div className="admin-screen admin-screen--service-logs"><ServiceLogsTab /></div>}
      {adminTab === 'tenantProfile' && !isSuperAdmin && (
        <div className="admin-screen admin-screen--tenant-profile"><TenantProfileDashboard /></div>
      )}
      {adminTab === 'csquare' && canViewCSquare && <div className="admin-screen admin-screen--csquare"><AdminCSquareTab /></div>}
      {adminTab === 'promotions' && canViewPromotions && <div className="admin-screen admin-screen--promotions"><CustomerPromotionsView canManage={hasPermission('promotions.manage')} /></div>}
      {adminTab === 'surplusSavings' && canViewSurplusSavings && <div className="admin-screen admin-screen--surplus-savings"><SurplusSavingsManager canManage={hasPermission('promotions.manage')} /></div>}

      {adminTab === 'fulfillment' && canViewFulfillment && (
        <div className="admin-screen admin-screen--fulfillment space-y-3">
          {ordersError && (
            <ErrorState
              title="Failed to load ongoing and delivered orders"
              message={ordersError}
              onRetry={loadAllOrders}
            />
          )}
          {loadingOrders && orders.length === 0 ? (
            <div className="space-y-4 animate-fade-in">
              <ComponentLoader
                title="Loading fulfillment queue…"
                subtitle="Fetching ongoing dispensary orders, dispatch assignments, and prescription checks."
                variant="spinner"
              />
              <TableSkeleton rows={6} columns={5} />
            </div>
          ) : (
            <>
              <AdminFulfillmentKanban orders={orders} onRefresh={loadAllOrders} dateRange={dashboardRange} />
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
              <div className="order-financial-grid">
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
        <div className="admin-screen admin-screen--requests"><AdminMedicineRequestsTab initialData={dashboardPeriod === 'all' ? initialMedicineRequests : null} dateRange={dashboardRange} onPendingCountRefresh={loadPendingMedicineRequestCount} /></div>
      )}

      {adminTab === 'riders' && canManageRiders && (
        <div className="admin-screen admin-screen--riders"><RiderFleetView /></div>
      )}

      {adminTab === 'offerZone' && canViewPromotions && (
        <div className="admin-screen admin-screen--offer-zone"><AdminOfferZoneManager /></div>
      )}

      {adminTab === 'payments' && canViewPayments && (
        <div className="admin-screen admin-screen--payments"><AdminPaymentReminders canManage={canManagePayments} /></div>
      )}

      {adminTab === 'medicineCatalogue' && canImportMedicineMaster && (
        <div className="admin-screen admin-screen--medicine-catalogue"><MedicineMasterCatalogueView onOpenImport={() => setCatalogueImportOpen(true)} /></div>
      )}

      {adminTab === 'inventory' && canViewInventory && (
        <div className="admin-screen admin-screen--inventory"><AdminInventoryTable
          onOpenBulkImport={() => setAdminBulkImportModalOpen(true)}
          canManage={canAccessOperations || isSuperAdmin || hasPermission('inventory.write') || hasPermission('*')}
          canImport={canImportInventory}
        /></div>
      )}

      {adminTab === 'routes' && canManageRoutes && (
        <div className="admin-screen admin-screen--routes"><AdminRouteOptimizer onRefresh={loadAllOrders} /></div>
      )}

      {adminTab === 'audits' && canViewAudits && (
        <div className="admin-screen admin-screen--audits space-y-5">
          {isSuperAdmin && <TenantActivityFeed />}
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
            <div className="hidden md:block overflow-x-auto">
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
            <div className="md:hidden space-y-3">
              {auditLogs.map((log, idx) => (
                <article key={log._id || log.id || `${log.importId || 'audit'}-${idx}`} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm space-y-3">
                  <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-xs font-extrabold text-slate-900">{log.name || 'Inventory event'}</p><p className="text-[10px] font-mono text-slate-500 break-all">{log.sku || '—'}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${log.eventType === 'DELIVERY' ? 'bg-rose-100 text-rose-800' : 'bg-blue-100 text-blue-800'}`}>{log.eventType === 'DELIVERY' ? 'Delivery' : 'Bulk import'}</span></div>
                  <dl className="grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-slate-50 p-2"><dt className="text-[10px] text-slate-500">Date & time</dt><dd className="font-semibold text-slate-800">{log.timestamp ? new Date(log.timestamp).toLocaleString() : '—'}</dd></div><div className="rounded-lg bg-slate-50 p-2"><dt className="text-[10px] text-slate-500">Reference</dt><dd className="font-mono text-[10px] text-slate-700 break-all">{log.importId || '—'}</dd></div><div className="rounded-lg bg-slate-50 p-2"><dt className="text-[10px] text-slate-500">Stock change</dt><dd className="font-bold text-slate-900">{log.eventType === 'DELIVERY' ? `−${log.quantity} delivered` : `${log.previousStock ?? '—'} → ${log.newStock ?? '—'}`}</dd></div><div className="rounded-lg bg-slate-50 p-2"><dt className="text-[10px] text-slate-500">Price change</dt><dd className="font-bold text-slate-900">{log.eventType === 'DELIVERY' ? `₹${log.newPrice ?? '—'} / unit` : `₹${log.previousPrice ?? '—'} → ₹${log.newPrice ?? '—'}`}</dd></div></dl>
                  <p className="text-[10px] text-slate-500 break-all">Authorized by: <strong className="text-slate-700">{log.adminId || '—'}</strong></p>
                </article>
              ))}
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
        </div>
      )}



      </main>
      <MedicineCatalogueImportModal isOpen={catalogueImportOpen} onClose={() => setCatalogueImportOpen(false)} />
    </div>
  );
}
