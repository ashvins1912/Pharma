import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { approveProposal, rejectProposal } from '../../api/medicineRequestService';

export default function CustomerProposalModal({ request, isOpen, onClose, onOrderCreated }) {
  const { loadUserMedicineRequests, loadUserOrders } = useApp();
  const { user, role } = useAuth();
  const { addToast } = useToast();

  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [approvalNote, setApprovalNote] = useState('');
  const [showApprovalConfirm, setShowApprovalConfirm] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setShowApprovalConfirm(false);
    setShowRejectInput(false);
    setRejectReason('');

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, request?._id]);

  if (!isOpen || !request) return null;

  const proposal = request.pharmacyProposal;
  const isExpired = request.status === 'EXPIRED' || (request.expiresAt && new Date() > new Date(request.expiresAt));
  const isApproved = request.status === 'CUSTOMER_APPROVED' || request.status === 'CONVERTED_TO_ORDER';
  const isRejected = request.status === 'CUSTOMER_REJECTED' || request.status === 'PHARMACY_REJECTED';
  const currentUserId = user?._id || user?.id || user?.sub || user?.userId || user?.supabase_user_id;
  const isOwner = !request.customerId || !currentUserId || String(request.customerId) === String(currentUserId);
  const canDecide = Boolean(proposal)
    && !isExpired
    && !isApproved
    && !isRejected
    && request.status !== 'CANCELLED';

  const priceType = proposal?.priceType || 'APPROXIMATE';
  const priceValue = proposal?.finalPrice ?? proposal?.totalPrice ?? proposal?.approximatePrice ?? 0;

  const handleApprove = async () => {
    if (approving) return;
    try {
      setApproving(true);
      const res = await approveProposal(request._id, approvalNote);
      addToast(res.message || 'Proposal approved and converted into an order!', 'success');
      await loadUserMedicineRequests();
      await loadUserOrders();
      if (onOrderCreated && res.order) {
        onOrderCreated(res.order);
      }
      onClose();
    } catch (err) {
      addToast(err.message || 'Unable to approve this proposal right now. Please try again.', 'error');
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    if (rejecting) return;
    try {
      setRejecting(true);
      const res = await rejectProposal(request._id, rejectReason);
      addToast(res.message || 'Proposal was declined.', 'info');
      await loadUserMedicineRequests();
      onClose();
    } catch (err) {
      addToast(err.message || 'Unable to update this proposal right now. Please try again.', 'error');
    } finally {
      setRejecting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex min-h-full items-start sm:items-center justify-center p-2.5 sm:p-4 animate-fade-in overscroll-contain">
      <div role="dialog" aria-modal="true" aria-labelledby="proposal-modal-title" className="my-auto bg-white rounded-3xl max-w-lg w-full max-h-[92vh] sm:max-h-[88vh] flex flex-col shadow-2xl animate-fade-in border border-slate-100 overflow-hidden relative">
        
        {/* Sticky Header - Always visible */}
        <div className="sticky top-0 z-20 shrink-0 bg-white border-b border-slate-100 p-4 sm:p-5 flex items-start justify-between shadow-xs">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-black uppercase tracking-wider bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full">
                Pharmacy Proposal
              </span>
              <span className="text-xs font-mono font-bold text-slate-500">
                #{request.requestNumber}
              </span>
            </div>
            <h3 id="proposal-modal-title" className="text-base sm:text-lg font-black text-slate-900">
              Review Medicine Proposal
            </h3>
            <p className="text-xs text-slate-500">
              Submitted on {new Date(request.createdAt).toLocaleDateString()}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close proposal"
            className="text-slate-400 hover:text-slate-700 text-lg font-bold w-8 h-8 rounded-full flex items-center justify-center hover:bg-slate-100 transition cursor-pointer shrink-0 ml-2"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Form Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-4 overscroll-contain">

        {/* Status Callout if not awaiting approval */}
        {isExpired && (
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3.5 text-rose-900 text-xs flex items-center gap-2.5">
            <span className="text-xl">⏳</span>
            <div>
              <strong>This proposal has expired.</strong>
              <p className="text-[11px] text-rose-700 mt-0.5">
                Pricing and supplier delivery slots are subject to market validity. Please submit a new medicine request.
              </p>
            </div>
          </div>
        )}

        {isApproved && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3.5 text-emerald-900 text-xs flex items-center gap-2.5">
            <span className="text-xl">✅</span>
            <div>
              <strong>Proposal approved & order created!</strong>
              <p className="text-[11px] text-emerald-700 mt-0.5">
                Order #{request.convertedOrderId ? String(request.convertedOrderId).slice(-6).toUpperCase() : ''} is currently being fulfilled.
              </p>
            </div>
          </div>
        )}

        {isRejected && (
          <div className="bg-slate-100 border border-slate-200 rounded-2xl p-3.5 text-slate-800 text-xs flex items-center gap-2.5">
            <span className="text-xl">❌</span>
            <div>
              <strong>Proposal was declined.</strong>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {request.status === 'PHARMACY_REJECTED'
                  ? 'Pharmacy was unable to procure this item from supplier network.'
                  : 'You declined this proposal.'}
              </p>
            </div>
          </div>
        )}

        {/* Medicine Product Details Card */}
        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 space-y-3">
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
            Offered Medication Details
          </span>

          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="font-extrabold text-sm sm:text-base text-slate-900">
                {proposal?.medicineName || request.requestedItems?.[0]?.requestedName}
              </h4>
              <p className="text-xs text-slate-600 mt-0.5 font-medium">
                {proposal?.dosageForm && <span>{proposal.dosageForm} • </span>}
                {proposal?.strength && <span>{proposal.strength} • </span>}
                {proposal?.manufacturer && <span>Mfg: {proposal.manufacturer}</span>}
              </p>
            </div>
            <div className="text-right">
              <span className="text-[10px] text-slate-400 uppercase font-black block">Quantity</span>
              <span className="text-sm font-black text-slate-900 bg-white border border-slate-200 px-2.5 py-0.5 rounded-lg inline-block">
                {proposal?.quantity || 1} units
              </span>
            </div>
          </div>

          {proposal?.alternativeProduct && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-2.5 text-xs text-amber-900">
              <strong className="block font-bold">Recommended Alternative Formulation:</strong>
              <p className="text-[11px] text-amber-800">{proposal.alternativeProduct}</p>
            </div>
          )}
        </div>

        {/* Pricing & Delivery Slot Summary Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          
          {/* Price Box */}
          <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 rounded-2xl p-3.5 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-emerald-800">
                {priceType === 'APPROXIMATE' ? 'Approximate Price' : 'Guaranteed Final Price'}
              </span>
              <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-md ${
                priceType === 'APPROXIMATE' ? 'bg-amber-200 text-amber-900' : 'bg-emerald-200 text-emerald-900'
              }`}>
                {priceType}
              </span>
            </div>
            <div className="text-2xl font-black text-emerald-800">
              ₹{priceValue}
            </div>
            <p className="text-[10px] text-emerald-700 leading-snug">
              {priceType === 'APPROXIMATE'
                ? 'Estimated price; final price may vary slightly based on supplier invoice.'
                : 'Payment method: Cash on Delivery (COD) upon courier arrival.'}
            </p>
          </div>

          {/* Delivery Slot Box */}
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-3.5 space-y-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-blue-800 block">
              Proposed Delivery Window
            </span>
            <div className="text-sm font-black text-blue-950 mt-1">
              {proposal?.deliverySlot?.label || `${proposal?.deliverySlot?.slotType || 'Flexible'} Delivery`}
            </div>
            <p className="text-[10px] text-blue-700 mt-1">
              📅 Date: {proposal?.deliverySlot?.date || 'Available date'}
              {proposal?.deliverySlot?.startTime && (
                <span> ({proposal.deliverySlot.startTime} – {proposal.deliverySlot.endTime})</span>
              )}
            </p>
          </div>

        </div>

        {/* Pharmacy Note */}
        {proposal?.pharmacyNote && (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 text-xs space-y-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
              Message from Dispensing Pharmacist
            </span>
            <p className="text-xs text-slate-700 italic">
              "{proposal.pharmacyNote}"
            </p>
          </div>
        )}

        {/* Prescription Verification Status */}
        <div className="flex items-center justify-between text-xs py-1 border-t border-slate-100 px-1">
          <span className="text-slate-500 font-medium">Prescription Status:</span>
          <span className={`font-bold px-2 py-0.5 rounded-full text-[11px] ${
            proposal?.prescriptionStatus === 'Verified'
              ? 'bg-emerald-100 text-emerald-800'
              : proposal?.prescriptionStatus === 'Not Required'
              ? 'bg-slate-100 text-slate-700'
              : 'bg-amber-100 text-amber-800'
          }`}>
            {proposal?.prescriptionStatus || 'Verified'}
          </span>
        </div>

        {/* Expiration Note */}
        {request.expiresAt && !isExpired && !isApproved && (
          <div className="text-[11px] text-slate-400 text-center font-medium">
            ⏱️ Proposal valid until {new Date(request.expiresAt).toLocaleString()}
          </div>
        )}

        </div>

        {/* Sticky Footer Actions - Confirm & Close buttons always visible */}
        <div className="sticky bottom-0 z-20 shrink-0 bg-white border-t border-slate-100 p-4 sm:p-5 shadow-xs">
          {canDecide ? (
            showApprovalConfirm ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5 space-y-3" role="group" aria-label="Confirm proposal approval">
                <div>
                  <p className="text-sm font-extrabold text-emerald-950">Please confirm this pharmacy proposal.</p>
                  <p className="mt-1 text-xs text-emerald-800">
                    {proposal?.medicineName || request.requestedItems?.[0]?.requestedName}
                    {' · Qty '}{proposal?.quantity || 1}
                    {' · '}{priceType} ₹{priceValue}
                    {' · '}{proposal?.deliverySlot?.label || 'Flexible delivery'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowApprovalConfirm(false)}
                    disabled={approving}
                    className="rounded-xl px-3.5 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                  >
                    Go Back
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-xl px-3.5 py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 cursor-pointer"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={handleApprove}
                    disabled={approving}
                    className="rounded-xl bg-emerald-700 hover:bg-emerald-800 px-4 py-2 text-xs font-black text-white shadow-sm cursor-pointer disabled:opacity-50"
                  >
                    {approving ? 'Creating Order...' : 'Confirm & Create Order'}
                  </button>
                </div>
              </div>
            ) : showRejectInput ? (
              <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3.5 space-y-2.5 animate-fade-in">
                <label className="block text-xs font-bold text-rose-900">
                  Reason for declining proposal (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Price higher than expected, purchased elsewhere..."
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-white border border-rose-200 rounded-xl outline-none"
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowRejectInput(false)}
                    className="text-xs font-bold text-slate-600 px-3 py-1.5 hover:bg-rose-100 rounded-lg cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="text-xs font-bold text-slate-600 px-3 py-1.5 hover:bg-slate-200 rounded-lg cursor-pointer"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={handleReject}
                    disabled={rejecting}
                    className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs px-3.5 py-1.5 rounded-xl cursor-pointer disabled:opacity-50"
                  >
                    {rejecting ? 'Declining...' : 'Confirm Rejection'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowRejectInput(true)}
                  className="w-full sm:w-auto px-4 py-2.5 border border-slate-200 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 text-slate-600 font-bold text-xs rounded-xl transition cursor-pointer text-center"
                >
                  Reject Proposal
                </button>

                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 sm:flex-initial px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowApprovalConfirm(true)}
                    className="flex-1 sm:flex-initial px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-xl shadow-md transition cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <span>✓</span>
                    <span>Approve & Confirm Order</span>
                  </button>
                </div>
              </div>
            )
          ) : isApproved ? (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-emerald-800 font-extrabold text-xs">
                <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">✓</span>
                <span>Pharmacy Proposal Approved & Converted to Order</span>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                {request.convertedOrderId && onOrderCreated && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOrderCreated({ _id: request.convertedOrderId });
                    }}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl transition cursor-pointer"
                  >
                    Track Order →
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-500 font-medium">
                {isExpired ? 'Proposal has expired.' : isRejected ? 'Proposal was declined.' : 'Proposal reviewed by pharmacy.'}
              </span>
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer"
              >
                Close
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
