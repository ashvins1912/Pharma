import React, { useState } from 'react';
import { useDashboardAnalytics } from '../context/DashboardAnalyticsContext';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export default function OfferZoneBanner() {
  const { addToCart } = useApp();
  const { user } = useAuth();
  const { addToast } = useToast();
  const offersData = useDashboardAnalytics();

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 4;

  const { smartRefillOffers, offerZoneItems } = offersData;

  if (!user) return null; // Show on sign-in only
  if (!offerZoneItems || offerZoneItems.length === 0) return null;

  // Sort by highest discount on top
  const sortedOffers = [...offerZoneItems].sort((a, b) => {
    const discA = a.discountPercent || 20;
    const discB = b.discountPercent || 20;
    return discB - discA;
  });

  const totalPages = Math.ceil(sortedOffers.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentOffers = sortedOffers.slice(startIndex, startIndex + itemsPerPage);

  const handleAddToCartWithDiscount = (item) => {
    const price = item.discountedPrice || item.price || 150;
    addToCart({
      ...item,
      price,
      originalPrice: item.price || price
    });
    addToast(`Added ${item.name || item.title || 'item'} with special discount to cart!`, 'success');
  };

  return (
    <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 rounded-2xl sm:rounded-3xl p-5 sm:p-7 text-white shadow-lg shadow-orange-500/20 space-y-4 my-6 relative overflow-hidden">
      <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-white/10 skew-x-12 pointer-events-none" />
      
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 relative z-10">
        <div>
          <div className="flex items-center gap-2">
            <span className="bg-white/20 px-2.5 py-0.5 rounded-full text-[10px] sm:text-xs font-black uppercase tracking-wider backdrop-blur-md">
              ⚡ Clearance Savings &amp; Surplus Specials
            </span>
            <span className="text-xs font-bold text-amber-100">
              Verified formulation discounts sorted by maximum savings
            </span>
          </div>
          <h2 className="text-base sm:text-xl font-black tracking-tight text-white mt-1">
            {smartRefillOffers.length > 0 ? 'Smart Refills & Top-Tier Discounts' : 'Exclusive Surplus Savings'}
          </h2>
        </div>

        {/* Pagination Controls / Navigation on Offer Screen */}
        {totalPages > 1 && (
          <div className="flex items-center gap-2 bg-white/20 backdrop-blur-md px-3 py-1.5 rounded-2xl w-fit">
            <button
              onClick={() => setCurrentPage(p => Math.max(p - 1, 1))}
              disabled={currentPage === 1}
              className="text-xs font-extrabold px-2 py-1 bg-white/20 hover:bg-white/40 disabled:opacity-40 rounded-xl transition cursor-pointer"
            >
              ← Prev
            </button>
            <span className="text-xs font-bold text-white px-1">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))}
              disabled={currentPage === totalPages}
              className="text-xs font-extrabold px-2 py-1 bg-white/20 hover:bg-white/40 disabled:opacity-40 rounded-xl transition cursor-pointer"
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Offer Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 relative z-10 pt-1">
        {currentOffers.map((item, idx) => {
          const name = item.name || item.title || 'Medicine Item';
          const price = item.price || 150;
          const discountPercent = item.discountPercent || 20;
          const discountedPrice = item.discountedPrice || Math.round(price * (1 - discountPercent / 100));
          const isSmartRefill = item.isSmartRefill;

          return (
            <div
              key={item.id || item._id || idx}
              className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-2xl p-4 shadow-md flex flex-col justify-between space-y-3 border border-orange-200/50 dark:border-slate-800 transition transform hover:-translate-y-0.5"
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="bg-red-100 dark:bg-red-950/80 text-red-700 dark:text-red-300 text-[10px] font-black px-2 py-0.5 rounded-md">
                    {isSmartRefill ? '🔥 Smart Refill' : `🏷️ ${discountPercent}% OFF`}
                  </span>
                  <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">
                    {item.isExpiringSoon ? 'Near Expiry (6M)' : 'Highest Saving'}
                  </span>
                </div>
                <h4 className="font-extrabold text-xs sm:text-sm line-clamp-1 text-slate-900 dark:text-white">
                  {name}
                </h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">
                  {item.offerReason || item.description || 'Verified licensed formulation available for rapid delivery.'}
                </p>
              </div>

              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <div className="text-[10px] text-slate-400 line-through">₹{price}</div>
                  <div className="text-sm font-black text-emerald-600 dark:text-emerald-400">₹{discountedPrice}</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleAddToCartWithDiscount(item)}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-3 py-2 rounded-xl transition cursor-pointer shadow-sm active:scale-95"
                >
                  Claim Offer
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
