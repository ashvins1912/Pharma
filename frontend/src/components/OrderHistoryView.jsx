import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import apiClient from '../api/apiClient';
import { useToast } from '../context/ToastContext';
import OrderHistory from './OrderHistory';

export default function OrderHistoryView({ onTrackOrder }) {
  const { orders, ordersError, loadingOrders, loadUserOrders } = useApp();
  const { addToast } = useToast();
  const editableStatuses = ['Pending_Review', 'Approved', 'Processing Order', 'Ready to Dispatch'];
  const activeOrders = orders.filter(order => !['Delivered', 'Cancelled', 'Rejected', 'Completed', 'delivered', 'cancelled', 'rejected', 'completed'].includes(order.orderStatus || order.status));

  const cancelOrder = async (order) => {
    if (!window.confirm('Cancel this order? Reserved stock will be released.')) return;
    try {
      await apiClient.put(`/api/orders/${order._id}/cancel`);
      addToast('Order cancelled and stock released.', 'success');
      await loadUserOrders();
    } catch (error) {
      addToast(error.message || 'Could not cancel this order.', 'error');
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'Delivered':
        return <span className="bg-emerald-100 text-emerald-800 text-[10px] font-black px-2 py-0.5 rounded-full">Delivered</span>;
      case 'Cancelled':
        return <span className="bg-slate-100 text-slate-600 text-[10px] font-black px-2 py-0.5 rounded-full">Cancelled</span>;
      case 'Rejected':
        return <span className="bg-rose-100 text-rose-700 text-[10px] font-black px-2 py-0.5 rounded-full">Rejected</span>;
      case 'Dispatched':
        return <span className="bg-blue-100 text-blue-800 text-[10px] font-black px-2 py-0.5 rounded-full">Out for Delivery</span>;
      case 'Ready to Dispatch':
        return <span className="bg-indigo-100 text-indigo-800 text-[10px] font-black px-2 py-0.5 rounded-full">Ready to Dispatch</span>;
      default:
        return <span className="bg-amber-100 text-amber-800 text-[10px] font-black px-2 py-0.5 rounded-full">Processing</span>;
    }
  };

  return (
    <div className="space-y-4">
    <div className="bg-white border border-slate-200 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-extrabold text-slate-900">📦 Active Orders</h3>
          <p className="text-xs text-slate-500">Track or manage orders currently being processed.</p>
        </div>
        <button
          onClick={loadUserOrders}
          disabled={loadingOrders}
          className="text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-xl cursor-pointer transition"
        >
          {loadingOrders ? 'Refreshing...' : '🔄 Refresh'}
        </button>
      </div>

      {ordersError ? (
        <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-800" role="alert">
          <p>{ordersError}</p>
          <button type="button" onClick={() => loadUserOrders()} disabled={loadingOrders} className="mt-2 font-bold underline disabled:opacity-50">Try again</button>
        </div>
      ) : activeOrders.length === 0 ? (
        <div className="py-16 text-center text-slate-400 space-y-2">
          <p className="text-3xl">📋</p>
          <p className="text-xs font-bold text-slate-700">No active orders</p>
          <p className="text-[11px] text-slate-400">Orders being processed will appear here.</p>
        </div>
      ) : (
        <>
          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 text-[10px] font-extrabold uppercase tracking-wider">
                  <th className="py-3 px-3">Order ID</th>
                  <th className="py-3 px-3">Date</th>
                  <th className="py-3 px-3">Items</th>
                  <th className="py-3 px-3">Total (COD)</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {activeOrders.map((order) => {
                  const orderId = (order._id || '').slice(-6).toUpperCase();
                  return (
                    <tr key={order._id} className="hover:bg-slate-50/70 transition">
                      <td className="py-3.5 px-3 font-extrabold text-slate-900">
                        #{orderId}
                      </td>
                      <td className="py-3.5 px-3 text-slate-500 text-[11px]">
                        {new Date(order.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-3.5 px-3 text-slate-600 max-w-[200px] truncate">
                        {(order.items || []).map(i => `${i.name} (x${i.quantity})`).join(', ')}
                      </td>
                      <td className="py-3.5 px-3 font-black text-emerald-600">
                        ₹{order.finalTotal}
                      </td>
                      <td className="py-3.5 px-3">
                        {getStatusBadge(order.orderStatus)}
                      </td>
                      <td className="py-3.5 px-3 text-right">
                        {editableStatuses.includes(order.orderStatus) && (
                          <button
                            onClick={() => cancelOrder(order)}
                            className="mr-2 bg-rose-50 hover:bg-rose-100 text-rose-700 font-extrabold text-xs px-3 py-1.5 rounded-xl cursor-pointer transition"
                          >
                            Cancel
                          </button>
                        )}
                        {!['Delivered', 'Cancelled', 'Rejected'].includes(order.orderStatus) && (
                          <button
                            onClick={() => onTrackOrder(order)}
                            className="bg-blue-50 hover:bg-blue-100 text-blue-700 font-extrabold text-xs px-3 py-1.5 rounded-xl cursor-pointer transition"
                          >
                            Track
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Stacked Cards */}
          <div className="md:hidden space-y-3">
            {activeOrders.map((order) => {
              const orderId = (order._id || '').slice(-6).toUpperCase();
              return (
                <div key={order._id} className="p-4 bg-slate-50/80 border border-slate-200 rounded-2xl space-y-2.5">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="font-black text-slate-900 text-xs">#{orderId}</span>
                      <span className="text-[10px] text-slate-400 block">
                        {new Date(order.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    {getStatusBadge(order.orderStatus)}
                  </div>

                  <p className="text-[11px] text-slate-600 line-clamp-2">
                    {(order.items || []).map(i => `${i.name} (x${i.quantity})`).join(', ')}
                  </p>

                  <div className="flex justify-between items-center pt-2 border-t border-slate-200">
                    <div>
                      <span className="text-[10px] text-slate-400 block font-bold">TOTAL</span>
                      <span className="font-extrabold text-emerald-600 text-sm">₹{order.finalTotal}</span>
                    </div>
                    <div className="flex gap-2">
                      {editableStatuses.includes(order.orderStatus) && (
                        <>
                          <button
                            onClick={() => cancelOrder(order)}
                            className="bg-rose-100 text-rose-700 font-extrabold text-xs px-3 py-1.5 rounded-xl cursor-pointer"
                          >
                            Cancel
                          </button>
                        </>
                      )}
                      {!['Delivered', 'Cancelled', 'Rejected'].includes(order.orderStatus) && (
                        <button
                          onClick={() => onTrackOrder(order)}
                          className="bg-blue-600 text-white font-extrabold text-xs px-4 py-1.5 rounded-xl cursor-pointer"
                        >
                          Track
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

    </div>
    <OrderHistory />
    </div>
  );
}
