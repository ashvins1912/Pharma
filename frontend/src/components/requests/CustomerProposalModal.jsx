import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { approveProposal, confirmMedicineRequestFulfillment, previewMedicineRequestFulfillment, rejectProposal, getCustomerStockWaitlist, confirmCustomerStockWaitlist, cancelCustomerStockWaitlist } from '../../api/medicineRequestService';
import { useLanguage } from '../../context/LanguageContext';

export default function CustomerProposalModal({ request, isOpen, onClose, onOrderCreated }) {
  const { t } = useLanguage();
  const { loadUserMedicineRequests, loadUserOrders } = useApp();
  const { user, role } = useAuth();
  const { addToast } = useToast();

  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [approvalNote, setApprovalNote] = useState('');
  const [showApprovalConfirm, setShowApprovalConfirm] = useState(false);
  const [availabilityPlan, setAvailabilityPlan] = useState(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState('');
  const [waitDays, setWaitDays] = useState(3);
  const [fulfillmentChoices, setFulfillmentChoices] = useState({});
  const [selectedOfferProductId, setSelectedOfferProductId] = useState('');
  const [stockWaitlistCase, setStockWaitlistCase] = useState(null);
  const [waitlistLoading, setWaitlistLoading] = useState(false);
  const [waitlistActionLoading, setWaitlistActionLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setShowApprovalConfirm(false);
    setShowRejectInput(false);
    setRejectReason('');
    setSelectedOfferProductId(request?.pharmacyProposal?.productId || '');
  }, [isOpen, request?._id]);

  useEffect(() => {
    if (!isOpen || !request?._id || !request?.fulfillmentCaseId
      || !['WAITING_FOR_STOCK', 'READY_FOR_CONFIRMATION', 'CONVERTED_TO_ORDER'].includes(request.status)) {
      setStockWaitlistCase(null);
      return undefined;
    }
    let active = true;
    setWaitlistLoading(true);
    getCustomerStockWaitlist()
      .then(items => {
        if (active) setStockWaitlistCase(items.find(item => String(item._id) === String(request.fulfillmentCaseId)) || null);
      })
      .catch(error => {
        if (active) addToast(error.response?.data?.message || 'Could not refresh stock availability.', 'warning');
      })
      .finally(() => { if (active) setWaitlistLoading(false); });
    return () => { active = false; };
  }, [isOpen, request?._id, request?.fulfillmentCaseId, request?.status]);

  useEffect(() => {
    if (!isOpen || !request?._id || request.status !== 'PROPOSAL_SENT') return undefined;
    let active = true;
    setAvailabilityLoading(true);
    setAvailabilityError('');
    setAvailabilityPlan(null);
    setFulfillmentChoices({});
    previewMedicineRequestFulfillment(request._id)
      .then(plan => { if (active) setAvailabilityPlan(plan); })
      .catch(error => {
        if (active) setAvailabilityError(error.response?.data?.message || error.message || 'Could not check live stock.');
      })
      .finally(() => { if (active) setAvailabilityLoading(false); });
    return () => { active = false; };
  }, [isOpen, request?._id, request?.status]);

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
  const selectedOffer = (proposal?.alternativeOffers || []).find(offer => String(offer.productId) === String(selectedOfferProductId));
  const priceValue = selectedOffer ? Number(selectedOffer.discountedUnitPrice || 0) * Number(selectedOffer.quantity || proposal?.quantity || 1) : (proposal?.finalPrice ?? proposal?.totalPrice ?? proposal?.approximatePrice ?? 0);
  const selectedName = selectedOffer?.medicineName || proposal?.medicineName || request.requestedItems?.[0]?.requestedName;

  const handleApprove = async () => {
    if (approving) return;
    try {
      setApproving(true);
      const multiLine = (availabilityPlan?.lines?.length || 0) > 1;
      const waitingQuantity = Number(availabilityPlan?.summary?.quantityWaiting || 0);
      const selectedAlternativeIsInPlan = availabilityPlan?.lines?.some(line =>
        line.alternatives?.some(option => String(option.productId) === String(selectedOfferProductId))
      );
      let res;
      if (multiLine || waitingQuantity > 0) {
        const decisions = { ...fulfillmentChoices };
        if (selectedAlternativeIsInPlan && availabilityPlan.lines.length === 1) {
          decisions[availabilityPlan.lines[0].productId] = { alternativeProductId: selectedOfferProductId };
        }
        res = await confirmMedicineRequestFulfillment(request._id, {
          approvalNote,
          decisions,
          waitDays
        });
      } else {
        res = await approveProposal(request._id, approvalNote, selectedOfferProductId || null);
      }
      addToast(res.message || 'Your fulfilment choices have been confirmed.', 'success');
      await loadUserMedicineRequests();
      await loadUserOrders();
      if (onOrderCreated && res.order) onOrderCreated(res.order);
      onClose();
    } catch (err) {
      addToast(err.response?.data?.message || err.message || 'Unable to confirm fulfilment right now. Please try again.', 'error');
      setShowApprovalConfirm(false);
      setAvailabilityPlan(null);
      previewMedicineRequestFulfillment(request._id).then(setAvailabilityPlan).catch(() => {});
    } finally {
      setApproving(false);
    }
  };

  const handleRefreshStockWaitlist = async () => {
    if (waitlistLoading || waitlistActionLoading) return;
    try {
      setWaitlistLoading(true);
      const items = await getCustomerStockWaitlist();
      setStockWaitlistCase(items.find(item => String(item._id) === String(request.fulfillmentCaseId)) || null);
      addToast('Stock availability refreshed.', 'success');
      await loadUserMedicineRequests();
    } catch (error) {
      addToast(error.response?.data?.message || 'Could not refresh stock availability.', 'error');
    } finally {
      setWaitlistLoading(false);
    }
  };

  const handleConfirmAvailableWaitlistStock = async () => {
    if (!stockWaitlistCase?._id || waitlistActionLoading) return;
    try {
      setWaitlistActionLoading(true);
      const result = await confirmCustomerStockWaitlist(stockWaitlistCase._id);
      addToast(result.message || 'Available stock has been ordered.', 'success');
      await Promise.all([loadUserMedicineRequests(), loadUserOrders()]);
      if (result.order && onOrderCreated) onOrderCreated(result.order);
      const cases = await getCustomerStockWaitlist();
      setStockWaitlistCase(cases.find(item => String(item._id) === String(request.fulfillmentCaseId)) || null);
    } catch (error) {
      addToast(error.response?.data?.message || 'Could not confirm the available stock. Please refresh and retry.', 'error');
      await handleRefreshStockWaitlist();
    } finally {
      setWaitlistActionLoading(false);
    }
  };

  const handleCancelStockWaitlist = async () => {
    if (!stockWaitlistCase?._id || waitlistActionLoading) return;
    try {
      setWaitlistActionLoading(true);
      await cancelCustomerStockWaitlist(stockWaitlistCase._id);
      setStockWaitlistCase(null);
      addToast('Stock waitlist cancelled.', 'info');
      await loadUserMedicineRequests();
    } catch (error) {
      addToast(error.response?.data?.message || 'Could not cancel the stock waitlist.', 'error');
    } finally {
      setWaitlistActionLoading(false);
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
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-4" aria-modal="true" role="dialog">
      <div className="bg-white rounded-3xl max-w-lg w-full p-5 sm:p-7 shadow-2xl space-y-5 animate-fade-in max-h-[92vh] overflow-y-auto border border-slate-100">
        
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 pb-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-black uppercase tracking-wider bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
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
              <strong>{t('proposalExpired')}</strong>
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
              <strong>{t('proposalApprovedOrderCreated')}</strong>
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
              <strong>{t('proposalDeclined')}</strong>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {request.status === 'PHARMACY_REJECTED'
                  ? t('unableToProcure')
                  : t('proposalDeclined')}
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
                {selectedName}
              </h4>
              <p className="text-xs text-slate-600 mt-0.5 font-medium">
                {(selectedOffer?.dosageForm || proposal?.dosageForm) && <span>{selectedOffer?.dosageForm || proposal.dosageForm} • </span>}
                {(selectedOffer?.strength || proposal?.strength) && <span>{selectedOffer?.strength || proposal.strength} • </span>}
                {(selectedOffer?.manufacturer || proposal?.manufacturer) && <span>Mfg: {selectedOffer?.manufacturer || proposal.manufacturer}</span>}
              </p>
            </div>
            <div className="text-right">
              <span className="text-[10px] text-slate-400 uppercase font-black block">{t('quantity')}</span>
              <span className="text-sm font-black text-slate-900 bg-white border border-slate-200 px-2.5 py-0.5 rounded-lg inline-block">
                {proposal?.quantity || 1} units
              </span>
            </div>
          </div>

          {proposal?.alternativeProduct && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-2.5 text-xs text-amber-900">
              <strong className="block font-bold">{t('recommendedAlternative')}</strong>
              <p className="text-[11px] text-amber-800">{proposal.alternativeProduct}</p>
            </div>
          )}
        </div>

        {(proposal?.alternativeOffers || []).length > 0 && canDecide && (request.requestedItems?.length || 0) <= 1 && !Number(availabilityPlan?.summary?.quantityWaiting || 0) && (
          <section className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3 space-y-2">
            <h4 className="text-xs font-black text-emerald-950">Choose your medicine offer</h4>
            {proposal.productId && (
              <label className="flex items-start gap-2 rounded-xl border border-emerald-100 bg-white p-3 text-xs">
                <input type="radio" name="proposal-product-choice" checked={selectedOfferProductId === proposal.productId} onChange={() => setSelectedOfferProductId(proposal.productId)}/>
                <span className="flex-1"><strong>{proposal.medicineName}</strong><br/><span className="text-slate-500">{proposal.manufacturer} · {proposal.strength} · {proposal.dosageForm}</span><br/><span className="font-bold text-emerald-700">₹{proposal.finalPrice ?? proposal.totalPrice ?? proposal.approximatePrice}</span></span>
              </label>
            )}
            {!proposal.productId && (
              <label className="flex items-start gap-2 rounded-xl border border-emerald-100 bg-white p-3 text-xs">
                <input type="radio" name="proposal-product-choice" checked={!selectedOfferProductId} onChange={() => setSelectedOfferProductId('')}/>
                <span className="flex-1"><strong>{proposal.medicineName}</strong><br/><span className="text-slate-500">Pharmacy-arranged offer</span><br/><span className="font-bold text-emerald-700">₹{proposal.finalPrice ?? proposal.totalPrice ?? proposal.approximatePrice}</span></span>
              </label>
            )}
            {proposal.alternativeOffers.map(offer => (
              <label key={offer.productId} className="flex items-start gap-2 rounded-xl border border-emerald-100 bg-white p-3 text-xs">
                <input type="radio" name="proposal-product-choice" checked={selectedOfferProductId === offer.productId} onChange={() => setSelectedOfferProductId(offer.productId)}/>
                <span className="flex-1"><strong>{offer.medicineName}</strong><br/><span className="text-slate-500">{offer.manufacturer} · {offer.strength} · {offer.dosageForm}</span><br/><span className="font-bold text-emerald-700">₹{offer.discountedUnitPrice} each · {offer.availableQuantity} available</span>{offer.discountPercentage > 0 ? <span className="ml-1 text-emerald-700">({offer.discountPercentage}% off)</span> : null}{offer.requiresPharmacistApproval ? <span className="block mt-1 text-amber-700">Prescription verification / pharmacist approval applies</span> : null}</span>
              </label>
            ))}
            <p className="text-[10px] text-emerald-900">Your selection is explicit. Stock is rechecked and reserved when you confirm. The pharmacy will not substitute a medicine without your approval.</p>
          </section>
        )}

        {/* Pricing & Delivery Slot Summary Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          
          {/* Price Box */}
          <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 rounded-2xl p-3.5 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-emerald-800">
                {priceType === 'APPROXIMATE' ? t('approximatePrice') : t('guaranteedFinalPrice')}
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
                : `${t('paymentMethod')}: ${t('cashOnDelivery')} (COD) upon courier arrival.`}
            </p>
          </div>

          {/* Delivery Slot Box */}
          <div className="bg-gradient-to-br from-blue-50 to-blue-50 border border-blue-200 rounded-2xl p-3.5 space-y-1">
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
          <span className="text-slate-500 font-medium">{t('prescriptionStatus')}:</span>
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

        {availabilityLoading && request.status === 'PROPOSAL_SENT' && <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">Checking current pharmacy stock and fulfilment options…</div>}
        {availabilityError && request.status === 'PROPOSAL_SENT' && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{availabilityError} Retry by closing and reopening this proposal.</div>}
        {availabilityPlan && request.status === 'PROPOSAL_SENT' && (
          <section className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 space-y-3">
            <div><h4 className="text-sm font-black text-indigo-950">Smart fulfilment options</h4><p className="mt-1 text-xs text-indigo-800">{availabilityPlan.summary.quantityAvailableNow} quantity available now · {availabilityPlan.summary.quantityWaiting} quantity may need to wait</p></div>
            {availabilityPlan.lines.map(line => (
              <div key={line.productId} className="rounded-xl border border-indigo-100 bg-white p-3 space-y-2">
                <div className="flex items-start justify-between gap-2 text-xs"><strong className="text-slate-900">{line.name || 'Requested medicine'}</strong><span className={line.waitingQuantity ? 'text-amber-700 font-bold' : 'text-emerald-700 font-bold'}>{line.fulfilNowQuantity} / {line.requestedQuantity} available</span></div>
                {line.fulfilNowQuantity > 0 && <p className="text-[11px] text-slate-600">Available now: {line.fulfilNowQuantity} × ₹{Number(line.unitPrice || 0).toFixed(2)}</p>}
                {line.waitingQuantity > 0 && <>
                  <label className="flex items-center gap-2 text-xs text-slate-700"><input type="radio" name={`request-alt-${line.productId}`} checked={!fulfillmentChoices[line.productId]?.alternativeProductId} onChange={() => setFulfillmentChoices(current => ({ ...current, [line.productId]: {} }))}/>Wait for the original medicine ({line.waitingQuantity})</label>
                  {line.alternatives?.map(alternative => <label key={alternative.productId} className="flex items-start gap-2 rounded-lg border border-emerald-100 p-2 text-xs"><input type="radio" name={`request-alt-${line.productId}`} checked={fulfillmentChoices[line.productId]?.alternativeProductId === alternative.productId} disabled={Boolean(alternative.requiresPharmacistApproval)} onChange={() => setFulfillmentChoices(current => ({ ...current, [line.productId]: { alternativeProductId: alternative.productId } }))}/><span><strong>{alternative.name}</strong><br/><span className="text-slate-500">{alternative.brand} · {alternative.availableQuantity} available</span><br/><span className="font-bold text-emerald-700">₹{alternative.discountedUnitPrice.toFixed(2)} each</span>{alternative.discountPercentage > 0 ? <span className="ml-1 text-emerald-700">· {alternative.discountPercentage}% offer</span> : null}{alternative.requiresPharmacistApproval ? <span className="block text-amber-700">Pharmacist review required; automatic substitution is not permitted.</span> : null}</span></label>)}
                </>}
              </div>
            ))}
            {availabilityPlan.summary.quantityWaiting > 0 && <div className="flex items-center justify-between gap-3"><label htmlFor="request-wait-days" className="text-xs font-bold text-indigo-950">Wait for original stock</label><select id="request-wait-days" value={waitDays} onChange={event => setWaitDays(Number(event.target.value))} className="rounded-lg border border-indigo-200 bg-white px-2 py-1.5 text-xs">{[1,2,3,4,5].map(days => <option key={days} value={days}>{days} day{days > 1 ? 's' : ''}</option>)}</select></div>}
            <p className="text-[10px] text-indigo-900">Stock is checked again when you confirm. Alternatives require your consent; prescription medicines cannot be automatically substituted.</p>
          </section>
        )}
        {['WAITING_FOR_STOCK', 'CONVERTED_TO_ORDER'].includes(request.status) && request.fulfillmentCaseId && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-3">
            <div>
              <h4 className="text-sm font-black text-amber-950">Stock refill tracking</h4>
              <p className="mt-1 text-xs text-amber-900">{stockWaitlistCase?.status === 'READY_FOR_CONFIRMATION' || stockWaitlistCase?.status === 'PARTIALLY_FULFILLED'
                ? 'Some or all requested stock is available. Confirm only the quantity currently available.'
                : 'We are checking this pharmacy for the requested medicines. You will need to confirm before a new order is created.'}</p>
            </div>
            {stockWaitlistCase && <>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-bold text-amber-950">Status: {stockWaitlistCase.status.replaceAll('_', ' ')}</span>
                <span className="text-amber-800">Wait until {new Date(stockWaitlistCase.waitUntil).toLocaleString()}</span>
              </div>
              {(stockWaitlistCase.lines || []).map((line, index) => (
                <div key={line.productId || line.requestedName || index} className="flex items-center justify-between gap-3 rounded-xl bg-white border border-amber-100 p-2 text-xs">
                  <span className="font-semibold text-slate-800">{line.name || line.requestedName}</span>
                  <span className="text-slate-600">{Number(line.allocatedQuantity || 0)} available / {Number(line.waitingQuantity || line.requestedQuantity || 0)} pending</span>
                </div>
              ))}
            </>}
            {!stockWaitlistCase && <p className="text-xs text-amber-800">{waitlistLoading ? 'Refreshing stock status…' : 'The latest waitlist status is not available yet. Refresh to check again.'}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={handleRefreshStockWaitlist} disabled={waitlistLoading || waitlistActionLoading} className="flex-1 rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-950 disabled:opacity-50">{waitlistLoading ? 'Checking…' : 'Check stock again'}</button>
              {stockWaitlistCase && ['READY_FOR_CONFIRMATION', 'PARTIALLY_FULFILLED'].includes(stockWaitlistCase.status) && (
                <button type="button" onClick={handleConfirmAvailableWaitlistStock} disabled={waitlistActionLoading} className="flex-1 rounded-xl bg-emerald-700 px-3 py-2 text-xs font-black text-white disabled:opacity-50">{waitlistActionLoading ? 'Confirming…' : 'Confirm available stock'}</button>
              )}
              {stockWaitlistCase && ['WAITING_FOR_STOCK', 'READY_FOR_CONFIRMATION', 'PARTIALLY_FULFILLED'].includes(stockWaitlistCase.status) && (
                <button type="button" onClick={handleCancelStockWaitlist} disabled={waitlistActionLoading} className="rounded-xl px-3 py-2 text-xs font-bold text-rose-700 hover:bg-white disabled:opacity-50">Cancel waitlist</button>
              )}
            </div>
          </section>
        )}
        {request.status === 'WAITING_FOR_STOCK' && !request.fulfillmentCaseId && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">This request is waiting for the selected pharmacy to replenish stock.</div>}

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
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 space-y-3" role="group" aria-label={t("confirmPharmacyProposal")}>
                <div>
                  <p className="text-sm font-extrabold text-emerald-950">{t('confirmPharmacyProposal')}</p>
                  <p className="mt-1 text-xs text-emerald-800">
                    {selectedName}
                    {' · Qty '}{selectedOffer?.quantity || proposal?.quantity || 1}
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
                    disabled={approving || availabilityLoading || !availabilityPlan || Boolean(availabilityError)}
                    className="rounded-xl bg-emerald-700 px-4 py-2 text-xs font-black text-white disabled:opacity-50"
                  >
                    {approving ? t('processing') : t('confirmCreateOrder')}
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
                    {rejecting ? t('processing') : t('confirmRejection')}
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
                  <span>{t('approveConfirmOrder')}</span>
                </button>
              </div>
            )}

          </div>
        )}

      </div>
    </div>
  );
}
