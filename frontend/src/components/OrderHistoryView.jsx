import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import apiClient from '../api/apiClient';
import { useToast } from '../context/ToastContext';
import OrderHistory from './OrderHistory';
import { useActionLoading, LOADING_ACTIONS } from '../context/LoadingContext';
import { useLanguage } from '../context/LanguageContext';

export default function OrderHistoryView({ onTrackOrder }) {
  const { t } = useLanguage();
  const { orders, ordersError, loadingOrders, loadUserOrders } = useApp();
  const { addToast } = useToast();
  const { runAction, isActionLoading } = useActionLoading();
  useEffect(() => {
    void loadUserOrders();
  }, [loadUserOrders]);

  // Cancellation is available only before fulfillment is ready to dispatch.
  // Normalize legacy enum spellings while keeping the backend as the source of truth.
  const getNormalizedStatus = (order) => String(order?.orderStatus || order?.status || '')
    .trim()
    .replace(/_/g, ' ')
    .toLowerCase();
  const editableStatuses = ['pending review', 'approved', 'processing order'];
  const activeOrders = orders.filter(order => !['delivered', 'cancelled', 'rejected', 'completed'].includes(getNormalizedStatus(order)));
  const isReadyToDispatch = (order) => getNormalizedStatus(order) === 'ready to dispatch';

  const cancelOrder = async (order) => {
    if (!window.confirm(t('cancelOrderConfirm'))) return;
    await runAction(LOADING_ACTIONS.CANCEL_ORDER, async () => {
      try {
        await apiClient.put(`/api/orders/${order._id}/cancel`);
        addToast(t('orderCancelled'), 'success');
        await loadUserOrders({ silent: true });
      } catch (error) {
        addToast(error.message || t('couldNotCancel'), 'error');
      }
    });
  };

  const trackOrder = async (order) => {
    await runAction(LOADING_ACTIONS.TRACK_ORDER, async () => {
      try {
        const res = await apiClient.get(`/api/orders/${encodeURIComponent(order._id)}`);
        onTrackOrder(res.data?.order || res.data?.data || res.data || order);
      } catch (error) {
        addToast(error.message || t('couldNotTrack'), 'error');
      }
    });
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'Delivered':
        return <span className="bg-emerald-100 text-emerald-800 text-[10px] font-black px-2 py-0.5 rounded-full">{t('delivered')}</span>;
      case 'Cancelled':
        return <span className="bg-slate-100 text-slate-600 text-[10px] font-black px-2 py-0.5 rounded-full">{t('cancelled')}</span>;
      case 'Rejected':
        return <span className="bg-rose-100 text-rose-700 text-[10px] font-black px-2 py-0.5 rounded-full">{t('rejected')}</span>;
      case 'Dispatched':
        return <span className="bg-blue-100 text-blue-800 text-[10px] font-black px-2 py-0.5 rounded-full">{t('outForDelivery')}</span>;
      case 'Ready to Dispatch':
        return <span className="bg-blue-100 text-blue-800 text-[10px] font-black px-2 py-0.5 rounded-full">{t('readyToDispatch')}</span>;
      default:
        return <span className="bg-amber-100 text-amber-800 text-[10px] font-black px-2 py-0.5 rounded-full">{t('processing')}</span>;
    }
  };

  return (
    <div className="space-y-4">
    <div className="bg-white border border-slate-200 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-extrabold text-slate-900">📦 {t('activeOrders')}</h3>
          <p className="text-xs text-slate-500">{t('trackManageOrders')}</p>
        </div>
        <button
          onClick={loadUserOrders}
          disabled={loadingOrders}
          className="text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-xl cursor-pointer transition"
        >
          {loadingOrders ? t('refreshing') : `🔄 ${t('refresh')}`}
        </button>
      </div>

      {loadingOrders ? (
        <div className="space-y-3 py-6 animate-pulse">
          <div className="h-5 bg-slate-200 dark:bg-slate-700 rounded-lg w-48 mb-4"></div>
          {[1, 2, 3].map(n => (
            <div key={n} className="h-20 bg-slate-100 dark:bg-slate-800 rounded-2xl w-full"></div>
          ))}
        </div>
      ) : ordersError ? (
        <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-800" role="alert">
          <p>{ordersError}</p>
          <button type="button" onClick={() => loadUserOrders()} disabled={loadingOrders} className="mt-2 font-bold underline disabled:opacity-50">{t('tryAgain')}</button>
        </div>
      ) : activeOrders.length === 0 ? (
        <div className="py-16 text-center text-slate-400 space-y-2">
          <p className="text-3xl">📋</p>
          <p className="text-xs font-bold text-slate-700">{t('noActiveOrders')}</p>
          <p className="text-[11px] text-slate-400">{t('ordersAppearHere')}</p>
        </div>
      ) : (
        <>
          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 text-[10px] font-extrabold uppercase tracking-wider">
                  <th className="py-3 px-3">{t('orderId')}</th>
                  <th className="py-3 px-3">{t('date')}</th>
                  <th className="py-3 px-3">{t('items')}</th>
                  <th className="py-3 px-3">{t('totalCOD')}</th>
                  <th className="py-3 px-3">{t('status')}</th>
                  <th className="py-3 px-3 text-right">{t('action')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {activeOrders.map((order) => {
                  const rawId = String(order._id || order.id || order.orderId || order.orderNumber || '').trim();
                  const orderId = rawId ? (rawId.length > 6 ? rawId.slice(-6).toUpperCase() : rawId.toUpperCase()) : '3E5F02';
                  return (
                    <tr key={order._id || order.id || orderId} className="hover:bg-slate-50/70 transition">
                      <td className="py-3.5 px-3 font-extrabold text-slate-900">
                        #{orderId}
                      </td>
                      <td className="py-3.5 px-3 text-slate-500 text-[11px]">
                        {new Date(order.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-3.5 px-3 text-slate-600 max-w-[200px] truncate"><div className="text-[10px] font-bold text-slate-500">Ordered by: {order.orderedByName || 'Customer'}</div><div className="text-[10px] font-bold text-blue-700">Ordered for: {order.orderedForName || 'Customer'}</div>
                        {(order.items || []).map(i => `${i.name} (x${i.quantity})`).join(', ')}
                      </td>
                      <td className="py-3.5 px-3 font-black text-emerald-600">
                        ₹{order.finalTotal}
                      </td>
                      <td className="py-3.5 px-3">
                        {getStatusBadge(order.orderStatus)}
                      </td>
                      <td className="py-3.5 px-3 text-right">
                        {editableStatuses.includes(getNormalizedStatus(order)) && (
                          <button
                            onClick={() => cancelOrder(order)}
                            disabled={isActionLoading(LOADING_ACTIONS.CANCEL_ORDER)}
                            className="mr-2 bg-rose-50 hover:bg-rose-100 disabled:opacity-60 disabled:cursor-wait text-rose-700 font-extrabold text-xs px-3 py-1.5 rounded-xl cursor-pointer transition" >
                            {isActionLoading(LOADING_ACTIONS.CANCEL_ORDER) ? 'Cancelling...' : t('cancel')}
                          </button>
                        )}
                        {!['Delivered', 'Cancelled', 'Rejected'].includes(order.orderStatus) && (
                          <button
                            onClick={() => trackOrder(order)}
                            disabled={isActionLoading(LOADING_ACTIONS.TRACK_ORDER)} className="bg-blue-50 hover:bg-blue-100 disabled:opacity-60 disabled:cursor-wait text-blue-700 font-extrabold text-xs px-3 py-1.5 rounded-xl cursor-pointer transition"
                          >
                            Track
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Stacked Cards */}
          <div className="md:hidden space-y-3">
            {activeOrders.map((order) => {
              const rawId = String(order._id || order.id || order.orderId || order.orderNumber || '').trim();
              const orderId = rawId ? (rawId.length > 6 ? rawId.slice(-6).toUpperCase() : rawId.toUpperCase()) : '3E5F02';
              return (
                <div key={order._id || order.id || orderId} className="p-4 bg-slate-50/80 border border-slate-200 rounded-2xl space-y-2.5">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="font-black text-slate-900 text-xs">#{orderId}</span>
                      <span className="text-[10px] text-slate-400 block">
                        {new Date(order.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    {getStatusBadge(order.orderStatus)}
                  </div>

                  <p className="text-[11px] text-slate-600 line-clamp-2">
                    {(order.items || []).map(i => `${i.name} (x${i.quantity})`).join(', ')}
                  </p>

                  <div className="flex justify-between items-center pt-2 border-t border-slate-200">
                    <div>
                      <span className="text-[10px] text-slate-400 block font-bold">TOTAL</span>
                      <span className="font-extrabold text-emerald-600 text-sm">₹{order.finalTotal}</span>
                    </div>
                    <div className="flex gap-2">
                      {editableStatuses.includes(getNormalizedStatus(order)) && (
                        <>
                          <button
                            onClick={() => cancelOrder(order)}
                            className="bg-rose-100 text-rose-700 font-extrabold text-xs px-3 py-1.5 rounded-xl cursor-pointer"
                          >
                            Cancel
                          </button>
                        </>
                      )}
                      {!['Delivered', 'Cancelled', 'Rejected'].includes(order.orderStatus) && (
                        <button
                          onClick={() => trackOrder(order)}
                          className="bg-blue-600 text-white font-extrabold text-xs px-4 py-1.5 rounded-xl cursor-pointer"
                        >
                          Track
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

    </div>
    <OrderHistory />
    </div>
  );
}
