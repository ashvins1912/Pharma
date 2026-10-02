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
  }, [isOpen, request?._id]);

  if (!isOpen || !request) return null;

  const proposal = request.pharmacyProposal;
  const isExpired = request.status === 'EXPIRED' || (request.expiresAt && new Date() > new Date(request.expiresAt));
  const isApproved = request.status === 'CUSTOMER_APPROVED' || request.status === 'CONVERTED_TO_ORDER';
  const isRejected = request.status === 'CUSTOMER_REJECTED' || request.status === 'PHARMACY_REJECTED';
  const isOwner = String(request.customerId) === String(user?.id || user?.sub);
  const canDecide = role === 'customer'
    && isOwner
    && request.status === 'PROPOSAL_SENT'
    && !isExpired;

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
      addToast(err.response?.data?.message || err.message || 'Failed to approve proposal.', 'error');
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
      addToast(err.response?.data?.message || err.message || 'Failed to reject proposal.', 'error');
    } finally {
      setRejecting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-3xl max-w-lg w-full p-5 sm:p-7 shadow-2xl space-y-5 animate-fade-in max-h-[92vh] overflow-y-auto border border-slate-100">
        
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 pb-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-black uppercase tracking-wider bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full">
                Pharmacy Proposal
              </span>
              <span className="text-xs font-mono font-bold text-slate-500">
                #{request.requestNumber}
              </span>
            </div>
            <h3 className="text-base sm:text-lg font-black text-slate-900">
              Review Medicine Proposal
            </h3>
            <p className="text-xs text-slate-500">
              Submitted on {new Date(request.createdAt).toLocaleDateString()}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-lg font-bold p-1 rounded-full hover:bg-slate-100 transition cursor-pointer"
          >
            ✕
          </button>
        </div>

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

        {/* Action Controls */}
        {canDecide && (
          <div className="space-y-3 pt-2 border-t border-slate-100">
            {showApprovalConfirm ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 space-y-3" role="group" aria-label="Confirm proposal approval">
                <div>
                  <p className="text-sm font-extrabold text-emerald-950">Please confirm this pharmacy proposal.</p>
                  <p className="mt-1 text-xs text-emerald-800">
                    {proposal?.medicineName || request.requestedItems?.[0]?.requestedName}
                    {' · Qty '}{proposal?.quantity || 1}
                    {' · '}{priceType} ₹{priceValue}
                    {' · '}{proposal?.deliverySlot?.label || 'Flexible delivery'}
                  </p>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowApprovalConfirm(false)}
                    disabled={approving}
                    className="rounded-xl px-4 py-2 text-xs font-bold text-slate-700 hover:bg-white disabled:opacity-50"
                  >
                    Go Back
                  </button>
                  <button
                    type="button"
                    onClick={handleApprove}
                    disabled={approving}
                    className="rounded-xl bg-emerald-700 px-4 py-2 text-xs font-black text-white disabled:opacity-50"
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

                <button
                  type="button"
                  onClick={() => setShowApprovalConfirm(true)}
                  className="w-full sm:w-auto px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-xl shadow-md transition cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span>✓</span>
                  <span>Approve & Confirm Order</span>
                </button>
              </div>
            )}

          </div>
        )}

      </div>
    </div>
  );
}
