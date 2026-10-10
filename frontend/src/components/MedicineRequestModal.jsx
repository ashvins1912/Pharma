import React, { useState, useEffect } from 'react';
import apiClient from '../api/apiClient';
import { useToast } from '../context/ToastContext';
import { useActionLoading, LOADING_ACTIONS } from '../context/LoadingContext';
import { useApp } from '../context/AppContext';

export default function MedicineRequestModal({ isOpen, onClose, initialMedicineName = '', onRequestSubmitted }) {
  const { addToast } = useToast();
  const { runAction, isActionLoading } = useActionLoading();
  const { addresses, selectedAddressId, setSelectedAddressId, loadAddresses } = useApp();
  const submitting = isActionLoading(LOADING_ACTIONS.CREATE_MEDICINE);

  const [medicineName, setMedicineName] = useState(initialMedicineName);
  const [saltComposition, setSaltComposition] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [urgency, setUrgency] = useState('Normal');
  const [customerNote, setCustomerNote] = useState('');
  const [prescriptionFile, setPrescriptionFile] = useState(null);
  const [addressError, setAddressError] = useState('');

  // Sync initial medicine name when modal opens
  useEffect(() => {
    if (isOpen) void loadAddresses();
  }, [isOpen, loadAddresses]);

  useEffect(() => {
    if (isOpen && addresses.length && !selectedAddressId) {
      const defaultAddress = addresses.find(address => address.isDefault) || addresses[0];
      setSelectedAddressId(defaultAddress?._id || '');
    }
  }, [isOpen, addresses, selectedAddressId, setSelectedAddressId]);

  useEffect(() => {
    if (initialMedicineName) {
      setMedicineName(initialMedicineName);
    }
  }, [initialMedicineName]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!medicineName.trim()) {
      addToast('Please enter the medicine or salt name.', 'warning');
      return;
    }

    await runAction(LOADING_ACTIONS.CREATE_MEDICINE, async () => {
      if (!selectedAddressId) {
        setAddressError('Select a saved delivery address before submitting the request.');
        return;
      }
      setAddressError('');
      try {
      const form = new FormData();
      form.append('requestedItems', JSON.stringify([{
        requestedName: medicineName.trim(),
        composition: saltComposition.trim(),
        quantity: Math.max(1, Number(quantity) || 1),
        originalAvailabilityStatus: 'NOT_IN_CATALOG'
      }]));
      form.append('addressId', selectedAddressId);
      form.append('urgencyLevel', urgency);
      form.append('preferredDeliveryPreference', 'Flexible');
      form.append('customerNote', customerNote.trim());
      if (prescriptionFile) form.append('prescription', prescriptionFile);
      const res = await apiClient.post('/api/medicine-requests', form);

      addToast(res.data.message || 'Medicine request submitted to pharmacy!', 'success');
      if (onRequestSubmitted) onRequestSubmitted(res.data.request);
      onClose();
      // Reset form
      setMedicineName('');
      setSaltComposition('');
      setQuantity(1);
      setUrgency('Normal');
      setCustomerNote('');
      setPrescriptionFile(null);
      setAddressError('');
      } catch (err) {
        addToast(err.message || 'Could not submit medicine request.', 'error');
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-3xl shadow-2xl max-w-lg w-full p-4 sm:p-6 md:p-8 my-6 relative max-h-[92vh] overflow-y-auto">
        
        {/* Header */}
        <div className="flex justify-between items-start pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center text-xl flex-shrink-0">
              📋
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black text-slate-900">
                Request Special / Out-of-Stock Medicine
              </h3>
              <p className="text-[11px] text-slate-400">
                Our licensed pharmacist will verify dispensary procurement and return a customized delivery proposal.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 hover:bg-slate-200 transition cursor-pointer flex-shrink-0"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div>
            <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
              Medicine / Formulation Name *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Augmentin 625 Duo, Remdesivir, Thyronorm 50mcg"
              value={medicineName}
              onChange={(e) => setMedicineName(e.target.value)}
              className="w-full px-3.5 py-2.5 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:bg-white transition"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
              Active Salt / Composition (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. Amoxicillin + Clavulanic Acid"
              value={saltComposition}
              onChange={(e) => setSaltComposition(e.target.value)}
              className="w-full px-3.5 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:bg-white transition"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                Required Units / Quantity *
              </label>
              <input
                type="number"
                min="1"
                required
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full px-3.5 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:bg-white transition"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                Urgency Level
              </label>
              <select
                value={urgency}
                onChange={(e) => setUrgency(e.target.value)}
                className="w-full px-3 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:bg-white font-bold text-slate-700"
              >
                <option value="Normal">🟢 Standard Delivery</option>
                <option value="Urgent (Same Day)">🟠 Urgent (Same Day)</option>
                <option value="Critical / Life-Saving">🔴 Critical / Life-Saving</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
              Delivery Address *
            </label>
            <select
              value={selectedAddressId}
              onChange={e => { setSelectedAddressId(e.target.value); setAddressError(''); }}
              className="w-full px-3 py-2.5 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:bg-white"
            >
              <option value="">Select saved address</option>
              {addresses.map(address => (
                <option key={address._id} value={address._id}>
                  {address.label || 'Address'} — {[address.addressLine1, address.city, address.pincode].filter(Boolean).join(', ')}
                </option>
              ))}
            </select>
            {addressError && <p className="mt-1 text-[11px] font-bold text-rose-600">{addressError}</p>}
            {!addresses.length && <p className="mt-1 text-[11px] text-amber-700">Please save a delivery address in your profile first.</p>}
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
              Prescription (Optional)
            </label>
            <input
              type="file"
              accept=".pdf,image/jpeg,image/png,image/webp"
              onChange={e => setPrescriptionFile(e.target.files?.[0] || null)}
              className="w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-xs file:font-bold file:text-blue-700"
            />
            <p className="mt-1 text-[10px] text-slate-500">
              Attach a prescription when the pharmacist needs it. Requests without a prescription are also supported.
            </p>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
              Doctor Instructions / Patient Note (Optional)
            </label>
            <textarea
              rows={3}
              placeholder="Provide preferred brand, packaging details, or dosage instructions..."
              value={customerNote}
              onChange={(e) => setCustomerNote(e.target.value)}
              className="w-full px-3.5 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:bg-white transition"
            />
          </div>

          {/* Pharmacist SLA Note */}
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3 flex items-start gap-2.5 text-blue-900">
            <span className="text-base flex-shrink-0">⏱️</span>
            <p className="text-[11px] leading-relaxed">
              <strong>Pharmacy Commitment:</strong> Our pharmacist reviews requests within 15–30 minutes, checks wholesale distributor stock, and delivers an itemized proposal with price and delivery slot.
            </p>
          </div>

          {/* Footer Actions */}
          <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-1/3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 rounded-xl text-xs cursor-pointer transition min-h-[44px]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !medicineName.trim()}
              className="w-full sm:w-2/3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-extrabold py-2.5 rounded-xl text-xs shadow-md shadow-blue-600/20 transition cursor-pointer flex items-center justify-center gap-2 min-h-[44px]"
            >
              {submitting && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}<span>{submitting ? 'Creating Medicine Request...' : 'Send Request to Pharmacist'}</span>
              <span>→</span>
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}
