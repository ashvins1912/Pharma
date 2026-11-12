import React, { useEffect, useState } from 'react';
import { getReadableErrorMessage } from '../utils/errorMessage';
import { useApp } from '../context/AppContext';
import apiClient from '../api/apiClient';
import { useToast } from '../context/ToastContext';
import OrderHistory from './OrderHistory';
import { useActionLoading, LOADING_ACTIONS } from '../context/LoadingContext';
import { useLanguage } from '../context/LanguageContext';
import CustomerStockWaitlist from './requests/CustomerStockWaitlist';

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
  const activeOrders = orders.filter(order =>
    !['cancelled', 'rejected', 'completed'].includes(getNormalizedStatus(order))
    && (getNormalizedStatus(order) !== 'delivered' || order.fulfillmentState === 'PARTIAL')
  );
  const isReadyToDispatch = (order) => getNormalizedStatus(order) === 'ready to dispatch';

  const cancelOrder = async (order) => {
    if (!window.confirm(t('cancelOrderConfirm'))) return;
    await runAction(LOADING_ACTIONS.CANCEL_ORDER, async () => {
      try {
        await apiClient.put(`/api/orders/${order._id}/cancel`);
        addToast(t('orderCancelled'), 'success');
        await loadUserOrders({ silent: true });
      } catch (error) {
        addToast(getReadableErrorMessage(error, t('couldNotCancel')), 'error');
      }
    });
  };

  const trackOrder = async (order) => {
    await runAction(LOADING_ACTIONS.TRACK_ORDER, async () => {
      try {
        const res = await apiClient.get(`/api/orders/${encodeURIComponent(order._id)}`);
        onTrackOrder(res.data?.order || res.data?.data || res.data || order);
      } catch (error) {
        addToast(getReadableErrorMessage(error, t('couldNotTrack')), 'error');
      }
    });
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'Delivered':
        return <span key={`badge-delivered-${status}`} className="status-badge-transition bg-emerald-100 text-emerald-800 text-[10px] font-black px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 transition-all duration-300 ease-in-out shadow-xs"><span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />{t('delivered')}</span>;
      case 'Cancelled':
        return <span key={`badge-cancelled-${status}`} className="status-badge-transition bg-slate-100 text-slate-600 text-[10px] font-black px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 transition-all duration-300 ease-in-out"><span className="w-1.5 h-1.5 rounded-full bg-slate-400" />{t('cancelled')}</span>;
      case 'Rejected':
        return <span key={`badge-rejected-${status}`} className="status-badge-transition bg-rose-100 text-rose-700 text-[10px] font-black px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 transition-all duration-300 ease-in-out"><span className="w-1.5 h-1.5 rounded-full bg-rose-600" />{t('rejected')}</span>;
      case 'Dispatched':
        return <span key={`badge-dispatched-${status}`} className="status-badge-transition bg-blue-100 text-blue-800 text-[10px] font-black px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 transition-all duration-300 ease-in-out shadow-xs"><span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />{t('outForDelivery')}</span>;
      case 'Ready to Dispatch':
        return <span key={`badge-ready-${status}`} className="status-badge-transition bg-indigo-100 text-indigo-800 text-[10px] font-black px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 transition-all duration-300 ease-in-out shadow-xs"><span className="w-1.5 h-1.5 rounded-full bg-indigo-600" />{t('readyToDispatch')}</span>;
      default:
        return <span key={`badge-processing-${status}`} className="status-badge-transition bg-amber-100 text-amber-800 text-[10px] font-black px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 transition-all duration-300 ease-in-out shadow-xs"><span className="w-1.5 h-1.5 rounded-full bg-amber-600 animate-pulse" />{t('processing')}</span>;
    }
  };

  return (
    <div className="space-y-4">
    <CustomerStockWaitlist />
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
                        {order.fulfillmentState === 'PARTIAL' && <p className="mt-1 text-[10px] font-bold text-amber-700">{t('stockPartialOrder')}</p>}
                        {order.fulfillmentState === 'COMPLETE' && <p className="mt-1 text-[10px] font-bold text-emerald-700">All split items fulfilled</p>}
                        {order.fulfillmentState === 'CANCELLED_REMAINDER' && <p className="mt-1 text-[10px] font-bold text-slate-600">Remaining items cancelled at your request</p>}
                        {order.fulfillmentState === 'EXPIRED_REMAINDER' && <p className="mt-1 text-[10px] font-bold text-amber-700">Remaining items expired from the stock wait window</p>}
                        {order.parentOrderId && <p className="mt-1 text-[10px] font-semibold text-indigo-700">Part of order #{String(order.parentOrderId).slice(-6).toUpperCase()}</p>}
                        {Array.isArray(order.childOrderIds) && order.childOrderIds.length > 0 && <p className="mt-1 text-[10px] font-semibold text-indigo-700">Split fulfilments: {order.childOrderIds.length} linked order(s)</p>}
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
                        {(!['Delivered', 'Cancelled', 'Rejected'].includes(order.orderStatus) || order.fulfillmentState === 'PARTIAL') && (
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
          <div className="md:hidden qm-mobile-record-list">
            {activeOrders.map((order) => {
              const rawId = String(order._id || order.id || order.orderId || order.orderNumber || '').trim();
              const orderId = rawId ? (rawId.length > 6 ? rawId.slice(-6).toUpperCase() : rawId.toUpperCase()) : '3E5F02';
              return (
                <div key={order._id || order.id || orderId} className="qm-mobile-record-card qm-mobile-order-card">
                  <header className="qm-mobile-record-header">
                    <div>
                      <span className="font-black text-slate-900 text-xs">#{orderId}</span>
                      <span className="text-[10px] text-slate-400 block">
                        {new Date(order.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    {getStatusBadge(order.orderStatus)}
                  </header>
                  {order.fulfillmentState === 'PARTIAL' && <p className="text-[10px] font-bold text-amber-700">{t('stockPartialOrder')}</p>}
                  {order.fulfillmentState === 'COMPLETE' && <p className="text-[10px] font-bold text-emerald-700">All split items fulfilled</p>}
                  {order.fulfillmentState === 'CANCELLED_REMAINDER' && <p className="text-[10px] font-bold text-slate-600">Remaining items cancelled at your request</p>}
                  {order.fulfillmentState === 'EXPIRED_REMAINDER' && <p className="text-[10px] font-bold text-amber-700">Remaining items expired from the stock wait window</p>}
                  {order.parentOrderId && <p className="text-[10px] font-semibold text-indigo-700">Part of order #{String(order.parentOrderId).slice(-6).toUpperCase()}</p>}
                  {Array.isArray(order.childOrderIds) && order.childOrderIds.length > 0 && <p className="text-[10px] font-semibold text-indigo-700">Split fulfilments: {order.childOrderIds.length} linked order(s)</p>}

                  <p className="qm-mobile-record-items">
                    {(order.items || []).map(i => `${i.name} (x${i.quantity})`).join(', ')}
                  </p>

                  <footer className="qm-mobile-record-footer">
                    <div>
                      <span className="text-[10px] text-slate-400 block font-bold">TOTAL</span>
                      <span className="font-extrabold text-emerald-600 text-sm">₹{order.finalTotal}</span>
                    </div>
                    <div className="qm-mobile-record-actions">
                      {editableStatuses.includes(getNormalizedStatus(order)) && (
                        <>
                          <button
                            onClick={() => cancelOrder(order)}
                            className="qm-mobile-action qm-mobile-action--danger"
                          >
                            Cancel
                          </button>
                        </>
                      )}
                      {(!['Delivered', 'Cancelled', 'Rejected'].includes(order.orderStatus) || order.fulfillmentState === 'PARTIAL') && (
                        <button
                          onClick={() => trackOrder(order)}
                          className="qm-mobile-action qm-mobile-action--primary"
                        >
                          Track
                        </button>
                      )}
                    </div>
                  </footer>
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
