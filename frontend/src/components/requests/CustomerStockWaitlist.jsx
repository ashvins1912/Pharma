import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { useToast } from '../../context/ToastContext';
import { useApp } from '../../context/AppContext';
import { useLanguage } from '../../context/LanguageContext';
import Pagination from '../common/Pagination';

export default function CustomerStockWaitlist() {
  const { t } = useLanguage();
  const { addToast } = useToast();
  const { loadUserOrders } = useApp();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [page, setPage] = useState(1);
  const [closed, setClosed] = useState(false);

  const pageSize = 10;
  const visibleItems = showAll ? items.slice((page - 1) * pageSize, page * pageSize) : items.slice(0, 2);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));

  const load = useCallback(async () => {
    try {
      const response = await apiClient.get('/api/orders/fulfillment/waitlist');
      setItems(response.data?.items || []);
    } catch (error) {
      addToast(error.response?.data?.message || t('couldNotLoadStockWatch'), 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  const hasConfirmingEntry = items.some(item => item.status === 'CONFIRMING');

  useEffect(() => {
    void load();
    const refresh = () => { void load(); };
    window.addEventListener('stock-waitlist-updated', refresh);
    const poll = window.setInterval(() => { void load(); }, hasConfirmingEntry ? 10 * 1000 : 60 * 1000);
    return () => {
      window.removeEventListener('stock-waitlist-updated', refresh);
      window.clearInterval(poll);
    };
  }, [load, hasConfirmingEntry]);

  const confirm = async entry => {
    if (busyId) return;
    setBusyId(String(entry._id));
    try {
      const response = await apiClient.post(`/api/orders/fulfillment/waitlist/${entry._id}/confirm`);
      addToast(response.data?.message || t('stockReservedOrderCreated'), 'success');
      await Promise.all([load(), loadUserOrders()]);
    } catch (error) {
      addToast(error.response?.data?.message || t('stockChangedRetry'), 'warning');
      await load();
    } finally {
      setBusyId('');
    }
  };

  const cancelLine = async (entry, lineIndex) => {
    if (busyId) return;
    setBusyId(String(entry._id));
    try {
      const response = await apiClient.post(`/api/orders/fulfillment/waitlist/${entry._id}/cancel`, {
        lineIndexes: [lineIndex]
      });
      addToast(response.data?.message || 'Selected remaining quantity cancelled.', 'info');
      await Promise.all([load(), loadUserOrders()]);
    } catch (error) {
      addToast(error.response?.data?.message || 'Could not cancel this medicine quantity.', 'error');
      await load();
    } finally {
      setBusyId('');
    }
  };

  const cancel = async entry => {
    if (busyId) return;
    setBusyId(String(entry._id));
    try {
      await apiClient.post(`/api/orders/fulfillment/waitlist/${entry._id}/cancel`);
      addToast(t('stockWatchCancelled'), 'info');
      await Promise.all([load(), loadUserOrders()]);
    } catch (error) {
      addToast(error.response?.data?.message || t('couldNotCancelStockWatch'), 'error');
    } finally {
      setBusyId('');
    }
  };

  if (closed || (!loading && !items.length)) return null;
  if (loading) return <div className="rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-500">{t('loadingStockWatch')}</div>;

  return (
    <section className="rounded-2xl border border-indigo-100 bg-white p-4 sm:p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-black text-slate-900">{t('stockWatchTitle')}</h3>
          <p className="mt-1 text-xs text-slate-500">{t('stockWatchDescription')}</p>
        </div>
        <button type="button" onClick={() => setClosed(true)} aria-label="Close stock availability watch" title="Close"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-lg font-bold text-slate-400 hover:bg-slate-100 hover:text-slate-700">×</button>
      </div>
      {visibleItems.map(entry => {
        const ready = ['READY_FOR_CONFIRMATION', 'PARTIALLY_FULFILLED'].includes(entry.status);
        const confirming = entry.status === 'CONFIRMING';
        const terminal = ['FULFILLED', 'EXPIRED', 'CANCELLED'].includes(entry.status);
        const statusLabel = confirming ? t('creatingOrder') : ready ? t('stockAvailableToConfirm') : entry.status === 'FULFILLED' ? t('fulfilled') : entry.status === 'EXPIRED' ? t('waitPeriodExpired') : entry.status === 'CANCELLED' ? t('cancelled') : t('waitingForStock');
        const until = entry.waitUntil ? new Date(entry.waitUntil).toLocaleString() : '';
        return (
          <article key={entry._id} className="rounded-xl border border-slate-200 p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-xs text-slate-900">{entry.caseNumber}</strong>
              <span className={`rounded-full px-2 py-1 text-[10px] font-black ${ready || entry.status === 'FULFILLED' ? 'bg-emerald-100 text-emerald-800' : entry.status === 'EXPIRED' || entry.status === 'CANCELLED' ? 'bg-slate-100 text-slate-600' : 'bg-amber-100 text-amber-900'}`}>
                {statusLabel}
              </span>
            </div>
            {(entry.lines || []).map((line, index) => {
              const waitingQuantity = Number(line.waitingQuantity ?? line.requestedQuantity ?? 0);
              const cancelled = line.customerDecision === 'CANCELLED';
              return (
                <div key={`${line.productId || line.requestedName || 'medicine'}-${index}`} className="flex items-start justify-between gap-3 text-xs border-t border-slate-100 pt-2">
                  <div className="min-w-0">
                    <span className="text-slate-700">{line.name || line.requestedName || 'Medicine'}</span>
                    {cancelled ? (
                      <p className="mt-1 text-[10px] font-bold text-slate-500">{t('remainingQuantityCancelled')}</p>
                    ) : (
                      <p className="mt-1 text-[10px] font-medium text-emerald-700">
                        {Number(line.listPrice || 0) > Number(line.unitPrice || 0)
                          ? <><s className="mr-1 text-slate-400">₹{Number(line.listPrice).toFixed(2)}</s>₹{Number(line.unitPrice).toFixed(2)} each · {Number(line.discountPercentage || 0)}% off</>
                          : <>₹{Number(line.unitPrice || 0).toFixed(2)} each</>}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-bold text-slate-900">{Number(line.allocatedQuantity || 0)} available / {waitingQuantity} waiting</p>
                    {!cancelled && waitingQuantity > 0 && !terminal && (
                      <button type="button" disabled={busyId === String(entry._id)} onClick={() => cancelLine(entry, index)} className="mt-1 text-[10px] font-bold text-rose-700 underline disabled:opacity-50">{t('cancelRemaining')}</button>
                    )}
                  </div>
                </div>
              );
            })}
            {entry.parentOrderId && <p className="text-[10px] text-indigo-700">{t('linkedToOrder')} #{String(entry.parentOrderId).slice(-6).toUpperCase()}</p>}
            <p className="text-[10px] text-slate-500">{t('waitWindowEnds')}: {until || t('notSpecified')}</p>
            {confirming && <p role="status" className="text-[11px] text-amber-800">{t('reconcilingOrder')}</p>}
            <div className="flex flex-wrap gap-2">
              {ready && <button type="button" disabled={busyId === String(entry._id)} onClick={() => confirm(entry)} className="flex-1 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-black text-white disabled:opacity-50">{busyId === String(entry._id) ? t('processing') : t('confirmAvailableStock')}</button>}
              {confirming && <button type="button" onClick={() => void load()} className="flex-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">{t('refreshStatus')}</button>}
              {!confirming && !terminal && <button type="button" disabled={busyId === String(entry._id)} onClick={() => cancel(entry)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 disabled:opacity-50">{t('cancelWait')}</button>}
            </div>
          </article>
        );
      })}
      {items.length > 2 && !showAll && (
        <button type="button" onClick={() => { setShowAll(true); setPage(1); }}
          className="w-full rounded-lg border border-indigo-100 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-50">
          View all {items.length} stock watches
        </button>
      )}
      {showAll && (
        <>
          <button type="button" onClick={() => { setShowAll(false); setPage(1); }}
            className="text-xs font-bold text-indigo-700 underline">Show less</button>
          <Pagination page={page} totalPages={totalPages} total={items.length} pageSize={pageSize}
            onPageChange={setPage} label="stock watches" />
        </>
      )}
    </section>
  );
}
