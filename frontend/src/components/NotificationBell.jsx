import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { useLanguage } from '../context/LanguageContext';

export default function NotificationBell({ onOpenOrders, onRequireAuth }) {
  const { t, language } = useLanguage();
  const { notifications, unreadNotificationsCount, markNotificationRead, setWhatsappModalOpen, deliveryEvents, realtimeConnectionStatus } = useApp();
  const [isOpen, setIsOpen] = useState(false);

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
    if (!keys) return { title: notification.title, body: notification.message || notification.body || '' };
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
        aria-label={t("notifications")}
      >
        <span className="text-sm sm:text-base select-none">🔔</span>
        {unreadNotificationsCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-blue-600 text-white text-[9px] sm:text-[10px] font-black w-4 h-4 sm:w-5 sm:h-5 rounded-full flex items-center justify-center shadow">
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
            <div className="flex justify-between items-center border-b border-slate-100 pb-2.5">
              <div className="min-w-0">
                <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                  <span>🔔</span> {t('notifications')} ({notifications.length})
                </h4>
                <p className={`mt-1 text-[10px] font-bold ${realtimeConnectionStatus === 'connected' ? 'text-emerald-600' : realtimeConnectionStatus === 'reconnecting' ? 'text-amber-600' : 'text-slate-400'}`}>
                  {realtimeConnectionStatus === 'connected' ? `● ${t('liveUpdatesConnected')}` : realtimeConnectionStatus === 'reconnecting' ? `● ${t('reconnectingLive')}` : `● ${t('liveOffline')}`}
                </p>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-xs font-bold p-1 rounded-full hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2 max-h-64 sm:max-h-72 overflow-y-auto">
              {notifications.map((n) => {
                const localized = notificationCopy(n);
                return (
                <div
                  key={n.id}
                  onClick={() => {
                    markNotificationRead(n.id);
                    setIsOpen(false);
                    if (n.actionType === 'CONNECT_WHATSAPP') {
                      setWhatsappModalOpen(true);
                    } else if (n.actionType === 'VIEW_PHARMACY_CATALOG' && n.actionUrl && n.actionUrl.startsWith('/')) {
                      window.location.assign(n.actionUrl);
                    } else if (onOpenOrders) {
                      onOpenOrders();
                    }
                  }}
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
                      <div key={event.id || `${eventLabel}-${index}`} className="rounded-xl border border-slate-100 bg-slate-50 p-2.5">
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
                  if (onOpenOrders) onOpenOrders();
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
