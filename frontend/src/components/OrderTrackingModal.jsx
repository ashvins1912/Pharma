import React from 'react';
import { useLanguage } from '../context/LanguageContext';

const STAGES = [
  { key: 'Processing Order', labelKey: 'processingOrderStage', descKey: 'processingOrderDesc' },
  { key: 'Ready to Dispatch', labelKey: 'readyToDispatch', descKey: 'readyDispatchDesc' },
  { key: 'Dispatched', labelKey: 'outForDelivery', descKey: 'outDeliveryDesc' },
  { key: 'Delivered', labelKey: 'delivered', descKey: 'deliveredDesc' }
];

export default function OrderTrackingModal({ order, onClose }) {
  const { t, language } = useLanguage();
  const rawStatus = String(order?.orderStatus || order?.status || '').trim().toLowerCase();
  if (!order || rawStatus === 'delivered') return null;

  const rawId = String(order?._id || order?.id || order?.orderId || order?.orderNumber || order?.trackingNumber || '').trim();
  const orderId = rawId
    ? (rawId.length > 6 ? rawId.slice(-6).toUpperCase() : rawId.toUpperCase())
    : '3E5F02';

  const currentStatus = ['dispatched', 'out_for_delivery'].includes(rawStatus)
    ? 'Dispatched'
    : order.orderStatus || 'Processing Order';

  const getStageIndex = (status) => {
    switch (status) {
      case 'Processing Order': return 0;
      case 'Ready to Dispatch': return 1;
      case 'Dispatched': return 2;
      case 'Delivered': return 3;
      default: return 0;
    }
  };

  const currentIndex = getStageIndex(currentStatus);
  const currentStatusLabel = currentStatus === 'Processing Order' ? t('processingOrderStage') : currentStatus === 'Ready to Dispatch' ? t('readyToDispatch') : currentStatus === 'Dispatched' ? t('outForDelivery') : currentStatus === 'Delivered' ? t('delivered') : currentStatus;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 modal-overlay animate-fade-in overscroll-none"
      aria-modal="true"
      role="dialog"
      aria-labelledby="order-tracking-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 touch-none"
        onClick={onClose}
        onWheel={(e) => e.preventDefault()}
        onTouchMove={(e) => e.preventDefault()}
        aria-hidden="true"
      />

      <div className="pharma-modal-surface relative z-10 m-auto flex h-[85dvh] max-h-[85dvh] min-h-0 w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl overscroll-contain">
        
        {/* Sticky Header: Always pinned & visible with {t('orderTracking')}: #{orderId} */}
        <div className="shrink-0 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4 sm:px-6 sm:py-5 pr-14">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-xl text-blue-600 shadow-sm border border-blue-100/60">
              📦
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 id="order-tracking-title" className="text-base sm:text-lg font-black tracking-tight text-slate-900 truncate">
                  Order Tracking: #{orderId}
                </h2>
                <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[10px] font-extrabold text-blue-700 border border-blue-200/50 shrink-0">
                  {currentStatus}
                </span>
              </div>
              <p className="text-[11px] font-medium text-slate-400 mt-0.5">
                {t('placedOn')} {order.createdAt ? new Date(order.createdAt).toLocaleDateString(language, { year: 'numeric', month: 'short', day: 'numeric' }) : t('recent')}
                {order.createdAt ? ` at ${new Date(order.createdAt).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })}` : ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t("close")}
            className="absolute top-4 right-4 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition cursor-pointer z-20"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-5 sm:p-6 space-y-5">
          
          {/* Timeline */}
          <div className="py-2">
            <div className="relative">
              {STAGES.map((stage, idx) => {
                const isCompleted = idx < currentIndex;
                const isCurrent = idx === currentIndex;

                return (
                  <div key={stage.key} className="flex items-start gap-4 mb-6 last:mb-0 relative">
                    {/* Connecting Line */}
                    {idx < STAGES.length - 1 && (
                      <div
                        className={`absolute left-4 top-8 -bottom-6 w-0.5 ${
                          idx < currentIndex ? 'bg-emerald-500' : 'bg-slate-200'
                        }`}
                      />
                    )}

                    {/* Icon Circle */}
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs z-10 shrink-0 transition-all ${
                        isCompleted
                          ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/25'
                          : isCurrent
                          ? 'bg-blue-600 text-white ring-4 ring-blue-100 animate-pulse'
                          : 'bg-slate-100 border-2 border-slate-300 text-slate-400'
                      }`}
                    >
                      {isCompleted ? '✓' : isCurrent ? '●' : idx + 1}
                    </div>

                    {/* Stage Text */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <h4
                          className={`text-xs sm:text-sm font-extrabold ${
                            isCurrent
                              ? 'text-blue-600'
                              : isCompleted
                              ? 'text-slate-900'
                              : 'text-slate-400'
                          }`}
                        >
                          {t(stage.labelKey || 'processingOrderStage')}
                        </h4>
                        {isCurrent && (
                          <span className="bg-blue-100 text-blue-800 text-[10px] font-black px-2 py-0.5 rounded-full uppercase shrink-0">
                            Current Stage
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">{t(stage.descKey || 'processingOrderDesc')}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Assigned Rider Box (If Dispatched or Delivered) */}
          {(order.rider || order.deliveryPersonMobile) && (
            <div className="bg-blue-50/70 border border-blue-200 rounded-2xl p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-2xl shrink-0">🛵</span>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">{t('assignedDeliveryRider')}</p>
                  <p className="text-xs font-black text-slate-900 truncate">{order.rider?.riderName || t('pharmacyExpressRider')}</p>
                  <p className="text-[11px] text-slate-600">📞 {order.rider?.riderMobile || order.deliveryPersonMobile}</p>
                </div>
              </div>
              <a
                href={`tel:${order.rider?.riderMobile || order.deliveryPersonMobile}`}
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-3 py-1.5 rounded-xl cursor-pointer shrink-0 transition"
              >
                Call Rider
              </a>
            </div>
          )}

          {/* Recipient Details */}
          <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-3.5 text-[11px] text-blue-950 space-y-1">
            <div><strong>{t('orderedBy')}:</strong> {order.orderedByName || t('customer')}</div>
            <div><strong>{t('orderedFor')}:</strong> {order.orderedForName || t('customer')}</div>
          </div>

          {/* Order Details Summary */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2 text-xs">
            <div className="flex justify-between text-slate-600 gap-2">
              <span className="shrink-0">{t('destination')}:</span>
              <span className="font-semibold text-slate-800 text-right truncate">{order.deliveryAddress || t('deliveryAddressProvided')}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>{t('totalValue')}:</span>
              <span className="font-extrabold text-emerald-600 text-sm">₹{order.finalTotal} ({t('cod')})</span>
            </div>
            <div className="pt-2 border-t border-slate-200">
              <span className="text-[11px] font-bold text-slate-500 uppercase block mb-1">{t('prescriptionItems')}:</span>
              <div className="space-y-1">
                {(order.items || []).map((i, idx) => (
                  <div key={idx} className="flex justify-between text-slate-700 text-[11px]">
                    <span className="truncate pr-2">• {i.name}</span>
                    <span className="font-bold shrink-0">x{i.quantity}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

        </div>

        {/* Customer can track delivery, but only the assigned rider can submit the delivery OTP. */}
        <div className="shrink-0 border-t border-slate-100 bg-slate-50/70 p-4 sm:p-5 space-y-2.5">
          {currentStatus === 'Dispatched' && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[11px] text-emerald-900">
              <p className="font-black">🔐 {t('deliveryVerification')}</p>
              <p className="mt-1">{t('whatsappOtpInstructions')}</p>
            </div>
          )}
          <button
            onClick={onClose}
            className="w-full bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold py-2.5 rounded-xl text-xs cursor-pointer transition"
          >
            {t('closeTrackingPanel')}
          </button>
        </div>

      </div>
    </div>
  );
}
