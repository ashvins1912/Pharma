import React, { useState, useEffect, useRef } from 'react';
import ModalAccessibilityManager from './components/ModalAccessibilityManager';
import './styles/responsive-guardrails.css';
import { useAuth } from './context/AuthContext';
import { useToast } from './context/ToastContext';
import { useApp } from './context/AppContext';
import { useTenant } from './context/TenantContext';

import Header from './components/Header';
import Footer from './components/Footer';
import SearchFilter from './components/SearchFilter';
import ProductGrid from './components/ProductGrid';
import CartDrawer from './components/CartDrawer';
import CheckoutModal from './components/CheckoutModal';
import OrderConfirmation from './components/OrderConfirmation';
import OrderTrackingModal from './components/OrderTrackingModal';
import OrderRatingPrompt from './components/OrderRatingPrompt';
import OrderHistoryView from './components/OrderHistoryView';
import AddressManager from './components/AddressManager';
import AuthModal from './components/AuthModal';
import UserProfileModal from './components/UserProfileModal';
import ApplicationGuideModal from './components/common/ApplicationGuideModal';
import InteractiveProductTour from './components/common/InteractiveProductTour';
import ContextualHelpBanner from './components/common/ContextualHelpBanner';
const AdminDashboardView = React.lazy(() => import('./components/admin/AdminDashboardView'));
import WhatsAppConnectModal from './components/admin/WhatsAppConnectModal';
import AdminNewStockModal from './components/admin/AdminNewStockModal';
import AdminBulkImportModal from './components/admin/AdminBulkImportModal';
import CustomerRequestsView from './components/requests/CustomerRequestsView';
import MedicineRequestModal from './components/requests/MedicineRequestModal';
import CustomerProposalModal from './components/requests/CustomerProposalModal';
import VerifyEmailView from './components/auth/VerifyEmailView';
import VendorOnboardingView from './components/auth/VendorOnboardingView';
import TenantSelectorModal from './components/auth/TenantSelectorModal';
import OfferZoneBanner from './components/OfferZoneBanner';
import SpendingAnalyticsWidget from './components/SpendingAnalyticsWidget';
import QuickActionsFAB from './components/QuickActionsFAB';
import { useLanguage } from './context/LanguageContext';

function AuthTransitionScreen({ initialLoad = false }) {
  const { t } = useLanguage();
  return (
    <div
      className="fixed inset-0 z-[10000] flex min-h-screen items-center justify-center bg-slate-50 px-6"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex w-full max-w-sm flex-col items-center rounded-3xl border border-slate-200 bg-white px-8 py-10 text-center shadow-xl shadow-slate-900/5">
        <img src="/favicon.svg" alt="" className="mb-5 h-14 w-14 rounded-2xl object-contain shadow-lg shadow-blue-600/20" />
        <span className="mb-4 h-7 w-7 animate-spin rounded-full border-4 border-blue-100 border-t-blue-600" aria-hidden="true" />
        <h2 className="text-lg font-black tracking-tight text-slate-900">
          {initialLoad ? t('checkingSession') : t('loadingYourDashboard')}
        </h2>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          {initialLoad ? t('secureRestore') : t('preparingDashboard')}
        </p>
      </div>
    </div>
  );
}

