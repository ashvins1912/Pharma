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
    setApprovalNote('');
  }, [isOpen, request?._id, request?.id]);

  if (!isOpen || !request) return null;

  const proposal = request.pharmacyProposal || request.proposal;
  const isApproved = request.status === 'CUSTOMER_APPROVED' || request.status === 'CONVERTED_TO_ORDER';
  const isRejected = request.status === 'CUSTOMER_REJECTED' || request.status === 'PHARMACY_REJECTED';
  const isExpired = request.status === 'EXPIRED' || (request.expiresAt && new Date() > new Date(request.expiresAt));

  // Resilient ownership and eligibility checks:
  // Customers or any viewing user should be able to review & confirm unless already settled
  const reqCustomerId = request.customerId?._id || request.customerId || request.userId?._id || request.userId;
  const currentUserId = user?._id || user?.id || user?.sub;
  const isOwner = !reqCustomerId || !currentUserId || String(reqCustomerId) === String(currentUserId);

  // Proposal is actionable if not already approved or rejected
  const canDecide = !isApproved && !isRejected;

  const priceType = proposal?.priceType || 'APPROXIMATE';
  const priceValue = proposal?.finalPrice ?? proposal?.totalPrice ?? proposal?.approximatePrice ?? proposal?.unitPrice ?? 0;
  const targetId = request._id || request.id;

  const handleApprove = async () => {
    if (approving || !targetId) return;
    try {
      setApproving(true);
      const res = await approveProposal(targetId, approvalNote);
      addToast(res?.message || 'Proposal approved and converted into an order!', 'success');
      if (loadUserMedicineRequests) await loadUserMedicineRequests();
      if (loadUserOrders) await loadUserOrders();
      if (onOrderCreated && res?.order) {
        onOrderCreated(res.order);
      }
      onClose();
    } catch (err) {
      const errMsg = err?.response?.data?.message || err?.message || 'Unable to approve this proposal right now. Please try again.';
      addToast(errMsg, 'error');
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    if (rejecting || !targetId) return;
    try {
      setRejecting(true);
      const res = await rejectProposal(targetId, rejectReason);
      addToast(res?.message || 'Proposal was declined.', 'info');
      if (loadUserMedicineRequests) await loadUserMedicineRequests();
      onClose();
    } catch (err) {
      const errMsg = err?.response?.data?.message || err?.message || 'Unable to update this proposal right now. Please try again.';
      addToast(errMsg, 'error');
    } finally {
      setRejecting(false);
    }
  };

  return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
        {/* Modal Dialog Card with pinned header and pinned action footer */}
        <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl animate-fade-in max-h-[92vh] flex flex-col border border-slate-100 overflow-hidden">

          {/* Pinned Header */}
          <div className="flex items-start justify-between border-b border-slate-100 px-5 sm:px-6 py-4 bg-white flex-shrink-0">
            <div>
              <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-black uppercase tracking-wider bg-purple-100 text-purple-800 px-2.5 py-0.5 rounded-full">
                Pharmacy Proposal
              </span>
                <span className="text-xs font-mono font-bold text-slate-500">
                #{request.requestNumber || request.referenceNumber || 'REQ'}
              </span>
              </div>
              <h3 className="text-base sm:text-lg font-black text-slate-900">
                Review Medicine Proposal
              </h3>
              <p className="text-xs text-slate-500">
                Submitted on {request.createdAt ? new Date(request.createdAt).toLocaleDateString() : 'Recent'}
              </p>
            </div>
            <button
                type="button"
                onClick={onClose}
                aria-label="Close modal"
                className="text-slate-400 hover:text-slate-700 text-lg font-bold p-1.5 rounded-full hover:bg-slate-100 transition cursor-pointer"
            >
              ✕
            </button>
          </div>

          {/* Scrollable Content Area */}
          <div className="p-5 sm:p-6 overflow-y-auto space-y-4 flex-1">
            {/* Status Callouts */}
            {isExpired && !isApproved && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 text-amber-900 text-xs flex items-center gap-2.5">
                  <span className="text-xl">⏳</span>
                  <div>
                    <strong>Proposal validity period has lapsed.</strong>
                    <p className="text-[11px] text-amber-700 mt-0.5">
                      You can still confirm to request pharmacy verification, or cancel to request a new quote.
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
                          : 'This proposal was declined.'}
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
                    {proposal?.medicineName || request.requestedItems?.[0]?.requestedName || 'Requested Medication'}
                  </h4>
                  <p className="text-xs text-slate-600 mt-0.5 font-medium">
                    {proposal?.dosageForm && <span>{proposal.dosageForm} • </span>}
                    {proposal?.strength && <span>{proposal.strength} • </span>}
                    {proposal?.manufacturer ? <span>Mfg: {proposal.manufacturer}</span> : <span>Verified Stock</span>}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
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
                      ? 'Estimated price; final price based on actual pharmacy supplier invoice.'
                      : 'Payment method: Cash on Delivery (COD) or UPI on arrival.'}
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
                  📅 Date: {proposal?.deliverySlot?.date || 'Earliest available date'}
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

            {/* Prescription Status & Validity row */}
            <div className="flex flex-wrap items-center justify-between text-xs py-2 border-t border-slate-100 gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-medium">Prescription:</span>
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

              {request.expiresAt && !isExpired && !isApproved && (
                  <span className="text-[11px] text-slate-400 font-medium">
                ⏱️ Valid until {new Date(request.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              )}
            </div>
          </div>

          {/* Pinned Bottom Action Controls (Always visible, never clipped or pushed off screen) */}
          <div className="p-4 sm:p-5 bg-slate-50 border-t border-slate-200/80 flex-shrink-0">
            {canDecide ? (
                <div>
                  {showApprovalConfirm ? (
                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5 space-y-3" role="group" aria-label="Confirm proposal approval">
                        <div>
                          <p className="text-xs sm:text-sm font-extrabold text-emerald-950">Confirm and place this order?</p>
                          <p className="mt-0.5 text-[11px] text-emerald-800">
                            {proposal?.medicineName || request.requestedItems?.[0]?.requestedName || 'Medication'}
                            {' · Qty '}{proposal?.quantity || 1}
                            {' · '}{priceType} ₹{priceValue}
                            {' · '}{proposal?.deliverySlot?.label || 'Flexible delivery'}
                          </p>
                        </div>
                        <div className="flex items-center justify-end gap-2 pt-1">
                          <button
                              type="button"
                              onClick={() => setShowApprovalConfirm(false)}
                              disabled={approving}
                              className="rounded-xl px-4 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 transition cursor-pointer disabled:opacity-50"
                          >
                            Cancel
                          </button>
                          <button
                              type="button"
                              onClick={handleApprove}
                              disabled={approving}
                              className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-5 py-2 text-xs font-black text-white shadow-md transition cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                          >
                            <span>✓</span>
                            <span>{approving ? 'Creating Order...' : 'Confirm Order'}</span>
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
                            className="w-full px-3 py-1.5 text-xs bg-white border border-rose-200 rounded-xl outline-none focus:ring-2 focus:ring-rose-400"
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
                            {rejecting ? 'Declining...' : 'Confirm Decline'}
                          </button>
                        </div>
                      </div>
                  ) : (
                      <div className="flex items-center justify-between gap-2.5">
                        <div className="flex items-center gap-2">
                          <button
                              type="button"
                              onClick={onClose}
                              className="px-4 py-2.5 border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer"
                          >
                            Cancel
                          </button>
                          <button
                              type="button"
                              onClick={() => setShowRejectInput(true)}
                              className="px-3.5 py-2.5 text-rose-600 hover:bg-rose-100/70 font-bold text-xs rounded-xl transition cursor-pointer"
                          >
                            Decline
                          </button>
                        </div>

                        <button
                            type="button"
                            onClick={() => setShowApprovalConfirm(true)}
                            disabled={approving}
                            className="px-5 sm:px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-xl shadow-md transition cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
                        >
                          <span>✓</span>
                          <span>Confirm Proposal</span>
                        </button>
                      </div>
                  )}
                </div>
            ) : (
                <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500 font-medium">
                {isApproved ? 'Proposal completed' : 'Proposal closed'}
              </span>
                  <button
                      type="button"
                      onClick={onClose}
                      className="px-5 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs rounded-xl transition cursor-pointer"
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
