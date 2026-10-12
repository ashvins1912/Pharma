import React from 'react';

export default function ProofOfDeliveryModal({ isOpen, onClose, order }) {
  if (!isOpen || !order) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delivery-code-info-title"
    >
      <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-5">
        <div className="flex items-start gap-3">
          <span className="text-2xl">🔐</span>
          <div>
            <h3 id="delivery-code-info-title" className="text-base font-black text-slate-900">
              Delivery verification
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Order #{String(order._id || order.id || '').slice(-6)}
            </p>
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
          Your 4-digit delivery code is sent to your WhatsApp when the order goes out for delivery. Share it with your rider at handover. The rider enters the code to complete the order.
        </div>
        <p className="text-xs text-slate-500">
          You do not need to enter the code in the customer app. If the message has not arrived, contact the pharmacy.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-2xl bg-slate-900 py-3 text-xs font-black text-white hover:bg-slate-800"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
