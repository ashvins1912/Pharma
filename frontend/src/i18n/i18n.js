/**
 * i18n configuration module
 * Reads from central translations.json file to support English, Hindi, Kannada, and Bengali.
 */
import translationsData from './translations.json';

const DEFAULT_LANG = 'en';

export const getSupportedLanguages = () => [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'hi', label: 'Hindi', native: 'हिंदी' },
  { code: 'kn', label: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'bn', label: 'Bengali', native: 'বাংলা' }
];

export const getStoredLanguage = () => {
  if (typeof window === 'undefined') return DEFAULT_LANG;
  return localStorage.getItem('pharma_lang') || DEFAULT_LANG;
};

export const setStoredLanguage = (lang) => {
  if (typeof window === 'undefined') return;
  const supported = ['en', 'hi', 'kn', 'bn'];
  const target = supported.includes(lang) ? lang : DEFAULT_LANG;
  localStorage.setItem('pharma_lang', target);
  window.dispatchEvent(new CustomEvent('pharma:lang-change', { detail: { lang: target } }));
};

export const translate = (key, lang = getStoredLanguage()) => {
  const dict = translationsData[lang] || translationsData[DEFAULT_LANG];
  return dict[key] || translationsData[DEFAULT_LANG][key] || key;
};

export default {
  getSupportedLanguages,
  getStoredLanguage,
  setStoredLanguage,
  translate
};
