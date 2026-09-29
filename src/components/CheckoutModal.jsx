import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import apiClient from '../api/apiClient';
import AddressManager from './AddressManager';

export default function CheckoutModal({ isOpen, onClose, onOrderPlaced }) {
  const { user } = useAuth();
  const { cart, subtotal, discountAmount, deliveryFee, finalTotal, appliedCoupon, selectedAddressId, addresses, clearCart } = useApp();
  const { addToast } = useToast();

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const selectedAddress = addresses.find(a => a._id === selectedAddressId) || addresses[0];

  const handlePlaceOrder = async () => {
    if (!selectedAddress) {
      setErrorMsg("Please select or add a delivery destination address first.");
      addToast("Please select a delivery address", "warning");
      return;
    }

    if (cart.length === 0) {
      setErrorMsg("Your cart is empty.");
      return;
    }

    setLoading(true);
    setErrorMsg('');

    try {
      const res = await apiClient.post('/api/orders/checkout', {
        cartItems: cart,
        totalAmount: subtotal,
        finalTotal: Math.round(finalTotal * 10) / 10,
        addressId: selectedAddress._id,
        deliveryAddress: selectedAddress.addressLine || `${selectedAddress.addressLine1}, ${selectedAddress.city} - ${selectedAddress.pincode}`,
        coordinates: selectedAddress.coordinates || { lat: 12.9716, lng: 77.5946 },
        mobile: selectedAddress.mobile || user?.user_metadata?.mobile || '+91 95899 16475',
        paymentMethod: "Cash on Delivery (COD)"
      });

      addToast("🎉 Order placed successfully! Dispensary queue assigned.", "success");
      clearCart();
      onClose();
      if (onOrderPlaced) onOrderPlaced(res.data.order || { _id: res.data.orderId, finalTotal });
    } catch (err) {
      setErrorMsg(err.message || "Checkout failed. Please verify cart items.");
      addToast(err.message || "Checkout failed", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-3xl shadow-2xl max-w-2xl w-full p-6 sm:p-8 my-8 relative">
        
        {/* Header */}
        <div className="flex justify-between items-center pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">📋</span>
            <div>
              <h2 className="text-lg font-black text-slate-900">Checkout & Order Confirmation</h2>
              <p className="text-[11px] text-slate-400">Step 3 of 3: Confirm address & place Cash on Delivery order</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 hover:bg-slate-200 transition cursor-pointer"
          >
            ✕
          </button>
        </div>

        {errorMsg && (
          <div className="my-4 p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold rounded-xl flex items-center gap-2">
            <span>⚠️</span>
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="space-y-6 py-4">
          
          {/* Section 1: Delivery Address Selection */}
          <div>
            <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider mb-2.5">
              1. Choose Shipping Address
            </h3>
            <AddressManager isSelectOnly={true} />
          </div>

          {/* Section 2: Order Items Summary */}
          <div>
            <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider mb-2.5">
              2. Prescription & Medicine Items ({cart.length})
            </h3>
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 max-h-48 overflow-y-auto space-y-2">
              {cart.map((item) => (
                <div key={item._id} className="flex justify-between items-center text-xs">
                  <div>
                    <span className="font-bold text-slate-900">{item.name}</span>
                    <span className="text-slate-400 ml-2">x{item.quantity}</span>
                  </div>
                  <span className="font-extrabold text-slate-800">₹{item.price * item.quantity}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Section 3: Payment Method & Totals */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-600">Payment Option</span>
              <span className="bg-emerald-100 text-emerald-800 text-xs font-black px-2.5 py-1 rounded-xl">
                💵 Cash on Delivery (COD)
              </span>
            </div>

            <div className="border-t border-slate-200 pt-3 space-y-1.5 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal ({cart.reduce((s, i) => s + i.quantity, 0)} items)</span>
                <span>₹{subtotal}</span>
              </div>
              {appliedCoupon && (
                <div className="flex justify-between text-emerald-600 font-bold">
                  <span>Discount Coupon ({appliedCoupon.code})</span>
                  <span>−₹{discountAmount.toFixed(1)}</span>
                </div>
              )}
              <div className="flex justify-between text-slate-600">
                <span>Delivery Charge</span>
                <span className="text-emerald-600 font-bold">FREE</span>
              </div>
              <div className="border-t border-dashed border-slate-300 pt-2 flex justify-between items-center text-base font-black text-slate-900">
                <span>Payable Amount:</span>
                <span className="text-emerald-600 text-xl font-black">₹{finalTotal.toFixed(1)}</span>
              </div>
            </div>
          </div>

        </div>

        {/* Footer Actions */}
        <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row gap-3">
          <button
            onClick={onClose}
            className="w-full sm:w-1/3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 rounded-2xl text-xs cursor-pointer transition"
          >
            Cancel
          </button>
          <button
            onClick={handlePlaceOrder}
            disabled={loading || !selectedAddress || cart.length === 0}
            className="w-full sm:w-2/3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-extrabold py-3 rounded-2xl text-xs shadow-lg shadow-emerald-600/25 transition cursor-pointer flex items-center justify-center gap-2"
          >
            <span>{loading ? 'Submitting Order...' : 'Confirm & Place COD Order'}</span>
            <span>✓</span>
          </button>
        </div>

      </div>
    </div>
  );
}
