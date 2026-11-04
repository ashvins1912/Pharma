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

  useEffect(() => {
    void load();
    const refresh = () => { void load(); };
    window.addEventListener('stock-waitlist-updated', refresh);
    const poll = window.setInterval(() => { void load(); }, 60 * 1000);
    return () => {
      window.removeEventListener('stock-waitlist-updated', refresh);
      window.clearInterval(poll);
    };
  }, [load]);

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

  const cancel = async entry => {
    if (busyId) return;
    setBusyId(String(entry._id));
    try {
      await apiClient.post(`/api/orders/fulfillment/waitlist/${entry._id}/cancel`);
      addToast('Stock waitlist cancelled.', 'info');
      await load();
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
        const until = entry.waitUntil ? new Date(entry.waitUntil).toLocaleString() : '';
        return (
          <article key={entry._id} className="rounded-xl border border-slate-200 p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-xs text-slate-900">{entry.caseNumber}</strong>
              <span className={`rounded-full px-2 py-1 text-[10px] font-black ${ready ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>
                {ready ? 'Stock available to confirm' : 'Waiting for stock'}
              </span>
            </div>
            {(entry.lines || []).map((line, index) => (
              <div key={`${line.productId}-${index}`} className="flex justify-between gap-3 text-xs">
                <span className="text-slate-700">{line.name || 'Medicine'}</span>
                <span className="font-bold text-slate-900">{line.allocatedQuantity || 0} available / {line.waitingQuantity || line.requestedQuantity} waiting</span>
              </div>
            ))}
            {entry.parentOrderId && <p className="text-[10px] text-indigo-700">Linked to order #{String(entry.parentOrderId).slice(-6).toUpperCase()}</p>}
            <p className="text-[10px] text-slate-500">Wait window ends: {until || 'Not specified'}</p>
            <div className="flex gap-2">
              {ready && <button type="button" disabled={busyId === String(entry._id)} onClick={() => confirm(entry)} className="flex-1 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-black text-white disabled:opacity-50">{busyId === String(entry._id) ? 'Processing…' : 'Confirm available stock'}</button>}
              <button type="button" disabled={busyId === String(entry._id)} onClick={() => cancel(entry)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 disabled:opacity-50">Cancel wait</button>
            </div>
          </article>
        );
      })}
    </section>
  );
}
