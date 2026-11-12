import React from 'react';
import { useAuth } from '../context/AuthContext';
import OrderSummaryCard from './OrderSummaryCard';
import apiClient from '../api/apiClient';
import { useToast } from '../context/ToastContext';
import { useActionLoading, LOADING_ACTIONS } from '../context/LoadingContext';
import { useLanguage } from '../context/LanguageContext';

export default function OrderConfirmation({ order, onTrackOrder, onContinueShopping }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { addToast } = useToast();
  const { runAction, isActionLoading } = useActionLoading();
  const userName = user?.user_metadata?.name
    || [user?.firstName, user?.lastName].filter(Boolean).join(' ')
    || user?.name
    || user?.email?.split('@')[0]
    || "Valued Patient";
  const rawId = String(order?._id || order?.id || order?.orderId || order?.orderNumber || order?.trackingNumber || '').trim();
  const orderId = rawId
    ? (rawId.length > 6 ? rawId.slice(-6).toUpperCase() : rawId.toUpperCase())
    : '3E5F02';
  const trackOrder = async () => {
    await runAction(LOADING_ACTIONS.TRACK_ORDER, async () => {
      try {
        const targetId = order?._id || order?.id || orderId;
        const res = await apiClient.get(`/api/orders/${encodeURIComponent(targetId)}`);
        onTrackOrder(res.data?.order || res.data?.data || res.data || order);
      } catch (error) {
        addToast(error.message || t('couldNotTrack'), 'error');
      }
    });
  };

  return (
    <div className="max-w-md mx-auto my-12 bg-white border border-slate-200 rounded-3xl p-8 text-center shadow-sm space-y-6 animate-fade-in">
      
      {/* Success Badge */}
      <div className="w-20 h-20 mx-auto rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-4xl shadow-md shadow-emerald-500/15">
        ✓
      </div>

      <div className="space-y-2">
        <h2 className="text-2xl font-black text-slate-900 tracking-tight">
          {t('orderPlacedSuccessfully')}
        </h2>
        <p className="text-sm font-bold text-slate-700">
          {t('thankYouUser')}, {userName}!
        </p>
        <p className="text-xs text-slate-500">
          {t('registeredInDispensaryQueue') ? t('registeredInDispensaryQueue').replace('{id}', orderId) : `Your medicine order #${orderId} has been registered.`}
        </p>
      </div>

      {order && (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-left text-xs space-y-2">
          <div className="flex justify-between text-slate-500">
            <span>{t('orderReference')}:</span>
            <span className="font-extrabold text-slate-900">#{orderId}</span>
          </div>
          <div className="flex justify-between text-slate-500">
            <span>{t('paymentMode')}:</span>
            <span className="font-bold text-emerald-600">{t('cashOnDelivery')}</span>
          </div>
          <div className="border-t border-slate-200 pt-2 text-[11px] text-slate-600"><strong>{t('orderedBy')}:</strong> {order.orderedByName || userName}<br /><strong>{t('orderedFor')}:</strong> {order.orderedForName || userName}</div>
          {order.deliveryAddress && (
            <div className="pt-2 border-t border-slate-200 text-[11px] text-slate-500">
              <span>📍 {t('deliveryTo')}: {order.deliveryAddress}</span>
            </div>
          )}
          {order && <OrderSummaryCard order={order} />}
        </div>
      )}

      {/* Action Buttons */}
      <div className="space-y-2.5 pt-2">
        {order?.orderStatus !== 'Delivered' && (
          <button
            onClick={trackOrder}
            disabled={isActionLoading(LOADING_ACTIONS.TRACK_ORDER)}
            className="w-full disabled:opacity-60 disabled:cursor-wait bg-blue-600 hover:bg-blue-700 text-white font-extrabold py-3 rounded-2xl text-xs shadow-md shadow-blue-600/25 transition cursor-pointer"
          >
            {isActionLoading(LOADING_ACTIONS.TRACK_ORDER) ? t('loadingTracking') : `📦 ${t('trackOrderStatus')}`}
          </button>
        )}
        <button
          onClick={onContinueShopping}
          className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 rounded-2xl text-xs transition cursor-pointer"
        >
          {t('continueShopping')}
        </button>
      </div>

    </div>
  );
}
