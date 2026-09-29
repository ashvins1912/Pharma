import React, { useState } from 'react';
import apiClient from '../api/apiClient';
import { useApp } from '../context/AppContext';

export default function ShoppingCart() {
    const {cart, subtotal, selectedAddressId, updateQuantity, clearCart} = useApp();
    const [code, setCode] = useState('');
    const [pct, setPct] = useState(0);
    const [msg, setMsg] = useState('');

    const checkCoupon = async () => {
        try {
            const res = await apiClient.get(`/api/coupons/validate/${code.trim()}`);
            if (res.data.valid) {
                setPct(res.data.discountPercentage);
                setMsg(`Applied! Saved ${res.data.discountPercentage}%`);
            }
        } catch {
            setPct(0);
            setMsg('Invalid code');
        }
    };

    const checkout = async () => {
        if (!selectedAddressId) return alert("❌ Checkout Blocked: Choose a shipping location node first.");
        try {
            const finalAmt = subtotal - (subtotal * pct / 100);
            await apiClient.post('/api/orders/checkout', {
                cartItems: cart,
                totalAmount: subtotal,
                finalTotal: finalAmt,
                addressId: selectedAddressId
            });
            alert("🎉 Cash-on-Delivery order logged successfully!");
            clearCart();
            setCode('');
            setPct(0);
            setMsg('');
        } catch {
            alert("Checkout transaction rejected.");
        }
    };

    const hasOverdraft = cart.some(i => i.quantity > i.stock);
    const totalBill = subtotal - (subtotal * pct / 100);

    return (
        <div className="bg-white border p-4 rounded-2xl shadow-sm space-y-4">
            <h3 className="font-bold text-sm">🛒 Basket Cart</h3>
            {cart.map(i => (
                <div key={i._id}
                     className={`flex justify-between text-xs border-b pb-2 ${i.quantity > i.stock ? 'bg-red-50 p-1.5 rounded border border-red-100' : ''}`}>
                    <div><h5>{i.name}</h5><span className="font-bold text-emerald-600">₹{i.price * i.quantity}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={() => updateQuantity(i._id, -1)} className="px-2 bg-slate-100 rounded">-
                        </button>
                        <span>{i.quantity}</span>
                        <button onClick={() => updateQuantity(i._id, 1)} disabled={i.quantity >= i.stock}
                                className="px-2 bg-slate-100 rounded disabled:opacity-30">+
                        </button>
                    </div>
                </div>
            ))}
            <div className="flex gap-2 pt-2">
                <input type="text" placeholder="COUPON" value={code} onChange={e => setCode(e.target.value)}
                       className="border text-xs px-2 py-1 rounded-xl flex-1 uppercase outline-none"/>
                <button onClick={checkCoupon}
                        className="bg-slate-800 text-white text-xs px-3 py-1 rounded-xl cursor-pointer">Apply
                </button>
            </div>
            {msg && <p className="text-[10px] font-bold text-blue-600">{msg}</p>}
            <div className="border-t pt-2 font-bold text-xs space-y-2">
                <div className="flex justify-between text-sm"><span>Payable:</span><span
                    className="text-emerald-600">₹{totalBill}</span></div>
                {hasOverdraft &&
                    <p className="text-[10px] text-red-500 font-medium">Reduce quantities to match available
                        stocks.</p>}
                <button onClick={checkout} disabled={hasOverdraft || cart.length === 0}
                        className="w-full bg-emerald-600 text-white py-2 rounded-xl text-center font-bold disabled:bg-slate-300 cursor-pointer">Place
                    COD Order
                </button>
            </div>
        </div>
    );
}