import React, { useState, useEffect } from 'react';
import apiClient from '../../api/apiClient';
import { useToast } from '../../context/ToastContext';

export default function AdminMedicineRequestsView() {
  const { addToast } = useToast();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [proposalModalRequest, setProposalModalRequest] = useState(null);

  // Proposal Form State
  const [propMedicineName, setPropMedicineName] = useState('');
  const [propBrand, setPropBrand] = useState('');
  const [propQuantity, setPropQuantity] = useState(1);
  const [propPrice, setPropPrice] = useState('');
  const [propPriceType, setPropPriceType] = useState('Standard MRP');
  const [propDeliveryDate, setPropDeliveryDate] = useState('');
  const [propDeliverySlot, setPropDeliverySlot] = useState('Morning (8 AM - 12 PM)');
  const [propPharmacyNote, setPropPharmacyNote] = useState('');
  const [submittingProposal, setSubmittingProposal] = useState(false);

  const loadAllRequests = async () => {
    try {
      setLoading(true);
      const res = await apiClient.get('/api/medicine-requests/admin/all');
      // Admin API returns a paginated envelope; keep the component state array-shaped.
      setRequests(Array.isArray(res.data) ? res.data : (res.data?.requests || res.data?.items || []));
    } catch (err) {
      addToast(err.message || 'Could not load requests queue.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAllRequests();
  }, []);

  const openProposalModal = (req) => {
    setProposalModalRequest(req);
    const existing = req.proposal;
    if (existing) {
      setPropMedicineName(existing.medicineName || req.medicineName);
      setPropBrand(existing.brand || '');
      setPropQuantity(existing.quantity || req.quantity || 1);
      setPropPrice(existing.price || '');
      setPropPriceType(existing.priceType || 'Standard MRP');
      setPropDeliveryDate(existing.deliveryDate || new Date(Date.now() + 86400000).toISOString().slice(0, 10));
      setPropDeliverySlot(existing.deliverySlot || 'Morning (8 AM - 12 PM)');
      setPropPharmacyNote(existing.pharmacyNote || '');
    } else {
      setPropMedicineName(req.medicineName);
      setPropBrand('');
      setPropQuantity(req.quantity || 1);
      setPropPrice('');
      setPropPriceType('Standard MRP');
      setPropDeliveryDate(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
      setPropDeliverySlot('Morning (8 AM - 12 PM)');
      setPropPharmacyNote('Inspected and sourced from certified wholesale distributor.');
    }
  };

  const handleSaveProposal = async (e) => {
    e.preventDefault();
    if (!propMedicineName.trim() || !propPrice) {
      addToast('Please enter medicine name and unit price.', 'warning');
      return;
    }

    setSubmittingProposal(true);
    try {
      const res = await apiClient.post(`/api/medicine-requests/admin/${proposalModalRequest._id}/proposal`, {
        medicineName: propMedicineName.trim(),
        brand: propBrand.trim(),
        quantity: Math.max(1, Number(propQuantity) || 1),
        price: Number(propPrice),
        priceType: propPriceType,
        deliveryDate: propDeliveryDate,
        deliverySlot: propDeliverySlot,
        pharmacyNote: propPharmacyNote.trim()
      });

      addToast(res.data.message || 'Proposal dispatched to customer.', 'success');
      setProposalModalRequest(null);
      await loadAllRequests();
    } catch (err) {
      addToast(err.message || 'Could not submit proposal.', 'error');
    } finally {
      setSubmittingProposal(false);
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'Proposal Received':
        return <span className="bg-emerald-100 text-emerald-800 text-[10px] font-black px-2 py-0.5 rounded-full uppercase">Proposal Sent</span>;
      case 'Proposal Approved':
        return <span className="bg-blue-100 text-blue-800 text-[10px] font-black px-2 py-0.5 rounded-full uppercase">Order Created ✓</span>;
      case 'Proposal Rejected':
        return <span className="bg-slate-200 text-slate-700 text-[10px] font-black px-2 py-0.5 rounded-full uppercase">Declined</span>;
      default:
        return <span className="bg-amber-100 text-amber-800 text-[10px] font-black px-2 py-0.5 rounded-full uppercase">Needs Proposal ⚠️</span>;
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 shadow-sm space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-3 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">📑</span>
            <h3 className="text-base sm:text-lg font-black text-slate-900">
              Customer Medicine Requests & Procurement Proposals
            </h3>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Formulate official pharmacy quotes with custom pricing tiers, delivery slots, and stock availability.
          </p>
        </div>
        <button
          onClick={loadAllRequests}
          disabled={loading}
          className="text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 px-3.5 py-2 rounded-xl transition cursor-pointer min-h-[44px]"
        >
          {loading ? 'Refreshing...' : '🔄 Refresh Queue'}
        </button>
      </div>

      {/* Content */}
      {loading && requests.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-xs font-semibold">
          Loading requests queue...
        </div>
      ) : requests.length === 0 ? (
        <div className="text-center py-12 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
          <p className="text-xs font-bold text-slate-600">No active customer medicine requests.</p>
        </div>
      ) : (
        <>
          {/* Desktop Table View: Customer | Medicine | Prescription | Proposal | Actions */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 text-[10px] font-extrabold uppercase tracking-wider">
                  <th className="py-3 px-3">Customer</th>
                  <th className="py-3 px-3">Medicine Requested</th>
                  <th className="py-3 px-3">Urgency</th>
                  <th className="py-3 px-3">Current Proposal Status</th>
                  <th className="py-3 px-3">Proposal Price & Slot</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {requests.map((req) => (
                  <tr key={req._id} className="hover:bg-slate-50/70 transition">
                    {/* Customer */}
                    <td className="py-3.5 px-3">
                      <span className="font-extrabold text-slate-900 block">{req.customerName}</span>
                      <span className="text-[10px] text-slate-400">{req.customerMobile || 'No phone'}</span>
                    </td>

                    {/* Medicine */}
                    <td className="py-3.5 px-3">
                      <span className="font-bold text-slate-900 block leading-tight">{req.medicineName}</span>
                      <span className="text-[10px] text-slate-500">Qty: {req.quantity} {req.saltComposition && `• Salt: ${req.saltComposition}`}</span>
                    </td>

                    {/* Urgency */}
                    <td className="py-3.5 px-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        req.urgency.includes('Critical')
                          ? 'bg-rose-100 text-rose-800'
                          : req.urgency.includes('Urgent')
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-100 text-slate-700'
                      }`}>
                        {req.urgency}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="py-3.5 px-3">
                      {getStatusBadge(req.status)}
                    </td>

                    {/* Proposal Details */}
                    <td className="py-3.5 px-3">
                      {req.proposal ? (
                        <div>
                          <span className="font-black text-emerald-700">₹{req.proposal.price * req.proposal.quantity}</span>
                          <span className="text-[10px] text-slate-500 block">{req.proposal.deliverySlot}</span>
                        </div>
                      ) : (
                        <span className="text-slate-400 italic text-[11px]">No proposal formulated</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-3 text-right">
                      <button
                        onClick={() => openProposalModal(req)}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs px-3.5 py-1.5 rounded-xl transition cursor-pointer shadow-xs min-h-[36px]"
                      >
                        {req.proposal ? '✏️ Edit Proposal' : '➕ Create Proposal'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Stacked Card View (Section 25 Requirement) */}
          <div className="lg:hidden space-y-3">
            {requests.map((req) => (
              <div key={req._id} className="p-4 bg-slate-50/80 border border-slate-200 rounded-2xl space-y-3">
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <h4 className="font-black text-sm text-slate-900">{req.medicineName}</h4>
                    <p className="text-xs text-slate-500">
                      Customer: <strong className="text-slate-800">{req.customerName}</strong> (Qty: {req.quantity})
                    </p>
                    {req.customerMobile && (
                      <p className="text-[11px] text-slate-400">📞 {req.customerMobile}</p>
                    )}
                  </div>
                  <div>{getStatusBadge(req.status)}</div>
                </div>

                {req.saltComposition && (
                  <p className="text-[11px] text-slate-500">
                    <strong>Salt Composition:</strong> {req.saltComposition}
                  </p>
                )}

                {req.proposal && (
                  <div className="bg-white border border-emerald-200 rounded-xl p-3 text-xs space-y-1">
                    <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 block">
                      Active Proposal:
                    </span>
                    <div className="flex justify-between font-bold">
                      <span>Total: ₹{req.proposal.price * req.proposal.quantity} ({req.proposal.priceType})</span>
                      <span className="text-blue-700">{req.proposal.deliveryDate}</span>
                    </div>
                    <p className="text-[11px] text-slate-500">{req.proposal.deliverySlot}</p>
                    {req.proposal.pharmacyNote && (
                      <p className="text-[10px] text-slate-600 italic mt-1">{req.proposal.pharmacyNote}</p>
                    )}
                  </div>
                )}

                <div className="pt-2 border-t border-slate-200 flex justify-end">
                  <button
                    onClick={() => openProposalModal(req)}
                    className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs px-4 py-2.5 rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5 min-h-[44px]"
                  >
                    <span>{req.proposal ? '✏️ Modify Proposal' : '➕ Formulate Delivery Proposal'}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Proposal Creation / Edit Modal Dialog */}
      {proposalModalRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-3xl shadow-2xl max-w-lg w-full p-4 sm:p-6 md:p-8 my-6 relative max-h-[92vh] overflow-y-auto">
            
            <div className="flex justify-between items-start pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base sm:text-lg font-black text-slate-900">
                  {proposalModalRequest.proposal ? 'Edit Pharmacy Proposal' : 'Create Pharmacy Proposal'}
                </h3>
                <p className="text-xs text-slate-500">
                  For {proposalModalRequest.customerName} • Requested: {proposalModalRequest.medicineName} (Qty: {proposalModalRequest.quantity})
                </p>
              </div>
              <button
                onClick={() => setProposalModalRequest(null)}
                className="text-slate-400 hover:text-slate-600 w-8 h-8 rounded-full flex items-center justify-center bg-slate-100"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveProposal} className="space-y-4 py-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                  Medicine & Formulation *
                </label>
                <input
                  type="text"
                  required
                  value={propMedicineName}
                  onChange={(e) => setPropMedicineName(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                    Procured Brand / Manufacturer
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Hetero, Abbott, GSK"
                    value={propBrand}
                    onChange={(e) => setPropBrand(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                    Confirmed Quantity *
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={propQuantity}
                    onChange={(e) => setPropQuantity(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                    Unit Price (₹) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    required
                    placeholder="e.g. 450"
                    value={propPrice}
                    onChange={(e) => setPropPrice(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none font-black text-emerald-700"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                    Price Type
                  </label>
                  <select
                    value={propPriceType}
                    onChange={(e) => setPropPriceType(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold"
                  >
                    <option value="Standard MRP">Standard MRP</option>
                    <option value="Subsidized Generic">Subsidized Generic</option>
                    <option value="Special Formulation">Special Formulation</option>
                    <option value="Discounted Institutional">Discounted Institutional</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                    Estimated Delivery Date
                  </label>
                  <input
                    type="date"
                    value={propDeliveryDate}
                    onChange={(e) => setPropDeliveryDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                    Delivery Slot
                  </label>
                  <select
                    value={propDeliverySlot}
                    onChange={(e) => setPropDeliverySlot(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold"
                  >
                    <option value="Morning (8 AM - 12 PM)">Morning (8 AM - 12 PM)</option>
                    <option value="Afternoon (12 PM - 4 PM)">Afternoon (12 PM - 4 PM)</option>
                    <option value="Evening (4 PM - 8 PM)">Evening (4 PM - 8 PM)</option>
                    <option value="Express 30-Min Emergency">Express 30-Min Emergency</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                  Pharmacist Procurement / Storage Note
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Certified cold-chain temperature monitoring maintained during transit."
                  value={propPharmacyNote}
                  onChange={(e) => setPropPharmacyNote(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={() => setProposalModalRequest(null)}
                  className="w-full sm:w-1/3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 rounded-xl text-xs min-h-[44px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingProposal}
                  className="w-full sm:w-2/3 bg-blue-600 hover:bg-blue-700 text-white font-extrabold py-2.5 rounded-xl text-xs shadow-md shadow-blue-600/20 flex items-center justify-center gap-1.5 min-h-[44px]"
                >
                  <span>{submittingProposal ? 'Dispatching...' : 'Send Proposal to Patient'}</span>
                  <span>↗</span>
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

    </div>
  );
}
