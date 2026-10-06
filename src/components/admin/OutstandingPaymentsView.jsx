import React, { useEffect, useState, useMemo } from 'react';
import apiClient from '../../api/apiClient';
import { useToast } from '../../context/ToastContext';

export default function OutstandingPaymentsView() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ customers: [], totalOutstanding: 0 });
  const [search, setSearch] = useState('');
  const [dispatchingId, setDispatchingId] = useState(null);
  const [expandedCustomerId, setExpandedCustomerId] = useState(null);
  const [error, setError] = useState(null);

  const fetchOutstanding = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiClient.get('/api/admin/payments/outstanding');
      if (res.data?.success && res.data?.data) {
        setData(res.data.data);
      } else if (res.data?.customers) {
        setData(res.data);
      } else {
        setData({ customers: [], totalOutstanding: 0 });
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Failed to load outstanding digital payments.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOutstanding();
  }, []);

  const handleDispatchReminder = async (customer) => {
    try {
      setDispatchingId(customer.customerId);
      const invoiceIds = (customer.invoices || []).map(i => i.orderId);
      const res = await apiClient.post('/api/admin/payments/reminders/dispatch', {
        customerId: customer.customerId,
        orderIds: invoiceIds
      });

      if (res.data?.success) {
        addToast(res.data?.data?.message || 'Payment reminder dispatched successfully via WhatsApp.', 'success');
        fetchOutstanding();
      } else {
        addToast(res.data?.message || 'Reminder queued.', 'info');
      }
    } catch (err) {
      addToast(err.response?.data?.message || err.message || 'Failed to dispatch payment reminder.', 'error');
    } finally {
      setDispatchingId(null);
    }
  };

  const filteredCustomers = useMemo(() => {
    if (!Array.isArray(data.customers)) return [];
    if (!search.trim()) return data.customers;
    const q = search.toLowerCase();
    return data.customers.filter(c =>
      String(c.customerId).toLowerCase().includes(q) ||
      (c.invoices || []).some(inv =>
        String(inv.orderId).toLowerCase().includes(q) ||
        String(inv.invoiceReference || '').toLowerCase().includes(q)
      )
    );
  }, [data.customers, search]);

  const totalInvoices = useMemo(() => {
    if (!Array.isArray(data.customers)) return 0;
    return data.customers.reduce((acc, c) => acc + (c.invoiceCount || (c.invoices || []).length), 0);
  }, [data.customers]);

  return (
    <div className="space-y-4">
      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">💳</span>
            <h3 className="text-base font-black text-slate-900">Outstanding Digital Payments</h3>
            <span className="bg-amber-100 text-amber-800 text-[10px] font-black px-2 py-0.5 rounded-full">
              Digital Invoices
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Track unpaid digital orders, pending payment gateway receipts, and send automated WhatsApp reminders.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchOutstanding}
            disabled={loading}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
          >
            <span>🔄</span>
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-linear-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-2xl p-4 shadow-xs">
          <span className="text-[10px] font-black uppercase tracking-wider text-amber-800 block">
            Total Outstanding Digital Balance
          </span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-black text-amber-950">
              ₹{(data.totalOutstanding || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
            <span className="text-[11px] font-bold text-amber-700">Pending Collection</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 block">
            Customers with Balances
          </span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-black text-slate-900">
              {data.customers?.length || 0}
            </span>
            <span className="text-[11px] text-slate-500">Accounts</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 block">
            Pending Digital Invoices
          </span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-black text-slate-900">
              {totalInvoices}
            </span>
            <span className="text-[11px] text-slate-500">Unsettled orders</span>
          </div>
        </div>
      </div>

      {/* Search Input */}
      <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-xs">
        <input
          type="search"
          placeholder="Filter by Customer ID or Order Reference..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-500"
        />
      </div>

      {/* Error View */}
      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-800 flex items-center justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={fetchOutstanding}
            className="underline font-bold text-rose-900 ml-2"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading View */}
      {loading && !error && (
        <div className="py-12 bg-white rounded-2xl border border-slate-200 text-center text-xs text-slate-500">
          Loading outstanding digital payments...
        </div>
      )}

      {/* Empty View */}
      {!loading && !error && filteredCustomers.length === 0 && (
        <div className="py-12 bg-white rounded-2xl border border-slate-200 text-center space-y-2">
          <span className="text-3xl block">🎉</span>
          <h4 className="text-sm font-black text-slate-800">No Outstanding Digital Payments</h4>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            All digital orders are completely settled or there are no pending digital invoices at this time.
          </p>
        </div>
      )}

      {/* Customer List */}
      {!loading && !error && filteredCustomers.length > 0 && (
        <div className="space-y-3">
          {filteredCustomers.map((cust) => {
            const isExpanded = expandedCustomerId === cust.customerId;
            const isSending = dispatchingId === cust.customerId;

            return (
              <div
                key={cust.customerId}
                className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3 hover:border-slate-300 transition"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-mono font-black text-slate-900 bg-slate-100 px-2 py-0.5 rounded-lg">
                        Customer #{String(cust.customerId).slice(-8)}
                      </span>
                      <span className="text-[10px] font-extrabold bg-amber-100 text-amber-900 px-2 py-0.5 rounded-full">
                        {cust.invoiceCount || cust.invoices?.length || 1} Unpaid Invoice(s)
                      </span>
                      {cust.snoozedUntil && (
                        <span className="text-[10px] font-bold bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                          Snoozed until {new Date(cust.snoozedUntil).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    {cust.lastReminder && (
                      <p className="text-[11px] text-slate-500">
                        Last reminder: <span className="font-semibold text-slate-700">{cust.lastReminder.status}</span> ({new Date(cust.lastReminder.sentAt || cust.lastReminder.createdAt).toLocaleString()})
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <span className="text-[10px] font-black uppercase text-slate-400 block">Total Due</span>
                      <span className="text-base font-black text-rose-600">
                        ₹{(cust.amountOutstanding || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDispatchReminder(cust)}
                      disabled={isSending}
                      className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black transition cursor-pointer shadow-xs disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <span>💬</span>
                      <span>{isSending ? 'Sending...' : 'Remind via WhatsApp'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setExpandedCustomerId(isExpanded ? null : cust.customerId)}
                      className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition cursor-pointer"
                      title={isExpanded ? 'Collapse' : 'View Invoices'}
                    >
                      {isExpanded ? '▲' : '▼'}
                    </button>
                  </div>
                </div>

                {/* Expanded Invoice Breakdown */}
                {isExpanded && Array.isArray(cust.invoices) && (
                  <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                    <h5 className="text-[11px] font-black uppercase tracking-wider text-slate-500">
                      Unpaid Order Invoices
                    </h5>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {cust.invoices.map((inv) => (
                        <div
                          key={inv.orderId}
                          className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs"
                        >
                          <div>
                            <span className="font-bold text-slate-900 block font-mono">
                              {inv.invoiceReference || `Order #${inv.orderId.slice(-6)}`}
                            </span>
                            <span className="text-[10px] text-slate-500">
                              Status: {inv.orderStatus} • {inv.createdAt ? new Date(inv.createdAt).toLocaleDateString() : 'Recent'}
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="font-black text-rose-600 block">
                              ₹{inv.amountOutstanding?.toFixed(2)}
                            </span>
                            <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-md">
                              {inv.paymentStatus || 'PENDING'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
