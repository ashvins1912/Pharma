import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../../../context/ToastContext';
import {
  sendPharmacyProposal,
  updatePharmacyProposal,
  rejectMedicineRequestByPharmacy,
  reviewMedicineRequest
} from '../../../api/medicineRequestService';

export default function AdminProposalModal({ request, isOpen, onClose, onRefresh }) {
  const { addToast } = useToast();

  const [medicineName, setMedicineName] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [strength, setStrength] = useState('');
  const [dosageForm, setDosageForm] = useState('Tablet');
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState(0);
  const [priceType, setPriceType] = useState('APPROXIMATE');
  const [approximatePrice, setApproximatePrice] = useState(0);
  const [finalPrice, setFinalPrice] = useState('');
  const [pharmacyNote, setPharmacyNote] = useState('');
  const [alternativeProduct, setAlternativeProduct] = useState('');

  // Delivery slot
  const [slotDate, setSlotDate] = useState('');
  const [slotType, setSlotType] = useState('EVENING');
  const [slotStartTime, setSlotStartTime] = useState('18:00');
  const [slotEndTime, setSlotEndTime] = useState('21:00');
  const [slotLabel, setSlotLabel] = useState('');

  // Prescription status
  const [prescriptionStatus, setPrescriptionStatus] = useState('Verified');

  // Validity
  const [validityHours, setValidityHours] = useState('48');

  // Reject dialog
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const [saving, setSaving] = useState(false);
  const [reviewReady, setReviewReady] = useState(false);
  const closeButtonRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const previousActiveElement = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const appRoot = document.getElementById('root');
    const previousInert = appRoot?.inert;
    document.body.style.overflow = 'hidden';
    if (appRoot) appRoot.inert = true;
    closeButtonRef.current?.focus();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') return;
      const dialog = closeButtonRef.current?.closest('[role="dialog"]');
      const focusableElements = dialog?.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusableElements?.length) {
        event.preventDefault();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (!dialog?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? lastElement : firstElement).focus();
      } else if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (appRoot) appRoot.inert = previousInert;
      if (previousActiveElement instanceof HTMLElement) previousActiveElement.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    let active = true;
    if (isOpen && request) {
      setReviewReady(request.status !== 'REQUESTED');
      if (request.status === 'REQUESTED') {
        reviewMedicineRequest(request._id)
          .then(() => {
            if (active) setReviewReady(true);
          })
          .catch((error) => {
            if (active) {
              setReviewReady(false);
              addToast(error.message || 'Could not start request review.', 'error');
            }
          });
      }

      const firstItem = request.requestedItems?.[0] || {};
      const proposal = request.pharmacyProposal;

      if (proposal) {
        setMedicineName(proposal.medicineName || firstItem.requestedName || '');
        setManufacturer(proposal.manufacturer || firstItem.manufacturer || '');
        setStrength(proposal.strength || firstItem.strength || '');
        setDosageForm(proposal.dosageForm || firstItem.dosageForm || 'Tablet');
        setQuantity(proposal.quantity || firstItem.quantity || 1);
        setUnitPrice(proposal.unitPrice || 0);
        setPriceType(proposal.priceType || 'APPROXIMATE');
        setApproximatePrice(proposal.approximatePrice || 0);
        setFinalPrice(proposal.finalPrice !== null && proposal.finalPrice !== undefined ? String(proposal.finalPrice) : '');
        setPharmacyNote(proposal.pharmacyNote || '');
        setAlternativeProduct(proposal.alternativeProduct || '');
        setPrescriptionStatus(proposal.prescriptionStatus || (request.prescriptionUrl ? 'Verified' : 'Not Required'));

        const slot = proposal.deliverySlot || {};
        setSlotDate(slot.date || new Date(Date.now() + 86400000).toISOString().split('T')[0]);
        setSlotType(slot.slotType || 'EVENING');
        setSlotStartTime(slot.startTime || '18:00');
        setSlotEndTime(slot.endTime || '21:00');
        setSlotLabel(slot.label || '');
      } else {
        setMedicineName(firstItem.requestedName || '');
        setManufacturer(firstItem.manufacturer || '');
        setStrength(firstItem.strength || '');
        setDosageForm(firstItem.dosageForm || 'Tablet');
        setQuantity(firstItem.quantity || 1);
        setUnitPrice(0);
        setPriceType('APPROXIMATE');
        setApproximatePrice(0);
        setFinalPrice('');
        setPharmacyNote('');
        setAlternativeProduct('');
        setPrescriptionStatus(request.prescriptionUrl ? 'Verified' : 'Not Required');

        const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
        setSlotDate(tomorrow);
        setSlotType('EVENING');
        setSlotStartTime('18:00');
        setSlotEndTime('21:00');
        setSlotLabel(`Tomorrow Evening, 6 PM - 9 PM`);
      }

      setShowRejectBox(false);
      setRejectReason('');
    }
    return () => { active = false; };
  }, [isOpen, request, addToast]);

  if (!isOpen || !request) return null;

  const firstItem = request.requestedItems?.[0] || {};
  const isApproved = request.status === 'CUSTOMER_APPROVED' || request.status === 'CONVERTED_TO_ORDER';
  const canEditProposal = ['UNDER_REVIEW', 'PROPOSAL_SENT'].includes(request.status)
    || (request.status === 'REQUESTED' && reviewReady);
  const canRejectRequest = request.status === 'UNDER_REVIEW';

  const handleSlotTypeChange = (type) => {
    setSlotType(type);
    let sTime = '10:00';
    let eTime = '18:00';
    let labelText = '';

    if (type === 'MORNING') {
      sTime = '09:00';
      eTime = '13:00';
      labelText = `${slotDate === new Date().toISOString().split('T')[0] ? 'Today' : 'Scheduled'} Morning, 9 AM - 1 PM`;
    } else if (type === 'EVENING') {
      sTime = '18:00';
      eTime = '21:00';
      labelText = `${slotDate === new Date().toISOString().split('T')[0] ? 'Today' : 'Scheduled'} Evening, 6 PM - 9 PM`;
    } else if (type === 'NEXT_DAY') {
      sTime = '10:00';
      eTime = '18:00';
      labelText = 'Next Day Delivery, 10 AM - 6 PM';
    } else {
      sTime = '10:00';
      eTime = '20:00';
      labelText = 'Flexible Delivery Window';
    }

    setSlotStartTime(sTime);
    setSlotEndTime(eTime);
    setSlotLabel(labelText);
  };

  const handleUnitPriceChange = (val) => {
    const num = Math.max(0, parseFloat(val) || 0);
    setUnitPrice(num);
    const total = Math.round(num * quantity * 100) / 100;
    setApproximatePrice(total);
    if (priceType === 'FINAL') {
      setFinalPrice(String(total));
    }
  };

  const handleQuantityChange = (val) => {
    const qty = Math.max(1, parseInt(val) || 1);
    setQuantity(qty);
    const total = Math.round(unitPrice * qty * 100) / 100;
    setApproximatePrice(total);
    if (priceType === 'FINAL') {
      setFinalPrice(String(total));
    }
  };

  const handleSubmitProposal = async (e) => {
    e.preventDefault();
    if (!medicineName.trim()) {
      addToast('Medicine name is required.', 'warning');
      return;
    }

    const calculatedApprox = Math.max(0, Number(approximatePrice) || Number(unitPrice * quantity) || 0);
    let calculatedFinal = null;

    if (priceType === 'FINAL') {
      calculatedFinal = Number(finalPrice);
      if (!Number.isFinite(calculatedFinal) || calculatedFinal <= 0) {
        addToast('Please enter a valid final price amount.', 'warning');
        return;
      }
    }

    const expiresAt = new Date(Date.now() + parseInt(validityHours) * 3600000).toISOString();

    const payload = {
      medicineName: medicineName.trim(),
      manufacturer: manufacturer.trim(),
      strength: strength.trim(),
      dosageForm: dosageForm.trim(),
      quantity,
      unitPrice,
      priceType,
      approximatePrice: calculatedApprox,
      finalPrice: calculatedFinal,
      pharmacyNote: pharmacyNote.trim(),
      alternativeProduct: alternativeProduct.trim(),
      prescriptionStatus,
      expiresAt,
      deliverySlot: {
        date: slotDate,
        slotType,
        startTime: slotStartTime,
        endTime: slotEndTime,
        label: slotLabel.trim() || `${slotType} Delivery (${slotDate})`
      }
    };

    try {
      setSaving(true);
      if (request.pharmacyProposal) {
        await updatePharmacyProposal(request._id, payload);
        addToast(`Proposal updated and re-sent to ${request.customerName}.`, 'success');
      } else {
        await sendPharmacyProposal(request._id, payload);
        addToast(`Proposal dispatched to ${request.customerName}!`, 'success');
      }
      onRefresh();
      onClose();
    } catch (err) {
      addToast(err.response?.data?.message || err.message || 'Failed to submit proposal.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleRejectByPharmacy = async () => {
    if (saving) return;
    try {
      setSaving(true);
      await rejectMedicineRequestByPharmacy(request._id, rejectReason);
      addToast(`Medicine request #${request.requestNumber} rejected.`, 'info');
      onRefresh();
      onClose();
    } catch (err) {
      addToast(err.response?.data?.message || err.message || 'Failed to reject request.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-950/60 p-3 backdrop-blur-sm sm:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="medicine-request-details-title"
        className="my-auto flex max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl sm:max-h-[92vh] animate-fade-in"
      >
        <header className="sticky top-0 z-10 flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 bg-white px-4 py-4 sm:px-7">
          <div className="min-w-0">
            <h2 id="medicine-request-details-title" className="text-base font-black text-slate-900 sm:text-lg">
              Medicine Procurement Request Details
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-wider bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                Dispensary Review & Quotation
              </span>
              <span className="text-xs font-mono font-bold text-slate-500">
                #{request.requestNumber}
              </span>
              <span className="text-[10px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full font-bold">
                {request.status.replaceAll('_', ' ')}
              </span>
            </div>
            {request.status === 'PROPOSAL_SENT' && (
              <div className="mt-2 rounded-xl border border-purple-200 bg-purple-50 px-3 py-2 text-xs font-bold text-purple-900">
                Proposal sent — waiting for customer approval. Pharmacy cannot approve or reject on the customer’s behalf.
              </div>
            )}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xl font-bold text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            ×
          </button>
        </header>

        <div className="min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-7">
          <div className="space-y-5">

        {/* Customer & Request Summary Banner */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2.5 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <span className="text-[10px] text-slate-400 font-extrabold uppercase block">Customer</span>
              <p className="font-bold text-slate-900">
                {request.customerName} {request.customerPhone && `• ${request.customerPhone}`}
              </p>
              <p className="text-[11px] text-slate-500 truncate max-w-xs mt-0.5">
                📍 {request.deliveryAddress}
              </p>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 font-extrabold uppercase block">Requested Formulation</span>
              <p className="font-bold text-slate-900">
                {firstItem.requestedName} (x{firstItem.quantity || 1})
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Preferred timing: <span className="font-semibold text-slate-700">{request.preferredDeliveryPreference || 'Flexible'}</span>
              </p>
            </div>
          </div>

          {request.customerNote && (
            <div className="bg-white border border-slate-200/80 rounded-xl p-2.5 text-[11px] text-slate-700">
              <span className="font-bold text-slate-900 block mb-0.5">Customer Instructions:</span>
              "{request.customerNote}"
            </div>
          )}

          {/* Attachments Inspection */}
          <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-slate-200/60">
            {request.prescriptionUrl ? (
              <a
                href={request.prescriptionUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[11px] font-extrabold bg-blue-50 text-blue-700 hover:bg-blue-100 px-3 py-1.5 rounded-xl border border-blue-200 transition"
              >
                <span>📄</span>
                <span>View Prescription Attachment</span>
              </a>
            ) : (
              <span className="text-[11px] text-slate-400">📄 No prescription attached</span>
            )}

            {request.productImageUrl && (
              <a
                href={request.productImageUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[11px] font-extrabold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-3 py-1.5 rounded-xl border border-indigo-200 transition"
              >
                <span>📷</span>
                <span>View Reference Product Photo</span>
              </a>
            )}
          </div>
        </div>

        {/* Prescription Verification Dropdown */}
        <div className="bg-amber-50/60 border border-amber-200 rounded-2xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
          <div>
            <span className="font-extrabold text-amber-950 block">Prescription Verification Status</span>
            <p className="text-[11px] text-amber-800">Confirm clinical verification before customer approval.</p>
          </div>
          <select
            value={prescriptionStatus}
            onChange={(e) => setPrescriptionStatus(e.target.value)}
            disabled={!canEditProposal || !reviewReady}
            className="px-3 py-1.5 text-xs font-bold bg-white border border-amber-300 rounded-xl text-amber-950 outline-none"
          >
            <option value="Verified">✓ Verified by Pharmacist</option>
            <option value="Pending Verification">⏳ Pending Verification</option>
            <option value="Not Required">Not Required (OTC)</option>
            <option value="Rejected">✕ Prescription Rejected</option>
          </select>
        </div>

        {/* Proposal Formulation Form */}
        <form onSubmit={handleSubmitProposal} className="space-y-4">
          
          <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 border-b border-slate-100 pb-1">
            Offer Specifications & Pricing
          </h4>

          {/* Product Name & Brand */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Medicine Name for Proposal <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                disabled={isApproved}
                value={medicineName}
                onChange={(e) => setMedicineName(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-blue-500 outline-none font-bold"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Manufacturer / Brand
              </label>
              <input
                type="text"
                disabled={isApproved}
                value={manufacturer}
                onChange={(e) => setManufacturer(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-blue-500 outline-none"
              />
            </div>
          </div>

          {/* Strength, Form, Quantity */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">Strength</label>
              <input
                type="text"
                disabled={isApproved}
                value={strength}
                onChange={(e) => setStrength(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">Dosage Form</label>
              <input
                type="text"
                disabled={isApproved}
                value={dosageForm}
                onChange={(e) => setDosageForm(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">Quantity</label>
              <input
                type="number"
                min="1"
                required
                disabled={isApproved}
                value={quantity}
                onChange={(e) => handleQuantityChange(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-blue-500 outline-none font-black"
              />
            </div>
          </div>

          {/* Pricing Controls: Unit Price, Price Type, Total Price */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-3">
            <span className="text-[11px] font-black uppercase tracking-wider text-slate-500 block">
              Pricing Details (INR)
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Unit Price (₹)
                </label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  disabled={isApproved}
                  value={unitPrice}
                  onChange={(e) => handleUnitPriceChange(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-blue-500 outline-none font-bold"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Price Type
                </label>
                <select
                  value={priceType}
                  disabled={isApproved}
                  onChange={(e) => {
                    const pt = e.target.value;
                    setPriceType(pt);
                    if (pt === 'FINAL' && !finalPrice) {
                      setFinalPrice(String(approximatePrice));
                    }
                  }}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-blue-500 outline-none font-bold"
                >
                  <option value="APPROXIMATE">Approximate Price</option>
                  <option value="FINAL">Final Price (Guaranteed)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  {priceType === 'APPROXIMATE' ? 'Approximate Total (₹)' : 'Final Total (₹)'}
                </label>
                {priceType === 'APPROXIMATE' ? (
                  <input
                    type="number"
                    step="any"
                    min="0"
                    disabled={isApproved}
                    value={approximatePrice}
                    onChange={(e) => setApproximatePrice(Math.max(0, parseFloat(e.target.value) || 0))}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-blue-500 outline-none font-black text-emerald-600"
                  />
                ) : (
                  <input
                    type="number"
                    step="any"
                    min="0"
                    required
                    disabled={isApproved}
                    value={finalPrice}
                    onChange={(e) => setFinalPrice(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-white border border-emerald-300 rounded-xl focus:border-emerald-500 outline-none font-black text-emerald-700"
                  />
                )}
              </div>
            </div>
          </div>

          {/* Delivery Slot Scheduling */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-3">
            <span className="text-[11px] font-black uppercase tracking-wider text-slate-500 block">
              Proposed Delivery Window
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Delivery Date</label>
                <input
                  type="date"
                  required
                  disabled={isApproved}
                  value={slotDate}
                  onChange={(e) => {
                    setSlotDate(e.target.value);
                    setSlotLabel(`${slotType} Delivery (${e.target.value})`);
                  }}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-blue-500 outline-none font-medium"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Delivery Slot</label>
                <select
                  value={slotType}
                  disabled={isApproved}
                  onChange={(e) => handleSlotTypeChange(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-blue-500 outline-none font-bold"
                >
                  <option value="MORNING">Morning (9 AM - 1 PM)</option>
                  <option value="EVENING">Evening (6 PM - 9 PM)</option>
                  <option value="NEXT_DAY">Next Day (10 AM - 6 PM)</option>
                  <option value="FLEXIBLE">Flexible (Any Window)</option>
                  <option value="CUSTOM">Custom Slot</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Slot Display Label</label>
                <input
                  type="text"
                  required
                  disabled={isApproved}
                  placeholder="e.g. Today, 6 PM - 9 PM"
                  value={slotLabel}
                  onChange={(e) => setSlotLabel(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-blue-500 outline-none"
                />
              </div>
            </div>
          </div>

          {/* Pharmacy Note & Alternative Product */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Pharmacy Note for Customer
              </label>
              <textarea
                rows={2}
                disabled={isApproved}
                placeholder="e.g. Arranged from certified distributor depot. Packaged in temperature-controlled cooler."
                value={pharmacyNote}
                onChange={(e) => setPharmacyNote(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Alternative Product Suggestion (Optional)
              </label>
              <textarea
                rows={2}
                disabled={isApproved}
                placeholder="e.g. If exact brand is unavailable, Zerodol-P 10s is offered as equivalent bio-similar."
                value={alternativeProduct}
                onChange={(e) => setAlternativeProduct(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-blue-500 outline-none"
              />
            </div>
          </div>

          {/* Validity Period */}
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span>⏱️ Proposal validity:</span>
            <select
              value={validityHours}
              disabled={isApproved}
              onChange={(e) => setValidityHours(e.target.value)}
              className="px-2 py-1 bg-slate-100 border border-slate-200 rounded-lg text-xs font-bold outline-none"
            >
              <option value="24">24 hours</option>
              <option value="48">48 hours (Standard)</option>
              <option value="72">72 hours</option>
            </select>
          </div>

          {/* Actions Bar */}
          {canEditProposal && (
            <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
              {showRejectBox && canRejectRequest ? (
                <div className="w-full bg-rose-50 border border-rose-200 rounded-xl p-3 space-y-2">
                  <label className="block text-xs font-bold text-rose-900">
                    Reason for pharmacy declining this request
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Distributor out of stock nationwide; discontinued formulation"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-white border border-rose-200 rounded-xl outline-none"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowRejectBox(false)}
                      className="text-xs font-bold text-slate-600 px-3 py-1.5 hover:bg-rose-100 rounded-lg"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleRejectByPharmacy}
                      disabled={saving}
                      className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs px-3.5 py-1.5 rounded-xl cursor-pointer disabled:opacity-50"
                    >
                      {saving ? 'Rejecting...' : 'Confirm Rejection'}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {canRejectRequest && (
                    <button
                      type="button"
                      onClick={() => setShowRejectBox(true)}
                      className="w-full sm:w-auto px-4 py-2 border border-rose-200 text-rose-700 hover:bg-rose-50 rounded-xl text-xs font-bold transition cursor-pointer"
                    >
                      Reject Request
                    </button>
                  )}

                  <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
                    >
                      Close
                    </button>
                    <button
                      type="submit"
                      disabled={saving || !reviewReady}
                      className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs rounded-xl shadow-md transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {saving ? (
                        <>
                          <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                          <span>Sending Proposal...</span>
                        </>
                      ) : (
                        <>
                          <span>📤</span>
                          <span>{request.pharmacyProposal ? 'Update & Re-send Proposal' : 'Send Proposal to Customer'}</span>
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

        </form>

          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}
