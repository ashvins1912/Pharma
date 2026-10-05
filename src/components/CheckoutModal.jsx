import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import apiClient from '../api/apiClient';
import AddressManager from './AddressManager';

export default function CheckoutModal({ isOpen, onClose, onOrderPlaced }) {
  const { user } = useAuth();
  const { cart, subtotal, discountAmount, deliveryFee, finalTotal, appliedCoupon, selectedAddressId, addresses, clearCart, addToCart } = useApp();
  const { addToast } = useToast();
  const prescriptionRequired = cart.some(item => item.isPrescriptionRequired || item.requiresPrescription);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [prescriptionFile, setPrescriptionFile] = useState(null);
  const [prescriptionError, setPrescriptionError] = useState('');
  const [prescriptionChoice, setPrescriptionChoice] = useState('no');
  const [prescriptionPreview, setPrescriptionPreview] = useState(null);
  const [restockItems, setRestockItems] = useState([]);
  const [restockError, setRestockError] = useState('');
  const [restockLoading, setRestockLoading] = useState(false);
  const [usePoints, setUsePoints] = useState(false);
  const [pointsRequested, setPointsRequested] = useState(0);
  const [rewardQuote, setRewardQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const quoteRequestId = useRef(0);
  const cartForQuote = JSON.stringify(cart.map(item => ({
    medicineId: item._id,
    quantity: item.quantity
  })));

  useEffect(() => {
    if (!isOpen || cart.length === 0) {
      setRewardQuote(null);
      return undefined;
    }
    const requestId = ++quoteRequestId.current;
    setQuoteLoading(true);
    const timeout = window.setTimeout(async () => {
      try {
        const response = await apiClient.post('/api/orders/checkout/quote', {
          items: JSON.parse(cartForQuote),
          pointsToRedeem: usePoints ? Number(pointsRequested) || 0 : 0,
          couponCode: appliedCoupon?.code || ''
        });
        if (requestId === quoteRequestId.current) {
          setRewardQuote(response.data);
          setQuoteError('');
        }
      } catch (error) {
        if (requestId === quoteRequestId.current) {
          setRewardQuote(null);
          setQuoteError(error.message || 'Reward quote is unavailable.');
        }
      } finally {
        if (requestId === quoteRequestId.current) setQuoteLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [isOpen, cartForQuote, cart.length, usePoints, pointsRequested, appliedCoupon?.code]);

  useEffect(() => {
    if (!isOpen) return undefined;
    let active = true;
    setRestockLoading(true);
    apiClient.get('/api/orders/dynamic-restock')
      .then(response => {
        if (active) setRestockItems(response.data.items || []);
      })
      .catch((error) => {
        if (active) setRestockError(error.message || 'Your regular restock list is temporarily unavailable.');
      })
      .finally(() => {
        if (active) setRestockLoading(false);
      });
    return () => { active = false; };
  }, [isOpen]);

  useEffect(() => {
    if (!prescriptionFile || !prescriptionFile.type.startsWith('image/')) {
      setPrescriptionPreview(null);
      return undefined;
    }
    const previewUrl = URL.createObjectURL(prescriptionFile);
    setPrescriptionPreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [prescriptionFile]);

  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen]);

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
    if (prescriptionRequired && prescriptionChoice !== 'yes') {
      setErrorMsg('Please confirm that you have a prescription for this order.');
      return;
    }
    if (prescriptionRequired && !prescriptionFile) {
      setErrorMsg("Upload a clear prescription image or PDF before placing this order.");
      return;
    }

    setLoading(true);
    setErrorMsg('');

    try {
      const checkoutData = {
        items: JSON.stringify(cart.map(item => ({
          medicineId: item._id,
          quantity: item.quantity
        }))),
        addressId: selectedAddress._id,
        deliveryAddress: selectedAddress.addressLine || `${selectedAddress.addressLine1}, ${selectedAddress.city} - ${selectedAddress.pincode}`,
        mobile: selectedAddress.mobile || user?.user_metadata?.mobile || '',
        couponCode: appliedCoupon?.code || '',
        pointsToRedeem: usePoints ? String(Number(pointsRequested) || 0) : '0',
        paymentMethod: "Cash on Delivery (COD)"
      };
      const formData = new FormData();
      Object.entries(checkoutData).forEach(([key, value]) => formData.append(key, value));
      if (prescriptionFile) formData.append('prescription', prescriptionFile);

      const res = await apiClient.post('/api/orders/checkout', formData);
      setRestockError('');

      addToast(
        res.data.rewardNotice
          ? `Order placed. ${res.data.rewardNotice}`
          : "🎉 Order placed successfully! Dispensary queue assigned.",
        res.data.rewardNotice ? "warning" : "success"
      );
      clearCart();
      setUsePoints(false);
      setPointsRequested(0);
      setPrescriptionFile(null);
      onClose();
      if (onOrderPlaced) onOrderPlaced(res.data.order || { _id: res.data.orderId, finalTotal });
    } catch (err) {
      setErrorMsg(err.message || "Checkout failed. Please verify cart items.");
      addToast(err.message || "Checkout failed", "error");
    } finally {
      setLoading(false);
    }
  };

  const addRestockItem = item => {
    if (!item.price || !item.stock) {
      addToast('This restock item is currently unavailable.', 'warning');
      return;
    }
    addToCart({
      ...item,
      _id: String(item._id),
      brand: item.manufacturer || 'Pharmacy',
      quantity: 1
    });
  };

  const retryRestockItems = async () => {
    setRestockLoading(true);
    setRestockError('');
    try {
      const response = await apiClient.get('/api/orders/dynamic-restock');
      setRestockItems(response.data.items || []);
    } catch (error) {
      setRestockError(error.message || 'Your regular restock list is temporarily unavailable.');
    } finally {
      setRestockLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex min-h-full items-start sm:items-center justify-center p-2.5 sm:p-4 animate-fade-in overscroll-contain">
      <div role="dialog" aria-modal="true" aria-labelledby="checkout-modal-title" className="my-auto bg-white border border-slate-200 rounded-3xl shadow-2xl max-w-2xl w-full max-h-[92vh] sm:max-h-[88vh] flex flex-col relative overflow-hidden">
        
        {/* Sticky Header - Stays visible when scrolling down or moving up */}
        <div className="sticky top-0 z-20 shrink-0 p-4 sm:p-6 pb-3.5 border-b border-slate-100 bg-white flex justify-between items-center shadow-xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-2xl shrink-0">📋</span>
            <div className="min-w-0">
              <h2 id="checkout-modal-title" className="text-base sm:text-lg font-black text-slate-900 truncate">
                Checkout & Order Confirmation
              </h2>
              <p className="text-[11px] text-slate-400">Step 3 of 3: Confirm address & place Cash on Delivery order</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close checkout"
            className="text-slate-400 hover:text-slate-700 w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 hover:bg-slate-200 transition cursor-pointer shrink-0 ml-2"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Form Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-6 overscroll-contain">
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold rounded-xl flex items-center gap-2">
              <span>⚠️</span>
              <span>{errorMsg}</span>
            </div>
          )}
          
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
            <div className={`mb-3 rounded-xl border p-3 ${prescriptionRequired ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-slate-50'}`}>
              <fieldset>
                <legend className="text-xs font-bold text-slate-800">Do you have a prescription for this order?</legend>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-700">
                  <label className="inline-flex items-center gap-2"><input type="radio" name="prescription-choice" checked={prescriptionChoice === 'yes'} onChange={() => setPrescriptionChoice('yes')} />Yes, I have a prescription</label>
                  <label className="inline-flex items-center gap-2"><input type="radio" name="prescription-choice" checked={prescriptionChoice === 'no'} onChange={() => { setPrescriptionChoice('no'); setPrescriptionFile(null); setPrescriptionError(''); }} />No prescription</label>
                </div>
              </fieldset>
              {prescriptionRequired && prescriptionChoice !== 'yes' && <p className="mt-2 text-xs font-bold text-rose-800">A prescription is required for one or more items in this cart. Choose Yes and upload it to continue.</p>}
              {(prescriptionRequired || prescriptionChoice === 'yes') && <>
                <label htmlFor="prescription-upload" className="mt-2 block text-xs font-bold text-slate-800">
                  Upload Prescription (PDF, JPEG, PNG, or WebP; maximum 5 MB)
                </label>
                <input
                  id="prescription-upload"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={event => {
                    const file = event.target.files?.[0] || null;
                    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
                    if (file && !allowedTypes.includes(file.type)) {
                      setPrescriptionFile(null);
                      setPrescriptionError('Choose a PDF, JPEG, PNG, or WebP file.');
                      event.target.value = '';
                      return;
                    }
                    if (file && file.size > 5 * 1024 * 1024) {
                      setPrescriptionFile(null);
                      setPrescriptionError('The prescription file must be 5 MB or smaller.');
                      event.target.value = '';
                      return;
                    }
                    setPrescriptionError('');
                    setPrescriptionFile(file);
                  }}
                  className="mt-2 block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-white file:px-3 file:py-2 file:font-bold file:text-rose-700"
                  required={prescriptionRequired}
                />
                {prescriptionFile && (
                  <div className="mt-2 flex items-center gap-3 text-[10px] text-emerald-800" role="status">
                    {prescriptionPreview && <img src={prescriptionPreview} alt="Prescription preview" className="h-12 w-12 rounded-lg object-cover" />}
                    <span>Ready to attach: {prescriptionFile.name}</span>
                  </div>
                )}
                {prescriptionError && <p className="mt-1 text-xs text-rose-700" role="alert">{prescriptionError}</p>}
              </>}
            </div>
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

          {restockError && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900" role="alert">
              <p>Your regular restock list is temporarily unavailable.</p>
              <button type="button" onClick={retryRestockItems} disabled={restockLoading} className="mt-2 font-bold underline disabled:opacity-50">{restockLoading ? 'Retrying...' : 'Try again'}</button>
            </div>
          )}

          {restockItems.length > 0 && (
            <section className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-black uppercase tracking-wider text-blue-950">Your regular restock</h3>
                  <p className="mt-1 text-[11px] text-blue-800">Frequently purchased items from completed orders</p>
                </div>
                {restockLoading && <span className="text-[10px] text-blue-700">Updating…</span>}
              </div>
              <div className="space-y-2">
                {restockItems.map(item => (
                  <div key={String(item._id)} className="flex items-center justify-between gap-3 rounded-xl bg-white p-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-slate-800">{item.name}</p>
                      <p className="text-[10px] text-slate-500">Ordered {item.orderCount} times · ₹{item.price}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => addRestockItem(item)}
                      disabled={!item.stock}
                      className="shrink-0 rounded-lg bg-blue-700 px-3 py-1.5 text-[10px] font-bold text-white disabled:bg-slate-300"
                    >
                      {item.stock ? 'Add' : 'Out of stock'}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

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
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-amber-950">
                  <input
                    type="checkbox"
                    checked={usePoints}
                    onChange={event => {
                      setUsePoints(event.target.checked);
                      if (event.target.checked) {
                        setPointsRequested(String(rewardQuote?.availablePoints || 0));
                      }
                    }}
                    disabled={!rewardQuote?.availablePoints}
                  />
                  Use loyalty points
                  <span className="ml-auto text-[10px] font-medium">
                    {rewardQuote?.availablePoints ?? '—'} available
                  </span>
                </label>
                {usePoints && (
                  <div className="mt-2">
                    <label htmlFor="checkout-points" className="block text-[10px] text-amber-900">
                      Points to redeem (₹0.10 per point)
                    </label>
                    <input
                      id="checkout-points"
                      type="number"
                      min="0"
                      max={rewardQuote?.availablePoints || 0}
                      step="1"
                      value={pointsRequested}
                      onChange={event => setPointsRequested(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-2 py-1.5 text-xs"
                    />
                  </div>
                )}
                <div className="mt-2 space-y-1 text-[11px] text-amber-950">
                  <p>{quoteLoading ? 'Checking reward eligibility…' : `Points earned after delivery: ${rewardQuote?.earnedPoints ?? '—'}`}</p>
                  {rewardQuote && (
                    <p>Basket profit margin: {Number(rewardQuote.netMarginPercentage).toFixed(1)}%</p>
                  )}
                  {rewardQuote?.redemptionBlockedReason && (
                    <p role="alert" className="font-bold text-rose-700">
                      Redemption blocked: {rewardQuote.redemptionBlockedReason}
                    </p>
                  )}
                  {rewardQuote?.redemptionEligible && !rewardQuote?.redemptionBlockedReason && (
                    <p className="font-bold text-emerald-700">This basket meets the profit threshold for point redemption.</p>
                  )}
                  {usePoints && rewardQuote?.pointsAdjusted && (
                    <p role="status" className="font-bold text-orange-700">
                      {rewardQuote.warning} Allowed: {rewardQuote.allowedPoints} points.
                    </p>
                  )}
                  {quoteError && <p role="alert" className="font-bold text-rose-700">{quoteError}</p>}
                </div>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Delivery Charge</span>
                <span className="text-emerald-600 font-bold">FREE</span>
              </div>
              <div className="border-t border-dashed border-slate-300 pt-2 flex justify-between items-center text-base font-black text-slate-900">
                <span>Payable Amount:</span>
                <span className="text-emerald-600 text-xl font-black">
                  ₹{(rewardQuote?.finalTotal ?? finalTotal) + deliveryFee > 0
                    ? ((rewardQuote?.finalTotal ?? finalTotal) + deliveryFee).toFixed(1)
                    : '0.0'}
                </span>
              </div>
            </div>
          </div>

        </div>

        {/* Footer Actions - Sticky at bottom */}
        <div className="sticky bottom-0 z-20 shrink-0 p-4 sm:p-6 pt-3.5 border-t border-slate-100 bg-white flex flex-col sm:flex-row gap-3 shadow-xs">
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
