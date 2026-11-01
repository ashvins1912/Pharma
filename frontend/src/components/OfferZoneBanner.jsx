import React, { useMemo } from 'react';
import { analyzeCustomerOffers } from '../services/analystService';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';

export default function OfferZoneBanner() {
  const { orders, medicines, addToCart } = useApp();
  const { addToast } = useToast();

  const offersData = useMemo(() => {
    return analyzeCustomerOffers(orders, medicines);
  }, [orders, medicines]);

  const { smartRefillOffers, offerZoneItems } = offersData;

  const handleAddToCartWithDiscount = (item) => {
    const price = item.discountedPrice || item.price || 150;
    const name = item.name || item.title || 'Medicine';
    
    addToCart({
      ...item,
      price,
      originalPrice: item.price || price
    });
  };

  if (!offerZoneItems || offerZoneItems.length === 0) return null;

  return (
    <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 rounded-2xl sm:rounded-3xl p-5 sm:p-7 text-white shadow-lg shadow-orange-500/20 space-y-4 my-6 relative overflow-hidden">
      <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-white/10 skew-x-12 pointer-events-none" />
      
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 relative z-10">
        <div>
          <div className="flex items-center gap-2">
            <span className="bg-white/20 px-2.5 py-0.5 rounded-full text-[10px] sm:text-xs font-black uppercase tracking-wider backdrop-blur-md">
              ⚡ Exclusive Offer Zone
            </span>
            <span className="text-xs font-bold text-amber-100">
              Limited-Time Pharmacy Refill Specials & Near-Expiry Savings
            </span>
          </div>
          <h2 className="text-base sm:text-xl font-black tracking-tight text-white mt-1">
            {smartRefillOffers.length > 0 ? 'Smart Refills & Personalized Discounts' : 'Near-Expiry & Slow-Moving Stock Discounts'}
          </h2>
        </div>
        <div className="text-xs font-bold bg-white/25 px-3 py-1.5 rounded-xl backdrop-blur-md w-fit">
          Save up to 30% on required formulations
        </div>
      </div>

      {/* Offer Cards Carousel / Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 relative z-10 pt-1">
        {offerZoneItems.slice(0, 4).map((item, idx) => {
          const name = item.name || item.title || 'Medicine Item';
          const price = item.price || 150;
          const discountedPrice = item.discountedPrice || Math.round(price * 0.8);
          const discountPercent = item.discountPercent || 20;
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
                    {item.isExpiringSoon ? 'Near Expiry (6M)' : 'Special Offer'}
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
