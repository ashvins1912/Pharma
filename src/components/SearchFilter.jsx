import React from 'react';
import { useApp } from '../context/AppContext';

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

  const isFilterActive = searchQuery || selectedCategory !== 'All' || hideRx || sortOption !== 'default';

  const clearAllFilters = () => {
    setSearchQuery('');
    setSelectedCategory('All');
    setHideRx(false);
    setSortOption('default');
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl sm:rounded-3xl p-3 sm:p-4 shadow-sm space-y-2.5 sm:space-y-3">
      {/* Top Bar: Search Input & Sort & Clear */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
          <input
            type="text"
            placeholder="Search medicines, brands, active salts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-7 py-1.5 sm:py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 focus:border-blue-500 focus:bg-white rounded-xl outline-none transition"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs p-0.5"
            >
              ✕
            </button>
          )}
        </div>

        {/* Sort Select */}
        <select
          value={sortOption}
          onChange={(e) => setSortOption(e.target.value)}
          className="text-[11px] sm:text-xs bg-slate-50 border border-slate-200 rounded-xl px-2 sm:px-3 py-1.5 sm:py-2 font-bold text-slate-700 outline-none focus:border-blue-500 cursor-pointer flex-shrink-0"
        >
          <option value="default">Sort: Default</option>
          <option value="price-asc">Price: Low to High</option>
          <option value="price-desc">Price: High to Low</option>
          <option value="name-asc">Name (A-Z)</option>
        </select>

        {isFilterActive && (
          <button
            onClick={clearAllFilters}
            className="text-[11px] sm:text-xs text-rose-600 hover:bg-rose-50 font-extrabold px-2.5 py-1.5 rounded-xl border border-rose-200 transition cursor-pointer whitespace-nowrap flex-shrink-0"
          >
            Clear
          </button>
        )}
      </div>

      {/* Category Pills & Rx Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1 border-t border-slate-100">
        
        {/* Category Pills (Compact horizontal scroll) */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`text-[11px] sm:text-xs px-2.5 py-1 rounded-lg sm:rounded-xl font-bold whitespace-nowrap transition cursor-pointer flex-shrink-0 ${
                selectedCategory === cat
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {cat}
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
          <span>Hide Rx Drugs</span>
        </label>
      </div>
    </div>
  );
}
