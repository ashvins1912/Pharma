import React from 'react';

const STAGES = [
  { key: 'Processing Order', label: 'Processing Order', desc: 'Pharmacist validating Rx formulation & packaging' },
  { key: 'Ready to Dispatch', label: 'Ready to Dispatch', desc: 'Securely packaged in pharmacy dispatch hub' },
  { key: 'Dispatched', label: 'Out for Delivery', desc: 'Assigned to delivery courier with cold-chain lock' },
  { key: 'Delivered', label: 'Delivered', desc: 'Safely delivered to patient & COD collected' }
];

export default function OrderTrackingModal({ order, onClose }) {
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/45 backdrop-blur-[2px] animate-fade-in overscroll-none"
      aria-modal="true"
      role="dialog"
      aria-labelledby="order-tracking-title"
    >
      {/* Backdrop */}
      <div
        className="modal-backdrop absolute inset-0 touch-none"
        onClick={onClose}
        onWheel={(e) => e.preventDefault()}
        onTouchMove={(e) => e.preventDefault()}
        aria-hidden="true"
      />

      <div className="relative z-10 m-auto flex h-[85dvh] max-h-[85dvh] min-h-0 w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl overscroll-contain">
        
        {/* Sticky Header: Always pinned & visible with Order Tracking: #{orderId} */}
        <div className="shrink-0 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4 sm:px-6 sm:py-5">
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
                Placed on {order.createdAt ? new Date(order.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Recent'}
                {order.createdAt ? ` at ${new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close tracking"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition cursor-pointer ml-2"
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
                          {stage.label}
                        </h4>
                        {isCurrent && (
                          <span className="bg-blue-100 text-blue-800 text-[10px] font-black px-2 py-0.5 rounded-full uppercase shrink-0">
                            Current Stage
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">{stage.desc}</p>
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
                  <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">Assigned Delivery Rider</p>
                  <p className="text-xs font-black text-slate-900 truncate">{order.rider?.riderName || 'Pharmacy Express Rider'}</p>
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
            <div><strong>Ordered by:</strong> {order.orderedByName || 'Customer'}</div>
            <div><strong>Ordered for:</strong> {order.orderedForName || 'Customer'}</div>
          </div>

          {/* Order Details Summary */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2 text-xs">
            <div className="flex justify-between text-slate-600 gap-2">
              <span className="shrink-0">Destination:</span>
              <span className="font-semibold text-slate-800 text-right truncate">{order.deliveryAddress || 'Delivery Address Provided'}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Total Value:</span>
              <span className="font-extrabold text-emerald-600 text-sm">₹{order.finalTotal} (COD)</span>
            </div>
            <div className="pt-2 border-t border-slate-200">
              <span className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Prescription Items:</span>
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

        {/* Sticky Footer */}
        <div className="shrink-0 border-t border-slate-100 bg-slate-50/70 p-4 sm:p-5">
          <button
            onClick={onClose}
            className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-2.5 rounded-xl text-xs cursor-pointer transition shadow-sm"
          >
            Close Tracking Panel
          </button>
        </div>

      </div>
    </div>
  );
}
