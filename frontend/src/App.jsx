import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from './context/AuthContext';
import { useToast } from './context/ToastContext';
import { useApp } from './context/AppContext';

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
const AdminDashboardView = React.lazy(() => import('./components/admin/AdminDashboardView'));
import WhatsAppConnectModal from './components/admin/WhatsAppConnectModal';
import CustomerRequestsView from './components/requests/CustomerRequestsView';
import MedicineRequestModal from './components/requests/MedicineRequestModal';
import CustomerProposalModal from './components/requests/CustomerProposalModal';
import VerifyEmailView from './components/auth/VerifyEmailView';
import VendorOnboardingView from './components/auth/VendorOnboardingView';

function MainApp() {
  const { user, isAdmin, isPharmacyOrAdmin, passwordRecoveryRequired, isFullyAuthenticated } = useAuth();
  const {
    cart,
    orders,
    loadUserOrders,
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
    openProposalModal
  } = useApp();
  const { addToast } = useToast();

  // Tab State: 'store' | 'orders' | 'requests' | 'addresses' | 'admin'
  const [activeTab, setActiveTab] = useState('store');

  // Modal Dialog States
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [placedOrder, setPlacedOrder] = useState(null);
  const [ratingPromptOrder, setRatingPromptOrder] = useState(null);
  const [dismissedRatingOrderIds, setDismissedRatingOrderIds] = useState([]);
  const [vendorOnboardingToken, setVendorOnboardingToken] = useState(null);
  const [verifyEmailToken, setVerifyEmailToken] = useState(null);

  // Check URL query parameters for onboarding or verification tokens
  useEffect(() => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const token = urlParams.get('token');
      const path = window.location.pathname;

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

  // Tab switch guard: Users must be signed in to access orders, tracking, requests, or addresses
  const handleTabSwitch = (tab) => {
    if ((tab === 'orders' || tab === 'addresses' || tab === 'requests') && !user) {
      addToast(`Please sign in to access ${tab === 'orders' ? 'your order history and live tracking' : tab === 'requests' ? 'your medicine requests' : 'your address directory'}.`, "info");
      setAuthOpen(true);
      return;
    }
    if (tab === 'requests' && isPharmacyOrAdmin) {
      addToast('Medicine requests are available in the pharmacy operations dashboard.', 'info');
      return;
    }
    if (tab === 'admin' && !isPharmacyOrAdmin) {
      addToast("Pharmacy or administrator authorization is required to access operations.", "warning");
      setAuthOpen(true);
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
    if (!isPharmacyOrAdmin && activeTab === 'admin') setActiveTab('store');
    if (!user && activeTrackingOrder) {
      setActiveTrackingOrder(null);
    }
  }, [user, isAdmin, isPharmacyOrAdmin, activeTab, activeTrackingOrder, setActiveTrackingOrder]);

  useEffect(() => {
    const requireLogin = () => setAuthOpen(true);
    window.addEventListener('ashvin:authentication-required', requireLogin);
    window.addEventListener('ashvin:logout-complete', requireLogin);
    return () => {
      window.removeEventListener('ashvin:authentication-required', requireLogin);
      window.removeEventListener('ashvin:logout-complete', requireLogin);
    };
  }, []);

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
    if (isFullyAuthenticated && isAdmin) {
      loadWhatsAppStatus().then((status) => {
        if (!cancelled && status && !status.isConnected && !adminCheckedRef.current) {
          adminCheckedRef.current = true;
          setWhatsappModalOpen(true);
        }
      });
    } else {
      adminCheckedRef.current = false;
      setWhatsappModalOpen(false);
    }
    return () => {
      cancelled = true;
    };
  }, [isFullyAuthenticated, isAdmin, loadWhatsAppStatus, setWhatsappModalOpen]);

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

  const displayName = user?.user_metadata?.name || user?.email?.split('@')[0] || "Friend";

  const handleProceedToCheckout = () => {
    if (!user) {
      addToast("Please sign in or use demo access to proceed with delivery checkout.", "info");
      setAuthOpen(true);
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

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-800 antialiased selection:bg-blue-100 selection:text-blue-900">
      
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
          if (isPharmacyOrAdmin) setActiveTab('admin');
        }}
      />

      {/* Main Content Area */}
      <main className="min-w-0 flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        
        {/* TAB 1: MEDICINE STORE & CATALOG */}
        {activeTab === 'store' && (
          <div className="space-y-6">
            
            {/* Friendly Hero Banner */}
            <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl sm:rounded-3xl p-4 sm:p-8 text-white shadow-lg shadow-blue-600/15 relative overflow-hidden">
              <div className="relative z-10 max-w-xl space-y-1.5 sm:space-y-2">
                <span className="inline-block bg-white/20 backdrop-blur-md text-white text-[10px] sm:text-[11px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                  Express 30-Min Prescription Delivery
                </span>
                <h1 className="text-lg sm:text-3xl font-black tracking-tight leading-tight m-0 text-white">
                  Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, {displayName}!
                </h1>
                <p className="text-xs sm:text-sm text-blue-100 font-medium leading-relaxed">
                  Find genuine pharmaceutical formulations, doctor-prescribed medications, and wellness care products delivered safely.
                </p>
              </div>

              {/* Decorative Pill/Capsule Graphic on larger screens */}
              <div className="hidden sm:block absolute right-4 -bottom-6 text-7xl sm:text-9xl opacity-20 pointer-events-none select-none">
                💊
              </div>
            </div>

            {/* Live Search & Filter Bar */}
            <SearchFilter />

            {/* Main Product Catalog Grid */}
            <ProductGrid />
          </div>
        )}

        {/* TAB 2: ORDER HISTORY & TRACKING (Guarded - Sign in required) */}
        {activeTab === 'orders' && (
          user ? (
            <div className="max-w-4xl mx-auto space-y-6">
              <OrderHistoryView
                onTrackOrder={(order) => setActiveTrackingOrder(order)}
              />
            </div>
          ) : (
            <div className="max-w-md mx-auto my-12 bg-white border border-slate-200 rounded-3xl p-8 text-center space-y-4 shadow-sm animate-fade-in">
              <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center text-2xl mx-auto">
                🔒
              </div>
              <h3 className="text-base font-extrabold text-slate-900">Sign In Required</h3>
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
          )
        )}

        {/* TAB 3: MEDICINE REQUESTS & PHARMACY PROPOSALS (Guarded - Sign in required) */}
        {activeTab === 'requests' && (
          user ? (
            <div className="max-w-4xl mx-auto space-y-6">
              <CustomerRequestsView
                onOpenProposal={(req) => openProposalModal(req)}
                onTrackOrder={(order) => {
                  setActiveTrackingOrder(order);
                  setActiveTab('orders');
                }}
              />
            </div>
          ) : (
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
          )
        )}

        {/* TAB 4: MULTI-ADDRESS DIRECTORY (Guarded - Sign in required) */}
        {activeTab === 'addresses' && (
          user ? (
            <div className="max-w-3xl mx-auto space-y-6">
              <AddressManager isSelectOnly={false} />
            </div>
          ) : (
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
          )
        )}

        {/* TAB 4: ADMIN OPERATIONS DASHBOARD (Guarded) */}
        {activeTab === 'admin' && (
          isPharmacyOrAdmin && (
            <React.Suspense fallback={<div className="py-12 text-center text-sm text-slate-500">Loading operations dashboard...</div>}>
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
      <Footer onNavigate={handleTabSwitch} />

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
          void loadUserOrders();
        }}
        onAlreadySubmitted={(orderId) => {
          const resolvedOrderId = String(orderId || ratingPromptOrder?._id || '');
          if (resolvedOrderId) setDismissedRatingOrderIds((previous) => previous.includes(resolvedOrderId) ? previous : [...previous, resolvedOrderId]);
          setRatingPromptOrder(null);
          void loadUserOrders();
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
      {user && isAdmin && (
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

    </div>
  );
}

export default MainApp;
