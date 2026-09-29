import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider, useToast } from './context/ToastContext';
import { AppProvider, useApp } from './context/AppContext';

import Header from './components/Header';
import Footer from './components/Footer';
import SearchFilter from './components/SearchFilter';
import ProductGrid from './components/ProductGrid';
import CartDrawer from './components/CartDrawer';
import CheckoutModal from './components/CheckoutModal';
import OrderConfirmation from './components/OrderConfirmation';
import OrderTrackingModal from './components/OrderTrackingModal';
import OrderHistoryView from './components/OrderHistoryView';
import AddressManager from './components/AddressManager';
import AuthModal from './components/AuthModal';
import UserProfileModal from './components/UserProfileModal';
import AdminDashboardView from './components/admin/AdminDashboardView';
import WhatsAppConnectModal from './components/admin/WhatsAppConnectModal';

function MainApp() {
  const { user, isAdmin, role } = useAuth();
  const {
    cart,
    activeTrackingOrder,
    setActiveTrackingOrder,
    whatsappModalOpen,
    setWhatsappModalOpen,
    whatsappStatus,
    loadWhatsAppStatus
  } = useApp();
  const { addToast } = useToast();

  // Tab State: 'store' | 'orders' | 'addresses' | 'admin'
  const [activeTab, setActiveTab] = useState('store');

  // Modal Dialog States
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [placedOrder, setPlacedOrder] = useState(null);

  // Tab switch guard: Users must be signed in to access orders, tracking, or addresses
  const handleTabSwitch = (tab) => {
    if ((tab === 'orders' || tab === 'addresses') && !user) {
      addToast(`Please sign in to access ${tab === 'orders' ? 'your order history and live tracking' : 'your address directory'}.`, "info");
      setAuthOpen(true);
      return;
    }
    if (tab === 'admin' && !isAdmin) {
      addToast("Admin authorization required to access operations dashboard.", "warning");
      setAuthOpen(true);
      return;
    }
    setActiveTab(tab);
  };

  // Reset tab to store if user signs out while on protected screens
  React.useEffect(() => {
    if (!user && (activeTab === 'orders' || activeTab === 'addresses' || activeTab === 'admin')) {
      setActiveTab('store');
    }
    if (!user && activeTrackingOrder) {
      setActiveTrackingOrder(null);
    }
  }, [user, activeTab, activeTrackingOrder, setActiveTrackingOrder]);

  // Admin WhatsApp Verification Flow:
  // When an admin logs in and WhatsApp is not connected, automatically show the pairing QR popup
  const adminCheckedRef = React.useRef(false);

  React.useEffect(() => {
    if (isAdmin) {
      loadWhatsAppStatus().then((status) => {
        if (status && !status.isConnected && !adminCheckedRef.current) {
          adminCheckedRef.current = true;
          setWhatsappModalOpen(true);
        }
      });
    } else {
      adminCheckedRef.current = false;
    }
  }, [isAdmin, loadWhatsAppStatus, setWhatsappModalOpen]);

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
          if (isAdmin) setActiveTab('admin');
        }}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        
        {/* TAB 1: MEDICINE STORE & CATALOG */}
        {activeTab === 'store' && (
          <div className="space-y-6">
            
            {/* Friendly Hero Banner */}
            <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl sm:rounded-3xl p-4 sm:p-8 text-white shadow-lg shadow-blue-600/15 relative overflow-hidden">
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

        {/* TAB 3: MULTI-ADDRESS DIRECTORY (Guarded - Sign in required) */}
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
          isAdmin ? (
            <AdminDashboardView />
          ) : (
            <div className="max-w-md mx-auto text-center py-20 space-y-4">
              <span className="text-4xl">🔒</span>
              <h3 className="text-lg font-black text-slate-900">Access Restricted</h3>
              <p className="text-xs text-slate-500">
                You must be authenticated with verified pharmacist/administrator credentials to access the operations hub.
              </p>
              <button
                onClick={() => setAuthOpen(true)}
                className="bg-purple-600 text-white font-extrabold text-xs px-5 py-2.5 rounded-xl cursor-pointer"
              >
                Sign in with Admin Credentials
              </button>
            </div>
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

      {/* Authentication Modal */}
      <AuthModal
        isOpen={authOpen}
        onClose={() => setAuthOpen(false)}
      />

      {/* User Profile Dropdown Modal */}
      <UserProfileModal
        isOpen={profileOpen}
        onClose={() => setProfileOpen(false)}
        onNavigate={handleTabSwitch}
      />

      {/* WhatsApp Delivery Dispatch Gateway Modal */}
      <WhatsAppConnectModal
        isOpen={whatsappModalOpen}
        onClose={() => setWhatsappModalOpen(false)}
      />

    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AppProvider>
          <MainApp />
        </AppProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