function MainApp() {
  const {
    user, isSuperAdmin, canAccessOperations, hasPermission,
    passwordRecoveryRequired, isFullyAuthenticated, loading: authLoading, authTransitionLoading
  } = useAuth();
  const {
    cart,
    orders,
    medicineRequests,
    addresses,
    activeTrackingOrder,
    setActiveTrackingOrder,
    whatsappModalOpen,
    setWhatsappModalOpen,
    whatsappStatus,
    loadWhatsAppStatus,
    requestModalOpen,
    closeRequestModal,
    requestAuthPending,
    cancelRequestAuthentication,
    resumeRequestAfterAuthentication,
    activeProposalRequest,
    setActiveProposalRequest,
    openProposalModal,
    fetchMedicines,
    adminNewStockModalOpen,
    setAdminNewStockModalOpen,
    adminBulkImportModalOpen,
    setAdminBulkImportModalOpen
  } = useApp();
  const { addToast } = useToast();
  const { activeTenant, tenantId } = useTenant();
  const { t, language, setLanguage } = useLanguage();

  // Last-resort storefront release: auth bootstrap is allowed to fail closed,
  // but it must never keep the entire public application behind a spinner.
  // AuthContext normally resolves this in 3 seconds; this independent UI guard
  // also protects against a stale/failed bootstrap implementation in a deploy.
  const [authBootstrapFailsafeElapsed, setAuthBootstrapFailsafeElapsed] = useState(false);
  useEffect(() => {
    if (!authLoading) {
      setAuthBootstrapFailsafeElapsed(false);
      return undefined;
    }
    const failsafeId = window.setTimeout(() => {
      console.error('[Auth] Bootstrap exceeded the UI loading limit; releasing the storefront.');
      setAuthBootstrapFailsafeElapsed(true);
    }, 4500);
    return () => window.clearTimeout(failsafeId);
  }, [authLoading]);

  useEffect(() => {
    const preferredLanguage = user?.preferredLanguage;
    if (['en', 'hi', 'kn', 'bn', 'te'].includes(preferredLanguage) && preferredLanguage !== language) {
      setLanguage(preferredLanguage);
    }
    // Apply the account preference when the account/profile preference changes,
    // not on every local language change. This prevents stale profile data
    // from immediately reverting a user's manual language selection.
  }, [user?.id, user?.preferredLanguage, setLanguage]);

  // Tab State: 'store' | 'orders' | 'requests' | 'addresses' | 'admin'
  const [activeTab, setActiveTab] = useState('store');

  // Modal Dialog States
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [appGuideOpen, setAppGuideOpen] = useState(false);
  const [productTourOpen, setProductTourOpen] = useState(false);
  const [placedOrder, setPlacedOrder] = useState(null);
  const [ratingPromptOrder, setRatingPromptOrder] = useState(null);
  const [dismissedRatingOrderIds, setDismissedRatingOrderIds] = useState([]);
  const [vendorOnboardingToken, setVendorOnboardingToken] = useState(null);
  const [verifyEmailToken, setVerifyEmailToken] = useState(null);
  const [tenantSelectorOpen, setTenantSelectorOpen] = useState(false);
  const [checkoutAfterTenantSelection, setCheckoutAfterTenantSelection] = useState(false);

  // Check URL query parameters for onboarding or verification tokens
  useEffect(() => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const token = urlParams.get('token');
      const preferredTenantId = urlParams.get('tenantId');
      const path = window.location.pathname;
      if (preferredTenantId && !token) setTenantSelectorOpen(true);

      if (token) {
        if (path.includes('vendor') || path.includes('onboarding') || urlParams.get('type') === 'vendor') {
          setVendorOnboardingToken(token);
        } else if (path.includes('verify') || path.includes('activate') || path === '/verify-email' || path === '/activate-account' || urlParams.get('type') === 'verify' || urlParams.get('type') === 'activation') {
          setVerifyEmailToken(token);
        }
      }
    } catch (e) {
      console.warn('URL parsing note:', e);
    }
  }, []);

  useEffect(() => {
    if (passwordRecoveryRequired) setAuthOpen(true);
  }, [passwordRecoveryRequired]);

  useEffect(() => {
    if (!tenantId && typeof window !== 'undefined'
      && localStorage.getItem('pharma_location_prompted_v1') !== 'true') {
      setTenantSelectorOpen(true);
    }
  }, [tenantId]);

  // Restore the selected dispensary's display details when only its ID survived
  // a previous session (for example, after local storage was partially cleared).
  useEffect(() => {
    const displayedTenantId = activeTenant?._id || activeTenant?.id || null;
    if (tenantId && String(displayedTenantId || '') !== String(tenantId)) {
      setTenantSelectorOpen(true);
    }
  }, [tenantId, activeTenant]);

  // Navigation is permission-first. Staff workspace capabilities are separate
  // from customer self-service permissions, even when they share a domain.
  const handleTabSwitch = (tab) => {
    if (['orders', 'addresses', 'requests'].includes(tab) && !user) {
      addToast(`Please sign in to access ${tab === 'orders' ? 'your order history and live tracking' : tab === 'requests' ? 'your medicine requests' : 'your address directory'}.`, 'info');
      setAuthOpen(true);
      return;
    }

    if (tab === 'orders') {
      if (!hasPermission('orders.read')) {
        addToast('Your account does not have permission to view orders.', 'warning');
        return;
      }
      if (canAccessOperations && !isSuperAdmin) {
        addToast('Order operations are available in your operations dashboard.', 'info');
        setActiveTab('admin');
        return;
      }
    }

    if (tab === 'requests') {
      if (!hasPermission('medicine_requests.read')) {
        addToast('Your account does not have permission to view medicine requests.', 'warning');
        return;
      }
      if (canAccessOperations && !isSuperAdmin) {
        setActiveTab('admin');
        return;
      }
    }

    if (tab === 'addresses') {
      if (!hasPermission('profile.read')) {
        addToast('Your account does not have permission to view saved addresses.', 'warning');
        return;
      }
      if (canAccessOperations && !isSuperAdmin) {
        addToast('This customer address workspace is not enabled for your current account.', 'info');
        return;
      }
    }

    if (tab === 'admin' && !canAccessOperations) {
      addToast(user
        ? 'Your account does not have permission to access operations.'
        : 'Sign in with an authorized staff account to access operations.', 'warning');
      if (!user) setAuthOpen(true);
      return;
    }
    setActiveTab(tab);
  };

  // Reset tab to store if user signs out while on protected screens
  useEffect(() => {
    if (!user && (activeTab === 'orders' || activeTab === 'addresses' || activeTab === 'admin' || activeTab === 'requests')) {
      setActiveTab('store');
    }
    if (!user) {
      setCartOpen(false);
      setCheckoutOpen(false);
      setProfileOpen(false);
      setPlacedOrder(null);
      setRatingPromptOrder(null);
      setDismissedRatingOrderIds([]);
    }
    if (activeTab === 'admin' && !canAccessOperations) setActiveTab('store');
    if (activeTab === 'orders' && (!user || !hasPermission('orders.read') || (canAccessOperations && !isSuperAdmin))) {
      setActiveTab(canAccessOperations && !isSuperAdmin ? 'admin' : 'store');
    }
    if (activeTab === 'requests' && (!user || !hasPermission('medicine_requests.read') || (canAccessOperations && !isSuperAdmin))) {
      setActiveTab(canAccessOperations && !isSuperAdmin ? 'admin' : 'store');
    }
    if (activeTab === 'addresses' && (!user || !hasPermission('profile.read') || (canAccessOperations && !isSuperAdmin))) {
      setActiveTab('store');
    }
    if (!user && activeTrackingOrder) {
      setActiveTrackingOrder(null);
    }
  }, [user, canAccessOperations, isSuperAdmin, hasPermission, activeTab, activeTrackingOrder, setActiveTrackingOrder]);

  useEffect(() => {
    const requireLogin = () => setAuthOpen(true);
    window.addEventListener('ashvin:authentication-required', requireLogin);
    window.addEventListener('ashvin:logout-complete', requireLogin);
    return () => {
      window.removeEventListener('ashvin:authentication-required', requireLogin);
      window.removeEventListener('ashvin:logout-complete', requireLogin);
    };
  }, []);

  // Guarantee scroll restoration and inert cleanup after login/auth transitions when no modal is open
  useEffect(() => {
    const activeDialogs = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"], [aria-modal="true"]'))
      .filter((el) => el.isConnected && window.getComputedStyle(el).display !== 'none' && window.getComputedStyle(el).visibility !== 'hidden');
    if (activeDialogs.length === 0) {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
      document.body.style.paddingRight = '';
      document.documentElement.classList.remove('modal-open');
      document.body.classList.remove('modal-open');
      const root = document.getElementById('root');
      if (root) {
        root.inert = false;
        root.removeAttribute('inert');
        root.removeAttribute('aria-hidden');
      }
    }
  }, [user, authOpen, authLoading, authTransitionLoading]);

  useEffect(() => {
    if (!user) {
      if (ratingPromptOrder) setRatingPromptOrder(null);
      setDismissedRatingOrderIds((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    if (ratingPromptOrder) return;
    const pendingOrder = Array.isArray(orders) && orders.find((order) =>
      order.ratingPromptPending
      && !order.customerRating
      && !dismissedRatingOrderIds.includes(String(order._id))
    );
    if (pendingOrder) setRatingPromptOrder(pendingOrder);
  }, [user, orders, ratingPromptOrder, dismissedRatingOrderIds]);

  // Admin WhatsApp Verification Flow:
  // When an admin logs in and WhatsApp is not connected, automatically show the pairing QR popup
  const adminCheckedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    if (isFullyAuthenticated && hasPermission('whatsapp.read')) {
      // Check if user/admin selected later or not required
      const pref = typeof window !== 'undefined' ? localStorage.getItem('whatsapp_status_preference') : null;
      if (pref === 'not_required') {
        return;
      }
      if (pref === 'later') {
        const time = Number(localStorage.getItem('whatsapp_status_preference_time') || 0);
        if (Date.now() - time < 24 * 60 * 60 * 1000) {
          return;
        }
      }

      if (!adminCheckedRef.current) {
        adminCheckedRef.current = true;
        loadWhatsAppStatus().then((status) => {
          if (!cancelled && status && !status.isConnected && hasPermission('whatsapp.manage')) {
            setWhatsappModalOpen(true);
          }
        });
      }
    } else {
      adminCheckedRef.current = false;
      setWhatsappModalOpen(false);
    }
    return () => {
      cancelled = true;
    };
  }, [isFullyAuthenticated, hasPermission, loadWhatsAppStatus, setWhatsappModalOpen]);

  useEffect(() => {
    if (passwordRecoveryRequired) setAuthOpen(true);
  }, [passwordRecoveryRequired]);

  React.useEffect(() => {
    if (!requestAuthPending) return;
    if (user) {
      resumeRequestAfterAuthentication();
    } else {
      setAuthOpen(true);
    }
  }, [requestAuthPending, user, resumeRequestAfterAuthentication]);

  const handleAuthModalClose = ({ authenticated = false } = {}) => {
    setAuthOpen(false);
    if (!authenticated) cancelRequestAuthentication();
  };

  const displayName = String(
    user?.user_metadata?.first_name
      || user?.user_metadata?.firstName
      || user?.user_metadata?.name
      || user?.name
      || user?.email?.split('@')[0]
      || "Friend"
  ).trim().split(/\s+/)[0] || "Friend";

  const handleProceedToCheckout = () => {
    if (!user) {
      addToast("Please sign in or use demo access to proceed with delivery checkout.", "info");
      setAuthOpen(true);
      return;
    }
    if (!tenantId) {
      setCheckoutAfterTenantSelection(true);
      setTenantSelectorOpen(true);
      addToast('Choose a pharmacy before checkout. Your order will be sent only to that pharmacy.', 'info');
      return;
    }
    setCheckoutOpen(true);
  };

  const handleOrderPlaced = (order) => {
    setPlacedOrder(order);
    setActiveTab('order-success');
  };

  const handleTrackFromConfirmation = () => {
    setActiveTrackingOrder(placedOrder);
    setPlacedOrder(null);
    setActiveTab('orders');
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [activeTab]);

  // Keep the loader after every hook has been evaluated so React hook order
  // remains stable across authentication state transitions.
  if ((authLoading && !authBootstrapFailsafeElapsed) || authTransitionLoading) {
    return <AuthTransitionScreen initialLoad={authLoading && !authBootstrapFailsafeElapsed} />;
  }

  return (
    <div className="pharma-app-shell pharma-responsive-scope min-h-screen min-h-dvh w-full min-w-0 flex flex-col font-sans antialiased selection:bg-blue-100 selection:text-blue-900 overflow-x-clip">
      
      {/* Responsive Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={handleTabSwitch}
        onOpenCart={() => {
          if (!user) {
            addToast("Please sign in to view your shopping cart.", "info");
            setAuthOpen(true);
            return;
          }
          setCartOpen(true);
        }}
        onOpenAuth={() => setAuthOpen(true)}
        onOpenProfile={() => setProfileOpen(true)}
        onOpenAdminAlerts={() => {
          if (canAccessOperations) setActiveTab('admin');
        }}
        onOpenGuide={() => setAppGuideOpen(true)}
        onStartTour={() => setProductTourOpen(true)}
        onToggleMobileMenu={(isOpen) => {
          if (isOpen) setAuthOpen(false);
        }}
      />

      {/* Main Content Area - Full width layout */}
      <main className="qm-site-container pharma-main-content min-w-0 min-h-0 flex-[1_0_auto] py-4 sm:py-6 overflow-visible">
        
        {/* TAB 1: MEDICINE STORE & CATALOG */}
        {activeTab === 'store' && (
          <div className="pharma-storefront space-y-6">
            
            {/* Contextual Help Guidance Banner */}
            <ContextualHelpBanner topic="storefront" />

            {/* Executive Customer Dashboard & Storefront Hero Banner */}
            <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 rounded-2xl sm:rounded-3xl p-5 sm:p-7 text-white shadow-xl border border-slate-800 relative overflow-hidden space-y-5">
              <div className="relative z-10 space-y-4">
                {(() => {
                  const istDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
                  const istHours = istDate.getHours();
                  const istGreeting = istHours < 12 ? t('goodMorning') : istHours < 18 ? t('goodAfternoon') : t('goodEvening');
                  const istTimeStr = istDate.toLocaleTimeString('en-IN', {
                    timeZone: 'Asia/Kolkata',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true
                  });
                  const activeOrderCount = (orders || []).filter(o => !['delivered', 'cancelled', 'rejected'].includes(String(o.orderStatus || '').toLowerCase())).length;
                  const activeReqCount = (medicineRequests || []).length;
                  const addressCount = (addresses || []).length;

                  return (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-800/80 pb-3">
                        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-300">
                          <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] sm:text-[11px] font-extrabold px-2.5 py-0.5 rounded-md uppercase tracking-wider">
                            {user ? 'Verified Customer Account' : t('expressDelivery')}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="text-slate-300 flex items-center gap-1 text-[11px]">
                            <span>🏥</span>
                            <span>{activeTenant ? (activeTenant.shopName || activeTenant.name || t('selectedPharmacy')) : 'Select a dispensary to check availability'}</span>
                          </span>
                        </div>
                        <span className="inline-flex items-center gap-1.5 bg-slate-900/90 border border-slate-700/60 text-slate-300 text-[10px] sm:text-[11px] font-bold px-2.5 py-1 rounded-lg">
                          <span>🇮🇳</span>
                          <span className="font-mono">IST: {istTimeStr}</span>
                        </span>
                      </div>

                      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                        <div className="space-y-1">
                          <h1 className="text-xl sm:text-3xl font-black tracking-tight leading-tight m-0 text-white">
                            {istGreeting}, {displayName}!
                          </h1>
                          <p className="text-xs sm:text-sm text-slate-300 font-medium leading-relaxed max-w-2xl">
                            {t('welcomeTo')} <strong className="text-white">{activeTenant?.shopName || activeTenant?.name || 'QuickMeds Rx'}</strong>. {t('welcomeBannerDesc')}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setTenantSelectorOpen(true)}
                            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold rounded-xl transition flex items-center gap-1.5 cursor-pointer shadow-xs shrink-0"
                          >
                            <span>📍 {activeTenant ? 'Change Pharmacy' : 'Select Pharmacy'}</span>
                          </button>
                          {user && (
                            <button
                              type="button"
                              onClick={() => setProfileOpen(true)}
                              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-extrabold rounded-xl transition flex items-center gap-1.5 cursor-pointer shadow-xs shrink-0"
                            >
                              <span>👤 Account & Security</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Logged-In User Quick Telemetry Cards */}
                      {user && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                          <button
                            type="button"
                            onClick={() => setActiveTab('orders')}
                            className="bg-slate-900/90 hover:bg-slate-800/90 border border-slate-800 text-left p-3 rounded-xl transition cursor-pointer space-y-0.5"
                          >
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Active Orders</span>
                            <div className="flex items-baseline justify-between">
                              <span className="text-xl font-black text-emerald-400 font-mono tabular-nums">{activeOrderCount}</span>
                              <span className="text-[10px] font-bold text-slate-400">View →</span>
                            </div>
                          </button>

                          <button
                            type="button"
                            onClick={() => setActiveTab('requests')}
                            className="bg-slate-900/90 hover:bg-slate-800/90 border border-slate-800 text-left p-3 rounded-xl transition cursor-pointer space-y-0.5"
                          >
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Medicine Requests</span>
                            <div className="flex items-baseline justify-between">
                              <span className="text-xl font-black text-amber-400 font-mono tabular-nums">{activeReqCount}</span>
                              <span className="text-[10px] font-bold text-slate-400">Proposals →</span>
                            </div>
                          </button>

                          <button
                            type="button"
                            onClick={() => setActiveTab('addresses')}
                            className="bg-slate-900/90 hover:bg-slate-800/90 border border-slate-800 text-left p-3 rounded-xl transition cursor-pointer space-y-0.5"
                          >
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Saved Addresses</span>
                            <div className="flex items-baseline justify-between">
                              <span className="text-xl font-black text-blue-400 font-mono tabular-nums">{addressCount || 1}</span>
                              <span className="text-[10px] font-bold text-slate-400">Manage →</span>
                            </div>
                          </button>

                          <button
                            type="button"
                            onClick={() => setProfileOpen(true)}
                            className="bg-slate-900/90 hover:bg-slate-800/90 border border-slate-800 text-left p-3 rounded-xl transition cursor-pointer space-y-0.5"
                          >
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Health Account</span>
                            <div className="flex items-baseline justify-between">
                              <span className="text-xs font-black text-purple-300 truncate max-w-[100px]">{user.role || 'Active'}</span>
                              <span className="text-[10px] font-bold text-slate-400">Settings →</span>
                            </div>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Smart Refill & Expiry Offer Zone Banner */}
            <OfferZoneBanner />

            {/* 30-Day Spending & Order Analytics Widget */}
            <SpendingAnalyticsWidget />

            {/* Live Search & Filter Bar */}
            <SearchFilter />

            {/* Main Product Catalog Grid */}
            <ProductGrid />
          </div>
        )}


        {/* TAB 2: ORDER HISTORY & TRACKING (Guarded - Sign in required) */}
        {activeTab === 'orders' && (
          user && hasPermission('orders.read') && (!canAccessOperations || isSuperAdmin) ? (
            <div className="max-w-4xl mx-auto space-y-6">
              <OrderHistoryView
                onTrackOrder={(order) => setActiveTrackingOrder(order)}
              />
            </div>
          ) : (!user ? (
            <div className="max-w-md mx-auto my-12 bg-white border border-slate-200 rounded-3xl p-8 text-center space-y-4 shadow-sm animate-fade-in">
              <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center text-2xl mx-auto">
                🔒
              </div>
              <h3 className="text-base font-extrabold text-slate-900">{t('signInRequired')}</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                You must be signed in to view your prescription order history, delivery receipts, and live courier tracking.
              </p>
              <button
                onClick={() => setAuthOpen(true)}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs py-2.5 rounded-xl transition cursor-pointer shadow-sm"
              >
                Sign In to View Orders
              </button>
            </div>
          ) : (
            <div className="max-w-md mx-auto my-12 bg-white border border-slate-200 rounded-3xl p-8 text-center space-y-3">
              <div className="text-sm font-extrabold text-slate-900">{t('accessRestricted')}</div>
              <p className="text-xs text-slate-500">Your current permissions do not allow access to this customer workspace.</p>
              {canAccessOperations && <button onClick={() => setActiveTab('admin')} className="text-xs font-bold text-blue-700 underline">Open Operations Dashboard</button>}
            </div>
          ))
        )}

        {/* TAB 3: MEDICINE REQUESTS & PHARMACY PROPOSALS (Guarded - Sign in required) */}
        {activeTab === 'requests' && (
          user && hasPermission('medicine_requests.read') && (!canAccessOperations || isSuperAdmin) ? (
            <div className="max-w-4xl mx-auto space-y-6">
              <ContextualHelpBanner topic="requests" />
              <CustomerRequestsView
                onOpenProposal={(req) => openProposalModal(req)}
                onTrackOrder={(order) => {
                  setActiveTrackingOrder(order);
                  setActiveTab('orders');
                }}
              />
            </div>
          ) : (!user ? (
            <div className="max-w-md mx-auto my-12 bg-white border border-slate-200 rounded-3xl p-8 text-center space-y-4 shadow-sm animate-fade-in">
              <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center text-2xl mx-auto">
                🔒
              </div>
              <h3 className="text-base font-extrabold text-slate-900">Sign In Required</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                You must be signed in to view your medicine requests, pharmacist proposals, and approve procurement.
              </p>
              <button
                onClick={() => setAuthOpen(true)}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs py-2.5 rounded-xl transition cursor-pointer shadow-sm"
              >
                Sign In to View Requests
              </button>
            </div>
          ) : (
            <div className="max-w-md mx-auto my-12 bg-white border border-slate-200 rounded-3xl p-8 text-center space-y-3">
              <div className="text-sm font-extrabold text-slate-900">Access restricted</div>
              <p className="text-xs text-slate-500">Your current permissions do not allow access to medicine requests.</p>
              {canAccessOperations && <button onClick={() => setActiveTab('admin')} className="text-xs font-bold text-blue-700 underline">Open Operations Dashboard</button>}
            </div>
          ))
        )}

        {/* TAB 4: MULTI-ADDRESS DIRECTORY (Guarded - Sign in required) */}
        {activeTab === 'addresses' && (
          user && hasPermission('profile.read') && (!canAccessOperations || isSuperAdmin) ? (
            <div className="max-w-3xl mx-auto space-y-6">
              <AddressManager isSelectOnly={false} />
            </div>
          ) : (!user ? (
            <div className="max-w-md mx-auto my-12 bg-white border border-slate-200 rounded-3xl p-8 text-center space-y-4 shadow-sm animate-fade-in">
              <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center text-2xl mx-auto">
                🔒
              </div>
              <h3 className="text-base font-extrabold text-slate-900">Sign In Required</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                You must be signed in to save and manage delivery addresses and GPS drop-off coordinates.
              </p>
              <button
                onClick={() => setAuthOpen(true)}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs py-2.5 rounded-xl transition cursor-pointer shadow-sm"
              >
                Sign In to View Addresses
              </button>
            </div>
          ) : (
            <div className="max-w-md mx-auto my-12 bg-white border border-slate-200 rounded-3xl p-8 text-center space-y-3">
              <div className="text-sm font-extrabold text-slate-900">Access restricted</div>
              <p className="text-xs text-slate-500">Your current permissions do not allow access to saved addresses.</p>
            </div>
          ))
        )}

        {/* TAB 4: ADMIN OPERATIONS DASHBOARD (Guarded) */}
        {activeTab === 'admin' && (
          canAccessOperations && (
            <React.Suspense fallback={<div className="py-12 text-center text-sm text-slate-500">{t('loadingDashboard')}</div>}>
              <AdminDashboardView />
            </React.Suspense>
          )
        )}

        {/* POST-ORDER SUCCESS CONFIRMATION VIEW */}
        {activeTab === 'order-success' && (
          <OrderConfirmation
            order={placedOrder}
            onTrackOrder={handleTrackFromConfirmation}
            onContinueShopping={() => setActiveTab('store')}
          />
        )}

      </main>

      {/* Persistent Pharmacy Footer */}
      <Footer onNavigate={handleTabSwitch} onOpenGuide={() => setAppGuideOpen(true)} />

      {/* Multi-Language Application Guide Modal */}
      <ApplicationGuideModal
        isOpen={appGuideOpen}
        onClose={() => setAppGuideOpen(false)}
      />

      {/* Interactive Guided Product Tour */}
      <InteractiveProductTour
        isOpen={productTourOpen}
        onClose={() => setProductTourOpen(false)}
      />

      {/* Slide-over Cart Drawer */}
      <CartDrawer
        isOpen={cartOpen}
        onClose={() => setCartOpen(false)}
        onProceedToCheckout={handleProceedToCheckout}
        onBrowseMedicines={() => setActiveTab('store')}
      />

      {/* Checkout Modal */}
      <CheckoutModal
        isOpen={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        onOrderPlaced={handleOrderPlaced}
      />

      {/* Order Live Tracking Modal */}
      <OrderTrackingModal
        order={activeTrackingOrder}
        onClose={() => setActiveTrackingOrder(null)}
      />

      <OrderRatingPrompt
        order={ratingPromptOrder}
        onClose={() => {
          const orderId = String(ratingPromptOrder?._id || '');
          if (orderId) setDismissedRatingOrderIds((previous) => previous.includes(orderId) ? previous : [...previous, orderId]);
          setRatingPromptOrder(null);
        }}
        onSubmitted={(orderId) => {
          const resolvedOrderId = String(orderId || ratingPromptOrder?._id || '');
          if (resolvedOrderId) setDismissedRatingOrderIds((previous) => previous.includes(resolvedOrderId) ? previous : [...previous, resolvedOrderId]);
          setRatingPromptOrder(null);
        }}
        onAlreadySubmitted={(orderId) => {
          const resolvedOrderId = String(orderId || ratingPromptOrder?._id || '');
          if (resolvedOrderId) setDismissedRatingOrderIds((previous) => previous.includes(resolvedOrderId) ? previous : [...previous, resolvedOrderId]);
          setRatingPromptOrder(null);
        }}
      />

      {/* Authentication Modal */}
      <AuthModal
        isOpen={authOpen}
        onClose={handleAuthModalClose}
      />

      {/* User Profile Dropdown Modal */}
      <UserProfileModal
        isOpen={profileOpen}
        onClose={() => setProfileOpen(false)}
        onNavigate={handleTabSwitch}
      />

      {/* WhatsApp Delivery Dispatch Gateway Modal */}
      {user && hasPermission('whatsapp.manage') && (
        <WhatsAppConnectModal
          isOpen={whatsappModalOpen}
          onClose={() => setWhatsappModalOpen(false)}
        />
      )}

      {/* Medicine Procurement Request Modal */}
      <MedicineRequestModal
        isOpen={requestModalOpen}
        onClose={closeRequestModal}
      />

      {/* Customer Proposal Review & Approval Modal */}
      <CustomerProposalModal
        isOpen={Boolean(activeProposalRequest)}
        request={activeProposalRequest}
        onClose={() => setActiveProposalRequest(null)}
        onOrderCreated={(order) => {
          setActiveProposalRequest(null);
          if (order) {
            handleOrderPlaced(order);
          } else {
            setActiveTab('orders');
          }
        }}
      />

      {/* Vendor Onboarding Flow Dialog */}
      {vendorOnboardingToken && (
        <VendorOnboardingView
          token={vendorOnboardingToken}
          onClose={() => {
            setVendorOnboardingToken(null);
            window.history.replaceState({}, document.title, window.location.pathname);
          }}
          onSuccess={() => {
            setVendorOnboardingToken(null);
            window.history.replaceState({}, document.title, '/');
            setActiveTab('admin');
          }}
        />
      )}

      {/* Email Verification Dialog */}
      {verifyEmailToken && (
        <VerifyEmailView
          token={verifyEmailToken}
          onClose={() => {
            setVerifyEmailToken(null);
            window.history.replaceState({}, document.title, window.location.pathname);
          }}
          onOpenSignIn={() => {
            setVerifyEmailToken(null);
            window.history.replaceState({}, document.title, '/');
            setAuthOpen(true);
          }}
        />
      )}

      {/* Tenant Selector Modal */}
      <TenantSelectorModal
        isOpen={tenantSelectorOpen}
        preferredTenantId={new URLSearchParams(window.location.search).get('tenantId') || tenantId || ''}
        onClose={() => {
          setTenantSelectorOpen(false);
          if (checkoutAfterTenantSelection) {
            setCheckoutAfterTenantSelection(false);
            if (tenantId) setCheckoutOpen(true);
          }
        }}
      />

      {/* Global Admin New Stock Modal */}
      <AdminNewStockModal
        isOpen={adminNewStockModalOpen}
        onClose={() => setAdminNewStockModalOpen(false)}
        onStockCreated={() => {
          fetchMedicines();
        }}
      />

      {/* Global Admin Bulk Import Modal */}
      <AdminBulkImportModal
        isOpen={adminBulkImportModalOpen}
        onClose={() => setAdminBulkImportModalOpen(false)}
      />

      <ModalAccessibilityManager />

      {/* Mobile Quick Actions Floating Action Button */}
      <QuickActionsFAB
        onRefillPrescriptions={() => {
          if (!user) {
            setAuthOpen(true);
            return;
          }
          setActiveTab('requests');
        }}
        onContactPharmacist={() => {
          setWhatsappModalOpen(true);
        }}
      />

    </div>
  );
}

export default MainApp;
