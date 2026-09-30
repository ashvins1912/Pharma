import React, { useState } from 'react';
import { useApp } from '../context/AppContext';

export default function ProductCard({ med }) {
  const { cart, addToCart, updateQuantity, openRequestModal } = useApp();
  const [imageError, setImageError] = useState(false);

  const stock = med.availableQuantity ?? med.stock ?? med.quantity ?? 0;
  const isOut = stock <= 0 || med.isExpired;
  const isLow = stock > 0 && stock < 5;

  // Find item in cart
  const cartItem = cart.find(item => item._id === med._id);
  const cartQty = cartItem ? cartItem.quantity : 0;

  // Fallback image placeholder
  const fallbackUrl = "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&q=80";
  const displayImage = imageError || !med.imageUrl ? fallbackUrl : med.imageUrl;

  return (
    <div
      className={`bg-white border rounded-xl sm:rounded-2xl p-2.5 sm:p-4 flex flex-col justify-between transition-all duration-200 h-full ${
        isOut
          ? 'border-slate-200 opacity-60 bg-slate-50/50'
          : 'border-slate-200 hover:border-blue-300 hover:shadow-md hover:-translate-y-0.5'
      }`}
    >
      <div>
        {/* Compact Product Image Container */}
        <div className="relative w-full h-28 sm:h-36 md:h-40 bg-gradient-to-tr from-slate-100 to-blue-50/40 rounded-lg sm:rounded-xl overflow-hidden mb-2 sm:mb-3 flex items-center justify-center">
          {displayImage && !imageError ? (
            <img
              src={displayImage}
              alt={med.name}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setImageError(true)}
              className="w-full h-full object-cover transition-transform duration-300 hover:scale-105"
            />
          ) : (
            <div className="flex flex-col items-center justify-center p-3 text-slate-400 select-none">
              <span className="text-3xl sm:text-4xl mb-1">💊</span>
              <span className="text-[10px] sm:text-[11px] font-bold text-slate-500 uppercase tracking-wider text-center line-clamp-1">
                {med.category || 'Pharmaceutical'}
              </span>
            </div>
          )}

          {/* Status Badges */}
          <div className="absolute top-1.5 left-1.5 flex flex-col gap-1">
            {(med.isPrescriptionRequired || med.requiresPrescription) && (
              <span className="bg-rose-600 text-white text-[9px] sm:text-[10px] font-black px-1.5 py-0.5 rounded shadow-xs tracking-wider uppercase">
                Rx Only
              </span>
            )}
            {med.isExpired && (
              <span className="bg-red-600 text-white text-[9px] sm:text-[10px] font-black px-1.5 py-0.5 rounded shadow-xs tracking-wider uppercase">
                Expired
              </span>
            )}
            {!med.isExpired && isOut && (
              <span className="bg-slate-700 text-white text-[9px] sm:text-[10px] font-black px-1.5 py-0.5 rounded shadow-xs tracking-wider uppercase">
                Sold Out
              </span>
            )}
            {!med.isExpired && !isOut && !isLow && (
              <span className="bg-emerald-600 text-white text-[9px] sm:text-[10px] font-black px-1.5 py-0.5 rounded shadow-xs tracking-wider uppercase">
                In Stock
              </span>
            )}
          </div>

          {isLow && !med.isExpired && (
            <span className="absolute bottom-1.5 right-1.5 bg-amber-500 text-white text-[9px] sm:text-[10px] font-extrabold px-1.5 py-0.5 rounded shadow-xs">
              Only {stock} Left
            </span>
          )}
        </div>

        {/* Category & Brand */}
        <div className="flex items-center justify-between text-[9px] sm:text-[11px] text-slate-400 font-semibold mb-0.5">
          <span className="truncate max-w-[50%]">{med.category || 'General'}</span>
          <span className="truncate max-w-[45%] text-right">{med.brand}</span>
        </div>

        {/* Medicine Name */}
        <h3 className="font-extrabold text-slate-900 text-xs sm:text-sm leading-snug line-clamp-2 mb-1">
          {med.name}
        </h3>

        {/* Description / Formulation */}
        <p className="text-[10px] sm:text-[11px] text-slate-500 line-clamp-1 leading-normal mb-1">
          {med.composition || med.description || 'Active pharmaceutical grade formulation.'}
        </p>
        {isOut && (
          <p className="text-[10px] text-amber-700 font-semibold mb-1 leading-tight">
            Currently out of stock. Ask Ashvin Pharmacy to arrange it.
          </p>
        )}
        {med.expiryDate && (
          <p className="mb-2 text-[9px] text-slate-400">
            Expires: {new Date(med.expiryDate).toLocaleDateString()}
          </p>
        )}
      </div>

      {/* Card Footer: Always aligned at bottom */}
      <div className="pt-2 sm:pt-3 border-t border-slate-100 flex items-center justify-between gap-1.5 mt-auto">
        <div>
          <span className="text-[9px] sm:text-[10px] text-slate-400 font-bold uppercase block leading-none">Price</span>
          <span className="text-xs sm:text-base font-black text-emerald-600">
            ₹{med.price}
          </span>
        </div>

        <div>
          {isOut ? (
            <button
              onClick={() => openRequestModal({
                name: med.name,
                brand: med.brand,
                strength: med.composition || '',
                dosageForm: med.category?.includes('Syrup') ? 'Syrup' : 'Tablet',
                medicineId: med._id,
                originalAvailabilityStatus: 'OUT_OF_STOCK'
              })}
              title="Currently out of stock. Ask Ashvin Pharmacy to arrange it."
              className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-extrabold text-xs px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-lg sm:rounded-xl cursor-pointer transition shadow-xs flex items-center gap-1 min-h-[36px]"
            >
              <span>📋</span>
              <span className="sm:hidden">Request</span>
              <span className="hidden sm:inline">Request Medicine</span>
            </button>
          ) : cartQty > 0 ? (
            /* Compact Step Controller with accessible touch sizing */
            <div className="flex items-center bg-blue-50 border border-blue-200 rounded-lg sm:rounded-xl p-1">
              <button
                onClick={() => updateQuantity(med._id, -1)}
                className="w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center text-blue-700 hover:bg-blue-200 rounded-md font-black text-xs cursor-pointer transition"
                aria-label="Decrease quantity"
              >
                −
              </button>
              <span className="w-6 sm:w-7 text-center font-extrabold text-xs text-blue-900 tabular-nums">
                {cartQty}
              </span>
              <button
                onClick={() => updateQuantity(med._id, 1)}
                disabled={cartQty >= stock}
                className="w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center text-blue-700 hover:bg-blue-200 disabled:opacity-30 rounded-md font-black text-xs cursor-pointer transition"
                aria-label="Increase quantity"
              >
                +
              </button>
            </div>
          ) : (
            <button
              onClick={() => addToCart(med)}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg sm:rounded-xl shadow-xs transition cursor-pointer flex items-center gap-1 min-h-[36px]"
            >
              <span>+</span>
              <span>Add</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
