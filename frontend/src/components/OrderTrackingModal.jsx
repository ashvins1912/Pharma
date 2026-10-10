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

  const orderId = (order._id || '').slice(-6).toUpperCase();
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px] animate-fade-in overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-3xl shadow-2xl max-w-xl w-full p-6 sm:p-8 my-8 relative">
        
        {/* Header */}
        <div className="flex justify-between items-start pb-4 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">📦</span>
              <h2 className="text-base sm:text-lg font-black text-slate-900">
                Order Tracking: #{orderId}
              </h2>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Placed on {new Date(order.createdAt).toLocaleDateString()} at{' '}
              {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 hover:bg-slate-200 transition cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Timeline (Vertical on Mobile, Step Bar on Desktop) */}
        <div className="py-6">
          <div className="relative">
            {STAGES.map((stage, idx) => {
              const isCompleted = idx < currentIndex;
              const isCurrent = idx === currentIndex;
              const isPending = idx > currentIndex;

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
                    className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs z-10 flex-shrink-0 transition-all ${
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
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
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
                        <span className="bg-blue-100 text-blue-800 text-[10px] font-black px-2 py-0.5 rounded-full uppercase">
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
          <div className="bg-blue-50/70 border border-blue-200 rounded-2xl p-4 mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🛵</span>
              <div>
                <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">Assigned Delivery Rider</p>
                <p className="text-xs font-black text-slate-900">{order.rider?.riderName || 'Pharmacy Express Rider'}</p>
                <p className="text-[11px] text-slate-600">📞 {order.rider?.riderMobile || order.deliveryPersonMobile}</p>
              </div>
            </div>
            <a
              href={`tel:${order.rider?.riderMobile || order.deliveryPersonMobile}`}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-3 py-1.5 rounded-xl cursor-pointer"
            >
              Call Rider
            </a>
          </div>
        )}

        <div className="mb-3 rounded-2xl border border-blue-100 bg-blue-50 p-3 text-[11px] text-blue-900"><strong>Ordered by:</strong> {order.orderedByName || 'Customer'}<br /><strong>Ordered for:</strong> {order.orderedForName || 'Customer'}</div>

        {/* Order Details Summary */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2 text-xs">
          <div className="flex justify-between text-slate-600">
            <span>Destination:</span>
            <span className="font-semibold text-slate-800 max-w-[60%] text-right">{order.deliveryAddress}</span>
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
                  <span>• {i.name}</span>
                  <span className="font-bold">x{i.quantity}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full mt-4 bg-slate-900 hover:bg-slate-800 text-white font-bold py-2.5 rounded-xl text-xs cursor-pointer transition"
        >
          Close Tracking Panel
        </button>

      </div>
    </div>
  );
}
