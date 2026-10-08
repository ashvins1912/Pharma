import React, { useState, useEffect } from 'react';
import apiClient from '../api/apiClient';
import { useToast } from '../context/ToastContext';
import MedicineRequestModal from './MedicineRequestModal';
import { useActionLoading, LOADING_ACTIONS } from '../context/LoadingContext';

export default function MedicineRequestsView({ onOrderCreated }) {
  const { addToast } = useToast();
  const { runAction, isActionLoading } = useActionLoading();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newRequestModalOpen, setNewRequestModalOpen] = useState(false);

  const loadRequests = async () => {
    try {
      setLoading(true);
      const res = await apiClient.get('/api/medicine-requests/my');
      setRequests(res.data || []);
    } catch (err) {
      addToast(err.message || 'Could not load your medicine requests.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRequests();
  }, []);

  const handleDecision = async (requestId, decision) => {
    const action = decision === 'approve' ? LOADING_ACTIONS.APPROVE_MEDICINE : LOADING_ACTIONS.REJECT_MEDICINE;
    await runAction(action, async () => {
      try {
        const res = await apiClient.post(`/api/medicine-requests/${requestId}/proposal/decision`, { decision });
        addToast(res.data.message || `Proposal ${decision}d.`, decision === 'approve' ? 'success' : 'info');
        await loadRequests();
        if (decision === 'approve' && onOrderCreated) onOrderCreated();
      } catch (err) {
        addToast(err.message || `Failed to ${decision} proposal.`, 'error');
      }
    });
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'Proposal Received':
        return <span className="bg-emerald-100 text-emerald-800 text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase animate-pulse">Proposal Ready ✨</span>;
      case 'Proposal Approved':
        return <span className="bg-blue-100 text-blue-800 text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase">Order Created ✓</span>;
      case 'Proposal Rejected':
        return <span className="bg-slate-200 text-slate-700 text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase">Declined</span>;
      default:
        return <span className="bg-amber-100 text-amber-800 text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase">Awaiting Pharmacist</span>;
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 shadow-sm space-y-5">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">📋</span>
            <h3 className="text-base sm:text-lg font-black text-slate-900">
              Special Medicine Requests & Pharmacy Proposals
            </h3>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Review custom quotes, pricing types, and delivery slots formulated by our dispensary staff.
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={() => setNewRequestModalOpen(true)}
            className="flex-1 sm:flex-initial bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs px-4 py-2.5 rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5 shadow-sm shadow-blue-500/20 min-h-[44px]"
          >
            <span>+</span>
            <span>New Request</span>
          </button>
          <button
            onClick={loadRequests}
            disabled={loading}
            className="flex-1 sm:flex-initial text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-2.5 rounded-xl transition cursor-pointer min-h-[44px]"
          >
            {loading ? 'Refreshing...' : '🔄 Refresh'}
          </button>
        </div>
      </div>

      {/* Requests List */}
      {loading && requests.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-xs font-semibold">
          Loading your medicine requests...
        </div>
      ) : requests.length === 0 ? (
        <div className="text-center py-12 bg-slate-50 rounded-2xl border border-dashed border-slate-200 space-y-3">
          <span className="text-3xl block">💊</span>
          <h4 className="text-sm font-bold text-slate-700">No special medicine requests placed</h4>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            Need a rare prescription medicine or out-of-stock formulation? Submit a request and our pharmacist will curate a dedicated delivery proposal for you.
          </p>
          <button
            onClick={() => setNewRequestModalOpen(true)}
            className="mt-1 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-4 py-2 rounded-xl transition cursor-pointer"
          >
            + Submit First Medicine Request
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {requests.map((req) => {
            const hasProposal = Boolean(req.proposal);
            const isProcessing = actionLoadingId === req._id;

            return (
              <div
                key={req._id}
                className={`border rounded-2xl p-4 sm:p-5 transition space-y-3 ${
                  req.status === 'Proposal Received'
                    ? 'border-emerald-300 bg-emerald-50/20 shadow-xs'
                    : 'border-slate-200 bg-white'
                }`}
              >
                {/* Request Overview Header */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pb-2 border-b border-slate-100">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <h4 className="font-extrabold text-sm sm:text-base text-slate-900">
                        {req.medicineName}
                      </h4>
                      <span className="text-xs text-slate-500 font-bold">
                        (Qty: {req.quantity})
                      </span>
                    </div>
                    {req.saltComposition && (
                      <p className="text-[11px] text-slate-500">
                        Salt: {req.saltComposition}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 self-start sm:self-center">
                    <span className="text-[10px] text-slate-400">
                      {new Date(req.createdAt).toLocaleDateString()}
                    </span>
                    {getStatusBadge(req.status)}
                  </div>
                </div>

                {/* Patient Notes */}
                {req.customerNote && (
                  <p className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                    <strong className="text-slate-700">Patient Note:</strong> {req.customerNote}
                  </p>
                )}

                {/* Pharmacist Proposal Card */}
                {hasProposal ? (
                  <div className="bg-white border-2 border-emerald-200 rounded-2xl p-4 sm:p-5 space-y-3 shadow-xs">
                    <div className="flex items-center justify-between pb-2 border-b border-emerald-100">
                      <div className="flex items-center gap-2">
                        <span className="text-base">🏷️</span>
                        <span className="text-xs font-black uppercase tracking-wider text-emerald-800">
                          Pharmacist Itemized Proposal
                        </span>
                      </div>
                      <span className="text-[10px] text-emerald-700 font-bold">
                        Proposed by {req.proposal.proposedBy || 'Pharmacy Staff'}
                      </span>
                    </div>

                    {/* Proposal Details Table/Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                      <div className="space-y-0.5">
                        <span className="text-[10px] font-bold text-slate-400 uppercase">Medicine</span>
                        <p className="font-extrabold text-slate-900 leading-snug">
                          {req.proposal.medicineName}
                        </p>
                        {req.proposal.brand && (
                          <p className="text-[10px] text-slate-500">{req.proposal.brand}</p>
                        )}
                      </div>

                      <div className="space-y-0.5">
                        <span className="text-[10px] font-bold text-slate-400 uppercase">Quantity</span>
                        <p className="font-extrabold text-slate-900">
                          {req.proposal.quantity} unit{req.proposal.quantity > 1 ? 's' : ''}
                        </p>
                      </div>

                      <div className="space-y-0.5">
                        <span className="text-[10px] font-bold text-slate-400 uppercase">Price & Type</span>
                        <p className="font-black text-emerald-700 text-sm">
                          ₹{req.proposal.price * req.proposal.quantity}{' '}
                          <span className="text-[10px] text-slate-400 font-normal">
                            (₹{req.proposal.price}/unit)
                          </span>
                        </p>
                        <span className="inline-block text-[10px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.2 rounded">
                          {req.proposal.priceType}
                        </span>
                      </div>

                      <div className="space-y-0.5">
                        <span className="text-[10px] font-bold text-slate-400 uppercase">Delivery Schedule</span>
                        <p className="font-bold text-slate-900">
                          📅 {req.proposal.deliveryDate || 'Next Day'}
                        </p>
                        <p className="text-[10px] text-blue-700 font-bold">
                          ⏰ {req.proposal.deliverySlot}
                        </p>
                      </div>
                    </div>

                    {/* Pharmacy Note */}
                    {req.proposal.pharmacyNote && (
                      <div className="bg-emerald-50/70 border border-emerald-100 rounded-xl p-2.5 text-xs text-emerald-900 leading-relaxed">
                        <strong>Pharmacy Note:</strong> {req.proposal.pharmacyNote}
                      </div>
                    )}

                    {/* Proposal Action Buttons */}
                    {req.status === 'Proposal Received' && (
                      <div className="pt-2 flex flex-col sm:flex-row items-center gap-2">
                        <button
                          onClick={() => handleDecision(req._id, 'approve')}
                          disabled={isActionLoading(LOADING_ACTIONS.APPROVE_MEDICINE) || isActionLoading(LOADING_ACTIONS.REJECT_MEDICINE)}
                          className="w-full sm:flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs py-2.5 px-4 rounded-xl shadow-md shadow-emerald-600/20 transition cursor-pointer flex items-center justify-center gap-1.5 min-h-[44px]"
                        >
                          {isActionLoading(LOADING_ACTIONS.APPROVE_MEDICINE) && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}<span>{isActionLoading(LOADING_ACTIONS.APPROVE_MEDICINE) ? 'Approving...' : '✓ Approve & Confirm Order'}</span>
                        </button>
                        <button
                          onClick={() => handleDecision(req._id, 'reject')}
                          disabled={isProcessing}
                          className="w-full sm:w-auto bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs py-2.5 px-4 rounded-xl transition cursor-pointer min-h-[44px]"
                        >
                          {isActionLoading(LOADING_ACTIONS.REJECT_MEDICINE) ? 'Rejecting...' : '✕ Reject Proposal'}
                        </button>
                      </div>
                    )}

                    {req.status === 'Proposal Approved' && (
                      <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800 font-bold flex items-center gap-2">
                        <span>🎉</span>
                        <span>Proposal approved! The order has been automatically placed into the dispensary dispatch queue.</span>
                      </div>
                    )}

                    {req.status === 'Proposal Rejected' && (
                      <div className="p-2 bg-slate-100 rounded-xl text-xs text-slate-500 italic">
                        You declined this proposal. You may submit a new request at any time.
                      </div>
                    )}

                  </div>
                ) : (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-500 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping"></span>
                    <span>Our pharmacist is actively checking dispensary availability and formulating your proposal.</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* New Medicine Request Modal */}
      <MedicineRequestModal
        isOpen={newRequestModalOpen}
        onClose={() => setNewRequestModalOpen(false)}
        onRequestSubmitted={loadRequests}
      />

    </div>
  );
}
