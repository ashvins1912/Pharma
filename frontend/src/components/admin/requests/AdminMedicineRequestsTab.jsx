import React, { useState, useEffect, useRef } from 'react';
import { getReadableErrorMessage } from '../../../utils/errorMessage';
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
      setLoadError(getReadableErrorMessage(err, 'Unable to load medicine requests.'));
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

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    loadRequests(1);
  };

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
    <div className="admin-screen admin-screen--requests admin-request-center grid w-full min-w-0 grid-cols-1 gap-4 animate-fade-in">
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

      <section className="request-center-metrics grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Request overview">
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

      <section className="request-center-queue" aria-label="Medicine procurement requests">
        <div className="request-center-queue-heading flex justify-between items-center pb-3 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h3 className="text-base font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <span>🩺</span> {t('medicineProcurementRequests')}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {loading ? 'Updating request queue…' : `${pagination.total || requests.length} requests · Page ${pagination.page || 1} of ${pagination.totalPages || 1}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-slate-400 dark:text-slate-500">QUEUE LIVE</span>
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          </div>
        </div>

        {loadError && (
          <div role="alert" className="request-center-error my-3 p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl text-xs text-rose-800 dark:text-rose-200 flex items-center justify-between">
            <span>{loadError}</span>
            <button type="button" onClick={() => loadRequests(pagination.page || 1)} className="px-3 py-1 bg-rose-600 text-white font-bold rounded-lg hover:bg-rose-700">Retry</button>
          </div>
        )}
        {loading && requests.length === 0 && (
          <div role="status" className="request-center-skeletons grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 py-4" aria-label="Loading medicine requests">
            {[1,2,3].map(row => <div key={row} className="request-center-skeleton h-56 rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse" />)}
          </div>
        )}
        {!loading && !loadError && requests.length === 0 ? (
          <div className="request-center-empty text-center py-12 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 my-4">
            <span className="text-2xl block mb-2" aria-hidden="true">📋</span>
            <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300">{t('noMedicineRequestsFound')}</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('noMedicineRequestsHelp')}</p>
          </div>
        ) : !loadError && requests.length > 0 ? (
          <div className="request-center-card-grid grid grid-cols-1 gap-4 pt-4 md:grid-cols-2 2xl:grid-cols-3">
            {requests.map(req => {
              const items = Array.isArray(req.requestedItems) ? req.requestedItems : [];
              const visibleItems = items.slice(0, 3);
              const proposal = req.pharmacyProposal;
              const price = proposal?.finalPrice ?? proposal?.totalPrice ?? proposal?.approximatePrice;
              const terminal = ['CUSTOMER_APPROVED','CONVERTED_TO_ORDER','CUSTOMER_REJECTED','PHARMACY_REJECTED','EXPIRED'].includes(req.status);
              return (
                <article key={req._id} className="request-center-card bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xs hover:shadow-md transition flex flex-col justify-between space-y-3">
                  <div className="space-y-3">
                    <div className="request-center-card-top flex justify-between items-start gap-2 border-b border-slate-100 dark:border-slate-800/60 pb-2.5">
                      <div className="request-center-request-id">
                        <span className="text-[10px] font-mono text-slate-400 block uppercase">REQ #{req.requestNumber}</span>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                          {req.createdAt ? new Date(req.createdAt).toLocaleDateString() : '—'}
                        </span>
                      </div>
                      <div className="request-center-card-status">{getStatusBadge(req.status)}</div>
                    </div>

                    <div className="request-center-card-customer flex items-center gap-2.5 bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">
                      <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 font-black text-xs flex items-center justify-center shrink-0">
                        {String(req.customerName || 'C').trim().charAt(0).toUpperCase()}
                      </div>
                      <div className="request-center-customer-details min-w-0 flex-1">
                        <strong className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate block">{req.customerName || 'Customer'}</strong>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 block">{req.customerPhone || 'Phone unavailable'}</span>
                      </div>
                      {req.deliveryAddress && (
                        <span className="request-center-location text-[10px] text-slate-400 dark:text-slate-500 truncate max-w-[120px]" title={req.deliveryAddress}>
                          📍 {req.deliveryAddress}
                        </span>
                      )}
                    </div>

                    <div className="request-center-medicines space-y-1.5">
                      <div className="request-center-section-label flex justify-between items-center text-[10px] text-slate-400 dark:text-slate-500 font-semibold uppercase">
                        <span>Requested items</span>
                        <b className="tabular-nums font-mono">{items.length} {items.length === 1 ? 'item' : 'items'}</b>
                      </div>
                      {visibleItems.map((item, index) => (
                        <div className="request-center-medicine flex items-center justify-between text-xs p-2 bg-slate-50/60 dark:bg-slate-800/30 rounded-lg border border-slate-100 dark:border-slate-800/40" key={`${item.requestedName || 'medicine'}-${index}`}>
                          <div className="min-w-0 flex-1 pr-2">
                            <strong className="font-bold text-slate-900 dark:text-slate-100 block truncate">{item.requestedName || 'Medicine'}</strong>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 block truncate">
                              {[item.strength, item.dosageForm].filter(Boolean).join(' · ') || 'Details not provided'}
                            </span>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-[11px] font-mono font-bold text-slate-700 dark:text-slate-300 block">Qty {item.quantity || 1}</span>
                            {item.originalAvailabilityStatus === 'OUT_OF_STOCK' && (
                              <span className="text-[9px] text-rose-600 dark:text-rose-400 font-bold">Out of stock</span>
                            )}
                          </div>
                        </div>
                      ))}
                      {items.length > 3 && (
                        <p className="request-center-more-items text-[10px] text-slate-400 italic">+{items.length - 3} more items</p>
                      )}
                    </div>

                    {(req.customerNote || req.prescriptionUrl || req.productImageUrl || proposal) && (
                      <div className="request-center-card-details space-y-2 pt-1 border-t border-slate-100 dark:border-slate-800">
                        {req.customerNote && (
                          <p className="request-center-customer-note text-[11px] bg-amber-50/70 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 p-2 rounded-lg border border-amber-200/50">
                            <span className="font-bold block text-[10px] text-amber-800 dark:text-amber-300">Customer Note:</span>
                            "{req.customerNote}"
                          </p>
                        )}
                        <div className="request-center-detail-actions flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div className="flex gap-1.5">
                            {req.prescriptionUrl && (
                              <button type="button" onClick={() => openPrescription(req.prescriptionUrl)} disabled={prescriptionLoading} className="px-2 py-1 text-[10px] font-bold bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 rounded-md border border-blue-200 dark:border-blue-800 hover:bg-blue-100">
                                📄 Rx
                              </button>
                            )}
                            {req.productImageUrl && (
                              <a href={req.productImageUrl} target="_blank" rel="noreferrer" className="px-2 py-1 text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-md hover:bg-slate-200">
                                📷 Photo
                              </a>
                            )}
                          </div>
                          {proposal && (
                            <div className="request-center-proposal-price text-right">
                              <span className="text-[9px] text-slate-400 uppercase block">{proposal.priceType === 'APPROXIMATE' ? 'Estimate' : 'Quote Total'}</span>
                              <strong className="text-xs font-black font-mono text-emerald-600 dark:text-emerald-400">₹{price ?? '—'}</strong>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="request-center-card-footer pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                    <span className="text-[10px] text-slate-400 dark:text-slate-500">
                      {req.status === 'PROPOSAL_SENT' ? 'Awaiting approval' : terminal ? 'Completed' : 'Action required'}
                    </span>
                    <button type="button" onClick={() => { setActiveRequest(req); setProposalModalOpen(true); }}
                      className={`px-3 py-1.5 text-xs font-bold rounded-xl transition cursor-pointer flex items-center gap-1 ${
                        terminal 
                          ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200' 
                          : 'bg-blue-600 hover:bg-blue-700 text-white shadow-xs'
                      }`}>
                      <span>{req.status === 'PROPOSAL_SENT' ? 'View proposal' : terminal ? 'View details' : 'Review & propose'}</span>
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
  );
}
