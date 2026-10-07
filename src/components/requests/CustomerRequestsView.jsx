import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { cancelMedicineRequest, approveProposal, replaceMedicineRequestPrescription } from '../../api/medicineRequestService';

const DEFAULT_PAGINATION = { page: 1, pageSize: 3, limit: 3, total: 0, totalPages: 0, hasNextPage: false };

export default function CustomerRequestsView({ onOpenProposal, onTrackOrder }) {
  const { user } = useAuth();
  const {
    medicineRequests,
    medicineRequestsError,
    loadingMedicineRequests,
    loadUserMedicineRequests,
    medicineRequestsPagination,
    openRequestModal,
    orders
  } = useApp();
  const { addToast } = useToast();
  const pagination = medicineRequestsPagination || DEFAULT_PAGINATION;

  const [statusFilter, setStatusFilter] = useState('ALL');
  const [cancellingRequest, setCancellingRequest] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [approvingId, setApprovingId] = useState(null);
  const [updatingPrescriptionId, setUpdatingPrescriptionId] = useState(null);

  const filteredRequests = medicineRequests.filter(r => {
    if (statusFilter === 'ALL') return true;
    if (statusFilter === 'ACTIVE') {
      return ['REQUESTED', 'UNDER_REVIEW', 'PROPOSAL_SENT'].includes(r.status);
    }
    if (statusFilter === 'COMPLETED') {
      return ['CUSTOMER_APPROVED', 'CONVERTED_TO_ORDER'].includes(r.status);
    }
    if (statusFilter === 'CANCELLED') {
      return ['CANCELLED', 'CUSTOMER_REJECTED', 'PHARMACY_REJECTED'].includes(r.status);
    }
    return r.status === statusFilter;
  });

  const handleCancelRequest = async () => {
    if (!cancellingRequest || cancelling) return;
    try {
      setCancelling(true);
      const res = await cancelMedicineRequest(cancellingRequest._id, cancelReason);
      addToast(res.message || `Request #${cancellingRequest.requestNumber} was cancelled.`, 'info');
      setCancellingRequest(null);
      setCancelReason('');
      await loadUserMedicineRequests();
    } catch (err) {
      addToast(err.message || 'Failed to cancel medicine request.', 'error');
    } finally {
      setCancelling(false);
    }
  };

  const handlePrescriptionReplacement = async (request, file) => {
    if (!file || updatingPrescriptionId) return;
    if (file.size > 5 * 1024 * 1024) {
      addToast('Prescription file size must be under 5 MB.', 'warning');
      return;
    }
    setUpdatingPrescriptionId(request._id);
    try {
      const result = await replaceMedicineRequestPrescription(request._id, file);
      addToast(result.message || 'Prescription updated and queued for reprocessing.', 'success');
      await loadUserMedicineRequests({ page: 1, statusGroup: statusFilter });
    } catch (error) {
      addToast(error.message || 'Failed to update prescription.', 'error');
    } finally {
      setUpdatingPrescriptionId(null);
    }
  };

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
      case 'CANCELLED':
        return (
          <span className="bg-slate-100 text-slate-600 text-[10px] font-black px-2 py-0.5 rounded-full inline-flex items-center gap-1">
            <span>🚫</span> Cancelled
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
          { id: 'ALL', label: 'All' },
          { id: 'ACTIVE', label: 'In Progress / Proposals' },
          { id: 'COMPLETED', label: 'Converted to Orders' },
          { id: 'CANCELLED', label: 'Cancelled' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => {
              setStatusFilter(tab.id);
              void loadUserMedicineRequests({ page: 1, statusGroup: tab.id });
            }}
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
      {medicineRequestsError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">
          <p>{medicineRequestsError}</p>
          <button
            type="button"
            onClick={() => loadUserMedicineRequests()}
            disabled={loadingMedicineRequests}
            className="mt-2 font-bold underline underline-offset-2 disabled:opacity-50"
          >
            Try again
          </button>
        </div>
      ) : loadingMedicineRequests && medicineRequests.length === 0 ? (
        <div className="py-12 text-center text-sm font-semibold text-slate-500" role="status">Loading medicine requests...</div>
      ) : filteredRequests.length === 0 ? (
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
            const proposal = req.pharmacyProposal || req.proposal;
            const convertedOrder = findConvertedOrder(req.convertedOrderId);
            const currentUserId = user?._id || user?.id || user?.sub || user?.userId || user?.supabase_user_id;
            const isOwner = !req.customerId || !currentUserId || String(req.customerId) === String(currentUserId);
            const hasProposal = Boolean(proposal);
            const isProposalActionable = req.status === 'PROPOSAL_SENT'
              || (hasProposal && !['CUSTOMER_APPROVED', 'CONVERTED_TO_ORDER', 'CUSTOMER_REJECTED', 'PHARMACY_REJECTED', 'CANCELLED', 'EXPIRED'].includes(req.status));
            const isPendingWithoutProposal = ['REQUESTED', 'UNDER_REVIEW'].includes(req.status) && !isProposalActionable;
            const isCancelled = req.status === 'CANCELLED';

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
                    <ul className="space-y-1">
                      {(req.requestedItems || []).map((item, index) => (
                        <li key={`${item.requestedName}-${index}`}>
                          <p className="font-extrabold text-slate-900 text-sm">
                            {item.requestedName || 'Medicine'}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {item.dosageForm && `${item.dosageForm} • `}
                            {item.strength && `${item.strength} • `}
                            Qty: {item.quantity || 1}
                          </p>
                        </li>
                      ))}
                    </ul>
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

                {req.prescriptionVerification?.medicines?.length > 0 && (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-wider text-emerald-900">
                          Prescription Medicines Extracted
                        </p>
                        <p className="text-[11px] text-emerald-800">
                          {req.prescriptionVerification.status || 'PROCESSING'}
                        </p>
                      </div>
                      {req.prescriptionVerification.overallConfidence > 0 && (
                        <span className="rounded-lg bg-white px-2 py-1 text-[10px] font-bold text-emerald-700">
                          {Math.round(req.prescriptionVerification.overallConfidence * 100)}% confidence
                        </span>
                      )}
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {req.prescriptionVerification.medicines.map((medicine, index) => (
                        <div key={`${medicine.rawName || medicine.normalizedName || index}-${index}`} className="rounded-xl bg-white border border-emerald-100 p-2.5">
                          <p className="text-xs font-black text-slate-900">
                            {medicine.normalizedName || medicine.rawName || 'Medicine'}
                          </p>
                          <p className="mt-0.5 text-[10px] text-slate-600">
                            Strength: {medicine.strength?.value != null ? `${medicine.strength.value} ${medicine.strength.unit || ''}` : medicine.strength || '—'}
                            {' • '}Dose: {medicine.dose?.value != null ? `${medicine.dose.value} ${medicine.dose.unit || ''}` : medicine.dose || '—'}
                            {' • '}Frequency: {medicine.frequency?.normalized || medicine.frequency?.raw || medicine.frequency || '—'}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            Duration/Course: {medicine.duration?.value != null ? `${medicine.duration.value} ${medicine.duration.unit || ''}` : medicine.duration || '—'}
                            {medicine.course?.value != null ? ` • Qty ${medicine.course.value}` : ''}
                          </p>
                        </div>
                      ))}
                    </div>
                    {req.prescriptionVerification.issues?.length > 0 && (
                      <p className="mt-2 text-[10px] font-semibold text-amber-800">
                        {req.prescriptionVerification.issues.join(' ')}
                      </p>
                    )}
                  </div>
                )}

                {req.prescriptionId && !['CONVERTED_TO_ORDER', 'CUSTOMER_APPROVED', 'CANCELLED', 'CUSTOMER_REJECTED', 'PHARMACY_REJECTED'].includes(req.status) && (
                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-wider text-blue-900">Prescription document</p>
                      <p className="text-[11px] text-blue-800">
                        {req.prescriptionVerification?.status === 'PROCESSING'
                          ? 'Processing the latest prescription…'
                          : 'Need to correct or replace the prescription?'}
                      </p>
                    </div>
                    <label className="cursor-pointer rounded-xl bg-blue-600 px-3 py-2 text-[11px] font-black text-white hover:bg-blue-700">
                      {updatingPrescriptionId === req._id ? 'Updating…' : 'Update Prescription'}
                      <input
                        type="file"
                        accept="application/pdf,image/jpeg,image/png,image/webp"
                        className="hidden"
                        disabled={updatingPrescriptionId === req._id}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = '';
                          void handlePrescriptionReplacement(req, file);
                        }}
                      />
                    </label>
                  </div>
                )}

                {/* Proposal Callout Card / Action Bar */}
                {isProposalActionable && (
                  <div className="bg-purple-50/90 border border-purple-200 rounded-2xl p-3.5 space-y-3 text-xs animate-fade-in">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <p className="font-black text-purple-950 text-sm">
                          🎉 Proposal Ready from Ashvin Pharmacy!
                        </p>
                        <p className="text-[11px] text-purple-800 mt-0.5">
                          {proposal?.medicineName || firstItem.requestedName} · ₹{proposal?.finalPrice ?? proposal?.totalPrice ?? proposal?.approximatePrice} · {proposal?.deliverySlot?.label || 'Available delivery slot'}
                        </p>
                      </div>
                      <span className="text-[10px] font-extrabold uppercase tracking-wide bg-purple-200 text-purple-900 px-2 py-0.5 rounded-full shrink-0 self-start sm:self-center">
                        Action Required
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-purple-200/60">
                      <button
                        type="button"
                        onClick={() => {
                          setCancellingRequest(req);
                          setCancelReason('');
                        }}
                        className="px-3.5 py-2 border border-rose-200 hover:bg-rose-100/70 text-rose-700 font-bold text-xs rounded-xl transition cursor-pointer flex items-center gap-1.5"
                      >
                        <span>✕</span>
                        <span>Cancel / Decline</span>
                      </button>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onOpenProposal && onOpenProposal(req)}
                          className="px-3.5 py-2 bg-purple-100 hover:bg-purple-200 text-purple-900 font-bold text-xs rounded-xl transition cursor-pointer"
                        >
                          Review Details
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenProposal && onOpenProposal(req)}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-xl shadow-xs transition cursor-pointer flex items-center gap-1.5"
                        >
                          <span>✓</span>
                          <span>Approve Proposal</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Pending Request Action Bar (Cancel Option) */}
                {isPendingWithoutProposal && (
                  <div className="flex items-center justify-between pt-2.5 border-t border-slate-200/60 text-xs">
                    <span className="text-slate-500 font-medium">
                      {req.status === 'UNDER_REVIEW'
                        ? '🔬 Pharmacist is actively reviewing stock and procuring quotes.'
                        : '⏳ Request submitted and queued for pharmacist review.'}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setCancellingRequest(req);
                        setCancelReason('');
                      }}
                      className="px-3 py-1.5 border border-slate-200 hover:border-rose-300 hover:bg-rose-50 text-slate-600 hover:text-rose-700 font-bold text-xs rounded-xl transition cursor-pointer flex items-center gap-1"
                    >
                      <span>✕</span>
                      <span>Cancel Request</span>
                    </button>
                  </div>
                )}

                {/* Cancelled Notice */}
                {isCancelled && (
                  <div className="pt-2 border-t border-slate-200/60 text-xs text-slate-500 flex items-center justify-between">
                    <span>
                      🚫 Cancelled by customer {req.customerResponse?.responseNote ? `(${req.customerResponse.responseNote})` : ''}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {req.customerResponse?.respondedAt ? new Date(req.customerResponse.respondedAt).toLocaleDateString() : ''}
                    </span>
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

      {pagination.total > 0 && (
        <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500" aria-live="polite">
            Showing {medicineRequests.length} of {pagination.total} requests
          </p>
          {pagination.hasNextPage && <button
              type="button"
              onClick={() => loadUserMedicineRequests({ page: pagination.page + 1, append: true })}
              disabled={loadingMedicineRequests}
              className="min-h-9 rounded-lg bg-slate-100 px-4 text-xs font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingMedicineRequests ? 'Loading medicine requests...' : 'Load More'}
            </button>}
        </div>
      )}

      {/* Cancel Confirmation Dialog */}
      {cancellingRequest && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex min-h-full items-center justify-center p-3 animate-fade-in">
          <div role="dialog" aria-modal="true" className="bg-white rounded-3xl max-w-md w-full p-5 sm:p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">⚠️</span>
                <h4 className="font-black text-slate-900 text-base">
                  Cancel Medicine Request
                </h4>
              </div>
              <button
                onClick={() => setCancellingRequest(null)}
                className="text-slate-400 hover:text-slate-700 font-bold text-lg w-8 h-8 rounded-full flex items-center justify-center hover:bg-slate-100 transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <p className="text-slate-700 font-medium">
                Are you sure you want to cancel request <strong className="font-bold text-slate-900 font-mono">#{cancellingRequest.requestNumber}</strong>?
              </p>
              <p className="text-slate-500">
                Medicine: <strong className="text-slate-800">{cancellingRequest.requestedItems?.[0]?.requestedName || 'Requested Medicine'}</strong>
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700">
                Reason for cancellation (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Purchased elsewhere, doctor changed medication..."
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:border-slate-400 transition"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setCancellingRequest(null)}
                disabled={cancelling}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer disabled:opacity-50"
              >
                Keep Request
              </button>
              <button
                type="button"
                onClick={handleCancelRequest}
                disabled={cancelling}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer disabled:opacity-50"
              >
                {cancelling ? 'Cancelling...' : 'Yes, Cancel Request'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
