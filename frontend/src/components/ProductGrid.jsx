import React, { useRef } from 'react';
import ProductCard from './ProductCard';
import { useApp } from '../context/AppContext';
import Pagination from './common/Pagination';
import { useLanguage } from '../context/LanguageContext';

export default function ProductGrid() {
  const { t } = useLanguage();
  const {
    medicines,
    medicinesError,
    loadingMedicines,
    fetchMedicines,
    searchQuery,
    setSelectedCategory,
    setSearchQuery,
    setHideRx,
    page,
    setPage,
    totalPages,
    totalMedicines,
    limit,
    isSearching,
    openRequestModal
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

  if (medicinesError) {
    return (
      <div className="my-4 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center" role="alert">
        <h3 className="font-bold text-slate-900">{t('catalogUnavailable')}</h3>
        <p className="mt-1 text-sm text-slate-600">{t('pleaseTryAgain')}</p>
        <button type="button" onClick={fetchMedicines} className="mt-3 rounded-xl bg-white px-4 py-2 text-sm font-bold text-blue-700 shadow-sm">{t('tryAgain')}</button>
      </div>
    );
  }

  if (medicines.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl sm:rounded-3xl p-6 sm:p-10 text-center space-y-4 my-4 shadow-xs">
        <div className="w-28 h-28 sm:w-36 sm:h-36 mx-auto rounded-3xl overflow-hidden shadow-md border border-slate-200">
          <img src="/src/assets/images/no_inventory_illustration_1793636345826.jpg" alt={t('noMedicinesFound')} className="w-full h-full object-cover" />
        </div>
        <div className="max-w-md mx-auto space-y-1.5">
          <h3 className="font-extrabold text-slate-800 text-sm sm:text-base">{t('noMedicinesFound')}</h3>
          <p className="text-xs text-slate-500">
            {searchQuery
              ? `No catalog matches for "${searchQuery}". Out-of-stock items also checked.`
              : t('noActiveFilters')}
          </p>
        </div>

        {/* Case 1: Can't find medicine -> Request Medicine */}
        <div className="max-w-md mx-auto bg-gradient-to-br from-blue-50 to-blue-50 border border-blue-200 rounded-2xl p-4 sm:p-5 text-left space-y-2.5 shadow-xs">
          <div className="flex items-center gap-2">
            <span className="text-xl">📋</span>
            <h4 className="font-black text-xs sm:text-sm text-blue-950">
              {t('cantFindMedicine')}
            </h4>
          </div>
          <p className="text-[11px] text-blue-800 leading-relaxed">
            Our dispensing pharmacists will check licensed supplier availability, source the medication, and formulate a proposal with pricing and delivery slot for your approval.
          </p>
          <div className="flex flex-col sm:flex-row items-center gap-2 pt-1">
            <button
              onClick={() => openRequestModal({
                name: searchQuery || '',
                originalAvailabilityStatus: 'NOT_IN_CATALOG'
              })}
              className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs px-4 py-2 rounded-xl shadow-xs transition cursor-pointer flex items-center justify-center gap-1.5"
            >
              <span>+</span>
              <span>{t('requestMedicine')}</span>
            </button>
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory('All');
                setHideRx(false);
              }}
              className="w-full sm:w-auto bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 font-bold text-xs px-3.5 py-2 rounded-xl cursor-pointer transition text-center"
            >
              {t('resetFilters')}
            </button>
          </div>
        </div>
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
            {t('showing')} {startRecord}–{endRecord} {t('of')} {totalMedicines.toLocaleString()} {t('medicines')}
          </span>
          <span className="text-[10px] bg-blue-50 text-blue-700 font-bold px-2 py-0.5 rounded-full border border-blue-100">
            {t('page')} {page} {t('of')} {totalPages}
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

      <Pagination
        page={page}
        totalPages={totalPages}
        total={totalMedicines}
        pageSize={limit}
        onPageChange={handlePageChange}
        loading={loadingMedicines}
        label="medicines"
        className="mt-6 rounded-2xl border border-slate-200 bg-white p-3 shadow-xs"
      />

      {/* Can't find medicine inquiry banner */}
      <div className="bg-gradient-to-r from-blue-50 via-blue-50 to-blue-50 border border-blue-200/80 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center text-xl flex-shrink-0">
            📋
          </div>
          <div>
            <h4 className="font-black text-slate-900 text-xs sm:text-sm">
              {t('lookingForSpecificPrescription')}
            </h4>
            <p className="text-[11px] text-slate-600 mt-0.5">
              {t('submitMedicineRequestDesc')}
            </p>
          </div>
        </div>
        <button
          onClick={() => openRequestModal({
            name: searchQuery || '',
            originalAvailabilityStatus: 'NOT_IN_CATALOG'
          })}
          className="bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs px-4 py-2 rounded-xl transition cursor-pointer flex-shrink-0 shadow-xs flex items-center gap-1.5"
        >
          <span>+</span>
          <span>{t('requestAnyMedicine')}</span>
        </button>
      </div>
    </div>
  );
}
