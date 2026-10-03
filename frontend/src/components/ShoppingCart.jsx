import React, { useState } from 'react';
import apiClient from '../api/apiClient';
import { useApp } from '../context/AppContext';
import { applyCouponCode } from '../api/couponService';

export default function ShoppingCart() {
    const { cart, subtotal = 0, selectedAddressId, updateQuantity, clearCart } = useApp();
    const [code, setCode] = useState('');
    const [pct, setPct] = useState(0);
    const [discountAmount, setDiscountAmount] = useState(0);
    const [msg, setMsg] = useState('');
    const [isSuccess, setIsSuccess] = useState(false);
    const [loading, setLoading] = useState(false);

    const checkCoupon = async () => {
        if (!code.trim()) return;
        setLoading(true);
        try {
            setMsg('');
            const result = await applyCouponCode(code.trim(), subtotal);
            if (result.success) {
                setPct(result.coupon.discountType === 'percentage' ? result.coupon.discountValue : 0);
                setDiscountAmount(result.discountAmount);
                setMsg(`✅ Applied! Saved ₹${result.discountAmount.toFixed(2)}`);
                setIsSuccess(true);
            }
        } catch (error) {
            setPct(0);
            setDiscountAmount(0);
            setMsg(`❌ ${error.message || 'Invalid coupon code'}`);
            setIsSuccess(false);
        } finally {
            setLoading(false);
        }
    };

    const checkout = async () => {
        if (!selectedAddressId) {
            setMsg("❌ Checkout Blocked: Choose a shipping location destination first.");
            setIsSuccess(false);
            return;
        }
        if (cart.length === 0) {
            setMsg("❌ Your cart is empty.");
            setIsSuccess(false);
            return;
        }
        setLoading(true);
        try {
            const finalAmt = Math.max(0, subtotal - discountAmount);
            const res = await apiClient.post('/api/orders/checkout', {
                cartItems: cart,
                totalAmount: subtotal,
                finalTotal: finalAmt,
                addressId: selectedAddressId,
                couponCode: code.trim() || undefined
            });
            setMsg(res.data.message || "🎉 Cash-on-Delivery order logged successfully!");
            setIsSuccess(true);
            clearCart();
            setCode('');
            setPct(0);
            setDiscountAmount(0);
        } catch (err) {
            setMsg(err.message || "Checkout transaction rejected.");
            setIsSuccess(false);
        } finally {
            setLoading(false);
        }
    };

    const hasOverdraft = cart.some(i => i.stock !== undefined && i.quantity > i.stock);
    const totalBill = Math.max(0, subtotal - discountAmount);

    return (
        <div className="bg-white border border-slate-200 p-4 rounded-2xl shadow-sm space-y-4">
            <div className="flex justify-between items-center border-b pb-2">
                <h3 className="font-bold text-sm text-slate-800">🛒 Cart ({cart.reduce((s, i) => s + i.quantity, 0)})</h3>
                {cart.length > 0 && (
                    <button onClick={clearCart} className="text-[10px] text-slate-400 hover:text-red-500 font-bold">Clear</button>
                )}
            </div>

            {cart.length === 0 ? (
                <p className="text-xs text-slate-400 py-4 text-center">Your shopping cart is empty.</p>
            ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                    {cart.map(i => {
                        const stockLimit = i.stock !== undefined ? i.stock : 999;
                        const isOver = i.quantity > stockLimit;
                        return (
                            <div key={i._id}
                                 className={`flex justify-between items-center text-xs border-b border-slate-100 pb-2 ${isOver ? 'bg-red-50 p-1.5 rounded border border-red-100' : ''}`}>
                                <div>
                                    <h5 className="font-medium text-slate-800">{i.name}</h5>
                                    <span className="font-bold text-emerald-600">₹{(Number(i.price) || 0) * i.quantity}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button onClick={() => updateQuantity(i._id, -1)} className="w-6 h-6 flex items-center justify-center bg-slate-100 hover:bg-slate-200 rounded text-slate-700 font-bold">-</button>
                                    <span className="font-semibold px-1">{i.quantity}</span>
                                    <button onClick={() => updateQuantity(i._id, 1)} disabled={i.quantity >= stockLimit}
                                            className="w-6 h-6 flex items-center justify-center bg-slate-100 hover:bg-slate-200 rounded text-slate-700 font-bold disabled:opacity-30">+</button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <div className="flex gap-2 pt-1">
                <input type="text" placeholder="COUPON (e.g. FREEMED20)" value={code}
                       onChange={e => { setCode(e.target.value); setDiscountAmount(0); setPct(0); setIsSuccess(false); }}
                       className="border border-slate-200 text-xs px-2.5 py-1.5 rounded-xl flex-1 uppercase outline-none focus:border-blue-500"/>
                <button onClick={checkCoupon} disabled={loading}
                        className="bg-slate-800 hover:bg-slate-900 text-white text-xs px-3 py-1.5 rounded-xl font-bold cursor-pointer transition">
                    {loading ? 'Checking...' : 'Apply'}
                </button>
            </div>

            {msg && (
                <div className={`p-2 rounded-xl text-xs font-semibold ${isSuccess ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}`}>
                    {msg}
                </div>
            )}

            <div className="border-t border-slate-100 pt-2 font-bold text-xs space-y-2">
                <div className="flex justify-between text-xs text-slate-500">
                    <span>Subtotal:</span>
                    <span>₹{subtotal}</span>
                </div>
                {discountAmount > 0 && (
                    <div className="flex justify-between text-xs text-emerald-600">
                        <span>Discount{pct > 0 ? ` (${pct}%)` : ''}:</span>
                        <span>-₹{discountAmount}</span>
                    </div>
                )}
                <div className="flex justify-between text-sm text-slate-900 font-extrabold pt-1 border-t border-dashed">
                    <span>Payable:</span>
                    <span className="text-emerald-600">₹{totalBill}</span>
                </div>
                {hasOverdraft && (
                    <p className="text-[10px] text-red-500 font-medium">Reduce quantities to match available stocks.</p>
                )}
                <button onClick={checkout} disabled={hasOverdraft || cart.length === 0 || loading}
                        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-xl text-center font-bold disabled:bg-slate-300 disabled:cursor-not-allowed cursor-pointer transition shadow-sm">
                    {loading ? 'Processing...' : 'Place COD Order'}
                </button>
            </div>
        </div>
    );
}
