import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { useLanguage } from '../context/LanguageContext';
import apiClient from '../api/apiClient';

export default function NotificationBell({ onOpenOrders, onRequireAuth, onNavigateTab }) {
  const { t, language } = useLanguage();
  const {
    notifications,
    unreadNotificationsCount,
    markNotificationRead,
    markAllNotificationsRead,
    setWhatsappModalOpen,
    deliveryEvents,
    realtimeConnectionStatus,
    orders,
    setActiveTrackingOrder,
    medicineRequests,
    openProposalModal,
    setActiveProposalRequest
  } = useApp();

  const [isOpen, setIsOpen] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const [navigatingId, setNavigatingId] = useState(null);

  const localizedStatus = (value) => {
    const normalized = String(value || '').trim().toLowerCase().replace(/[ _-]+/g, ' ');
    const labels = {
      delivered: 'delivered',
      cancelled: 'cancelled',
      rejected: 'rejected',
      dispatched: 'outForDelivery',
      'out for delivery': 'outForDelivery',
      'ready to dispatch': 'readyToDispatch',
      processing: 'processing',
      'processing order': 'processingOrderStage',
      assigned: 'riderAssignedTitle',
      sent: 'sent',
      failed: 'failed',
      requested: 'requested',
      'queued offline': 'queuedOffline',
      'missing recipient': 'missingRecipient',
      'order created': 'orderConfirmedTitle',
      'order accepted': 'orderProcessingTitle',
      'rider assigned': 'riderAssignedTitle',
      'order delivered': 'orderDeliveredTitle',
      'medicine request created': 'medicineRequestTitle',
      'proposal approved': 'proposalApprovedTitle',
      'proposal rejected': 'proposalRejectedTitle',
    };
    return labels[normalized] ? t(labels[normalized]) : String(value || '');
  };

  const notificationCopy = (notification) => {
    const id = notification.orderId || notification.medicineRequestId || notification.requestNumber || '';
    const values = {
      ORDER_CREATED: ['orderConfirmedTitle', 'orderConfirmedBody'],
      ORDER_STATUS_CHANGED: ['orderStatusTitle', 'orderStatusBody'],
      ORDER_ACCEPTED: ['orderProcessingTitle', 'orderProcessingBody'],
      RIDER_ASSIGNED: ['riderAssignedTitle', 'riderAssignedBody'],
      ORDER_DELIVERED: ['orderDeliveredTitle', 'orderDeliveredBody'],
      ORDER_DELIVERED_RATING_PROMPT: ['deliveryRatingTitle', 'deliveryRatingBody'],
      ORDER_OUT_FOR_DELIVERY_OTP_SENT: ['outForDeliveryTitle', 'outForDeliveryBody'],
      MEDICINE_REQUEST_CREATED: ['medicineRequestTitle', 'medicineRequestBody'],
      PROPOSAL_CREATED: ['proposalReadyTitle', 'proposalReadyBody'],
      PROPOSAL_APPROVED: ['proposalApprovedTitle', 'proposalApprovedBody'],
      PROPOSAL_REJECTED: ['proposalRejectedTitle', 'proposalRejectedBody'],
      REQUEST_CANCELLED: ['requestCancelledTitle', 'requestCancelledBody'],
      WHATSAPP_DELIVERY_STATUS: [
        notification.deliveryState === 'SENT' ? 'whatsappSent' :
        ['FAILED', 'MISSING_RECIPIENT'].includes(notification.deliveryState) ? 'whatsappFailed' : 'whatsappUpdate',
        'whatsappStatusBody'
      ]
    };
    const keys = values[notification.eventType];
    if (!keys) {
      const rawBody = notification.message ?? notification.body ?? '';
      return {
        title: notification.title || '',
        body: typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody)
      };
    }
    const params = {
      id,
      orderId: notification.orderId || '',
      name: notification.riderName || '',
      medicine: notification.medicineName || t('medicine'),
      order: notification.orderId || '',
      event: String(notification.eventType || 'notification').replaceAll('_', ' ').toLowerCase(),
      status: localizedStatus(notification.status || notification.deliveryState)
    };
    const interpolate = (value) => String(value || '').replace(/\{(\w+)\}/g, (_, key) => params[key] ?? '');
    return { title: t(keys[0]), body: interpolate(t(keys[1])) };
  };

  const handleNotificationClick = async (n) => {
    if (navigatingId) return;
    setNavigatingId(n.id);
    try {
      // 1. Instantly mark read so it is filtered out and no longer shown
      markNotificationRead(n.id);
      setIsOpen(false);

      // 2. Action Type Direct Routing
      if (n.actionType === 'CONNECT_WHATSAPP') {
        setWhatsappModalOpen(true);
        return;
      }
      if (n.actionType === 'VIEW_PHARMACY_CATALOG' && n.actionUrl && n.actionUrl.startsWith('/')) {
        window.location.assign(n.actionUrl);
        return;
      }

      const orderTargetId = n.orderId || n.orderNumber;
      const requestTargetId = n.medicineRequestId || n.requestId || n.requestNumber;
      const isOrderEvent = Boolean(orderTargetId) || (n.eventType && (n.eventType.startsWith('ORDER_') || n.eventType.startsWith('RIDER_') || n.eventType.startsWith('WHATSAPP_')));
      const isRequestEvent = Boolean(requestTargetId) || (n.eventType && (n.eventType.startsWith('PROPOSAL_') || n.eventType.startsWith('MEDICINE_REQUEST_') || n.eventType.startsWith('REQUEST_')));

      // 3. Deep Link Order Notifications -> Open exact OrderTrackingModal & Order History tab
      if (isOrderEvent) {
        let targetOrder = (orders || []).find(o =>
          String(o._id) === String(orderTargetId) ||
          String(o.id) === String(orderTargetId) ||
          String(o.orderNumber) === String(orderTargetId)
        );

        if (!targetOrder && orderTargetId) {
          try {
            const res = await apiClient.get(`/api/orders/${encodeURIComponent(orderTargetId)}`);
            targetOrder = res.data?.order || res.data;
          } catch (err) {
            console.warn('[NotificationBell] Could not fetch target order details by ID:', err);
          }
        }

        if (targetOrder) {
          setActiveTrackingOrder(targetOrder);
        }

        if (onNavigateTab) {
          onNavigateTab('orders');
        } else if (onOpenOrders) {
          onOpenOrders();
        }
        return;
      }

      // 4. Deep Link Medicine Request & Proposal Notifications -> Open exact CustomerProposalModal & Requests tab
      if (isRequestEvent) {
        let targetRequest = (medicineRequests || []).find(r =>
          String(r._id) === String(requestTargetId) ||
          String(r.id) === String(requestTargetId) ||
          String(r.requestNumber) === String(requestTargetId)
        );

        if (!targetRequest && requestTargetId) {
          try {
            const res = await apiClient.get(`/api/medicine-requests/${encodeURIComponent(requestTargetId)}`);
            targetRequest = res.data?.request || res.data;
          } catch (err) {
            console.warn('[NotificationBell] Could not fetch target medicine request by ID:', err);
          }
        }

        if (targetRequest) {
          if (typeof openProposalModal === 'function') {
            openProposalModal(targetRequest);
          } else if (typeof setActiveProposalRequest === 'function') {
            setActiveProposalRequest(targetRequest);
          }
        }

        if (onNavigateTab) {
          onNavigateTab('requests');
        } else if (onOpenOrders) {
          onOpenOrders();
        }
        return;
      }

      // 5. Default Fallback
      if (onNavigateTab) {
        onNavigateTab('orders');
      } else if (onOpenOrders) {
        onOpenOrders();
      }
    } finally {
      setNavigatingId(null);
    }
  };

  return (
    <div className="relative flex-shrink-0">
      <button
        onClick={() => {
          if (onRequireAuth && !onOpenOrders) {
            onRequireAuth();
            return;
          }
          setIsOpen(!isOpen);
        }}
        className="relative w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 transition cursor-pointer flex items-center justify-center flex-shrink-0"
        aria-label={`${t("notifications")} (${unreadNotificationsCount})`}
      >
        <span className="text-sm sm:text-base select-none">🔔</span>
        {unreadNotificationsCount > 0 && (
          <span aria-live="polite" aria-atomic="true" className="absolute -top-1.5 -right-1.5 z-10 inline-flex min-w-[1.15rem] sm:min-w-[1.3rem] h-[1.15rem] sm:h-[1.3rem] max-w-[2.6rem] items-center justify-center rounded-full border-2 border-white bg-blue-600 px-1 text-[9px] sm:text-[10px] font-black leading-none tabular-nums shadow-md whitespace-nowrap">
            {unreadNotificationsCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div
            onClick={() => setIsOpen(false)}
            className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-xs sm:bg-transparent"
          />
          <div className="fixed inset-x-3 top-16 sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:mt-2 w-auto sm:w-96 max-w-md bg-white border border-slate-200 rounded-3xl shadow-2xl z-50 p-4 space-y-3 animate-fade-in">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
              <div className="min-w-0">
                <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                  <span>🔔</span> {t('notifications')} ({unreadNotificationsCount})
                </h4>
                <p className={`mt-1 text-[10px] font-bold ${realtimeConnectionStatus === 'connected' ? 'text-emerald-600' : realtimeConnectionStatus === 'reconnecting' ? 'text-amber-600' : 'text-slate-400'}`}>
                  {realtimeConnectionStatus === 'connected' ? `● ${t('liveUpdatesConnected')}` : realtimeConnectionStatus === 'reconnecting' ? `● ${t('reconnectingLive')}` : `● ${t('liveOffline')}`}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-2">
                {notifications.length > 0 && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (clearingAll) return;
                      setClearingAll(true);
                      try { await markAllNotificationsRead?.(); }
                      finally { setClearingAll(false); }
                    }}
                    disabled={clearingAll}
                    className="min-h-8 shrink-0 rounded-lg border border-blue-100 bg-blue-50 px-2.5 py-1.5 text-[10px] font-extrabold text-blue-700 transition hover:bg-blue-100 disabled:cursor-wait disabled:opacity-50"
                    aria-label={t("clearAllNotifications")}
                  >
                    {clearingAll ? t('clearingNotifications') : t('clearAllNotifications')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="text-slate-400 hover:text-slate-700 text-xs font-bold p-1 rounded-full hover:bg-slate-100"
                  aria-label={t("close")}
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="space-y-2 max-h-64 sm:max-h-72 overflow-y-auto">
              {notifications.map((n) => {
                const localized = notificationCopy(n);
                return (
                <div
                  key={n.id}
                  onClick={() => handleNotificationClick(n)}
                  className={`p-3 rounded-2xl border text-xs cursor-pointer transition ${
                    n.type === 'warning'
                      ? 'border-amber-300 bg-amber-50/80 hover:bg-amber-100/70 font-semibold'
                      : n.read
                      ? 'border-slate-100 bg-white hover:bg-slate-50'
                      : 'border-blue-200 bg-blue-50/60 font-semibold'
                  }`}
                >
                  <div className="flex justify-between items-start gap-1">
                    <p className={`font-bold text-xs ${n.type === 'warning' ? 'text-amber-950' : 'text-slate-900'}`}>
                      {localized.title}
                    </p>
                    <span className="text-[10px] text-slate-400 flex-shrink-0">{n.time}</span>
                  </div>
                  <p className={`text-[11px] mt-1 leading-snug ${n.type === 'warning' ? 'text-amber-800' : 'text-slate-600'}`}>
                    {localized.body}
                  </p>
                  {n.whatsappDeliveryState && (
                    <p className="text-[10px] mt-1 font-bold text-emerald-700">
                      {t('whatsappDelivery')}: {localizedStatus(n.whatsappDeliveryState)}
                    </p>
                  )}
                  {n.actionType === 'VIEW_PHARMACY_CATALOG' && (
                    <div className="mt-2 pt-1 border-t border-blue-100 flex items-center justify-between">
                      <span className="text-[10px] font-black uppercase text-blue-700">{t('pharmacyOffer')}</span>
                      <span className="text-[11px] font-extrabold text-blue-700 underline">{t('viewPharmacyCatalog')}</span>
                    </div>
                  )}
                  {n.actionType === 'CONNECT_WHATSAPP' && (
                    <div className="mt-2 pt-1 border-t border-amber-200/60 flex items-center justify-between">
                      <span className="text-[10px] font-black text-amber-700 uppercase">{t('actionRequired')}</span>
                      <span className="text-[11px] font-extrabold text-blue-700 underline">{t('linkWhatsAppNow')}</span>
                    </div>
                  )}
                </div>
                );
              })}
            </div>

            {deliveryEvents.length > 0 && (
              <section className="border-t border-slate-100 pt-3">
                <h5 className="mb-2 text-[10px] font-black uppercase tracking-wider text-slate-500">{t('recentFulfillmentUpdates')}</h5>
                <div className="space-y-2">
                  {deliveryEvents.slice(0, 3).map((event, index) => {
                    const eventLabel = localizedStatus(event.status || event.eventType || event.type || 'FULFILLMENT_UPDATE');
                    const orderLabel = event.orderNumber || event.orderId || event.aggregateId;
                    return (
                      <div
                        key={event.id || `${eventLabel}-${index}`}
                        onClick={() => {
                          if (orderLabel) {
                            handleNotificationClick({ orderId: orderLabel, eventType: 'ORDER_STATUS_CHANGED', id: event.id });
                          }
                        }}
                        className="rounded-xl border border-slate-100 bg-slate-50 p-2.5 cursor-pointer hover:bg-slate-100 transition"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[11px] font-bold text-slate-800">{eventLabel}</p>
                          <span className="shrink-0 text-[9px] text-slate-400">{event.timestamp ? new Date(event.timestamp).toLocaleTimeString(language) : t('recent')}</span>
                        </div>
                        {orderLabel && <p className="mt-1 text-[10px] text-slate-600">{t('orderLabel')}: {String(orderLabel)}</p>}
                        {event.status && <p className="mt-1 text-[10px] font-semibold text-indigo-700">{t('status')}: {localizedStatus(event.status)}</p>}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            <div className="pt-2 border-t border-slate-100 text-center">
              <button
                onClick={() => {
                  setIsOpen(false);
                  if (onNavigateTab) {
                    onNavigateTab('orders');
                  } else if (onOpenOrders) {
                    onOpenOrders();
                  }
                }}
                className="text-[11px] font-bold text-blue-600 hover:underline cursor-pointer"
              >
                {t('viewAllOrdersDeliveries')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
