import React, { useState } from 'react';
import { useLanguage } from '../context/LanguageContext';

function ActionIcon({ type, className = 'h-5 w-5' }) {
  const paths = {
    refill: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h8M8 11h5M12 15v4m-2-2h4" /></>,
    contact: <><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 3.9a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z" /><path d="M8.5 12h7" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>
  };
  return <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[type]}</svg>;
}

export default function QuickActionsFAB({ onRefillPrescriptions, onContactPharmacist }) {
  const { t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const actions = [
    { key: 'refill', label: t('refillPrescriptions') || 'Refill prescriptions', description: 'Upload or manage a prescription', onClick: onRefillPrescriptions, tone: 'text-blue-700 bg-blue-50 dark:bg-blue-950/50 dark:text-blue-300' },
    { key: 'contact', label: t('contactPharmacist') || 'Contact pharmacist', description: 'Ask a pharmacist for help', onClick: onContactPharmacist, tone: 'text-emerald-700 bg-emerald-50 dark:bg-emerald-950/50 dark:text-emerald-300' }
  ];
  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col items-end sm:hidden">
      {isOpen && (
        <div id="quick-actions-menu" role="group" aria-label={t('quickActions') || 'Quick actions'} className="mb-3 w-[min(19rem,calc(100vw-2.5rem))] space-y-2 rounded-2xl border border-slate-200 bg-white/95 p-2.5 shadow-2xl shadow-slate-900/15 backdrop-blur-xl animate-fade-in dark:border-slate-700 dark:bg-slate-900/95">
          {actions.map(action => (
            <button key={action.key} type="button" onClick={() => { setIsOpen(false); action.onClick?.(); }} className="flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:bg-slate-50 active:scale-[.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-slate-800">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${action.tone}`}><ActionIcon type={action.key} /></span>
              <span className="min-w-0 flex-1"><span className="block text-xs font-extrabold text-slate-900 dark:text-white">{action.label}</span><span className="mt-0.5 block text-[10px] text-slate-500 dark:text-slate-400">{action.description}</span></span>
              <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6" /></svg>
            </button>
          ))}
        </div>
      )}
      <button type="button" onClick={() => setIsOpen(value => !value)} aria-label={t('quickActions') || 'Quick actions'} aria-expanded={isOpen} aria-controls="quick-actions-menu" className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-700 text-white shadow-xl shadow-blue-700/30 transition hover:bg-blue-800 active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 dark:focus-visible:ring-blue-900">
        <ActionIcon type={isOpen ? 'close' : 'menu'} className="h-6 w-6" />
      </button>
    </div>
  );
}
