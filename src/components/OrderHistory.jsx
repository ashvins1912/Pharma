import React, { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '../api/apiClient';
import { useAuth } from '../context/AuthContext';

const formatDate = (date) => {
  const parsedDate = new Date(date);
  return Number.isNaN(parsedDate.getTime())
    ? 'Date unavailable'
    : parsedDate.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

const getItemName = (item) => item.name || item.productName || 'Order item';
const PAGE_SIZE = 5;

const normalizeHistoryResponse = (data, requestedPage) => {
  if (Array.isArray(data)) {
    const total = data.length;
    const totalPages = Math.ceil(total / PAGE_SIZE);
    const page = Math.min(requestedPage, Math.max(totalPages, 1));
    return {
      orders: data.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
      pagination: { page, limit: PAGE_SIZE, total, totalPages }
    };
  }

  if (!Array.isArray(data?.orders)) {
    throw new Error('The order history response was invalid.');
  }

  const total = Number.isFinite(Number(data.pagination?.total))
    ? Number(data.pagination.total)
    : data.orders.length;
  const totalPages = Number.isFinite(Number(data.pagination?.totalPages))
    ? Number(data.pagination.totalPages)
    : Math.ceil(total / PAGE_SIZE);
  const page = Number.isFinite(Number(data.pagination?.page))
    ? Number(data.pagination.page)
    : requestedPage;
  return {
    orders: data.orders,
    pagination: {
      page,
      limit: PAGE_SIZE,
      total,
      totalPages
    }
  };
};

export default function OrderHistory() {
  const { user } = useAuth();
  const [result, setResult] = useState({
    userId: null,
    orders: [],
    pagination: { page: 1, limit: 5, total: 0, totalPages: 0 },
    error: ''
  });
  const [loading, setLoading] = useState(true);
  const pageRef = useRef(1);
  const requestSequence = useRef(0);
  const userId = user?.id;

  const loadOrderHistory = useCallback(async (requestedPage) => {
    const currentPage = requestedPage ?? pageRef.current;
    const currentSequence = ++requestSequence.current;
    if (!userId) {
      setResult({
        userId: null,
        orders: [],
        pagination: { page: 1, limit: 5, total: 0, totalPages: 0 },
        error: ''
      });
      setLoading(false);
      return;
    }

    pageRef.current = currentPage;
    setLoading(true);
    try {
      const { data } = await apiClient.get('/api/orders/history', {
        params: { userId, page: currentPage }
      });
      const history = normalizeHistoryResponse(data, currentPage);
      if (currentSequence === requestSequence.current) {
        pageRef.current = history.pagination.page;
        setResult({ userId, ...history, error: '' });
      }
    } catch (requestError) {
      if (currentSequence === requestSequence.current) {
        setResult({
          userId,
          orders: [],
          pagination: { page: currentPage, limit: PAGE_SIZE, total: 0, totalPages: 0 },
          error: requestError.message || 'Could not load your order history.'
        });
      }
    } finally {
      if (currentSequence === requestSequence.current) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    pageRef.current = 1;
    void loadOrderHistory(1);
    return () => {
      requestSequence.current += 1;
    };
  }, [loadOrderHistory]);

  const userResult = result.userId === userId ? result : null;
  const isLoading = loading || Boolean(userId && !userResult);
  const orders = userResult?.orders || [];
  const pagination = userResult?.pagination || { page: 1, limit: 5, total: 0, totalPages: 0 };
  const error = userResult?.error || '';

  return (
    <section className="min-w-0 overflow-hidden rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="order-history-title">
      <div className="mb-4 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 id="order-history-title" className="text-base font-extrabold text-slate-900">Past Orders</h3>
          <p className="text-xs text-slate-500">Your completed, cancelled, and rejected orders.</p>
        </div>
        <button
          type="button"
          onClick={() => loadOrderHistory()}
          disabled={isLoading}
          className="min-h-10 shrink-0 rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {isLoading ? (
        <div className="flex min-h-36 items-center justify-center gap-3 text-sm font-semibold text-slate-500" role="status">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" aria-hidden="true" />
          Loading past orders...
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-800" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => loadOrderHistory()} className="mt-2 font-bold underline underline-offset-2">
            Try again
          </button>
        </div>
      ) : orders.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm font-bold text-slate-700">No past orders found</p>
          <p className="mt-1 text-xs text-slate-500">Completed or cancelled orders will appear here.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {orders.map((order) => {
            const id = String(order._id || order.id || '');
            const status = order.orderStatus || order.status || 'Completed';
            const items = Array.isArray(order.items) ? order.items : [];

            return (
              <li key={id} className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5">
                <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="break-all text-xs font-extrabold text-slate-900">
                      Order ID: <span className="font-semibold text-slate-600">{id || 'Unavailable'}</span>
                    </p>
                    <p className="mt-1 text-xs text-slate-500">Placed {formatDate(order.createdAt)}</p>
                  </div>
                  <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${
                      ['Cancelled', 'cancelled', 'Rejected', 'rejected'].includes(status)
                        ? 'bg-rose-100 text-rose-700'
                        : 'bg-emerald-100 text-emerald-800'
                    }`}>
                      {status.replaceAll('_', ' ')}
                    </span>
                    <span className="whitespace-nowrap text-sm font-black text-slate-900">
                      ₹{Number(order.finalTotal ?? order.totalAmount ?? 0).toLocaleString('en-IN')}
                    </span>
                  </div>
                </div>

                <div className="mt-4 border-t border-slate-200 pt-3">
                  <p className="mb-2 text-[10px] font-black uppercase tracking-wider text-slate-400">Items</p>
                  {items.length ? (
                    <ul className="space-y-1.5">
                      {items.map((item, index) => (
                        <li key={`${getItemName(item)}-${index}`} className="flex min-w-0 justify-between gap-3 text-xs text-slate-600">
                          <span className="min-w-0 break-words">{getItemName(item)} <span className="whitespace-nowrap">× {item.quantity || 1}</span></span>
                          {(item.totalPrice != null || item.price != null || item.unitPrice != null) && (
                            <span className="shrink-0 whitespace-nowrap font-semibold text-slate-700">
                              ₹{Number(item.totalPrice ?? (item.price ?? item.unitPrice) * (item.quantity || 1)).toLocaleString('en-IN')}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-slate-500">Item details unavailable.</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {!isLoading && !error && pagination.totalPages > 1 && (
        <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500" aria-live="polite">
            Page {pagination.page} of {pagination.totalPages} · {pagination.total} past orders
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => loadOrderHistory(pagination.page - 1)}
              disabled={isLoading || pagination.page <= 1}
              className="min-h-9 rounded-lg bg-slate-100 px-3 text-xs font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => loadOrderHistory(pagination.page + 1)}
              disabled={isLoading || pagination.page >= pagination.totalPages}
              className="min-h-9 rounded-lg bg-slate-100 px-3 text-xs font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
