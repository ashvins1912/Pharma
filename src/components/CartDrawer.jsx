import React from 'react';
import { useApp } from '../context/AppContext';

export default function CartDrawer({ isOpen, onClose, onProceedToCheckout }) {
  const {
    cart,
    updateQuantity,
    removeFromCart,
    clearCart,
    subtotal,
    discountAmount,
    deliveryFee,
    finalTotal,
    appliedCoupon,
    couponCode,
    setCouponCode,
    couponError,
    applyCoupon,
    removeCoupon
  } = useApp();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden animate-fade-in">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity"
      />

      <div className="fixed inset-y-0 right-0 max-w-full flex pl-0 sm:pl-10">
        <div className="w-screen max-w-md bg-white border-l border-slate-200 shadow-2xl flex flex-col justify-between">
          
          {/* Header */}
          <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">🛒</span>
              <h2 className="text-base font-extrabold text-slate-900">
                Your Shopping Cart ({cart.reduce((s, i) => s + i.quantity, 0)})
              </h2>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-700 w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 hover:bg-slate-200 cursor-pointer transition"
            >
              ✕
            </button>
          </div>

          {/* Cart Content */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {cart.length === 0 ? (
              <div className="text-center py-16 space-y-4">
                <div className="w-20 h-20 mx-auto rounded-3xl bg-blue-50 text-blue-600 flex items-center justify-center text-4xl">
                  🛍️
                </div>
                <div className="space-y-1">
                  <h3 className="font-extrabold text-slate-800 text-base">Your cart is empty</h3>
                  <p className="text-xs text-slate-500 max-w-xs mx-auto">
                    Find medicines and healthcare products for your everyday family needs.
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-6 py-2.5 rounded-xl cursor-pointer transition shadow-md shadow-blue-600/20"
                >
                  Browse Medicines
                </button>
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  {cart.map((item) => (
                    <div
                      key={item._id}
                      className="flex items-center gap-3 p-3 bg-slate-50/70 border border-slate-100 rounded-2xl"
                    >
                      <img
                        src={item.imageUrl || "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=100&q=80"}
                        alt={item.name}
                        className="w-14 h-14 object-cover rounded-xl bg-white border border-slate-200 p-1 flex-shrink-0"
                      />

                      <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-xs text-slate-900 truncate">{item.name}</h4>
                        <p className="text-[10px] text-slate-400">Unit: ₹{item.price}</p>
                        <span className="font-extrabold text-xs text-emerald-600">
                          ₹{item.price * item.quantity}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <div className="flex items-center bg-white border border-slate-200 rounded-xl p-0.5">
                          <button
                            onClick={() => updateQuantity(item._id, -1)}
                            className="w-6 h-6 flex items-center justify-center text-slate-700 hover:bg-slate-100 rounded font-black text-xs cursor-pointer"
                          >
                            −
                          </button>
                          <span className="w-6 text-center font-extrabold text-xs text-slate-900">
                            {item.quantity}
                          </span>
                          <button
                            onClick={() => updateQuantity(item._id, 1)}
                            disabled={item.quantity >= item.stock}
                            className="w-6 h-6 flex items-center justify-center text-slate-700 hover:bg-slate-100 disabled:opacity-30 rounded font-black text-xs cursor-pointer"
                          >
                            +
                          </button>
                        </div>

                        <button
                          onClick={() => removeFromCart(item._id)}
                          className="text-slate-400 hover:text-rose-600 p-1 cursor-pointer transition text-xs"
                          aria-label="Remove item"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Coupon Code Section */}
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                      🎟️ Promo Code
                    </span>
                    <span className="text-[10px] text-slate-400">Try: FREEMED20 or WELCOME10</span>
                  </div>

                  {appliedCoupon ? (
                    <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-xl text-xs">
                      <div>
                        <span className="font-black text-emerald-800 uppercase">{appliedCoupon.code}</span>
                        <span className="text-emerald-600 text-[11px] ml-2">({appliedCoupon.discountPercentage}% OFF)</span>
                      </div>
                      <button
                        onClick={removeCoupon}
                        className="text-emerald-700 hover:text-emerald-900 text-xs font-bold cursor-pointer"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="ENTER COUPON"
                        value={couponCode}
                        onChange={(e) => setCouponCode(e.target.value)}
                        className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl outline-none uppercase font-bold text-slate-800"
                      />
                      <button
                        onClick={() => applyCoupon()}
                        className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs px-3.5 py-1.5 rounded-xl transition cursor-pointer"
                      >
                        Apply
                      </button>
                    </div>
                  )}

                  {couponError && (
                    <p className="text-[10px] font-bold text-rose-600">{couponError}</p>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Drawer Footer with Price Breakdown & Checkout Button */}
          {cart.length > 0 && (
            <div className="p-6 border-t border-slate-100 bg-white space-y-3">
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between text-slate-500">
                  <span>Cart Subtotal</span>
                  <span>₹{subtotal}</span>
                </div>
                {appliedCoupon && (
                  <div className="flex justify-between text-emerald-600 font-semibold">
                    <span>Discount ({appliedCoupon.discountPercentage}%)</span>
                    <span>−₹{discountAmount.toFixed(1)}</span>
                  </div>
                )}
                <div className="flex justify-between text-slate-500">
                  <span>Delivery Charge</span>
                  <span className="text-emerald-600 font-bold">FREE (Dispensary Promo)</span>
                </div>
                <div className="border-t border-slate-200 pt-2 flex justify-between items-center text-slate-900 font-black text-base">
                  <span>Final Total</span>
                  <span className="text-emerald-600 text-lg">₹{finalTotal.toFixed(1)}</span>
                </div>
              </div>

              <button
                onClick={() => {
                  onClose();
                  onProceedToCheckout();
                }}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3.5 rounded-2xl shadow-lg shadow-emerald-600/25 transition cursor-pointer text-sm flex items-center justify-center gap-2"
              >
                <span>Proceed to Checkout</span>
                <span>→</span>
              </button>

              <p className="text-[10px] text-center text-slate-400 font-medium">
                🔒 Safe & Verified Delivery • Pay Cash on Delivery (COD)
              </p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
