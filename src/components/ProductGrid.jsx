import React, { useRef } from 'react';
import ProductCard from './ProductCard';
import { useApp } from '../context/AppContext';

export default function ProductGrid() {
  const {
    medicines,
    loadingMedicines,
    searchQuery,
    setSelectedCategory,
    setSearchQuery,
    setHideRx,
    page,
    setPage,
    totalPages,
    totalMedicines,
    limit,
    isSearching
  } = useApp();

  const gridTopRef = useRef(null);

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages && newPage !== page) {
      setPage(newPage);
      if (gridTopRef.current) {
        gridTopRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  };

  // Generate page numbers with ellipses
  const getPageNumbers = () => {
    const pages = [];
    if (totalPages <= 5) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push('...');
      const start = Math.max(2, page - 1);
      const end = Math.min(totalPages - 1, page + 1);
      for (let i = start; i <= end; i++) {
        if (!pages.includes(i)) pages.push(i);
      }
      if (page < totalPages - 2) pages.push('...');
      if (!pages.includes(totalPages)) pages.push(totalPages);
    }
    return pages;
  };

  if (loadingMedicines) {
    return (
      <div className="space-y-4">
        <div className="h-6 bg-slate-200/60 rounded-lg w-48 animate-pulse"></div>
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <div key={n} className="bg-white border border-slate-200 rounded-xl sm:rounded-2xl p-2.5 sm:p-4 space-y-2 sm:space-y-3 animate-pulse">
              <div className="w-full h-24 sm:h-36 bg-slate-100 rounded-lg sm:rounded-xl"></div>
              <div className="h-2.5 bg-slate-100 rounded w-1/3"></div>
              <div className="h-3.5 bg-slate-100 rounded w-3/4"></div>
              <div className="h-2.5 bg-slate-100 rounded w-full"></div>
              <div className="pt-2 flex justify-between items-center">
                <div className="h-4 bg-slate-100 rounded w-12"></div>
                <div className="h-6 bg-slate-100 rounded w-14"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (medicines.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl sm:rounded-3xl p-8 sm:p-12 text-center space-y-3 my-4 shadow-xs">
        <div className="w-12 h-12 sm:w-16 sm:h-16 mx-auto bg-slate-100 rounded-2xl flex items-center justify-center text-2xl sm:text-3xl">
          🔍
        </div>
        <div className="max-w-sm mx-auto space-y-1">
          <h3 className="font-extrabold text-slate-800 text-sm sm:text-base">No medicines found</h3>
          <p className="text-xs text-slate-500">
            {searchQuery
              ? `No catalog matches for "${searchQuery}". Out-of-stock items also checked.`
              : 'No items match your active filters.'}
          </p>
        </div>
        <button
          onClick={() => {
            setSearchQuery('');
            setSelectedCategory('All');
            setHideRx(false);
          }}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-4 py-2 rounded-xl cursor-pointer transition shadow-sm"
        >
          Reset All Filters
        </button>
      </div>
    );
  }

  const startRecord = (page - 1) * limit + 1;
  const endRecord = Math.min(totalMedicines, (page - 1) * limit + medicines.length);

  return (
    <div ref={gridTopRef} className="space-y-4">
      {/* Information Header & Availability Indicator */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-1.5 text-xs text-slate-500 pb-1">
        <div className="flex items-center gap-2">
          <span className="font-extrabold text-slate-800">
            Showing {startRecord}–{endRecord} of {totalMedicines.toLocaleString()} medicines
          </span>
          <span className="text-[10px] bg-blue-50 text-blue-700 font-bold px-2 py-0.5 rounded-full border border-blue-100">
            Page {page} of {totalPages}
          </span>
        </div>

        {/* Search vs Browse Inventory Rule Note */}
        <div>
          {isSearching ? (
            <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md inline-flex items-center gap-1">
              <span>🔍</span> Showing search matches (out-of-stock items included)
            </span>
          ) : (
            <span className="text-[11px] text-slate-400 hidden sm:inline">
              ✓ In-stock catalog (out-of-stock items show on search only)
            </span>
          )}
        </div>
      </div>

      {/* Responsive Product Grid: 2 cols on mobile, 4 on desktop */}
      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-4">
        {medicines.map((med) => (
          <ProductCard key={med._id} med={med} />
        ))}
      </div>

      {/* Pagination Controller */}
      {totalPages > 1 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-3 sm:p-4 mt-6 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
          
          <div className="text-xs text-slate-500 font-medium">
            Page <strong className="text-slate-900">{page}</strong> of <strong className="text-slate-900">{totalPages}</strong> ({totalMedicines.toLocaleString()} total items)
          </div>

          <div className="flex items-center gap-1 sm:gap-1.5">
            {/* Previous Page Button */}
            <button
              onClick={() => handlePageChange(page - 1)}
              disabled={page <= 1}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer flex items-center gap-1"
              aria-label="Previous Page"
            >
              <span>‹</span>
              <span className="hidden sm:inline">Prev</span>
            </button>

            {/* Page Number Buttons */}
            {getPageNumbers().map((pNum, idx) => {
              if (pNum === '...') {
                return (
                  <span key={`dots-${idx}`} className="px-1.5 py-1 text-slate-400 text-xs font-bold select-none">
                    ...
                  </span>
                );
              }

              const isCurrent = pNum === page;
              return (
                <button
                  key={pNum}
                  onClick={() => handlePageChange(pNum)}
                  className={`w-8 h-8 rounded-lg text-xs font-extrabold transition cursor-pointer flex items-center justify-center ${
                    isCurrent
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'border border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {pNum}
                </button>
              );
            })}

            {/* Next Page Button */}
            <button
              onClick={() => handlePageChange(page + 1)}
              disabled={page >= totalPages}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer flex items-center gap-1"
              aria-label="Next Page"
            >
              <span className="hidden sm:inline">Next</span>
              <span>›</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
