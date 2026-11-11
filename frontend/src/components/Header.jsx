import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { useTenant } from '../context/TenantContext';
import { useLanguage } from '../context/LanguageContext';
import NotificationBell from './NotificationBell';
import AdminAlertBell from './admin/AdminAlertBell';
import apiClient from '../api/apiClient';
import './application-chrome.css';

export default function Header({
  activeTab,
  setActiveTab,
  onOpenCart,
  onOpenAuth,
  onOpenProfile,
  onOpenAdminAlerts,
  onOpenGuide,
  onStartTour,
  onToggleMobileMenu
}) {
  const {
    user, isAdmin, isSuperAdmin, isTenantAdmin, canAccessOperations,
    hasPermission, hasAnyPermission, role, logout
  } = useAuth();
  const { cart, whatsappStatus, setWhatsappModalOpen, medicineRequests } = useApp();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuToggleRef = useRef(null);
  const mobileMenuPanelRef = useRef(null);

  const closeMobileMenu = () => {
    setMobileMenuOpen(false);
    onToggleMobileMenu?.(false);
  };

  useEffect(() => {
    if (!mobileMenuOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusFirst = () => mobileMenuPanelRef.current?.querySelector('button, a, select, input, [tabindex]:not([tabindex="-1"])')?.focus();
    focusFirst();
    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMobileMenu();
        mobileMenuToggleRef.current?.focus();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(mobileMenuPanelRef.current?.querySelectorAll('button:not([disabled]), a[href], select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])') || []);
      if (!focusable.length) { event.preventDefault(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow === 'hidden' ? '' : previousOverflow;
      mobileMenuToggleRef.current?.focus();
    };
  }, [mobileMenuOpen]);
  const [signingOut, setSigningOut] = useState(false);
  const { tenantId, branchId, setBranchId } = useTenant();
  const { language, setLanguage, t, languages } = useLanguage();
  const [branchOptions, setBranchOptions] = useState([]);
  const [branchOptionsForTenant, setBranchOptionsForTenant] = useState(null);

  React.useEffect(() => {
    let cancelled = false;
    if (!tenantId) {
      setBranchOptions([]);
      setBranchOptionsForTenant(null);
      return () => { cancelled = true; };
    }

    // Load only the selected pharmacy's active branches. The global branch list
    // can contain branches from other tenants and can race a tenant switch.
    setBranchOptions([]);
    setBranchOptionsForTenant(String(tenantId));
    apiClient.get('/api/v1/branches/all', { params: { tenantId } }).then(res => {
      const payload = res.data?.data || res.data?.branches || [];
      const items = Array.isArray(payload) ? payload : [];
      const valid = items
        .filter(Boolean)
        .map(item => ({
          id: String(item._id || item.id || ''),
          name: String(item.name || item.branchName || 'Branch'),
          tenantId: String(item.tenantId || tenantId),
          isDefault: Boolean(item.isDefault),
          createdAt: item.createdAt || null
        }))
        .filter(item => item.id && item.tenantId === String(tenantId));
      valid.sort((a, b) => Number(b.isDefault) - Number(a.isDefault)
        || new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
        || a.id.localeCompare(b.id));
      if (!cancelled) setBranchOptions(valid);
    }).catch(() => {
      if (!cancelled) setBranchOptions([]);
    });
    return () => { cancelled = true; };
  }, [tenantId]);

  React.useEffect(() => {
    if (!tenantId || branchOptionsForTenant !== String(tenantId) || branchOptions.length === 0) return;
    const selectedBranchIsValid = branchOptions.some(option => option.id === String(branchId || ''));
    if (!selectedBranchIsValid) setBranchId(branchOptions[0].id);
  }, [tenantId, branchOptionsForTenant, branchOptions, branchId, setBranchId]);

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
    closeMobileMenu();
  };

  return (
    <header className="quickmeds-header app-header bg-white/95 backdrop-blur-md border-b border-slate-200">
      <div className="w-full min-w-0">
        <div className="quickmeds-header-inner app-header__inner qm-site-container">
          
          {/* Left: Logo & Pharmacy Brand */}
          <div
            onClick={() => setActiveTab('store')}
              aria-current={activeTab === 'store' ? 'page' : undefined}
            className="quickmeds-brand-anchor app-header__brand" role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setActiveTab('store'); } }}
          >
            <div className="quickmeds-brand-mark flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 text-white shadow-md shadow-blue-500/20 sm:h-11 sm:w-11" aria-hidden="true">
              <img src="/favicon.svg" alt="" className="h-full w-full object-contain" />
            </div>
            <div className="app-header__brand-copy flex flex-col justify-center">
              <div className="quickmeds-brand-badge-container">
                <span className="quickmeds-brand-name">
                  QuickMeds Rx
                </span>
                {canViewOperations && (
                  <span className="quickmeds-role-chip bg-blue-100 text-blue-700">
                    {isSuperAdmin ? t('superAdmin') : (isTenantAdmin ? t('tenantAdmin') : (role === 'admin' ? t('admin') : t('pharmacy')))}
                  </span>
                )}
                {canViewOperations && canReadWhatsApp && (
                  canManageWhatsApp ? (
                    whatsappStatus.isConnected ? (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setWhatsappModalOpen(true); }}
                        className="hidden lg:inline-flex items-center gap-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase transition cursor-pointer whitespace-nowrap"
                        title={t("whatsappStatus")}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                        <span>{t('waLive')}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setWhatsappModalOpen(true); }}
                        className="hidden lg:inline-flex items-center gap-1 bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase transition cursor-pointer whitespace-nowrap"
                        title={t("whatsappOffline")}
                      >
                        <span>⚠️</span>
                        <span>{t('waOffline')}</span>
                      </button>
                    )
                  ) : (
                    <span className="hidden lg:inline-flex items-center gap-1 text-[9px] font-black uppercase text-slate-500 whitespace-nowrap">
                      {whatsappStatus.isConnected ? t('waLive') : t('waOffline')}
                    </span>
                  )
                )}
              </div>
              <p className="app-header__tagline hidden md:block text-[11px] text-slate-400 font-medium tracking-tight leading-normal mt-0.5 whitespace-nowrap">
                {t('trustedTagline')}
              </p>
            </div>
          </div>

          {/* Center: Desktop Navigation */}
          <nav className="app-header__desktop-nav hidden items-center gap-1.5 lg:gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('store')}
              className={`app-header__nav-item h-9 sm:h-10 px-3.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'store'
                  ? 'bg-blue-50 text-blue-700 font-extrabold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <span>💊</span>
              <span>{t('store')}</span>
            </button>

            {(canViewCustomerOrders || canViewCustomerRequests || canViewAddresses) && (
              <>
                {canViewCustomerOrders && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('orders')}
              aria-current={activeTab === 'orders' ? 'page' : undefined}
                    className={`app-header__nav-item h-9 sm:h-10 px-3.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                      activeTab === 'orders'
                        ? 'bg-blue-50 text-blue-700 font-extrabold shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    <span>📦</span>
                    <span>{t('orders')}</span>
                  </button>
                )}
                {canViewCustomerRequests && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('requests')}
              aria-current={activeTab === 'requests' ? 'page' : undefined}
                    className={`h-9 sm:h-10 px-3.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 relative ${
                      activeTab === 'requests'
                        ? 'bg-blue-50 text-blue-700 font-extrabold shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    <span>📋</span>
                    <span>{t('requests')}</span>
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
              aria-current={activeTab === 'addresses' ? 'page' : undefined}
                    className={`app-header__nav-item h-9 sm:h-10 px-3.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                      activeTab === 'addresses'
                        ? 'bg-blue-50 text-blue-700 font-extrabold shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    <span>🏠</span>
                    <span>{t('addresses')}</span>
                  </button>
                )}
              </>
            )}

            {canViewOperations && (
              <button
                type="button"
                onClick={() => setActiveTab('admin')}
                className={`app-header__nav-item h-9 sm:h-10 px-3.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'admin'
                    ? 'bg-blue-600 text-white shadow-sm font-extrabold'
                    : 'text-blue-700 bg-blue-50 hover:bg-blue-100'
                }`}
              >
                <span>⚙️</span>
                <span>{t('adminOperations')}</span>
              </button>
            )}
          </nav>

          {/* Right: Actions Bar */}
          <div className="quickmeds-actions-group app-header__actions">

            <label className="app-header__language qm-select-shell hidden min-[380px]:flex items-center gap-1 px-2 py-1.5 text-[11px] font-semibold text-slate-600" title={t('selectLanguage')}>
              <span aria-hidden="true">🌐</span>
              <span className="sr-only">{t('language')}</span>
              <select
                aria-label={t('language')}
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                className="app-header__language-select qm-select-control max-w-[82px] bg-transparent text-[11px] font-bold text-slate-700"
              >
                {languages.map((item) => <option key={item.code} value={item.code}>{item.nativeLabel}</option>)}
              </select>
            </label>

            {/* Branch Quick-Switcher Dropdown */}
            {Array.isArray(branchOptions) && branchOptions.length > 0 && (
              <div className="app-header__branch qm-select-shell hidden sm:flex items-center gap-1 px-2.5 py-1.5 transition shrink-0" title="Toggle active branch context (X-Branch-Id)">
                <span className="text-xs">🏢</span>
                <select
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  className="app-header__branch-select qm-select-control bg-transparent text-[11px] font-bold text-slate-800 cursor-pointer max-w-[112px] truncate"
                >
                  {branchOptions.filter(Boolean).map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            )}

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
                aria-label={t('viewCart')}
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

            {/* Admin Alerts Bell (Strictly restricted to staff/operations users) */}
            {user && canViewOperations && hasAnyPermission(['inventory.read', 'whatsapp.read']) && (
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
                  aria-label={t('profile')}
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
                className="app-header__sign-in h-9 sm:h-10 px-3.5 sm:px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-sm cursor-pointer transition flex items-center justify-center gap-1.5 shrink-0"
                aria-label={t('signIn')}
              >
                <span className="app-header__sign-in-icon text-xs" aria-hidden="true">👤</span>
                <span className="app-header__sign-in-label">{t('signIn')}</span>
              </button>
            )}

            {/* Hamburger Navigation Menu Toggle (Visible on all screen sizes to access Menu & Guidance) */}
            <button
              type="button"
              ref={mobileMenuToggleRef}
              onClick={() => {
                const nextState = !mobileMenuOpen;
                setMobileMenuOpen(nextState);
                onToggleMobileMenu?.(nextState);
              }}
              className="app-header__menu-toggle flex h-9 w-9 sm:h-10 sm:w-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer items-center justify-center shrink-0 border border-slate-200"
              aria-label={t('toggleMenu')}
              aria-expanded={mobileMenuOpen}
              aria-controls="quickmeds-mobile-navigation"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>

          </div>
        </div>

        {/* Slide-in Mobile / Global Navigation Drawer from the Right (Rendered via Portal) */}
        {mobileMenuOpen && typeof document !== 'undefined' && createPortal(
          <div className="fixed inset-0 z-[99999] overflow-hidden animate-fade-in" aria-modal="true" role="dialog" aria-labelledby="quickmeds-mobile-navigation-title">
            {/* Backdrop */}
            <div
              onClick={closeMobileMenu}
              aria-label={t("close")}
              className="absolute inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity"
            />

            {/* Slide-in Panel */}
            <div id="quickmeds-mobile-navigation" ref={mobileMenuPanelRef} className="pharma-mobile-nav-panel app-header__mobile-panel absolute inset-y-0 right-0 max-w-xs w-full bg-white border-l border-slate-200 shadow-2xl flex flex-col justify-between animate-slide-in-right overflow-y-auto" tabIndex="-1">
              
              {/* Drawer Header */}
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <div className="h-9 w-9 rounded-xl overflow-hidden shadow-md"><img src="/favicon.svg" alt="" className="h-full w-full object-contain" /></div>
                  <div>
                    <h3 id="quickmeds-mobile-navigation-title" className="font-black text-sm text-slate-900">QuickMeds Rx</h3>
                    <p className="text-[10px] text-slate-400 font-medium">{t('trustedTagline')}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeMobileMenu}
                  className="w-10 h-10 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition cursor-pointer"
                  aria-label={t("close")}
                >
                  ✕
                </button>
              </div>

              {/* Drawer Body: Navigation & Selectors */}
              <div className="py-4 space-y-4 flex-1">
                {/* Language & Branch Selectors */}
                <div className="space-y-2 pb-3 border-b border-slate-100">
                  <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
                    <span>🌐</span>
                    <select
                      aria-label={t('language')}
                      value={language}
                      onChange={(event) => setLanguage(event.target.value)}
                      className="w-full bg-transparent text-xs font-bold text-slate-800 outline-none cursor-pointer"
                    >
                      {languages.map((item) => <option key={item.code} value={item.code}>{item.nativeLabel}</option>)}
                    </select>
                  </label>

                  {Array.isArray(branchOptions) && branchOptions.length > 0 && (
                    <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
                      <span>🏢</span>
                      <select
                        aria-label={t("selectBranch")}
                        value={branchId}
                        onChange={(e) => setBranchId(e.target.value)}
                        className="w-full bg-transparent text-xs font-bold text-slate-800 outline-none cursor-pointer truncate"
                      >
                        {branchOptions.filter(Boolean).map(b => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>

                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={() => { setActiveTab('store'); closeMobileMenu(); }}
                    className={`w-full text-left px-3.5 py-3 rounded-xl text-xs font-bold transition flex items-center gap-2.5 ${
                      activeTab === 'store' ? 'bg-blue-50 text-blue-700 font-extrabold shadow-xs' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span>💊</span> {t('store')}
                  </button>

                  {user ? (
                    <>
                      {canViewCustomerOrders && (
                        <button
                          type="button"
                          onClick={() => { setActiveTab('orders'); closeMobileMenu(); }}
                          className={`w-full text-left px-3.5 py-3 rounded-xl text-xs font-bold transition flex items-center gap-2.5 ${
                            activeTab === 'orders' ? 'bg-blue-50 text-blue-700 font-extrabold shadow-xs' : 'text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          <span>📦</span> {t('orders')}
                        </button>
                      )}
                      {canViewCustomerRequests && (
                        <button
                          type="button"
                          onClick={() => { setActiveTab('requests'); closeMobileMenu(); }}
                          className={`w-full text-left px-3.5 py-3 rounded-xl text-xs font-bold transition flex items-center justify-between ${
                            activeTab === 'requests' ? 'bg-blue-50 text-blue-700 font-extrabold shadow-xs' : 'text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          <span className="flex items-center gap-2.5"><span>📋</span> {t('requests')}</span>
                          {proposalsWaitingCount > 0 && (
                            <span className="bg-blue-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full">
                              {proposalsWaitingCount} {t('new')}
                            </span>
                          )}
                        </button>
                      )}
                      {canViewAddresses && (
                        <button
                          type="button"
                          onClick={() => { setActiveTab('addresses'); closeMobileMenu(); }}
                          className={`w-full text-left px-3.5 py-3 rounded-xl text-xs font-bold transition flex items-center gap-2.5 ${
                            activeTab === 'addresses' ? 'bg-blue-50 text-blue-700 font-extrabold shadow-xs' : 'text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          <span>🏠</span> {t('addresses')}
                        </button>
                      )}
                      {canViewOperations && (
                        <button
                          type="button"
                          onClick={() => { setActiveTab('admin'); closeMobileMenu(); }}
                          className={`w-full text-left px-3.5 py-3 rounded-xl text-xs font-bold transition flex items-center gap-2.5 ${
                            activeTab === 'admin' ? 'bg-blue-600 text-white font-extrabold' : 'text-blue-700 bg-blue-50'
                          }`}
                        >
                          <span>⚙️</span> {t('adminOperations')}
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { closeMobileMenu(); onOpenAuth?.(); }}
                      className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-sm text-center flex items-center justify-center gap-2"
                    >
                      <span>👤</span> {t('signIn')}
                    </button>
                  )}
                </div>

                {/* Exclusive Help & In-App Guidance Section in Hamburger Menu */}
                <div className="pt-3 border-t border-slate-100 space-y-1.5">
                  <p className="px-3.5 text-[10px] font-black uppercase text-slate-400 tracking-wider">
                    {t('helpAndGuidance') || 'Help & Guidance'}
                  </p>
                  <button
                    type="button"
                    onClick={() => { closeMobileMenu(); onStartTour?.(); }}
                    className="w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-extrabold text-blue-700 bg-blue-50/80 hover:bg-blue-100/80 transition flex items-center gap-2.5 border border-blue-100 cursor-pointer"
                  >
                    <span className="text-sm">✨</span>
                    <span>{t('interactiveProductTour') || 'Interactive Product Tour'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { closeMobileMenu(); onOpenGuide?.(); }}
                    className="w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-extrabold text-indigo-700 bg-indigo-50/80 hover:bg-indigo-100/80 transition flex items-center gap-2.5 border border-indigo-100 cursor-pointer"
                  >
                    <span className="text-sm">📖</span>
                    <span>{t('appGuideAndManual') || t('appGuide') || 'Application Guide & Manual'}</span>
                  </button>
                </div>
              </div>

              {/* Drawer Footer: User & Sign Out */}
              {user && (
                <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                  <div className="flex flex-col min-w-0 pr-2">
                    <span className="text-[10px] text-slate-400 font-medium">{t('signedInAs')}</span>
                    <span className="text-xs text-slate-800 font-bold truncate">{user?.email}</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    disabled={signingOut}
                    className="text-xs font-bold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 px-3.5 py-2 rounded-xl transition shrink-0 cursor-pointer"
                  >
                    {signingOut ? t('signingOut') : t('signOut')}
                  </button>
                </div>
              )}

            </div>
          </div>,
          document.body
        )}

      </div>
    </header>
  );
}
