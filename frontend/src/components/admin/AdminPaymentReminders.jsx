import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';

const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

export default function AdminPaymentReminders({ canManage = false }) {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sendingId, setSendingId] = useState(null);
  const [notice, setNotice] = useState('');
  const [totalOutstanding, setTotalOutstanding] = useState(0);
  const [truncated, setTruncated] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiClient.get('/api/v1/admin/payments/outstanding');
      const data = response.data?.data || {};
      setCustomers(data.customers || []);
      setTotalOutstanding(Number(data.totalOutstanding || 0));
      setTruncated(Boolean(data.truncated));
    } catch (requestError) {
      setError(requestError.message || 'Could not load outstanding payments.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const sendReminder = async customer => {
    setSendingId(customer.customerId);
    setNotice('');
    setError('');
    try {
      const response = await apiClient.post('/api/v1/admin/payments/reminders/dispatch', {
        customerId: customer.customerId,
        orderIds: customer.invoices.map(invoice => invoice.orderId)
      });
      const status = response.data?.data?.status || 'REQUESTED';
      setNotice(`Reminder ${status.toLowerCase().replaceAll('_', ' ')} for customer ${customer.customerId.slice(-6)}.`);
      await load();
    } catch (requestError) {
      setError(requestError.message || 'Could not send payment reminder.');
    } finally {
      setSendingId(null);
    }
  };

  return (
    <section className="space-y-4" aria-labelledby="payment-reminder-title">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="payment-reminder-title" className="text-lg font-black text-slate-900">Outstanding digital payments</h2>
          <p className="text-xs text-slate-500">{totalOutstanding == null ? 'Outstanding total exceeds the scan limit; filter by customer to calculate it.' : `Total outstanding: ${currency.format(totalOutstanding)}`} · Eligible invoices, reminder history, and snooze status.</p>
        </div>
        <button type="button" onClick={load} disabled={loading} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold disabled:opacity-50">Refresh</button>
      </header>
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
      {truncated && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Showing the first 500 customers. Use the customer filter API for more results.</p>}
      {loading ? <p className="py-10 text-center text-sm text-slate-500">Loading payment records…</p>
        : customers.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">No eligible outstanding digital payments.</p>
          : <div className="grid gap-3 lg:grid-cols-2">
            {customers.map(customer => (
              <article key={customer.customerId} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <header className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Customer · {customer.customerId.slice(-8)}</p>
                    <p className="mt-1 text-xl font-black text-slate-900">{currency.format(customer.amountOutstanding)}</p>
                    <p className="text-xs text-slate-500">{customer.invoiceCount} invoice{customer.invoiceCount === 1 ? '' : 's'}</p>
                  </div>
                  {canManage && (
                    <button type="button" onClick={() => sendReminder(customer)} disabled={Boolean(sendingId) || Boolean(customer.snoozedUntil)} className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-50">
                      {sendingId === customer.customerId ? 'Sending…' : customer.snoozedUntil ? 'Snoozed' : 'Send WhatsApp reminder'}
                    </button>
                  )}
                </header>
                {customer.snoozedUntil && <p className="text-xs text-amber-700">Snoozed until {new Date(customer.snoozedUntil).toLocaleString()}</p>}
                {customer.lastReminder && <p className="text-xs text-slate-500">Last reminder: {customer.lastReminder.status} · {new Date(customer.lastReminder.createdAt).toLocaleString()}</p>}
                <ul className="divide-y divide-slate-100 rounded-xl bg-slate-50 px-3">
                  {customer.invoices.map(invoice => <li key={invoice.orderId} className="flex items-center justify-between gap-3 py-2 text-xs">
                    <span className="truncate text-slate-600">Invoice {invoice.invoiceReference || invoice.orderId.slice(-8)}</span>
                    <span className="shrink-0 font-bold text-slate-800">{currency.format(invoice.amountOutstanding)}</span>
                  </li>)}
                </ul>
              </article>
            ))}
          </div>}
    </section>
  );
}
