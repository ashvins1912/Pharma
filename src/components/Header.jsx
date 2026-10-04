import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import NotificationBell from './NotificationBell';
import AdminAlertBell from './admin/AdminAlertBell';

export default function Header({
  activeTab,
  setActiveTab,
  onOpenCart,
  onOpenAuth,
  onOpenProfile,
  onOpenAdminAlerts
}) {
  const { user, isAdmin, isSuperAdmin, isTenantAdmin, logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const {
    cart,
    whatsappStatus,
    setWhatsappModalOpen,
    medicineRequests,
    openRequestModal,
    branches,
    activeBranchId,
    switchBranch
  } = useApp();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const cartItemCount = cart.reduce((total, item) => total + item.quantity, 0);
  const proposalsWaitingCount = (medicineRequests || []).filter(r => r.status === 'PROPOSAL_SENT').length;

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200 transition">
      <div className="max-w-7xl mx-auto px-2.5 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 sm:h-20 gap-1 sm:gap-4">
          
          {/* Left: Logo & Pharmacy Brand */}
          <div
            onClick={() => setActiveTab('store')}
            className="flex items-center gap-1.5 sm:gap-3 cursor-pointer select-none shrink min-w-0"
          >
            <div className="w-8 h-8 sm:w-11 sm:h-11 rounded-xl sm:rounded-2xl bg-blue-600 text-white flex items-center justify-center font-black text-base sm:text-xl shadow-md shadow-blue-500/20 shrink-0">
              ⚕️
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1 sm:gap-1.5">
                <span className="text-sm sm:text-lg font-black text-slate-900 tracking-tight leading-none truncate block">
                  Ashvin Pharmacy
                </span>
                {isAdmin && (
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="bg-purple-100 text-purple-700 text-[9px] sm:text-[10px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                      {isSuperAdmin ? 'Super Admin' : (isTenantAdmin ? 'Tenant Admin' : 'Admin')}
                    </span>
                    {whatsappStatus.isConnected ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); setWhatsappModalOpen(true); }}
                        className="hidden sm:inline-flex items-center gap-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase transition cursor-pointer"
                        title="WhatsApp Dispatch Connected - Click to view"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                        <span>WA Live</span>
                      </button>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); setWhatsappModalOpen(true); }}
                        className="hidden sm:inline-flex items-center gap-1 bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase transition cursor-pointer animate-pulse"
                        title="WhatsApp Offline - Click to scan QR code"
                      >
                        <span>⚠️</span>
                        <span>WA Offline</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
              <p className="hidden md:block text-[11px] text-slate-400 font-medium tracking-tight mt-0.5">
                Your Trusted Pharmacy for Everyday Healthcare
              </p>
            </div>
          </div>

          {/* Center: Desktop Navigation - Orders and Addresses only shown if user is signed in */}
          <nav className="hidden md:flex items-center gap-1 lg:gap-2">
            <button
              onClick={() => setActiveTab('store')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                activeTab === 'store'
                  ? 'bg-blue-50 text-blue-700 font-extrabold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              💊 Store
            </button>

            {user && (
              <>
                <button
                  onClick={() => setActiveTab('orders')}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                    activeTab === 'orders'
                      ? 'bg-blue-50 text-blue-700 font-extrabold'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  📦 Orders
                </button>
                <button
                  onClick={() => setActiveTab('requests')}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer relative ${
                    activeTab === 'requests'
                      ? 'bg-blue-50 text-blue-700 font-extrabold'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  📋 Requests
                  {proposalsWaitingCount > 0 && (
                    <span className="ml-1.5 bg-purple-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full animate-pulse shadow-xs">
                      {proposalsWaitingCount}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab('addresses')}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                    activeTab === 'addresses'
                      ? 'bg-blue-50 text-blue-700 font-extrabold'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  🏠 Addresses
                </button>
              </>
            )}

            {isAdmin && (
              <button
                onClick={() => setActiveTab('admin')}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                  activeTab === 'admin'
                    ? 'bg-purple-600 text-white shadow-sm font-extrabold'
                    : 'text-purple-700 bg-purple-50 hover:bg-purple-100'
                }`}
              >
                ⚙️ Admin Operations
              </button>
            )}
          </nav>

          {/* Right: Actions Bar (Branch, Notifications, Cart, User Profile, Mobile Menu) */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            
            {/* Pharmacy Branch Selector */}
            <div className="hidden md:flex items-center gap-1.5 text-xs text-slate-700 bg-slate-100 hover:bg-slate-200/80 border border-slate-200 rounded-xl px-2.5 py-1.5 transition">
              <span className="text-slate-500">📍</span>
              <select
                value={activeBranchId}
                onChange={(e) => switchBranch(e.target.value)}
                className="bg-transparent text-slate-800 font-bold focus:outline-none cursor-pointer pr-1 text-xs"
                title="Select fulfilling pharmacy branch"
              >
                {(branches || []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.serviceRadiusKm}km)
                  </option>
                ))}
              </select>
            </div>

            {/* Notification Bell (Only shown when user is signed in) */}
            {user && (
              isAdmin ? (
                <AdminAlertBell onOpenAlerts={onOpenAdminAlerts} />
              ) : (
                <NotificationBell onOpenOrders={() => setActiveTab('orders')} />
              )
            )}

            {/* Shopping Cart Icon with Live Count Badge (Only shown when user is signed in) */}
            {user && (
              <button
                onClick={onOpenCart}
                className="relative w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 transition cursor-pointer flex items-center justify-center flex-shrink-0"
                aria-label="View Shopping Cart"
              >
                <svg className="w-5 h-5 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                </svg>
                {cartItemCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-emerald-600 text-white text-[9px] sm:text-[10px] font-black w-4 h-4 sm:w-5 sm:h-5 rounded-full flex items-center justify-center shadow-md animate-pulse">
                    {cartItemCount}
                  </span>
                )}
              </button>
            )}

            {/* User Profile / Auth Button */}
            {user ? (
              <button
                onClick={onOpenProfile}
                className="w-9 h-9 sm:w-auto p-0 sm:px-2.5 sm:py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer transition flex items-center justify-center gap-1.5 flex-shrink-0"
                aria-label="User Account Profile"
              >
                <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-black text-xs flex items-center justify-center uppercase shadow-sm">
                  {user.user_metadata?.name ? user.user_metadata.name.charAt(0) : user.email?.charAt(0) || 'U'}
                </div>
                <span className="hidden sm:inline text-xs font-bold text-slate-700 max-w-[85px] truncate">
                  {user.user_metadata?.name || user.email?.split('@')[0]}
                </span>
              </button>
            ) : (
              <button
                onClick={onOpenAuth}
                className="w-auto px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-sm cursor-pointer transition flex items-center justify-center gap-1.5 flex-shrink-0"
                aria-label="Sign In"
              >
                <span className="text-xs">👤</span>
                <span>Sign In</span>
              </button>
            )}

            {/* Mobile Navigation Sandwich / Hamburger Menu Toggle (Only shown when user is signed in) */}
            {user && (
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer flex items-center justify-center flex-shrink-0"
                aria-label="Toggle Navigation Menu"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  {mobileMenuOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>
            )}

          </div>
        </div>

        {/* Mobile Navigation Dropdown Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-slate-100 py-3 space-y-1 animate-fade-in">
            <button
              onClick={() => { setActiveTab('store'); setMobileMenuOpen(false); }}
              className={`w-full text-left px-4 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-between ${
                activeTab === 'store' ? 'bg-blue-50 text-blue-700 font-extrabold' : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span>💊 Medicine Store</span>
              <span className="text-slate-400">→</span>
            </button>

            <button
              onClick={() => { setActiveTab('orders'); setMobileMenuOpen(false); }}
              className={`w-full text-left px-4 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-between ${
                activeTab === 'orders' ? 'bg-blue-50 text-blue-700 font-extrabold' : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span>📦 Order History & Tracking</span>
              <span className="text-slate-400">→</span>
            </button>

            <button
              onClick={() => { setActiveTab('requests'); setMobileMenuOpen(false); }}
              className={`w-full text-left px-4 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-between ${
                activeTab === 'requests' ? 'bg-blue-50 text-blue-700 font-extrabold' : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-2">
                <span>📋 My Medicine Requests</span>
                {proposalsWaitingCount > 0 && (
                  <span className="bg-purple-600 text-white text-[9px] font-black px-1.5 py-0.2 rounded-full">
                    {proposalsWaitingCount} new
                  </span>
                )}
              </div>
              <span className="text-slate-400">→</span>
            </button>

            <button
              onClick={() => { setActiveTab('addresses'); setMobileMenuOpen(false); }}
              className={`w-full text-left px-4 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-between ${
                activeTab === 'addresses' ? 'bg-blue-50 text-blue-700 font-extrabold' : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span>🏠 Multi-Address Directory</span>
              <span className="text-slate-400">→</span>
            </button>

            {isAdmin && (
              <button
                onClick={() => { setActiveTab('admin'); setMobileMenuOpen(false); }}
                className={`w-full text-left px-4 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-between ${
                  activeTab === 'admin' ? 'bg-purple-600 text-white font-extrabold' : 'text-purple-700 bg-purple-50 hover:bg-purple-100'
                }`}
              >
                <span>⚙️ Admin Operations Dashboard</span>
                <span>→</span>
              </button>
            )}

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between px-2 text-xs">
              {user ? (
                <>
                  <span className="text-slate-500 truncate max-w-[180px] font-medium">
                    👤 {user.email}
                  </span>
                  <button
                    onClick={async () => { setSigningOut(true); await logout(); setMobileMenuOpen(false); setSigningOut(false); }}
                    disabled={signingOut}
                    aria-busy={signingOut}
                    className="text-rose-600 font-bold hover:underline disabled:opacity-60"
                  >
                    {signingOut ? 'Signing out…' : 'Log Out'}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => { onOpenAuth(); setMobileMenuOpen(false); }}
                  className="w-full bg-blue-600 text-white font-bold py-2 rounded-xl text-center"
                >
                  Sign In / Create Account
                </button>
              )}
            </div>
          </div>
        )}

      </div>
    </header>
  );
}
