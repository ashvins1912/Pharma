import React, { useState, useEffect } from 'react';
import { getReadableErrorMessage } from '../../utils/errorMessage';
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
import ContextualHelpBanner from '../common/ContextualHelpBanner';
import PlatformAccessControl from './PlatformAccessControl';
import LiveTelemetryTab from './LiveTelemetryTab';
import RoleFeatureMatrixTab from './RoleFeatureMatrixTab';
import AutomationTestCenterTab from './AutomationTestCenterTab';
import FeatureHealthDashboard from './FeatureHealthDashboard';
import DatabaseCleanupTask from './DatabaseCleanupTask';
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

  return (
    <aside className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-950 shadow-sm" aria-live="polite">
      <h3 className="text-sm font-black">
        {count} {t('medicineRequests')}
      </h3>
      <p className="mt-1 text-xs text-rose-800">
        {t('actionRequired')}
      </p>
      <button
        type="button"
        onClick={onOpen}
        className="mt-3 text-xs font-extrabold text-rose-800 underline underline-offset-2 hover:text-rose-950"
      >
        {t('medicineRequests')} →
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
  const [workspaceSearch, setWorkspaceSearch] = useState('');
  const [commandClock, setCommandClock] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setCommandClock(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);
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
    if (adminTab !== 'tenantProfile' || canViewTenants) return;
    if (canViewFulfillment) setAdminTab('fulfillment');
    else if (canViewAdminRequests) setAdminTab('requests');
    else if (canViewInventory) setAdminTab('inventory');
  }, [adminTab, canViewTenants, canViewFulfillment, canViewAdminRequests, canViewInventory]);
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
      setOrdersError(getReadableErrorMessage(err, 'Could not load the order queue.'));
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
      isSuperAdmin && 'featureHealth',
      isSuperAdmin && 'databaseCleanup'
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

  // Open the selected module and move keyboard/screen-reader focus to its workspace.
  // Two animation frames allow React to commit the selected tab before scrolling.
  const openWorkspaceTab = (tab) => {
    setAdminTab(tab);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const workspace = document.getElementById('admin-workspace-content');
        if (!workspace) return;
        workspace.scrollIntoView({ behavior: 'smooth', block: 'start' });
        workspace.focus({ preventScroll: true });
      });
    });
  };

  const renderWorkspaceItem = (tab, label, icon, count = null, tone = 'default') => {
    const active = adminTab === tab;
    return (
      <button
        key={tab}
        type="button"
        onClick={() => openWorkspaceTab(tab)}
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

  const activeTabMeta = {
    fulfillment: { category: t('orders') + ' & ' + t('requests'), title: t('fulfillmentQueue'), icon: '📦' },
    requests: { category: t('orders') + ' & ' + t('requests'), title: t('medicineRequests'), icon: '📋' },
    csquare: { category: t('orders') + ' & ' + t('requests'), title: 'C-Square Integration', icon: '🔗' },
    riders: { category: t('delivery'), title: t('riderFleet'), icon: '🛵' },
    routes: { category: t('delivery'), title: t('smartRoute'), icon: '🗺️' },
    inventory: { category: t('stock'), title: t('inventoryCatalog'), icon: '📊' },
    medicineCatalogue: { category: t('stock'), title: t('medicineList'), icon: '🧬' },
    audits: { category: t('stock'), title: t('inventoryAudits'), icon: '📜' },
    promotions: { category: t('financeAndOffers'), title: t('customerOffers'), icon: '🏷️' },
    surplusSavings: { category: t('financeAndOffers'), title: t('surplusSavings'), icon: '⚡' },
    offerZone: { category: t('financeAndOffers'), title: t('offerZone'), icon: '✨' },
    payments: { category: t('financeAndOffers'), title: t('paymentReminders'), icon: '💳' },
    members: { category: t('peopleAndPharmacy'), title: t('tenantPersonnel'), icon: '👥' },
    tenantProfile: { category: t('peopleAndPharmacy'), title: t('tenantProfileBranches'), icon: '🏢' },
    tenants: { category: t('platformSettings'), title: t('platformTenants'), icon: '🌐' },
    access: { category: t('platformSettings'), title: t('securityAccess'), icon: '🛡️' },
    serviceLogs: { category: t('platformSettings'), title: t('systemActivity'), icon: '🧾' },
    telemetry: { category: t('platformSettings'), title: t('liveTelemetry'), icon: '📡' },
    matrix: { category: t('platformSettings'), title: t('roleFeatureMatrix'), icon: '📐' },
    automation: { category: t('platformSettings'), title: t('systemChecks'), icon: '🧪' },
    featureHealth: { category: t('platformSettings'), title: t('systemHealth'), icon: '🩺' },
    databaseCleanup: { category: t('platformSettings'), title: 'Database Cleanup', icon: '🧹' }
  }[adminTab] || { category: 'Operations', title: 'Workspace', icon: '⚡' };

  return (
    <div className="dashboard-shell dashboard-shell--command-center min-w-0 space-y-4 animate-fade-in">
      
      {/* Executive Command Header & Metric Highlights */}
      <div className="dashboard-hero bg-slate-950 text-white rounded-3xl p-5 sm:p-6 shadow-xl space-y-5 border border-slate-800">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 border-b border-slate-800/80 pb-4">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
              <span className="text-emerald-400 font-bold uppercase tracking-wider text-[11px]">{t('operationsDashboard')}</span>
              <span aria-hidden="true">·</span>
              <span>Real-Time Dispensary Telemetry</span>
              <span aria-hidden="true">·</span>
              <span className="text-slate-400 font-mono text-[11px]">{commandClock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white flex items-center gap-2.5">
              <span>Dispensary Command Hub</span>
            </h2>
          </div>

          {/* Quick Primary Actions Toolbar */}
          <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto">
            {canAccessOperations && (
              <button
                type="button"
                onClick={() => setAdminNewStockModalOpen(true)}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs px-4 py-2.5 rounded-xl shadow-sm transition cursor-pointer flex items-center gap-2 active:scale-95 shrink-0"
              >
                <span className="text-sm font-bold">+</span>
                <span>{t('addMedicine')}</span>
              </button>
            )}

            {canImportInventory && (
              <button
                type="button"
                onClick={() => setAdminBulkImportModalOpen(true)}
                className="bg-blue-600 hover:bg-blue-500 text-white font-black text-xs px-4 py-2.5 rounded-xl shadow-sm transition cursor-pointer flex items-center gap-2 active:scale-95 shrink-0"
              >
                <span>📥</span>
                <span>{t('bulkExcelIngestion')}</span>
              </button>
            )}

            {canImportMedicineMaster && (
              <button
                type="button"
                onClick={() => { setAdminTab('medicineCatalogue'); document.getElementById('admin-workspace-content')?.scrollIntoView({ behavior: 'smooth' }); }}
                className="rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 px-3.5 py-2.5 text-xs font-bold text-slate-200 transition cursor-pointer flex items-center gap-2 shrink-0"
              >
                <span>🧬</span>
                <span>{t('importMedicineList')}</span>
              </button>
            )}

            {canReadWhatsApp && (canManageWhatsApp ? (
              <button
                type="button"
                onClick={() => setWhatsappModalOpen(true)}
                className={`font-bold text-xs px-3.5 py-2.5 rounded-xl transition cursor-pointer flex items-center gap-2 shadow-xs shrink-0 ${
                  whatsappStatus.isConnected
                    ? 'bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/30'
                    : 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-black animate-pulse'
                }`}
                title={t('whatsappStatus')}
              >
                <span>📲</span>
                <span>{whatsappStatus.isConnected ? t('whatsappConnected') : t('whatsappOfflineStatus')}</span>
              </button>
            ) : (
              <span className="rounded-xl bg-slate-800 px-3.5 py-2.5 text-xs font-bold text-slate-300 border border-slate-700">
                {whatsappStatus.isConnected ? t('whatsappConnected') : t('whatsappOfflineStatus')}
              </span>
            ))}

            {isSuperAdmin && (
              <button
                type="button"
                onClick={() => {
                  setAdminTab('automation');
                  document.getElementById('admin-workspace-content')?.scrollIntoView({ behavior: 'smooth' });
                }}
                className="bg-purple-900/80 hover:bg-purple-800 text-purple-200 border border-purple-700/50 font-bold text-xs px-3.5 py-2.5 rounded-xl transition cursor-pointer flex items-center gap-1.5 shrink-0"
              >
                <span>🧪</span>
                <span>Test Suite</span>
              </button>
            )}
          </div>
        </div>

        {/* 4 Executive KPI Metric Cards */}
        <div className="dashboard-metrics grid grid-cols-2 lg:grid-cols-4 gap-3.5">
          {canViewFulfillment && (
            <div className="bg-slate-900/90 dark:bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-sm hover:border-slate-700 transition space-y-1.5">
              <div className="flex items-center justify-between text-slate-400 text-[11px] font-bold uppercase tracking-wider">
                <span>Orders Queue</span>
                <span className="text-indigo-400">📦 Total</span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-3xl font-black text-white font-mono tabular-nums">{totalOrders}</span>
                <span className="text-xs font-extrabold text-amber-400 bg-amber-950/60 border border-amber-800/50 px-2 py-0.5 rounded-md">
                  {activeCount} active
                </span>
              </div>
              <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden flex">
                <div style={{ width: `${totalOrders ? Math.min(100, Math.round((deliveredCount / totalOrders) * 100)) : 0}%` }} className="bg-emerald-500 h-full transition-all" />
                <div style={{ width: `${totalOrders ? Math.min(100, Math.round((activeCount / totalOrders) * 100)) : 0}%` }} className="bg-amber-500 h-full transition-all" />
              </div>
              <p className="text-[11px] text-slate-400 font-medium pt-0.5 flex justify-between">
                <span>{deliveredCount} delivered</span>
                <span className="text-slate-500 font-mono">{totalOrders ? Math.round((deliveredCount / totalOrders) * 100) : 0}% success</span>
              </p>
            </div>
          )}

          {hasPermission('inventory.read') && (
            <div className="bg-slate-900/90 dark:bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-sm hover:border-slate-700 transition space-y-1.5">
              <div className="flex items-center justify-between text-slate-400 text-[11px] font-bold uppercase tracking-wider">
                <span>Low Stock Alerts</span>
                <span className="text-yellow-400">⚠️ Threshold</span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-3xl font-black text-yellow-400 font-mono tabular-nums">{inventoryAlerts.lowStockCount || 0}</span>
                <span className="text-xs font-extrabold text-yellow-300 bg-yellow-950/60 border border-yellow-800/50 px-2 py-0.5 rounded-md">
                  ≤ 3 units
                </span>
              </div>
              <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                <div style={{ width: `${Math.min(100, (inventoryAlerts.lowStockCount || 0) * 15)}%` }} className="bg-yellow-500 h-full transition-all" />
              </div>
              <p className="text-[11px] text-slate-400 font-medium pt-0.5 flex justify-between">
                <span>Reorder threshold alert</span>
                <button type="button" onClick={() => openWorkspaceTab('inventory')} className="text-yellow-400 hover:underline">View catalog →</button>
              </p>
            </div>
          )}

          {hasPermission('inventory.read') && (
            <div className="bg-slate-900/90 dark:bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-sm hover:border-slate-700 transition space-y-1.5">
              <div className="flex items-center justify-between text-slate-400 text-[11px] font-bold uppercase tracking-wider">
                <span>Expiring Stock</span>
                <span className="text-rose-400">⏳ ≤30 Days</span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-3xl font-black text-amber-400 font-mono tabular-nums">{inventoryAlerts.expiringSoonCount || 0}</span>
                {Boolean(inventoryAlerts.expiredCount) && (
                  <span className="text-xs font-extrabold text-rose-400 bg-rose-950/60 border border-rose-800/50 px-2 py-0.5 rounded-md">
                    {inventoryAlerts.expiredCount} expired
                  </span>
                )}
              </div>
              <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                <div style={{ width: `${Math.min(100, (inventoryAlerts.expiringSoonCount || 0) * 10)}%` }} className="bg-amber-500 h-full transition-all" />
              </div>
              <p className="text-[11px] text-slate-400 font-medium pt-0.5 flex justify-between">
                <span>Audit & surplus clearance</span>
                <button type="button" onClick={() => openWorkspaceTab('surplusSavings')} className="text-amber-400 hover:underline">Surplus deal →</button>
              </p>
            </div>
          )}

          {canViewFulfillment && (
            <div className="bg-slate-900/90 dark:bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-sm hover:border-slate-700 transition space-y-1.5">
              <div className="flex items-center justify-between text-slate-400 text-[11px] font-bold uppercase tracking-wider">
                <span>Gross Queue Value</span>
                <span className="text-emerald-400">₹ Revenue</span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-3xl font-black text-emerald-400 font-mono tabular-nums">₹{totalRevenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                <span className="text-xs font-extrabold text-emerald-300 bg-emerald-950/60 border border-emerald-800/50 px-2 py-0.5 rounded-md">
                  {dashboardPeriod}
                </span>
              </div>
              <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                <div className="bg-emerald-500 h-full w-3/4 transition-all" />
              </div>
              <p className="text-[11px] text-slate-400 font-medium pt-0.5 flex justify-between">
                <span>Avg: ₹{(totalOrders ? Math.round(totalRevenue / totalOrders) : 0).toLocaleString('en-IN')} / order</span>
                <span className="text-slate-400 font-mono">Live</span>
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Operations Contextual Help Guidance Banner */}
      <ContextualHelpBanner topic="admin" className="mt-2" />

      {/* WhatsApp Disconnection Warning Banner */}
      {!whatsappStatus.isConnected && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800/70 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-amber-950 dark:text-amber-200 shadow-xs animate-fade-in">
          <div className="flex items-start sm:items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-amber-200 dark:bg-amber-900/80 text-amber-950 dark:text-amber-200 flex items-center justify-center text-lg flex-shrink-0 font-bold">
              📲
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="font-extrabold text-xs sm:text-sm text-amber-950 dark:text-amber-100 tracking-tight">
                {t('missDeliveryUpdatesTitle')}
              </h4>
              <p className="text-xs text-amber-900 dark:text-amber-300 mt-0.5 leading-snug">
                {t('whatsappDisconnectedDesc')}
              </p>
            </div>
          </div>
          {canManageWhatsApp && (
            <button
              type="button"
              onClick={() => setWhatsappModalOpen(true)}
              className="bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-xs px-4 py-2.5 rounded-xl transition cursor-pointer flex items-center gap-2 flex-shrink-0 shadow-xs"
            >
              <span>{t('linkWhatsAppQr')}</span>
            </button>
          )}
        </div>
      )}

      {/* Command Center Workspace Toolbar */}
      <section className="dashboard-workspace dashboard-workspace--command-center space-y-4" aria-labelledby="operations-workspace-title">
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xs">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">{t('operationsDashboard')}</span>
            <h3 id="operations-workspace-title" className="text-lg font-black text-slate-900 dark:text-white">{t('dispensaryCommandCenter')}</h3>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {(canViewFulfillment || canViewAdminRequests) && (
              <div className="flex items-center gap-2">
                <label htmlFor="operations-date-range" className="text-xs font-bold text-slate-600 dark:text-slate-400 shrink-0">Period:</label>
                <select
                  id="operations-date-range"
                  value={dashboardPeriod}
                  onChange={event => { setDashboardPeriod(event.target.value); setActiveOrdersPage(1); }}
                  className="rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-extrabold text-slate-900 dark:text-slate-100 cursor-pointer"
                >
                  {DASHBOARD_PERIODS.map(period => <option key={period.value} value={period.value}>{period.label}</option>)}
                </select>
              </div>
            )}
          </div>
        </header>

        {/* Toolbar Search & Signal Badges */}
        <div className="dashboard-command-toolbar flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-100 dark:bg-slate-900/60 p-2.5 rounded-2xl border border-slate-200 dark:border-slate-800">
          <label className="dashboard-command-search relative flex-1 flex items-center" htmlFor="command-workspace-search">
            <span className="absolute left-3 text-slate-400 text-sm" aria-hidden="true">🔍</span>
            <input
              id="command-workspace-search"
              type="search"
              value={workspaceSearch}
              onChange={event => setWorkspaceSearch(event.target.value)}
              placeholder={`${t('searchSections')} (e.g. Orders, Inventory, Riders)...`}
              autoComplete="off"
              className="w-full pl-9 pr-8 py-2 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
            {workspaceSearch && (
              <button
                type="button"
                onClick={() => setWorkspaceSearch('')}
                className="absolute right-2.5 text-slate-400 hover:text-slate-600 text-xs p-1"
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </label>

          <div className="dashboard-command-signals flex flex-wrap items-center gap-1.5" aria-label={t('needsAttention')}>
            {canViewAdminRequests && (
              <button
                type="button"
                onClick={() => openWorkspaceTab('requests')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  pendingMedicineRequestCount > 0
                    ? 'bg-rose-100 dark:bg-rose-950/80 text-rose-800 dark:text-rose-200 border border-rose-300 dark:border-rose-800'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                }`}
              >
                <span>📋</span>
                <span>{t('requests')}</span>
                <strong className="font-mono tabular-nums bg-slate-200/80 dark:bg-slate-700 px-1.5 py-0.5 rounded text-[11px]">{pendingMedicineRequestCount}</strong>
              </button>
            )}

            {hasPermission('inventory.read') && (
              <button
                type="button"
                onClick={() => openWorkspaceTab('inventory')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  (inventoryAlerts.lowStockCount || 0) > 0
                    ? 'bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-800'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                }`}
              >
                <span>⚠️</span>
                <span>{t('lowStockLabel')}</span>
                <strong className="font-mono tabular-nums bg-slate-200/80 dark:bg-slate-700 px-1.5 py-0.5 rounded text-[11px]">{inventoryAlerts.lowStockCount || 0}</strong>
              </button>
            )}

            {canViewFulfillment && (
              <button
                type="button"
                onClick={() => openWorkspaceTab('fulfillment')}
                className="px-3 py-1.5 rounded-xl text-xs font-bold bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition flex items-center gap-1.5 cursor-pointer"
              >
                <span>📦</span>
                <span>{t('activeOrders')}</span>
                <strong className="font-mono tabular-nums bg-slate-200/80 dark:bg-slate-700 px-1.5 py-0.5 rounded text-[11px]">{activeCount}</strong>
              </button>
            )}
          </div>
        </div>

        {/* Grouped Workspace Navigation Grid */}
        <nav className="dashboard-workspace-nav dashboard-workspace-nav--dense" aria-label={t('operationsDashboard')}>
          {[
            {
              id: 'orders',
              title: `${t('orders')} & ${t('requests')}`,
              items: [
                canViewFulfillment && { tab: 'fulfillment', label: t('fulfillmentQueue'), icon: '📦', count: orders.length },
                canViewAdminRequests && { tab: 'requests', label: t('medicineRequests'), icon: '📋', count: pendingMedicineRequestCount, tone: 'attention' },
                canViewCSquare && { tab: 'csquare', label: 'C-Square', icon: '🔗' }
              ]
            },
            {
              id: 'delivery',
              title: t('delivery'),
              items: [
                canManageRiders && { tab: 'riders', label: t('riderFleet'), icon: '🛵' },
                canManageRoutes && { tab: 'routes', label: t('smartRoute'), icon: '🗺️' }
              ]
            },
            {
              id: 'inventory',
              title: t('stock'),
              items: [
                canViewInventory && { tab: 'inventory', label: t('inventoryCatalog'), icon: '📊' },
                canImportMedicineMaster && { tab: 'medicineCatalogue', label: t('medicineList'), icon: '🧬', tone: 'governance' },
                canViewAudits && { tab: 'audits', label: t('inventoryAudits'), icon: '📜' }
              ]
            },
            {
              id: 'growth',
              title: t('financeAndOffers'),
              items: [
                canViewPromotions && { tab: 'promotions', label: t('customerOffers'), icon: '🏷️' },
                canViewSurplusSavings && { tab: 'surplusSavings', label: t('surplusSavings'), icon: '⚡' },
                canViewPromotions && { tab: 'offerZone', label: t('offerZone'), icon: '✨' },
                canViewPayments && { tab: 'payments', label: t('paymentReminders'), icon: '💳' }
              ]
            },
            {
              id: 'workspace',
              title: t('peopleAndPharmacy'),
              items: [
                canManageMembers && { tab: 'members', label: t('tenantPersonnel'), icon: '👥' },
                !isSuperAdmin && { tab: 'tenantProfile', label: t('tenantProfileBranches'), icon: '🏢' }
              ]
            },
            {
              id: 'governance',
              title: t('platformSettings'),
              items: [
                canViewTenants && { tab: 'tenants', label: t('platformTenants'), icon: '🌐', tone: 'governance' },
                canManagePlatformAccess && { tab: 'access', label: t('securityAccess'), icon: '🛡️', tone: 'governance' },
                isSuperAdmin && { tab: 'serviceLogs', label: t('systemActivity'), icon: '🧾', tone: 'governance' },
                isSuperAdmin && { tab: 'telemetry', label: t('liveTelemetry'), icon: '📡', tone: 'governance' },
                isSuperAdmin && { tab: 'matrix', label: t('roleFeatureMatrix'), icon: '📐', tone: 'governance' },
                isSuperAdmin && { tab: 'automation', label: t('systemChecks'), icon: '🧪', tone: 'governance' },
                isSuperAdmin && { tab: 'featureHealth', label: t('systemHealth'), icon: '🩺', tone: 'governance' },
                isSuperAdmin && { tab: 'databaseCleanup', label: 'Database Cleanup', icon: '🧹', tone: 'governance' }
              ]
            }
          ].map(group => {
            const query = workspaceSearch.trim().toLocaleLowerCase();
            const items = group.items.filter(Boolean).filter(item => !query || `${item.label} ${group.title}`.toLocaleLowerCase().includes(query));
            if (!items.length) return null;
            return (
              <section key={group.id} className={`dashboard-nav-group dashboard-nav-group--${group.id}`} aria-label={group.title}>
                <div className="dashboard-nav-group-heading">
                  <h4 className="dashboard-nav-group-title">{group.title}</h4>
                </div>
                <div className="dashboard-nav-group-items">
                  {items.map(item => item.externalUrl ? (
                    <a
                      key={item.tab}
                      href={item.externalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="dashboard-nav-item dashboard-nav-item--external"
                      aria-label={`Open ${item.label} in a new tab`}
                    >
                      <span className="dashboard-nav-item-icon" aria-hidden="true">{item.icon}</span>
                      <span className="dashboard-nav-item-label">{item.label}</span>
                      <span className="dashboard-nav-item-chevron" aria-hidden="true">↗</span>
                    </a>
                  ) : renderWorkspaceItem(item.tab, item.label, item.icon, item.count === 0 && item.tone === 'attention' ? null : item.count, item.tone || 'default'))}
                </div>
              </section>
            );
          })}
        </nav>
      </section>

      {/* Main Workspace Display Header & Canvas */}
      <main className="dashboard-content" id="admin-workspace-content" tabIndex="-1">
        {/* Workspace Breadcrumb Header */}
        <header className="flex items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-5 py-3.5 shadow-xs">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>Operations</span>
            <span aria-hidden="true">/</span>
            <span className="font-semibold text-slate-700 dark:text-slate-300">{activeTabMeta.category}</span>
            <span aria-hidden="true">/</span>
            <span className="font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
              <span>{activeTabMeta.icon}</span>
              <span>{activeTabMeta.title}</span>
            </span>
          </div>
          
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="text-[11px] font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 flex items-center gap-1"
          >
            <span>↑ Top</span>
          </button>
        </header>

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
      {adminTab === 'databaseCleanup' && isSuperAdmin && (
        <div className="admin-screen admin-screen--database-cleanup"><DatabaseCleanupTask /></div>
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
              title={t('ordersCouldNotLoad')}
              message={ordersError}
              onRetry={loadAllOrders}
            />
          )}
          {loadingOrders && orders.length === 0 ? (
            <div className="space-y-4 animate-fade-in">
              <ComponentLoader
                title={t('loadingOrdersForReview')}
                
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
            <div className="audit-responsive-layout">
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
            <div className="md:hidden qm-mobile-record-list">
              {auditLogs.map((log, idx) => (
                <article key={log._id || log.id || `${log.importId || 'audit'}-${idx}`} className="qm-mobile-record-card qm-mobile-audit-card">
                  <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-xs font-extrabold text-slate-900">{log.name || 'Inventory event'}</p><p className="text-[10px] font-mono text-slate-500 break-all">{log.sku || '—'}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${log.eventType === 'DELIVERY' ? 'bg-rose-100 text-rose-800' : 'bg-blue-100 text-blue-800'}`}>{log.eventType === 'DELIVERY' ? 'Delivery' : 'Bulk import'}</span></div>
                  <dl className="grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-slate-50 p-2"><dt className="text-[10px] text-slate-500">Date & time</dt><dd className="font-semibold text-slate-800">{log.timestamp ? new Date(log.timestamp).toLocaleString() : '—'}</dd></div><div className="rounded-lg bg-slate-50 p-2"><dt className="text-[10px] text-slate-500">Reference</dt><dd className="font-mono text-[10px] text-slate-700 break-all">{log.importId || '—'}</dd></div><div className="rounded-lg bg-slate-50 p-2"><dt className="text-[10px] text-slate-500">Stock change</dt><dd className="font-bold text-slate-900">{log.eventType === 'DELIVERY' ? `−${log.quantity} delivered` : `${log.previousStock ?? '—'} → ${log.newStock ?? '—'}`}</dd></div><div className="rounded-lg bg-slate-50 p-2"><dt className="text-[10px] text-slate-500">Price change</dt><dd className="font-bold text-slate-900">{log.eventType === 'DELIVERY' ? `₹${log.newPrice ?? '—'} / unit` : `₹${log.previousPrice ?? '—'} → ₹${log.newPrice ?? '—'}`}</dd></div></dl>
                  <p className="text-[10px] text-slate-500 break-all">Authorized by: <strong className="text-slate-700">{log.adminId || '—'}</strong></p>
                </article>
              ))}
            </div>
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
