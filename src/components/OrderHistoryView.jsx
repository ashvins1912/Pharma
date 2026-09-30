import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import apiClient from '../api/apiClient';
import { useToast } from '../context/ToastContext';

export default function OrderHistoryView({ onTrackOrder }) {
  const { orders, medicines, loadingOrders, loadUserOrders } = useApp();
  const { addToast } = useToast();
  const [editingOrder, setEditingOrder] = useState(null);
  const [draftItems, setDraftItems] = useState([]);
  const [medicineSearches, setMedicineSearches] = useState({});
  const [activeMedicineSearch, setActiveMedicineSearch] = useState(null);
  const [prescriptionFile, setPrescriptionFile] = useState(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const editableStatuses = ['Pending_Review', 'Approved', 'Processing Order', 'Ready to Dispatch'];
  const editorMedicines = editingOrder
    ? [...medicines, ...(editingOrder.medicineItems || editingOrder.items || []).map(item => ({
      _id: String(item.medicineId?._id || item.medicineId || item._id || ''),
      name: item.name,
      price: item.price,
      isPrescriptionRequired: item.isPrescriptionRequired
    }))].filter((medicine, index, all) => medicine._id && all.findIndex(entry => entry._id === medicine._id) === index)
    : medicines;

  const startEditing = (order) => {
    const initialItems = (order.medicineItems || []).map(item => ({
      medicineId: String(item.medicineId?._id || item.medicineId),
      quantity: item.quantity
    }));
    setEditingOrder(order);
    setDraftItems(initialItems.length ? initialItems : [{ medicineId: '', quantity: 1 }]);
    setMedicineSearches({});
    setActiveMedicineSearch(null);
    setPrescriptionFile(null);
  };

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

  const saveOrderChanges = async (event) => {
    event.preventDefault();
    if (!editingOrder || savingOrder) return;
    if (draftItems.some(item => !item.medicineId || !Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1)) {
      addToast('Choose a medicine and enter a positive whole-number quantity for each item.', 'warning');
      return;
    }
    const selectedRequiresPrescription = draftItems.some(item => {
      const medicine = editorMedicines.find(entry => String(entry._id) === item.medicineId);
      return Boolean(medicine?.isPrescriptionRequired ?? medicine?.requiresPrescription);
    });
    if (selectedRequiresPrescription && !editingOrder.prescriptionUrl && !prescriptionFile) {
      addToast('A prescription is required for the selected medicines.', 'warning');
      return;
    }

    const formData = new FormData();
    formData.append('items', JSON.stringify(draftItems));
    if (editingOrder.prescriptionUrl) formData.append('previousPrescriptionUrl', editingOrder.prescriptionUrl);
    if (prescriptionFile) formData.append('prescription', prescriptionFile);
    setSavingOrder(true);
    try {
      const response = await apiClient.put(`/api/orders/${editingOrder._id}/modify`, formData);
      addToast(response.data?.message || 'Order updated and sent for pharmacist review.', 'success');
      setEditingOrder(null);
      setMedicineSearches({});
      setActiveMedicineSearch(null);
      await loadUserOrders();
    } catch (error) {
      addToast(error.message || 'Could not update this order.', 'error');
    } finally {
      setSavingOrder(false);
    }
  };

  const updateDraftItem = (index, field, value) => {
    setDraftItems(current => current.map((item, itemIndex) => (
      itemIndex === index ? { ...item, [field]: value } : item
    )));
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
    <div className="bg-white border border-slate-200 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-extrabold text-slate-900">📦 Order History</h3>
          <p className="text-xs text-slate-500">Track current and past prescription orders.</p>
        </div>
        <button
          onClick={loadUserOrders}
          disabled={loadingOrders}
          className="text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-xl cursor-pointer transition"
        >
          {loadingOrders ? 'Refreshing...' : '🔄 Refresh'}
        </button>
      </div>

      {orders.length === 0 ? (
        <div className="py-16 text-center text-slate-400 space-y-2">
          <p className="text-3xl">📋</p>
          <p className="text-xs font-bold text-slate-700">No orders placed yet</p>
          <p className="text-[11px] text-slate-400">Your orders and tracking status will appear here once placed.</p>
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
                {orders.map((order) => {
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
                        {editableStatuses.includes(order.orderStatus) && order.medicineItems?.length > 0 && (
                          <>
                            <button
                              onClick={() => startEditing(order)}
                              className="mr-2 bg-amber-50 hover:bg-amber-100 text-amber-800 font-extrabold text-xs px-3 py-1.5 rounded-xl cursor-pointer transition"
                            >
                              Edit
                            </button>
                          </>
                        )}
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
            {orders.map((order) => {
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
                          {order.medicineItems?.length > 0 && (
                            <button
                              onClick={() => startEditing(order)}
                              className="bg-amber-100 text-amber-800 font-extrabold text-xs px-3 py-1.5 rounded-xl cursor-pointer"
                            >
                              Edit
                            </button>
                          )}
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

      {editingOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="edit-order-title">
          <form onSubmit={saveOrderChanges} className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl sm:p-7 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="edit-order-title" className="text-lg font-black text-slate-900">Edit order</h3>
                <p className="mt-1 text-xs text-slate-500">Changes reserve stock again and send the order back for pharmacist review.</p>
              </div>
              <button type="button" onClick={() => setEditingOrder(null)} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="Close">✕</button>
            </div>

            <div className="space-y-3">
              {draftItems.map((item, index) => (
                <div key={index} className="flex flex-col gap-2 sm:flex-row">
                  <div className="relative min-w-0 flex-1">
                    <input
                      type="search"
                      value={Object.hasOwn(medicineSearches, index)
                        ? medicineSearches[index]
                        : editorMedicines.find(medicine => String(medicine._id) === item.medicineId)?.name || ''}
                      onFocus={event => {
                        if (!Object.hasOwn(medicineSearches, index)) event.currentTarget.select();
                        setActiveMedicineSearch(index);
                      }}
                      onChange={event => {
                        setMedicineSearches(current => ({ ...current, [index]: event.target.value }));
                        updateDraftItem(index, 'medicineId', '');
                        setActiveMedicineSearch(index);
                      }}
                      onBlur={() => setActiveMedicineSearch(current => current === index ? null : current)}
                      onKeyDown={event => {
                        if (event.key === 'Escape') setActiveMedicineSearch(null);
                      }}
                      placeholder="Enter at least 2 characters to search medicines"
                      autoComplete="off"
                      aria-label="Search medicines"
                      aria-autocomplete="list"
                      aria-expanded={
                        activeMedicineSearch === index &&
                        (medicineSearches[index] || '').trim().length >= 2
                      }
                      required={!item.medicineId}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                    />
                    {activeMedicineSearch === index && (medicineSearches[index] || '').trim().length >= 2 && (
                      <ul
                        role="listbox"
                        className="absolute left-0 right-0 top-full z-10 mt-1 max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
                      >
                        {editorMedicines
                          .filter(medicine => medicine.name.toLowerCase().includes(medicineSearches[index].trim().toLowerCase()))
                          .slice(0, 10)
                          .map(medicine => (
                            <li key={medicine._id} role="option" aria-selected={item.medicineId === String(medicine._id)}>
                              <button
                                type="button"
                                onMouseDown={event => event.preventDefault()}
                                onClick={() => {
                                  updateDraftItem(index, 'medicineId', String(medicine._id));
                                  setMedicineSearches(current => {
                                    const next = { ...current };
                                    delete next[index];
                                    return next;
                                  });
                                  setActiveMedicineSearch(null);
                                }}
                                className="w-full px-3 py-2 text-left text-sm hover:bg-blue-50"
                              >
                                {medicine.name} — ₹{medicine.price}
                              </button>
                            </li>
                          ))}
                        {!editorMedicines.some(medicine =>
                          medicine.name.toLowerCase().includes(medicineSearches[index].trim().toLowerCase())
                        ) && (
                          <li className="px-3 py-2 text-sm text-slate-500">No medicines found.</li>
                        )}
                      </ul>
                    )}
                  </div>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={item.quantity}
                    onChange={event => updateDraftItem(index, 'quantity', event.target.value)}
                    required
                    aria-label="Quantity"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm sm:w-24"
                  />
                  <button type="button" onClick={() => setDraftItems(current => current.filter((_, itemIndex) => itemIndex !== index))} className="rounded-xl px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50">Remove</button>
                </div>
              ))}
              <button type="button" onClick={() => setDraftItems(current => [...current, { medicineId: '', quantity: 1 }])} className="text-xs font-extrabold text-blue-700 hover:text-blue-900">+ Add medicine</button>
            </div>

            {(editingOrder.prescriptionRequired || draftItems.some(item => {
              const medicine = editorMedicines.find(entry => String(entry._id) === item.medicineId);
              return Boolean(medicine?.isPrescriptionRequired ?? medicine?.requiresPrescription);
            })) && (
              <label className="block rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
                Prescription required. Upload a clear image or PDF to replace the current file.
                <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={event => setPrescriptionFile(event.target.files?.[0] || null)} className="mt-2 block w-full text-xs" />
                {editingOrder.prescriptionUrl && !prescriptionFile && <span className="mt-1 block text-emerald-700">Current prescription will be kept.</span>}
              </label>
            )}

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button type="button" onClick={() => setEditingOrder(null)} className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-extrabold text-slate-700">Keep current order</button>
              <button type="submit" disabled={savingOrder} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-extrabold text-white disabled:opacity-50">{savingOrder ? 'Saving...' : 'Save changes'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
