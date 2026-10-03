import React, { useState, useEffect } from 'react';
import {
  getAdminMedicineRequests,
  getAdminMedicineRequestMetrics
} from '../../../api/medicineRequestService';
import AdminProposalModal from './AdminProposalModal';

export default function AdminMedicineRequestsTab({ onPendingCountRefresh }) {
  const [requests, setRequests] = useState([]);
  const [metrics, setMetrics] = useState({
    totalRequests: 0,
    pendingReviewCount: 0,
    underReviewCount: 0,
    proposalsSentCount: 0,
    convertedCount: 0,
    customerRejectedCount: 0,
    pharmacyRejectedCount: 0,
    expiredCount: 0,
    proposalAcceptanceRate: 0
  });

  const [loading, setLoading] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeRequest, setActiveRequest] = useState(null);
  const [proposalModalOpen, setProposalModalOpen] = useState(false);

  const loadRequests = async () => {
    try {
      setLoading(true);
      const [list, m] = await Promise.all([
        getAdminMedicineRequests({
          status: selectedStatus !== 'ALL' ? selectedStatus : undefined,
          search: searchQuery.trim() || undefined
        }),
        getAdminMedicineRequestMetrics()
      ]);
      setRequests(list || []);
      if (m) setMetrics(m);
    } catch (err) {
      console.error('Failed to load admin medicine requests:', err);
    } finally {
      setLoading(false);
      onPendingCountRefresh?.();
    }
  };

  useEffect(() => {
    loadRequests();
  }, [selectedStatus]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    loadRequests();
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'REQUESTED':
        return (
          <span className="bg-amber-100 text-amber-900 text-[10px] font-black px-2 py-0.5 rounded-full inline-flex items-center gap-1">
            <span>⏳</span> Pending Review
          </span>
        );
      case 'UNDER_REVIEW':
        return (
          <span className="bg-blue-100 text-blue-900 text-[10px] font-black px-2 py-0.5 rounded-full inline-flex items-center gap-1">
            <span>🔬</span> Under Review
          </span>
        );
      case 'PROPOSAL_SENT':
        return (
          <span className="bg-purple-100 text-purple-900 text-[10px] font-black px-2 py-0.5 rounded-full inline-flex items-center gap-1">
            <span>📤</span> Proposal Sent
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
            <span>✕</span> Customer Declined
          </span>
        );
      case 'PHARMACY_REJECTED':
        return (
          <span className="bg-rose-100 text-rose-800 text-[10px] font-black px-2 py-0.5 rounded-full inline-flex items-center gap-1">
            <span>✕</span> Pharmacy Rejected
          </span>
        );
      case 'EXPIRED':
        return (
          <span className="bg-slate-100 text-slate-500 text-[10px] font-black px-2 py-0.5 rounded-full inline-flex items-center gap-1">
            <span>⏱️</span> Expired
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

  return (
    <div className="space-y-5 animate-fade-in">
      
      {/* Metrics Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-slate-800">
        
        <div className="bg-white border border-slate-200 rounded-2xl p-3.5 shadow-xs">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">
            Pending / Under Review
          </span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-black text-amber-600">
              {metrics.pendingReviewCount + metrics.underReviewCount}
            </span>
            <span className="text-[11px] text-slate-400 font-medium">
              ({metrics.pendingReviewCount} new)
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-3.5 shadow-xs">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">
            Proposals Sent
          </span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-black text-purple-600">
              {metrics.proposalsSentCount}
            </span>
            <span className="text-[11px] text-slate-400 font-medium">awaiting customer</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-3.5 shadow-xs">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">
            Converted to Orders
          </span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-black text-emerald-600">
              {metrics.convertedCount}
            </span>
            <span className="text-[11px] font-bold text-emerald-600">
              {metrics.proposalAcceptanceRate}% rate
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-3.5 shadow-xs">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">
            Total Inquiries
          </span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-black text-slate-900">
              {metrics.totalRequests}
            </span>
            <span className="text-[11px] text-slate-400 font-medium">
              ({metrics.expiredCount} expired)
            </span>
          </div>
        </div>

      </div>

      {/* Control & Search Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-3.5 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
        
        {/* Status Filters */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar w-full sm:w-auto text-xs">
          {[
            { id: 'ALL', label: 'All Requests' },
            { id: 'REQUESTED', label: 'Pending Review' },
            { id: 'UNDER_REVIEW', label: 'Under Review' },
            { id: 'PROPOSAL_SENT', label: 'Proposal Sent' },
            { id: 'CUSTOMER_APPROVED', label: 'Customer Approved' },
            { id: 'CUSTOMER_REJECTED', label: 'Customer Rejected' },
            { id: 'PHARMACY_REJECTED', label: 'Pharmacy Rejected' },
            { id: 'EXPIRED', label: 'Expired' },
            { id: 'CONVERTED_TO_ORDER', label: 'Converted to Orders' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setSelectedStatus(tab.id)}
              className={`px-3 py-1.5 rounded-xl font-bold transition cursor-pointer whitespace-nowrap ${
                selectedStatus === tab.id
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search input */}
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 w-full sm:w-72">
          <input
            type="text"
            placeholder="Search medicine, customer, #MR..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-1.5 text-xs bg-slate-100 border border-transparent focus:border-purple-500 focus:bg-white rounded-xl outline-none"
          />
          <button
            type="submit"
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-xl cursor-pointer"
          >
            Search
          </button>
        </form>

      </div>

      {/* Request Table / Cards */}
      <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-xs space-y-4">
        
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-black text-slate-900">
              📋 Medicine Procurement Requests & Proposals
            </h3>
            <p className="text-xs text-slate-500">
              Customer inquiries for unstocked or out-of-stock items requiring supplier arrangement.
            </p>
          </div>
          <button
            onClick={loadRequests}
            disabled={loading}
            className="text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-xl cursor-pointer transition disabled:opacity-50"
          >
            {loading ? 'Refreshing...' : '🔄 Refresh'}
          </button>
        </div>

        {requests.length === 0 ? (
          <div className="py-16 text-center text-slate-400 space-y-2">
            <p className="text-3xl">📭</p>
            <p className="text-xs font-bold text-slate-700">No medicine requests found</p>
            <p className="text-[11px] text-slate-400">
              When customers search for medicines that are out of stock or not in the catalog, requests will appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 text-[10px] font-extrabold uppercase tracking-wider">
                  <th className="py-3 px-3">Req Number</th>
                  <th className="py-3 px-3">Customer</th>
                  <th className="py-3 px-3">Requested Medicine</th>
                  <th className="py-3 px-3">Attachments</th>
                  <th className="py-3 px-3">Proposal / Price</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {requests.map((req) => {
                  const firstItem = req.requestedItems?.[0] || {};
                  const proposal = req.pharmacyProposal;

                  return (
                    <tr key={req._id} className="hover:bg-slate-50 transition">
                      
                      <td className="py-3.5 px-3">
                        <span className="font-extrabold text-slate-900 font-mono block">
                          #{req.requestNumber}
                        </span>
                        <span className="text-[10px] text-slate-400 block">
                          {new Date(req.createdAt).toLocaleDateString()}
                        </span>
                      </td>

                      <td className="py-3.5 px-3">
                        <span className="font-bold text-slate-900 block">{req.customerName}</span>
                        <span className="text-[11px] text-slate-500 block">{req.customerPhone || 'No phone'}</span>
                        <span className="text-[10px] text-slate-400 truncate max-w-[150px] block" title={req.deliveryAddress}>
                          📍 {req.deliveryAddress}
                        </span>
                      </td>

                      <td className="py-3.5 px-3">
                        <ul className="space-y-1">
                          {(req.requestedItems || []).map((item, index) => (
                            <li key={`${item.requestedName}-${index}`}>
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-slate-900">{item.requestedName || 'Medicine'}</span>
                                {item.originalAvailabilityStatus === 'OUT_OF_STOCK' && (
                                  <span className="text-[9px] bg-amber-100 text-amber-800 font-bold px-1.5 py-0.2 rounded">
                                    Out of Stock
                                  </span>
                                )}
                              </div>
                              <span className="text-[11px] text-slate-500 block">
                                {item.strength && `${item.strength} • `}
                                Qty: {item.quantity || 1}
                              </span>
                            </li>
                          ))}
                        </ul>
                        <span className="text-[11px] text-slate-500 block">
                          {firstItem.dosageForm && `${firstItem.dosageForm} • `}
                          {firstItem.strength && `${firstItem.strength} • `}
                          Qty: <strong>{firstItem.quantity || 1}</strong>
                        </span>
                        {req.customerNote && (
                          <span className="text-[10px] text-slate-400 italic block line-clamp-1" title={req.customerNote}>
                            Note: "{req.customerNote}"
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-3">
                        <div className="flex items-center gap-1.5">
                          {req.prescriptionUrl ? (
                            <a
                              href={req.prescriptionUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[10px] font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 px-2 py-0.5 rounded border border-blue-200"
                            >
                              📄 Rx
                            </a>
                          ) : (
                            <span className="text-[10px] text-slate-300">—</span>
                          )}
                          {req.productImageUrl && (
                            <a
                              href={req.productImageUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[10px] font-bold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-2 py-0.5 rounded border border-indigo-200"
                            >
                              📷 Photo
                            </a>
                          )}
                        </div>
                      </td>

                      <td className="py-3.5 px-3">
                        {proposal ? (
                          <div>
                            <span className="font-black text-emerald-600 block">
                              ₹{proposal.finalPrice ?? proposal.totalPrice ?? proposal.approximatePrice}
                            </span>
                            <span className="text-[10px] text-slate-400 block">
                              {proposal.priceType === 'APPROXIMATE' ? 'Approximate' : 'Guaranteed Final'}
                            </span>
                            {proposal.deliverySlot?.label && (
                              <span className="text-[10px] text-blue-700 block truncate max-w-[130px]" title={proposal.deliverySlot.label}>
                                🚚 {proposal.deliverySlot.label}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 text-[11px] italic">No proposal yet</span>
                        )}
                      </td>

                      <td className="py-3.5 px-3">
                        {getStatusBadge(req.status)}
                        {req.status === 'PROPOSAL_SENT' && (
                          <span className="mt-1 block text-[10px] font-bold text-purple-700">
                            Waiting for Customer Approval
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-3 text-right">
                        <button
                          onClick={() => {
                            setActiveRequest(req);
                            setProposalModalOpen(true);
                          }}
                          className={`font-extrabold text-xs px-3.5 py-1.5 rounded-xl cursor-pointer transition shadow-xs ${
                            ['CUSTOMER_APPROVED', 'CONVERTED_TO_ORDER'].includes(req.status)
                              ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                              : req.status === 'PROPOSAL_SENT'
                              ? 'bg-purple-600 hover:bg-purple-700 text-white'
                              : 'bg-blue-600 hover:bg-blue-700 text-white'
                          }`}
                        >
                          {req.status === 'PROPOSAL_SENT'
                            ? 'View / Edit Proposal'
                            : ['CUSTOMER_APPROVED', 'CONVERTED_TO_ORDER'].includes(req.status)
                            ? 'View Details'
                            : ['CUSTOMER_REJECTED', 'PHARMACY_REJECTED', 'EXPIRED'].includes(req.status)
                            ? 'View Details'
                            : 'Review & Propose'}
                        </button>
                      </td>

                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

      </div>

      {/* Proposal Builder & Review Modal */}
      {proposalModalOpen && activeRequest && (
        <AdminProposalModal
          request={activeRequest}
          isOpen={proposalModalOpen}
          onClose={() => {
            setProposalModalOpen(false);
            setActiveRequest(null);
          }}
          onRefresh={loadRequests}
        />
      )}

    </div>
  );
}
