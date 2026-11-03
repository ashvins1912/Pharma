import React, { useState } from 'react';
import { useLanguage } from '../context/LanguageContext';

export default function QuickActionsFAB({ onRefillPrescriptions, onContactPharmacist }) {
  const { t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="fixed bottom-5 right-5 z-[100] sm:hidden flex flex-col items-end">
      {/* Expanded Menu Actions */}
      {isOpen && (
        <div className="mb-3 flex flex-col gap-2.5 animate-fade-in">
          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              onRefillPrescriptions?.();
            }}
            className="flex items-center gap-2.5 bg-white text-slate-800 border border-slate-200 px-4 py-3 rounded-2xl shadow-xl font-bold text-xs active:scale-95 transition cursor-pointer whitespace-nowrap"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-blue-50 text-blue-600 text-sm">📋</span>
            <span>{t('refillPrescriptions') || 'Refill Prescriptions'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              onContactPharmacist?.();
            }}
            className="flex items-center gap-2.5 bg-white text-slate-800 border border-slate-200 px-4 py-3 rounded-2xl shadow-xl font-bold text-xs active:scale-95 transition cursor-pointer whitespace-nowrap"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 text-sm">💬</span>
            <span>{t('contactPharmacist') || 'Contact Pharmacist'}</span>
          </button>
        </div>
      )}

      {/* Main FAB Toggle Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-2xl shadow-blue-600/40 hover:bg-blue-700 active:scale-95 transition cursor-pointer"
        aria-label={t('quickActions') || 'Quick Actions'}
      >
        {isOpen ? (
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <span className="text-2xl leading-none">⚡</span>
        )}
      </button>
    </div>
  );
}
