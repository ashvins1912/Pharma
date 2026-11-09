import React, { useState, useEffect, useRef } from 'react';
import {
  getAdminMedicineRequests,
  getAdminMedicineRequestMetrics
} from '../../../api/medicineRequestService';
import AdminProposalModal from './AdminProposalModal';
import apiClient from '../../../api/apiClient';
import { normalizePrescriptionBlob } from '../../../utils/prescriptionFile';
import Pagination from '../../common/Pagination';
import { useLanguage } from '../../../context/LanguageContext';

export default function AdminMedicineRequestsTab({ initialData = null, initialLoading = false, onPendingCountRefresh, dateRange = {} }) {
  const { t } = useLanguage();
  const [requests, setRequests] = useState(initialData?.requests || []);
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
  const [loadError, setLoadError] = useState('');
  const requestSequence = useRef(0);
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeRequest, setActiveRequest] = useState(null);
  const [proposalModalOpen, setProposalModalOpen] = useState(false);
  const [pagination, setPagination] = useState(initialData?.pagination || { page: 1, pageSize: 15, total: 0, totalPages: 1, hasNextPage: false, hasPreviousPage: false });

  const loadRequests = async (targetPage = 1) => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setLoadError('');
    try {
      const [list, nextMetrics] = await Promise.all([
        getAdminMedicineRequests({
          page: targetPage,
          pageSize: 15,
          status: selectedStatus !== 'ALL' ? selectedStatus : undefined,
          search: searchQuery.trim() || undefined,
          ...dateRange
        }),
        getAdminMedicineRequestMetrics(dateRange)
      ]);
      if (sequence !== requestSequence.current) return;
      setRequests(Array.isArray(list?.requests) ? list.requests : []);
      setPagination(list?.pagination || { page: targetPage, pageSize: 15, total: 0, totalPages: 1 });
      if (nextMetrics) setMetrics(nextMetrics);
      onPendingCountRefresh?.();
    } catch (err) {
      if (sequence !== requestSequence.current) return;
      console.error('Failed to load admin medicine requests:', err);
      setLoadError(err?.response?.data?.message || err?.message || 'Unable to load medicine requests.');
      setRequests([]);
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  };

  useEffect(() => {
    const refreshRequests = () => { void loadRequests(1); };
    window.addEventListener('pharma:medicine-request-updated', refreshRequests);
    return () => window.removeEventListener('pharma:medicine-request-updated', refreshRequests);
  }, [selectedStatus, searchQuery, dateRange.startDate, dateRange.endDate]);

  useEffect(() => {
    // Dashboard owns the initial ALL/15 request. Wait for it rather than racing
    // with a second identical request when the pharmacy dashboard mounts.
    if (selectedStatus === 'ALL' && !searchQuery.trim() && initialLoading) return;
    if (selectedStatus === 'ALL' && !searchQuery.trim() && initialData && !dateRange.startDate && !dateRange.endDate) return;
    loadRequests(1);
  }, [selectedStatus, initialLoading, initialData, dateRange.startDate, dateRange.endDate]);

  useEffect(() => {
    if (!initialData || dateRange.startDate || dateRange.endDate) return;
    setRequests(initialData.requests || []);
    setPagination(initialData.pagination || pagination);
  }, [initialData]);

  const handleSearchSubmit = (e) => {\n    e.preventDefault();\n    loadRequests(1);\n  };

  const [prescriptionPreview, setPrescriptionPreview] = useState(null);
  const [prescriptionLoading, setPrescriptionLoading] = useState(false);
  const [prescriptionError, setPrescriptionError] = useState('');
  
  const openPrescription = async (prescriptionUrl) => {
    if (!prescriptionUrl || prescriptionLoading) return;
    console.log('[MedicineRequestPrescription] Opening prescription URL:', prescriptionUrl);
    setPrescriptionLoading(true);
    setPrescriptionError('');
    setPrescriptionPreview(null);

    try {
      const response = await apiClient.get(prescriptionUrl, {
        responseType: 'blob',
        headers: { Accept: 'application/pdf,image/*' }
      });
      const contentType = String(
        response.headers?.['content-type'] || response.data?.type || ''
      ).toLowerCase();
      console.log('[MedicineRequestPrescription] Response received:', { status: response.status, contentType, size: response.data?.size });
      const blob = await normalizePrescriptionBlob(response.data, contentType);
      const objectUrl = URL.createObjectURL(blob);
      console.log('[MedicineRequestPrescription] Successfully mapped state for prescription preview:', { objectUrl, type: blob.type });
      setPrescriptionPreview({
        url: objectUrl,
        type: blob.type
      });
    } catch (error) {
      console.error('[MedicineRequestPrescription] Failed to open prescription:', error);
      setPrescriptionError(
        error?.response?.status === 404
          ? 'Prescription file was not found. Please re-upload the prescription.'
          : 'Could not open the prescription file. Please try again.'
      );
    } finally {
      setPrescriptionLoading(false);
    }
  };

  const closePrescriptionPreview = () => {
    if (prescriptionPreview?.url) {
      URL.revokeObjectURL(prescriptionPreview.url);
    }
    setPrescriptionPreview(null);
    setPrescriptionError('');
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
          <span className="bg-blue-100 text-blue-900 text-[10px] font-black px-2 py-0.5 rounded-full inline-flex items-center gap-1">
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

  const statusFilters = [
    { id: 'ALL', label: 'All requests' },
    { id: 'REQUESTED', label: 'Pending review' },
    { id: 'UNDER_REVIEW', label: 'Under review' },
    { id: 'PROPOSAL_SENT', label: 'Proposal sent' },
    { id: 'CONVERTED_TO_ORDER', label: 'Converted' },
    { id: 'CUSTOMER_REJECTED', label: 'Customer declined' },
    { id: 'PHARMACY_REJECTED', label: 'Rejected' },
    { id: 'EXPIRED', label: 'Expired' }
  ];

  return (
    <div className="admin-screen admin-screen--requests admin-request-center w-full min-w-0 space-y-4 animate-fade-in">
      <section className="request-center-hero">
        <div className="request-center-hero-copy">
          <span className="request-center-eyebrow">PROCUREMENT WORKSPACE</span>
          <h2>Medicine requests</h2>
          <p>Review customer requirements, verify prescriptions and prepare pharmacy proposals.</p>
        </div>
        <div className="request-center-hero-status">
          <span className="request-center-live-dot" />
          <span>Request operations</span>
        </div>
      </section>

      <section className="request-center-metrics" aria-label="Request overview">
        <article className="request-center-metric request-center-metric--attention">
          <span className="request-center-metric-label">Needs review</span>
          <strong>{metrics.pendingReviewCount + metrics.underReviewCount}</strong>
          <small>{metrics.pendingReviewCount} new · {metrics.underReviewCount} in review</small>
        </article>
        <article className="request-center-metric request-center-metric--proposal">
          <span className="request-center-metric-label">Awaiting customer</span>
          <strong>{metrics.proposalsSentCount}</strong>
          <small>Proposals sent</small>
        </article>
        <article className="request-center-metric request-center-metric--success">
          <span className="request-center-metric-label">Converted orders</span>
          <strong>{metrics.convertedCount}</strong>
          <small>{metrics.proposalAcceptanceRate}% acceptance rate</small>
        </article>
        <article className="request-center-metric">
          <span className="request-center-metric-label">Total inquiries</span>
          <strong>{metrics.totalRequests}</strong>
          <small>{metrics.expiredCount} expired</small>
        </article>
      </section>

      <section className="request-center-controls" aria-label="Request filters and search">
        <div className="request-center-filter-heading">
          <div>
            <h3>Request queue</h3>
            <p>Filter by status or search a customer, medicine or request ID.</p>
          </div>
          <button type="button" onClick={() => loadRequests(pagination.page || 1)} disabled={loading}
            className="request-center-refresh">
            <span aria-hidden="true">↻</span> {loading ? t('loading') : t('refresh')}
          </button>
        </div>
        <div className="request-center-filter-layout">
          <div className="request-center-status-filters" role="group" aria-label="Filter request status">
            {statusFilters.map(filter => (
              <button key={filter.id} type="button" aria-pressed={selectedStatus === filter.id}
                onClick={() => setSelectedStatus(filter.id)}
                className={selectedStatus === filter.id ? 'is-selected' : ''}>
                {filter.label}
                {filter.id === 'REQUESTED' && metrics.pendingReviewCount > 0 && <span>{metrics.pendingReviewCount}</span>}
              </button>
            ))}
          </div>
          <form onSubmit={handleSearchSubmit} className="request-center-search">
            <label htmlFor="medicine-request-search">Search requests</label>
            <div className="request-center-search-field">
              <span aria-hidden="true">⌕</span>
              <input id="medicine-request-search" type="search" placeholder="Medicine, customer, request #"
                value={searchQuery} onChange={event => setSearchQuery(event.target.value)} />
              <button type="submit">Search</button>
            </div>
          </form>
        </div>
      </section>

      <section id="admin-medicine-requests-list" className="request-center-queue" aria-label="Medicine procurement requests">
        <div className="request-center-queue-heading">
          <div>
            <h3>{t('medicineProcurementRequests')}</h3>
            <p>{loading ? 'Updating request queue…' : `${pagination.total || requests.length} requests · Page ${pagination.page || 1} of ${pagination.totalPages || 1}`}</p>
          </div>
          <span className="request-center-queue-icon" aria-hidden="true">▤</span>
        </div>

        {loadError && (
          <div role="alert" className="request-center-error">
            <span>{loadError}</span>
            <button type="button" onClick={() => loadRequests(pagination.page || 1)}>Retry</button>
          </div>
        )}
        {loading && requests.length === 0 && (
          <div role="status" className="request-center-skeletons" aria-label="Loading medicine requests">
            {[1,2,3].map(row => <div key={row} className="request-center-skeleton" />)}
          </div>
        )}
        {!loading && !loadError && requests.length === 0 ? (
          <div className="request-center-empty">
            <span aria-hidden="true">⌕</span>
            <h4>{t('noMedicineRequestsFound')}</h4>
            <p>{t('noMedicineRequestsHelp')}</p>
          </div>
        ) : !loadError && requests.length > 0 ? (
          <div className="request-center-card-grid">
            {requests.map(req => {
              const items = Array.isArray(req.requestedItems) ? req.requestedItems : [];
              const visibleItems = items.slice(0, 3);
              const proposal = req.pharmacyProposal;
              const price = proposal?.finalPrice ?? proposal?.totalPrice ?? proposal?.approximatePrice;
              const terminal = ['CUSTOMER_APPROVED','CONVERTED_TO_ORDER','CUSTOMER_REJECTED','PHARMACY_REJECTED','EXPIRED'].includes(req.status);
              return (
                <article key={req._id} className="request-center-card">
                  <div className="request-center-card-top">
                    <div className="request-center-request-id">
                      <span>REQUEST</span>
                      <strong>#{req.requestNumber}</strong>
                      <small>{req.createdAt ? new Date(req.createdAt).toLocaleDateString() : '—'}</small>
                    </div>
                    <div className="request-center-card-status">{getStatusBadge(req.status)}</div>
                  </div>

                  <div className="request-center-card-customer">
                    <span className="request-center-avatar" aria-hidden="true">{String(req.customerName || 'C').trim().charAt(0).toUpperCase()}</span>
                    <div className="request-center-customer-details">
                      <strong>{req.customerName || 'Customer'}</strong>
                      <span>{req.customerPhone || 'Phone unavailable'}</span>
                    </div>
                    {req.deliveryAddress && <span className="request-center-location" title={req.deliveryAddress}>⌖ {req.deliveryAddress}</span>}
                  </div>

                  <div className="request-center-medicines">
                    <div className="request-center-section-label"><span>Requested medicines</span><b>{items.length} {items.length === 1 ? 'item' : 'items'}</b></div>
                    {visibleItems.map((item,index) => (
                      <div className="request-center-medicine" key={`${item.requestedName || 'medicine'}-${index}`}>
                        <div className="request-center-medicine-symbol" aria-hidden="true">✚</div>
                        <div className="request-center-medicine-details">
                          <strong>{item.requestedName || 'Medicine'}</strong>
                          <span>{[item.strength,item.dosageForm].filter(Boolean).join(' · ') || 'Details not provided'}</span>
                        </div>
                        <span className="request-center-quantity">Qty {item.quantity || 1}</span>
                        {item.originalAvailabilityStatus === 'OUT_OF_STOCK' && <span className="request-center-stock-tag">Out of stock</span>}
                      </div>
                    ))}
                    {items.length > 3 && <p className="request-center-more-items">+{items.length - 3} more medicine items</p>}
                  </div>

                  {(req.customerNote || req.prescriptionUrl || req.productImageUrl || proposal) && (
                    <div className="request-center-card-details">
                      {req.customerNote && <p className="request-center-customer-note"><span>Customer note</span>{req.customerNote}</p>}
                      <div className="request-center-detail-actions">
                        {req.prescriptionUrl && <button type="button" onClick={() => openPrescription(req.prescriptionUrl)} disabled={prescriptionLoading}>▤ Prescription</button>}
                        {req.productImageUrl && <a href={req.productImageUrl} target="_blank" rel="noreferrer">▧ Product photo</a>}
                        {proposal && <div className="request-center-proposal-price"><span>{proposal.priceType === 'APPROXIMATE' ? 'Estimate' : 'Proposed total'}</span><strong>₹{price ?? '—'}</strong></div>}
                      </div>
                    </div>
                  )}

                  <div className="request-center-card-footer">
                    <span>{req.status === 'PROPOSAL_SENT' ? 'Waiting for customer approval' : terminal ? 'Request activity' : 'Action required'}</span>
                    <button type="button" onClick={() => { setActiveRequest(req); setProposalModalOpen(true); }}
                      className={terminal ? 'request-center-action request-center-action--secondary' : 'request-center-action'}>
                      {req.status === 'PROPOSAL_SENT' ? 'View proposal' : terminal ? 'View details' : 'Review & propose'}
                      <span aria-hidden="true">→</span>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}

        {pagination.total > 0 && (
          <div className="request-center-pagination">
            <Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total}
              pageSize={15} onPageChange={loadRequests} loading={loading} label="medicine requests" />
          </div>
        )}
      </section>

      {prescriptionLoading && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-900/70 p-4" role="status" aria-live="polite">
          <div className="rounded-2xl bg-white px-6 py-5 text-sm font-semibold text-slate-700 shadow-2xl">Loading prescription…</div>
        </div>
      )}

      {(prescriptionError || prescriptionPreview) && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/70 p-3 sm:p-5"
          onClick={event => { if (event.target === event.currentTarget) closePrescriptionPreview(); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="medicine-request-prescription-title"
            className="flex h-[92dvh] w-full max-w-5xl min-h-0 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <h4 id="medicine-request-prescription-title" className="text-sm font-black text-slate-900">Prescription</h4>
              <div className="flex items-center gap-2">
                {prescriptionPreview?.url && <a href={prescriptionPreview.url} download="prescription" className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700">Download</a>}
                <button type="button" onClick={closePrescriptionPreview} aria-label="Close prescription preview" className="min-h-10 rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200">Close</button>
              </div>
            </div>
            <div className="min-h-0 flex-1 bg-slate-100 p-2 sm:p-3">
              {prescriptionError ? <div role="alert" className="flex h-full items-center justify-center p-6 text-center text-sm font-semibold text-rose-700">{prescriptionError}</div>
                : prescriptionPreview?.type?.startsWith('image/') ? <div className="flex h-full items-center justify-center overflow-auto rounded-xl bg-slate-200 p-3"><img src={prescriptionPreview.url} alt="Uploaded prescription" className="max-h-full max-w-full rounded-lg object-contain shadow" /></div>
                : <iframe title="Uploaded prescription PDF" src={prescriptionPreview.url} className="h-full w-full rounded-xl border border-slate-200 bg-white" />}
            </div>
          </div>
        </div>
      )}

      {proposalModalOpen && activeRequest && (
        <AdminProposalModal request={activeRequest} isOpen={proposalModalOpen}
          onClose={() => { setProposalModalOpen(false); setActiveRequest(null); }}
          onRefresh={loadRequests} />
      )}
    </div>

}
