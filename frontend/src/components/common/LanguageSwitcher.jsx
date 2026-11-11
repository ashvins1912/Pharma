import React from 'react';
import { useLanguage } from '../../context/LanguageContext';

export default function LanguageSwitcher({ className = '' }) {
  const { language, setLanguage, languages, t } = useLanguage();

  return (
    <div
      className={`flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200/70 px-2.5 py-1.5 rounded-xl border border-slate-200 transition shrink-0 ${className}`}
      title={t('selectLanguage') || 'Choose language'}
    >
      <span className="text-xs" aria-hidden="true">🌐</span>
      <select
        value={language}
        onChange={(e) => setLanguage(e.target.value)}
        aria-label={t('selectLanguage') || 'Choose language'}
        className="bg-transparent text-[11px] font-black text-slate-800 outline-none cursor-pointer"
      >
        {languages.map((l) => (
          <option key={l.code} value={l.code}>
            {l.nativeLabel} ({l.label})
          </option>
        ))}
      </select>
    </div>
  );
}
