import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { useToast } from '../../context/ToastContext';
import { useApp } from '../../context/AppContext';

export default function CustomerStockWaitlist() {
  const { addToast } = useToast();
  const { loadUserOrders } = useApp();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await apiClient.get('/api/orders/fulfillment/waitlist');
      setItems(response.data?.items || []);
    } catch (error) {
      addToast(error.response?.data?.message || 'Could not load your stock waitlist.', 'error');
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
      addToast(response.data?.message || 'Available stock reserved and order created.', 'success');
      await Promise.all([load(), loadUserOrders()]);
    } catch (error) {
      addToast(error.response?.data?.message || 'Stock changed before confirmation. Refresh and try again.', 'warning');
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
      addToast('Stock waitlist cancelled.', 'info');
      await Promise.all([load(), loadUserOrders()]);
    } catch (error) {
      addToast(error.response?.data?.message || 'Could not cancel this waitlist.', 'error');
    } finally {
      setBusyId('');
    }
  };

  if (loading) return <div className="rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-500">Loading stock waitlist…</div>;
  if (!items.length) return null;

  return (
    <section className="rounded-2xl border border-indigo-100 bg-white p-4 sm:p-5 space-y-3">
      <div>
        <h3 className="text-sm font-black text-slate-900">Stock availability watch</h3>
        <p className="mt-1 text-xs text-slate-500">We keep checking the selected pharmacy. Stock is only reserved after you confirm.</p>
      </div>
      {items.map(entry => {
        const ready = ['READY_FOR_CONFIRMATION', 'PARTIALLY_FULFILLED'].includes(entry.status);
        const confirming = entry.status === 'CONFIRMING';
        const terminal = ['FULFILLED', 'EXPIRED', 'CANCELLED'].includes(entry.status);
        const statusLabel = confirming ? 'Creating your order…' : ready ? 'Stock available to confirm' : entry.status === 'FULFILLED' ? 'Fulfilled' : entry.status === 'EXPIRED' ? 'Wait period expired' : entry.status === 'CANCELLED' ? 'Cancelled' : 'Waiting for stock';
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
                      <p className="mt-1 text-[10px] font-bold text-slate-500">Remaining quantity cancelled</p>
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
                      <button type="button" disabled={busyId === String(entry._id)} onClick={() => cancelLine(entry, index)} className="mt-1 text-[10px] font-bold text-rose-700 underline disabled:opacity-50">Cancel remaining</button>
                    )}
                  </div>
                </div>
              );
            })}
            {entry.parentOrderId && <p className="text-[10px] text-indigo-700">Linked to order #{String(entry.parentOrderId).slice(-6).toUpperCase()}</p>}
            <p className="text-[10px] text-slate-500">Wait window ends: {until || 'Not specified'}</p>
            {confirming && <p role="status" className="text-[11px] text-amber-800">We are reconciling your order confirmation. This panel checks again automatically; you can refresh the status below.</p>}
            <div className="flex flex-wrap gap-2">
              {ready && <button type="button" disabled={busyId === String(entry._id)} onClick={() => confirm(entry)} className="flex-1 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-black text-white disabled:opacity-50">{busyId === String(entry._id) ? 'Processing…' : 'Confirm available stock'}</button>}
              {confirming && <button type="button" onClick={() => void load()} className="flex-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">Refresh status</button>}
              {!confirming && !terminal && <button type="button" disabled={busyId === String(entry._id)} onClick={() => cancel(entry)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 disabled:opacity-50">Cancel wait</button>}
            </div>
          </article>
        );
      })}
    </section>
  );
}
