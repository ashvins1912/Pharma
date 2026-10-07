import React from 'react';
import { useAuth } from '../context/AuthContext';
import OrderSummaryCard from './OrderSummaryCard';

export default function OrderConfirmation({ order, onTrackOrder, onContinueShopping }) {
  const { user } = useAuth();
  const userName = user?.user_metadata?.name
    || [user?.firstName, user?.lastName].filter(Boolean).join(' ')
    || user?.name
    || user?.email?.split('@')[0]
    || "Valued Patient";
  const orderId = (order?._id || '').slice(-6).toUpperCase();

  return (
    <div className="max-w-md mx-auto my-12 bg-white border border-slate-200 rounded-3xl p-8 text-center shadow-sm space-y-6 animate-fade-in">
      
      {/* Success Badge */}
      <div className="w-20 h-20 mx-auto rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-4xl shadow-md shadow-emerald-500/15">
        ✓
      </div>

      <div className="space-y-2">
        <h2 className="text-2xl font-black text-slate-900 tracking-tight">
          Order Placed Successfully!
        </h2>
        <p className="text-sm font-bold text-slate-700">
          Thank you, {userName}!
        </p>
        <p className="text-xs text-slate-500">
          Your medicine order <strong className="text-blue-600">#{orderId}</strong> has been registered in the dispensary fulfillment queue and is being processed.
        </p>
      </div>

      {order && (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-left text-xs space-y-2">
          <div className="flex justify-between text-slate-500">
            <span>Order Reference:</span>
            <span className="font-extrabold text-slate-900">#{orderId}</span>
          </div>
          <div className="flex justify-between text-slate-500">
            <span>Payment Mode:</span>
            <span className="font-bold text-emerald-600">Cash on Delivery</span>
          </div>
          {order.deliveryAddress && (
            <div className="pt-2 border-t border-slate-200 text-[11px] text-slate-500">
              <span>📍 Delivery to: {order.deliveryAddress}</span>
            </div>
          )}
          {order && <OrderSummaryCard order={order} />}
        </div>
      )}

      {/* Action Buttons */}
      <div className="space-y-2.5 pt-2">
        {order?.orderStatus !== 'Delivered' && (
          <button
            onClick={onTrackOrder}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold py-3 rounded-2xl text-xs shadow-md shadow-blue-600/25 transition cursor-pointer"
          >
            📦 Track Order Status
          </button>
        )}
        <button
          onClick={onContinueShopping}
          className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 rounded-2xl text-xs transition cursor-pointer"
        >
          Continue Shopping
        </button>
      </div>

    </div>
  );
}
