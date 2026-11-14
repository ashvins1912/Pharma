import React, { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';

export default function QuickActionsFAB({
  onRefillPrescriptions,
  onRequestMedicine,
  onTrackOrders,
  onSavedAddresses,
  onOpenCart,
  onContactPharmacist,
  canManageWhatsapp = false,
  cartCount = 0,
  pharmacyPhone = '+91 95899 16475',
  pharmacyName = 'QuickMeds Rx'
}) {
  const { t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [showPharmacistCard, setShowPharmacistCard] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      setShowPharmacistCard(false);
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const normalizedTel = String(pharmacyPhone || '+919589916475').replace(/[^+\d]/g, '') || '+919589916475';

  const triggerAction = (handler) => {
    setIsOpen(false);
    setShowPharmacistCard(false);
    handler?.();
  };

  const handlePharmacistClick = () => {
    if (canManageWhatsapp && onContactPharmacist) {
      triggerAction(onContactPharmacist);
      return;
    }
    setShowPharmacistCard((prev) => !prev);
  };

  return (
    <div
      ref={containerRef}
      className="fixed bottom-5 left-4 sm:bottom-6 sm:left-6 z-[1050] flex flex-col items-start"
    >
      {isOpen && (
        <div
          role="menu"
          aria-label={t('quickActions') || 'Quick Actions'}
          className="mb-3 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-900/10 animate-fade-in"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <div className="flex flex-col">
              <span className="text-xs font-extrabold uppercase tracking-wider text-slate-900">
                {t('quickActions') || 'Quick Actions'}
              </span>
              <span className="text-[11px] font-medium text-slate-600">
                {pharmacyName}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="flex min-h-9 min-w-9 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 cursor-pointer"
              aria-label="Close quick actions"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="mt-1.5 flex flex-col gap-1">
            {/* 1. Refill Prescriptions */}
            <button
              type="button"
              role="menuitem"
              onClick={() => triggerAction(onRefillPrescriptions)}
              className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-xs font-bold text-slate-800 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1 transition cursor-pointer"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-blue-200 bg-blue-50 text-blue-700" aria-hidden="true">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              </span>
              <span className="flex flex-1 flex-col min-w-0">
                <span className="truncate font-bold text-slate-900">
                  {t('refillPrescriptions') || 'Refill Prescriptions'}
                </span>
                <span className="truncate text-[11px] font-medium text-slate-600">
                  Review past Rx &amp; repeat orders
                </span>
              </span>
            </button>

            {/* 2. Request Medicine / Upload Rx */}
            {onRequestMedicine && (
              <button
                type="button"
                role="menuitem"
                onClick={() => triggerAction(onRequestMedicine)}
                className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-xs font-bold text-slate-800 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1 transition cursor-pointer"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700" aria-hidden="true">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </span>
                <span className="flex flex-1 flex-col min-w-0">
                  <span className="truncate font-bold text-slate-900">
                    {t('requestMedicine') || 'Request Medicine'}
                  </span>
                  <span className="truncate text-[11px] font-medium text-slate-600">
                    Upload Rx or request stock
                  </span>
                </span>
              </button>
            )}

            {/* 3. Order Tracking */}
            {onTrackOrders && (
              <button
                type="button"
                role="menuitem"
                onClick={() => triggerAction(onTrackOrders)}
                className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-xs font-bold text-slate-800 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1 transition cursor-pointer"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-800" aria-hidden="true">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
                  </svg>
                </span>
                <span className="flex flex-1 flex-col min-w-0">
                  <span className="truncate font-bold text-slate-900">
                    {t('orderTracking') || 'Order Tracking'}
                  </span>
                  <span className="truncate text-[11px] font-medium text-slate-600">
                    Live delivery status &amp; history
                  </span>
                </span>
              </button>
            )}

            {/* 4. Saved Delivery Addresses */}
            {onSavedAddresses && (
              <button
                type="button"
                role="menuitem"
                onClick={() => triggerAction(onSavedAddresses)}
                className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-xs font-bold text-slate-800 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1 transition cursor-pointer"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-slate-700" aria-hidden="true">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </span>
                <span className="flex flex-1 flex-col min-w-0">
                  <span className="truncate font-bold text-slate-900">
                    {t('savedAddresses') || 'Saved Delivery Addresses'}
                  </span>
                  <span className="truncate text-[11px] font-medium text-slate-600">
                    Drop-off locations &amp; GPS
                  </span>
                </span>
              </button>
            )}

            {/* 5. Shopping Cart */}
            {onOpenCart && (
              <button
                type="button"
                role="menuitem"
                onClick={() => triggerAction(onOpenCart)}
                className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-xs font-bold text-slate-800 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1 transition cursor-pointer"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-slate-700" aria-hidden="true">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </span>
                <span className="flex flex-1 flex-col min-w-0">
                  <span className="truncate font-bold text-slate-900">
                    {t('viewCart') || 'View Shopping Cart'}
                  </span>
                  <span className="truncate text-[11px] font-medium text-slate-600">
                    Review selected medicines
                  </span>
                </span>
                {cartCount > 0 && (
                  <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-extrabold text-blue-700 tabular-nums">
                    {cartCount}
                  </span>
                )}
              </button>
            )}

            {/* 6. Contact Pharmacist */}
            <button
              type="button"
              role="menuitem"
              onClick={handlePharmacistClick}
              aria-expanded={!canManageWhatsapp ? showPharmacistCard : undefined}
              className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-xs font-bold text-slate-800 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1 transition cursor-pointer"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700" aria-hidden="true">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </span>
              <span className="flex flex-1 flex-col min-w-0">
                <span className="truncate font-bold text-slate-900">
                  {t('contactPharmacist') || 'Contact Pharmacist'}
                </span>
                <span className="truncate text-[11px] font-medium text-slate-600">
                  {canManageWhatsapp ? 'Manage WhatsApp dispatch desk' : 'Call helpline or send Rx inquiry'}
                </span>
              </span>
            </button>

            {showPharmacistCard && !canManageWhatsapp && (
              <div className="mt-1 rounded-xl border border-emerald-200 bg-emerald-50 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-900">
                    {t('dispensaryDesk') || 'Dispensary Desk'}
                  </span>
                  <span className="text-[11px] font-mono font-bold text-emerald-800">
                    {pharmacyPhone}
                  </span>
                </div>
                <div className="flex flex-row flex-wrap gap-2">
                  <a
                    href={`tel:${normalizedTel}`}
                    className="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                  >
                    <span>Call Desk</span>
                  </a>
                  {onRequestMedicine && (
                    <button
                      type="button"
                      onClick={() => triggerAction(onRequestMedicine)}
                      className="flex min-h-10 flex-1 items-center justify-center rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-bold text-emerald-900 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 cursor-pointer"
                    >
                      <span>Ask via Rx</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main FAB Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={t('quickActions') || 'Quick Actions'}
        className="flex min-h-12 items-center gap-2 rounded-full border border-blue-700 bg-blue-600 px-4 py-2.5 text-white shadow-lg shadow-blue-900/20 hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 active:scale-95 transition cursor-pointer"
      >
        {isOpen ? (
          <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        )}
        <span className="hidden sm:inline text-xs font-bold tracking-tight whitespace-nowrap">
          {t('quickActions') || 'Quick Actions'}
        </span>
        {!isOpen && cartCount > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1.5 text-[11px] font-black text-blue-700 tabular-nums">
            {cartCount}
          </span>
        )}
      </button>
    </div>
  );
}
