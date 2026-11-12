import React from 'react';
import { useApp } from '../context/AppContext';
import SearchGroundingInfo from './SearchGroundingInfo';
import VoiceSearchButton from './common/VoiceSearchButton';
import { useLanguage } from '../context/LanguageContext';

const CATEGORIES = [
  'All',
  'Pain & Fever',
  'Antibiotics',
  'Allergy & Cold',
  'Vitamins & Supplements',
  'Digestion & Acidity',
  'Wellness & First Aid'
];

export default function SearchFilter() {
  const { t } = useLanguage();
  const {
    searchQuery,
    setSearchQuery,
    selectedCategory,
    setSelectedCategory,
    hideRx,
    setHideRx,
    sortOption,
    setSortOption
  } = useApp();

  const categoryLabels = { All: t('all'), 'Pain & Fever': t('painFever'), Antibiotics: t('antibiotics'), 'Allergy & Cold': t('allergyCold'), 'Vitamins & Supplements': t('vitamins'), 'Digestion & Acidity': t('digestionAcidity'), 'Wellness & First Aid': t('wellnessFirstAid') };
  const isFilterActive = searchQuery || selectedCategory !== 'All' || hideRx || sortOption !== 'default';

  const [isVoiceListening, setIsVoiceListening] = useState(false);

  const clearAllFilters = () => {
    setSearchQuery('');
    setSelectedCategory('All');
    setHideRx(false);
    setSortOption('default');
    setMicError(null);
  };

  return (
    <div className={`pharma-search-panel bg-white border rounded-2xl sm:rounded-3xl p-3 sm:p-4 shadow-sm space-y-2.5 sm:space-y-3 transition-all duration-300 ${
      isVoiceListening ? 'border-rose-400 ring-4 ring-rose-400/30 bg-rose-50/10' : 'border-slate-200'
    }`}>
      {/* Inline Voice Search Error Alert Banner */}
      {micError && (
        <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl flex items-center justify-between text-xs text-rose-900 animate-fade-in">
          <div className="flex items-center gap-2">
            <span>🎙️⚠️</span>
            <span className="font-bold">{micError.title}:</span>
            <span className="text-[11px] text-rose-800">{micError.message}</span>
          </div>
          <button
            onClick={() => setMicError(null)}
            className="text-rose-500 hover:text-rose-800 text-xs font-bold px-1.5"
            aria-label="Dismiss alert"
          >
            ✕
          </button>
        </div>
      )}

      {/* Top Bar: Search Input & Sort & Clear */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <div className="pharma-search-query relative flex-1 min-w-0 flex items-center gap-1.5">
          <div className="relative flex-1 min-w-0">
            <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-xs transition ${isVoiceListening ? 'text-rose-600 font-bold animate-bounce' : 'text-slate-400'}`}>
              {isVoiceListening ? '🎙️' : '🔍'}
            </span>
            <input
              type="text"
              placeholder={isVoiceListening ? "🎙️ Listening... Speak medicine name (e.g. Dolo 650)" : t("searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`pharma-search-query__input w-full min-w-0 pl-8 pr-7 py-2 text-xs sm:text-sm rounded-xl outline-none transition min-h-[40px] ${
                isVoiceListening
                  ? 'bg-rose-50/80 border-2 border-rose-500 text-rose-950 font-bold placeholder-rose-400 ring-2 ring-rose-400/40'
                  : 'bg-slate-50 border border-slate-200 focus:border-blue-500 focus:bg-white'
              }`}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs p-1"
                aria-label={t("clearSearch")}
              >
                ✕
              </button>
            )}
          </div>
          <VoiceSearchButton
            onTranscript={(spokenText) => setSearchQuery(spokenText)}
            onError={(err) => setMicError(err)}
            onListeningChange={(listening) => setIsVoiceListening(listening)}
            currentQuery={searchQuery}
          />
        </div>

        <div className="pharma-search-controls flex items-center gap-2 shrink-0">
          {/* Sort Select */}
          <select
            value={sortOption}
            onChange={(e) => setSortOption(e.target.value)}
            className="pharma-search-sort text-xs bg-slate-50 border border-slate-200 rounded-xl px-2.5 sm:px-3 py-2 font-bold text-slate-700 outline-none focus:border-blue-500 cursor-pointer min-h-[40px] flex-1 sm:flex-none"
          >
            <option value="default">{t("sortDefault")}</option>
            <option value="price-asc">{t("priceLowHigh")}</option>
            <option value="price-desc">{t("priceHighLow")}</option>
            <option value="name-asc">{t("nameAZ")}</option>
          </select>

          {isFilterActive && (
            <button
              onClick={clearAllFilters}
              className="pharma-search-clear text-xs text-rose-600 hover:bg-rose-50 font-extrabold px-3 py-2 rounded-xl border border-rose-200 transition cursor-pointer whitespace-nowrap min-h-[40px]"
            >
              {t('clear')}
            </button>
          )}
        </div>
      </div>

      {/* Category Pills & Rx Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1 border-t border-slate-100">
        
        {/* Category Pills (Compact horizontal scroll) */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          {CATEGORIES.map((cat) => (
            <button
              key={categoryLabels[cat] || cat}
              onClick={() => setSelectedCategory(cat)}
              className={`text-[11px] sm:text-xs px-2.5 py-1 rounded-lg sm:rounded-xl font-bold whitespace-nowrap transition cursor-pointer flex-shrink-0 ${
                selectedCategory === cat
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {categoryLabels[cat] || cat}
            </button>
          ))}
        </div>

        {/* Prescription Checkbox */}
        <label className="flex items-center gap-1.5 text-[11px] sm:text-xs font-semibold text-slate-600 cursor-pointer select-none whitespace-nowrap flex-shrink-0">
          <input
            type="checkbox"
            checked={hideRx}
            onChange={(e) => setHideRx(e.target.checked)}
            className="w-3.5 h-3.5 rounded text-blue-600 border-slate-300 focus:ring-blue-500 cursor-pointer"
          />
          <span>{t('hideRx')}</span>
        </label>
      </div>

      {/* Real-Time Medical Search Grounding Box */}
      <SearchGroundingInfo searchQuery={searchQuery} />
    </div>
  );
}
