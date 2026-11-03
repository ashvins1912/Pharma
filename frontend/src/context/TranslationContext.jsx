import React, { createContext, useContext } from 'react';
import { useLanguage as useCoreLanguage } from './LanguageContext';

export const TranslationContext = createContext(null);

export function TranslationProvider({ children }) {
  const core = useCoreLanguage();
  return (
    <TranslationContext.Provider value={core}>
      {children}
    </TranslationContext.Provider>
  );
}

export const useTranslation = () => {
  const ctx = useContext(TranslationContext);
  if (ctx && typeof ctx.t === 'function') {
    return ctx;
  }
  return useCoreLanguage();
};

export const useLanguage = useTranslation;
export default TranslationProvider;


