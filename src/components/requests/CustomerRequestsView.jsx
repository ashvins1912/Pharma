import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';

export default function CustomerRequestsView({ onOpenProposal, onTrackOrder }) {
  const {
    medicineRequests,
    loadingMedicineRequests,
    loadUserMedicineRequests,
    openRequestModal,
    orders
  } = useApp();

  const [statusFilter, setStatusFilter] = useState('ALL');

  const filteredRequests = medicineRequests.filter(r => {
    if (statusFilter === 'ALL') return true;
    if (statusFilter === 'ACTIVE') {
      return ['REQUESTED', 'UNDER_REVIEW', 'PROPOSAL_SENT'].includes(r.status);
    }
    if (statusFilter === 'COMPLETED') {
      return ['CUSTOMER_APPROVED', 'CONVERTED_TO_ORDER'].includes(r.status);
    }
    return r.status === statusFilter;
  });

  const getStatusBadge = (status) => {
    switch (status) {
      case 'REQUESTED':
        return (
          <span className="bg-amber-100 text-amber-900 text-[10px] font-black px-2 py-0.5 rounded-full inline-flex items-center gap-1">
            <span>⏳</span> Submitted & Pending
          </span>
        );
      case 'UNDER_REVIEW':
        return (
          <span className="bg-blue-100 text-blue-900 text-[10px] font-black px-2 py-0.5 rounded-full inline-flex items-center gap-1">
            <span>🔬</span> Pharmacist Reviewing
          </span>
        );
      case 'PROPOSAL_SENT':
        return (
          <span className="bg-purple-100 text-purple-900 text-[10px] font-black px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 shadow-xs animate-pulse">
            <span>💊</span> Proposal Ready
          </span>
        );
      case 'CUSTOMER_APPROVED':
      case 'CONVERTED_TO_ORDER':
        return (
          <span className="bg-emerald-100 text-emerald-900 text-[10px] font-black px-2 py-0.5 rounded-full inline-flex items-center gap-1">
            <span>✓</span> Converted to Order
          </span>
        );
      case 'CUSTOMER_REJECTED':
        return (
          <span className="bg-slate-100 text-slate-700 text-[10px] font-black px-2 py-0.5 rounded-full inline-flex items-center gap-1">
            <span>✕</span> Declined by You
          </span>
        );
      case 'PHARMACY_REJECTED':
        return (
          <span className="bg-rose-100 text-rose-800 text-[10px] font-black px-2 py-0.5 rounded-full inline-flex items-center gap-1">
            <span>✕</span> Unavailable from Supplier
          </span>
        );
      case 'EXPIRED':
        return (
          <span className="bg-slate-100 text-slate-500 text-[10px] font-black px-2 py-0.5 rounded-full inline-flex items-center gap-1">
            <span>⏱️</span> Proposal Expired
          </span>
        );
      default:
        return (
          <span className="bg-slate-100 text-slate-700 text-[10px] font-black px-2 py-0.5 rounded-full">
            {status}
          </span>
        );
    }
  };

  const findConvertedOrder = (convertedOrderId) => {
    if (!convertedOrderId || !orders) return null;
    return orders.find(o => String(o._id) === String(convertedOrderId)) || null;
  };

  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
      
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">📋</span>
            <h3 className="text-base sm:text-lg font-black text-slate-900">
              My Medicine Requests
            </h3>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Track special procurement inquiries, review pharmacy price proposals, and approve delivery slots.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => loadUserMedicineRequests()}
            disabled={loadingMedicineRequests}
            className="text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-xl cursor-pointer transition disabled:opacity-50"
          >
            {loadingMedicineRequests ? 'Refreshing...' : '🔄 Refresh'}
          </button>

          <button
            onClick={() => openRequestModal()}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-3.5 py-1.5 rounded-xl transition cursor-pointer shadow-xs flex items-center gap-1.5"
          >
            <span>+</span>
            <span>New Request</span>
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 text-xs">
        {[
          { id: 'ALL', label: `All (${medicineRequests.length})` },
          { id: 'ACTIVE', label: 'In Progress / Proposals' },
          { id: 'COMPLETED', label: 'Converted to Orders' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setStatusFilter(tab.id)}
            className={`px-3 py-1.5 rounded-xl font-bold transition cursor-pointer whitespace-nowrap ${
              statusFilter === tab.id
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Requests List */}
      {filteredRequests.length === 0 ? (
        <div className="py-16 text-center text-slate-400 space-y-3">
          <p className="text-4xl">💊</p>
          <div className="max-w-sm mx-auto space-y-1">
            <p className="text-xs font-bold text-slate-700">No medicine requests found</p>
            <p className="text-[11px] text-slate-400">
              {statusFilter === 'ALL'
                ? "Can't find a medicine in our store? Ask Ashvin Pharmacy to procure it for you."
                : 'No requests match your selected filter.'}
            </p>
          </div>
          <button
            onClick={() => openRequestModal()}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-4 py-2 rounded-xl transition cursor-pointer shadow-sm"
          >
            Request a Medicine Now
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredRequests.map((req) => {
            const firstItem = req.requestedItems?.[0] || {};
            const proposal = req.pharmacyProposal;
            const convertedOrder = findConvertedOrder(req.convertedOrderId);

            return (
              <div
                key={req._id}
                className="bg-slate-50/70 hover:bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-5 transition space-y-3"
              >
                {/* Row Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/70 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-black text-sm text-slate-900 font-mono">
                      #{req.requestNumber}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      • {new Date(req.createdAt).toLocaleDateString()}
                    </span>
                    {firstItem.originalAvailabilityStatus === 'OUT_OF_STOCK' && (
                      <span className="text-[9px] font-bold uppercase bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded">
                        Out of Stock Arrangement
                      </span>
                    )}
                  </div>
                  <div>
                    {getStatusBadge(req.status)}
                  </div>
                </div>

                {/* Requested Item Info */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  
                  <div className="space-y-0.5">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
                      Requested Medicine
                    </span>
                    <p className="font-extrabold text-slate-900 text-sm">
                      {firstItem.requestedName || 'Medicine'}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {firstItem.dosageForm && `${firstItem.dosageForm} • `}
                      {firstItem.strength && `${firstItem.strength} • `}
                      Qty: {firstItem.quantity || 1}
                    </p>
                  </div>

                  <div className="space-y-0.5">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
                      Delivery Window
                    </span>
                    <p className="font-bold text-slate-800 text-xs">
                      {proposal?.deliverySlot?.label
                        ? proposal.deliverySlot.label
                        : `Preference: ${req.preferredDeliveryPreference || 'Flexible'}`}
                    </p>
                    <p className="text-[11px] text-slate-500 truncate max-w-xs">
                      📍 {req.deliveryAddress}
                    </p>
                  </div>

                  <div className="space-y-0.5 sm:text-right">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
                      {proposal?.priceType === 'APPROXIMATE' ? 'Approximate Price' : 'Price / Proposal'}
                    </span>
                    {proposal ? (
                      <div>
                        <span className="text-base font-black text-emerald-600">
                          ₹{proposal.finalPrice ?? proposal.totalPrice ?? proposal.approximatePrice}
                        </span>
                        <span className="text-[10px] text-slate-400 block">
                          ({proposal.priceType === 'APPROXIMATE' ? 'Approximate' : 'Guaranteed Final'})
                        </span>
                      </div>
                    ) : (
                      <span className="text-slate-400 text-xs font-semibold">
                        Awaiting Pharmacist Quote
                      </span>
                    )}
                  </div>

                </div>

                {/* Proposal Callout Card / Action Bar */}
                {req.status === 'PROPOSAL_SENT' && (
                  <div className="bg-purple-50/80 border border-purple-200 rounded-xl p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                    <div className="space-y-0.5">
                      <p className="font-extrabold text-purple-950">
                        🎉 Ashvin Pharmacy sent a proposal for #{req.requestNumber}!
                      </p>
                      <p className="text-[11px] text-purple-800">
                        {proposal?.deliverySlot?.label || 'Scheduled delivery slot available'}. Review pricing and medicine formulation.
                      </p>
                    </div>
                    <button
                      onClick={() => onOpenProposal(req)}
                      className="bg-purple-600 hover:bg-purple-700 text-white font-extrabold text-xs px-4 py-2 rounded-xl shadow-xs transition cursor-pointer flex-shrink-0"
                    >
                      View & Confirm Proposal →
                    </button>
                  </div>
                )}

                {/* Linked Order Action */}
                {req.convertedOrderId && (
                  <div className="flex items-center justify-between pt-2 border-t border-slate-200/60 text-xs">
                    <span className="text-emerald-700 font-bold flex items-center gap-1.5">
                      <span>✓</span>
                      <span>Order #{String(req.convertedOrderId).slice(-6).toUpperCase()} created</span>
                    </span>
                    {onTrackOrder && (
                      <button
                        onClick={() => {
                          const order = convertedOrder || { _id: req.convertedOrderId, orderStatus: 'Processing Order' };
                          onTrackOrder(order);
                        }}
                        className="text-blue-600 hover:text-blue-800 font-bold hover:underline cursor-pointer"
                      >
                        Track Order Delivery →
                      </button>
                    )}
                  </div>
                )}

              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
