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
  const {
    user, isAdmin, isSuperAdmin, isTenantAdmin, canAccessOperations,
    hasPermission, hasAnyPermission, role, logout
  } = useAuth();
  const { cart, whatsappStatus, setWhatsappModalOpen, medicineRequests } = useApp();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const cartItemCount = cart.reduce((total, item) => total + item.quantity, 0);
  const proposalsWaitingCount = (medicineRequests || []).filter(r => r.status === 'PROPOSAL_SENT').length;
  const canViewCustomerWorkspace = !canAccessOperations || isSuperAdmin;
  const canViewCustomerOrders = Boolean(user && canViewCustomerWorkspace && hasPermission('orders.read'));
  const canViewCustomerRequests = Boolean(user && canViewCustomerWorkspace && hasPermission('medicine_requests.read'));
  const canViewAddresses = Boolean(user && canViewCustomerWorkspace && hasPermission('profile.read'));
  const canViewOperations = Boolean(user && canAccessOperations);
  const canReadWhatsApp = hasPermission('whatsapp.read');
  const canManageWhatsApp = hasPermission('whatsapp.manage');

  const handleSignOut = async () => {
    setSigningOut(true);
    await logout();
    setMobileMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200 transition">
      <div className="w-full px-3.5 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 sm:h-20 gap-2 sm:gap-4">
          
          {/* Left: Logo & Pharmacy Brand */}
          <div
            onClick={() => setActiveTab('store')}
            className="flex items-center gap-2 sm:gap-3 cursor-pointer select-none shrink-0 min-w-0"
          >
            <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl sm:rounded-2xl bg-blue-600 text-white flex items-center justify-center font-black text-base sm:text-xl shadow-md shadow-blue-500/20 shrink-0">
              ⚕️
            </div>
            <div className="min-w-0 flex flex-col justify-center">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <span className="text-sm sm:text-lg font-black text-slate-900 tracking-tight leading-tight truncate block">
                  Ashvin Pharmacy
                </span>
                {canViewOperations && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="bg-blue-100 text-blue-700 text-[9px] sm:text-[10px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                      {isSuperAdmin ? 'Super Admin' : (isTenantAdmin ? 'Tenant Admin' : (role === 'admin' ? 'Admin' : 'Pharmacy'))}
                    </span>
                    {canReadWhatsApp && (canManageWhatsApp ? (
                      whatsappStatus.isConnected ? (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setWhatsappModalOpen(true); }}
                          className="hidden lg:inline-flex items-center gap-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase transition cursor-pointer"
                          title="WhatsApp status and controls"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                          <span>WA Live</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setWhatsappModalOpen(true); }}
                          className="hidden lg:inline-flex items-center gap-1 bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase transition cursor-pointer"
                          title="WhatsApp offline; click to pair"
                        >
                          <span>⚠️</span>
                          <span>WA Offline</span>
                        </button>
                      )
                    ) : (
                      <span className="hidden lg:inline-flex items-center gap-1 text-[9px] font-black uppercase text-slate-500">
                        {whatsappStatus.isConnected ? 'WA Live' : 'WA Offline'}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <p className="hidden md:block text-[11px] text-slate-400 font-medium tracking-tight leading-normal mt-0.5">
                Your Trusted Pharmacy for Everyday Healthcare
              </p>
            </div>
          </div>

          {/* Center: Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-1.5 lg:gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('store')}
              className={`h-9 sm:h-10 px-3.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'store'
                  ? 'bg-blue-50 text-blue-700 font-extrabold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <span>💊</span>
              <span>Store</span>
            </button>

            {(canViewCustomerOrders || canViewCustomerRequests || canViewAddresses) && (
              <>
                {canViewCustomerOrders && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('orders')}
                    className={`h-9 sm:h-10 px-3.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                      activeTab === 'orders'
                        ? 'bg-blue-50 text-blue-700 font-extrabold shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    <span>📦</span>
                    <span>Orders</span>
                  </button>
                )}
                {canViewCustomerRequests && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('requests')}
                    className={`h-9 sm:h-10 px-3.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 relative ${
                      activeTab === 'requests'
                        ? 'bg-blue-50 text-blue-700 font-extrabold shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    <span>📋</span>
                    <span>Requests</span>
                    {proposalsWaitingCount > 0 && (
                      <span className="ml-1 bg-blue-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full animate-pulse shadow-xs">
                        {proposalsWaitingCount}
                      </span>
                    )}
                  </button>
                )}
                {canViewAddresses && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('addresses')}
                    className={`h-9 sm:h-10 px-3.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                      activeTab === 'addresses'
                        ? 'bg-blue-50 text-blue-700 font-extrabold shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    <span>🏠</span>
                    <span>Addresses</span>
                  </button>
                )}
              </>
            )}

            {canViewOperations && (
              <button
                type="button"
                onClick={() => setActiveTab('admin')}
                className={`h-9 sm:h-10 px-3.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'admin'
                    ? 'bg-blue-600 text-white shadow-sm font-extrabold'
                    : 'text-blue-700 bg-blue-50 hover:bg-blue-100'
                }`}
              >
                <span>⚙️</span>
                <span>Admin Operations</span>
              </button>
            )}
          </nav>

          {/* Right: Actions Bar */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            
            {/* Customer notifications */}
            {user && canViewCustomerWorkspace && hasPermission('profile.read') && (
              <NotificationBell
                onOpenOrders={canViewCustomerOrders ? () => setActiveTab('orders') : null}
                onRequireAuth={onOpenAuth}
              />
            )}

            {/* Shopping Cart Button */}
            {user && canViewCustomerWorkspace && hasPermission('orders.create') && (
              <button
                type="button"
                onClick={onOpenCart}
                className="relative h-9 w-9 sm:h-10 sm:w-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 transition cursor-pointer flex items-center justify-center shrink-0"
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

            {/* Admin Alerts Bell */}
            {user && hasAnyPermission(['inventory.read', 'whatsapp.read']) && (
              <AdminAlertBell
                onOpenAlerts={onOpenAdminAlerts}
                canViewInventoryAlerts={hasPermission('inventory.read')}
                canReadWhatsApp={hasPermission('whatsapp.read')}
                canManageWhatsApp={hasPermission('whatsapp.manage')}
              />
            )}

            {/* User Profile / Auth Button */}
            {user ? (
              hasPermission('profile.read') ? (
                <button
                  type="button"
                  onClick={onOpenProfile}
                  className="h-9 sm:h-10 px-2 sm:px-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer transition flex items-center justify-center gap-2 shrink-0"
                  aria-label="User Account Profile"
                >
                  <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-black text-xs flex items-center justify-center uppercase shadow-xs shrink-0">
                    {user.user_metadata?.name ? user.user_metadata.name.charAt(0) : user.email?.charAt(0) || 'U'}
                  </div>
                  <span className="hidden sm:inline text-xs font-bold text-slate-700 max-w-[90px] truncate leading-none">
                    {user.user_metadata?.name || user.email?.split('@')[0]}
                  </span>
                </button>
              ) : (
                <span className="hidden sm:inline max-w-[120px] truncate text-xs font-medium text-slate-500 leading-none" title="Profile details are restricted by your current permissions">
                  {user.email}
                </span>
              )
            ) : (
              <button
                type="button"
                onClick={onOpenAuth}
                className="h-9 sm:h-10 px-3.5 sm:px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-sm cursor-pointer transition flex items-center justify-center gap-1.5 shrink-0"
                aria-label="Sign In"
              >
                <span className="text-xs">👤</span>
                <span>Sign In</span>
              </button>
            )}

            {/* Mobile Navigation Sandwich / Hamburger Menu Toggle */}
            {user && (
              <button
                type="button"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden h-9 w-9 sm:h-10 sm:w-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer flex items-center justify-center shrink-0"
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
              type="button"
              onClick={() => { setActiveTab('store'); setMobileMenuOpen(false); }}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
                activeTab === 'store' ? 'bg-blue-50 text-blue-700 font-extrabold' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span>💊</span> Store
            </button>
            {canViewCustomerOrders && (
              <button
                type="button"
                onClick={() => { setActiveTab('orders'); setMobileMenuOpen(false); }}
                className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
                  activeTab === 'orders' ? 'bg-blue-50 text-blue-700 font-extrabold' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <span>📦</span> Orders
              </button>
            )}
            {canViewCustomerRequests && (
              <button
                type="button"
                onClick={() => { setActiveTab('requests'); setMobileMenuOpen(false); }}
                className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-between ${
                  activeTab === 'requests' ? 'bg-blue-50 text-blue-700 font-extrabold' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <span className="flex items-center gap-2"><span>📋</span> Requests</span>
                {proposalsWaitingCount > 0 && (
                  <span className="bg-blue-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full">
                    {proposalsWaitingCount} new
                  </span>
                )}
              </button>
            )}
            {canViewAddresses && (
              <button
                type="button"
                onClick={() => { setActiveTab('addresses'); setMobileMenuOpen(false); }}
                className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
                  activeTab === 'addresses' ? 'bg-blue-50 text-blue-700 font-extrabold' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <span>🏠</span> Addresses
              </button>
            )}
            {canViewOperations && (
              <button
                type="button"
                onClick={() => { setActiveTab('admin'); setMobileMenuOpen(false); }}
                className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
                  activeTab === 'admin' ? 'bg-blue-600 text-white font-extrabold' : 'text-blue-700 bg-blue-50'
                }`}
              >
                <span>⚙️</span> Admin Operations
              </button>
            )}
            <div className="pt-2 border-t border-slate-100 flex items-center justify-between px-2">
              <span className="text-[11px] text-slate-500 font-medium truncate max-w-[180px]">
                Signed in as {user?.email}
              </span>
              <button
                type="button"
                onClick={handleSignOut}
                disabled={signingOut}
                className="text-xs font-bold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 px-3 py-1.5 rounded-lg transition"
              >
                {signingOut ? 'Signing out...' : 'Sign Out'}
              </button>
            </div>
          </div>
        )}

      </div>
    </header>
  );
}
