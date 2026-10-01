import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { createMedicineRequest } from '../../api/medicineRequestService';

export default function MedicineRequestModal({ isOpen, onClose }) {
  const { user } = useAuth();
  const {
    requestPrefillData,
    addresses,
    selectedAddressId,
    loadUserMedicineRequests
  } = useApp();
  const { addToast } = useToast();

  const [medicineName, setMedicineName] = useState('');
  const [strength, setStrength] = useState('');
  const [dosageForm, setDosageForm] = useState('Tablet');
  const [manufacturer, setManufacturer] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [deliveryPreference, setDeliveryPreference] = useState('Flexible');
  const [customerNote, setCustomerNote] = useState('');

  // Address
  const [chosenAddressId, setChosenAddressId] = useState('');
  const [customAddress, setCustomAddress] = useState('');

  // File attachments
  const [prescriptionFile, setPrescriptionFile] = useState(null);
  const [productImageFile, setProductImageFile] = useState(null);
  const [prescriptionPreview, setPrescriptionPreview] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);

  const [submitting, setSubmitting] = useState(false);

  useEffect(() => () => {
    if (prescriptionPreview) URL.revokeObjectURL(prescriptionPreview);
  }, [prescriptionPreview]);

  useEffect(() => () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
  }, [imagePreview]);

  useEffect(() => {
    if (!isOpen) {
      setMedicineName('');
      setStrength('');
      setDosageForm('Tablet');
      setManufacturer('');
      setQuantity(1);
      setDeliveryPreference('Flexible');
      setCustomerNote('');
      setChosenAddressId('');
      setCustomAddress('');
      setPrescriptionFile(null);
      setProductImageFile(null);
      setPrescriptionPreview(null);
      setImagePreview(null);
      setSubmitting(false);
      return;
    }

    if (requestPrefillData) {
      setMedicineName(requestPrefillData.name || requestPrefillData.requestedName || '');
      setStrength(requestPrefillData.strength || '');
      setDosageForm(requestPrefillData.dosageForm || 'Tablet');
      setManufacturer(requestPrefillData.brand || requestPrefillData.manufacturer || '');
      setQuantity(requestPrefillData.quantity || 1);
    } else {
      setMedicineName('');
      setStrength('');
      setDosageForm('Tablet');
      setManufacturer('');
      setQuantity(1);
    }
    setDeliveryPreference('Flexible');
    setCustomerNote('');
    setPrescriptionFile(null);
    setProductImageFile(null);
    setPrescriptionPreview(null);
    setImagePreview(null);
    setChosenAddressId('');
    setCustomAddress('');
  }, [isOpen, requestPrefillData]);

  useEffect(() => {
    if (!isOpen || chosenAddressId || !addresses?.length) return;
    const defaultAddr = addresses.find(a => a.isDefault) || addresses[0];
    setChosenAddressId(defaultAddr._id);
  }, [isOpen, addresses, chosenAddressId]);

  if (!isOpen) return null;

  const handlePrescriptionChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      addToast('Prescription file size must be under 5 MB.', 'warning');
      return;
    }
    setPrescriptionFile(file);
    if (file.type.startsWith('image/')) {
      setPrescriptionPreview(URL.createObjectURL(file));
    } else {
      setPrescriptionPreview(null);
    }
  };

  const handleProductImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      addToast('Product photo size must be under 5 MB.', 'warning');
      return;
    }
    setProductImageFile(file);
    if (file.type.startsWith('image/')) {
      setImagePreview(URL.createObjectURL(file));
    } else {
      setImagePreview(null);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!medicineName.trim()) {
      addToast('Please enter the medicine name.', 'warning');
      return;
    }

    let deliveryAddress = '';
    let addressDetails = {};
    let coordinates = null;

    if (chosenAddressId && chosenAddressId !== 'custom') {
      const selected = addresses.find(a => String(a._id) === String(chosenAddressId));
      if (selected) {
        deliveryAddress = selected.addressLine || `${selected.addressLine1}, ${selected.city} - ${selected.pincode}`;
        addressDetails = {
          fullName: selected.fullName,
          mobile: selected.mobile,
          addressLine1: selected.addressLine1,
          city: selected.city,
          state: selected.state,
          pincode: selected.pincode
        };
        coordinates = selected.coordinates;
      }
    } else {
      deliveryAddress = customAddress.trim();
    }

    if (!deliveryAddress) {
      addToast('Please specify a delivery address for this request.', 'warning');
      return;
    }

    try {
      setSubmitting(true);
      const formData = new FormData();

      const requestedItems = [
        {
          requestedName: medicineName.trim(),
          medicineId: requestPrefillData?.medicineId || null,
          strength: strength.trim(),
          dosageForm: dosageForm.trim(),
          manufacturer: manufacturer.trim(),
          quantity: Math.max(1, Number(quantity) || 1),
          originalAvailabilityStatus: requestPrefillData?.originalAvailabilityStatus || 'NOT_IN_CATALOG'
        }
      ];

      formData.append('requestedItems', JSON.stringify(requestedItems));
      formData.append('deliveryAddress', deliveryAddress);
      formData.append('preferredDeliveryPreference', deliveryPreference);
      formData.append('customerNote', customerNote.trim());
      formData.append('customerPhone', user?.user_metadata?.mobile || '');

      if (Object.keys(addressDetails).length > 0) {
        formData.append('addressDetails', JSON.stringify(addressDetails));
      }
      if (coordinates) {
        formData.append('coordinates', JSON.stringify(coordinates));
      }

      if (prescriptionFile) {
        formData.append('prescription', prescriptionFile);
      }
      if (productImageFile) {
        formData.append('productImage', productImageFile);
      }

      const res = await createMedicineRequest(formData);
      addToast(res.message || 'Medicine request submitted to Ashvin Pharmacy!', 'success');
      await loadUserMedicineRequests();
      onClose();
    } catch (err) {
      addToast(err.response?.data?.message || err.message || 'Failed to submit request.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-3xl max-w-xl w-full p-5 sm:p-7 shadow-2xl space-y-5 animate-fade-in max-h-[92vh] overflow-y-auto border border-slate-100">
        
        {/* Modal Header */}
        <div className="flex items-start justify-between border-b border-slate-100 pb-3">
          <div>
            <span className="text-[10px] font-black uppercase tracking-wider text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full inline-block mb-1">
              Dispensary Procurement Request
            </span>
            <h3 className="text-base sm:text-lg font-black text-slate-900">
              Request Medicine from Ashvin Pharmacy
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Can't find a medicine or currently out of stock? Our pharmacists will arrange it from licensed distributors.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-lg font-bold p-1 rounded-full hover:bg-slate-100 transition cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Notice Banner */}
        <div className="bg-indigo-50/70 border border-indigo-200 rounded-2xl p-3 text-xs text-indigo-900 flex items-start gap-2.5">
          <span className="text-base">ℹ️</span>
          <div className="text-[11px] leading-relaxed">
            <strong>No immediate charge or normal order is created.</strong> Our pharmacy team checks stock and creates a personalized <strong>Proposal</strong> with approximate/final pricing and delivery timing for your review and approval.
          </div>
        </div>

        {/* Request Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          
          {/* Medicine Name (Required) */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Medicine / Product Name <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Paracetamol, Rifaximin 550mg, Augmentin 625 Duo"
              value={medicineName}
              onChange={(e) => setMedicineName(e.target.value)}
              className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-blue-500 outline-none transition font-medium"
            />
          </div>

          {/* Strength, Dosage Form, Manufacturer Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">
                Strength (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. 500mg, 10ml"
                value={strength}
                onChange={(e) => setStrength(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">
                Dosage Form
              </label>
              <select
                value={dosageForm}
                onChange={(e) => setDosageForm(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-blue-500 outline-none font-medium"
              >
                <option value="Tablet">Tablet / Strip</option>
                <option value="Capsule">Capsule</option>
                <option value="Syrup">Syrup / Suspension</option>
                <option value="Ointment">Cream / Ointment</option>
                <option value="Injection">Injection / Vial</option>
                <option value="Drops">Eye / Ear Drops</option>
                <option value="Inhaler">Inhaler / Respule</option>
                <option value="Other">Other Medical Product</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">
                Quantity <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                min="1"
                required
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-blue-500 outline-none font-bold"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">
              Preferred Manufacturer / Brand (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. Cipla, Sun Pharma, Abbott, GlaxoSmithKline"
              value={manufacturer}
              onChange={(e) => setManufacturer(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-blue-500 outline-none"
            />
          </div>

          {/* Delivery Timing Preference */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Preferred Delivery Timing
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { id: 'Flexible', label: 'Flexible', sub: 'Any Slot' },
                { id: 'Morning', label: 'Morning', sub: '9 AM - 1 PM' },
                { id: 'Evening', label: 'Evening', sub: '4 PM - 9 PM' },
                { id: 'Next Day', label: 'Next Day', sub: '10 AM - 6 PM' }
              ].map(opt => (
                <button
                  type="button"
                  key={opt.id}
                  onClick={() => setDeliveryPreference(opt.id)}
                  className={`p-2 rounded-xl text-center border text-xs font-bold transition cursor-pointer ${
                    deliveryPreference === opt.id
                      ? 'border-blue-600 bg-blue-50 text-blue-800'
                      : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600'
                  }`}
                >
                  <span className="block text-[11px]">{opt.label}</span>
                  <span className="block text-[9px] text-slate-400 font-medium">{opt.sub}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Delivery Address Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Delivery Address <span className="text-rose-500">*</span>
            </label>
            {addresses && addresses.length > 0 ? (
              <div className="space-y-2">
                <select
                  value={chosenAddressId}
                  onChange={(e) => setChosenAddressId(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-blue-500 outline-none font-medium"
                >
                  {addresses.map(a => (
                    <option key={a._id} value={a._id}>
                      {a.label ? `[${a.label}] ` : ''}{a.addressLine || a.addressLine1}, {a.city} - {a.pincode}
                    </option>
                  ))}
                  <option value="custom">Enter a different address manually</option>
                </select>

                {chosenAddressId === 'custom' && (
                  <textarea
                    rows={2}
                    placeholder="Enter complete street address, apartment, pincode..."
                    value={customAddress}
                    onChange={(e) => setCustomAddress(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-blue-500 outline-none"
                  />
                )}
              </div>
            ) : (
              <textarea
                required
                rows={2}
                placeholder="Enter complete street address, house/flat no., city, pincode..."
                value={customAddress}
                onChange={(e) => setCustomAddress(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-blue-500 outline-none"
              />
            )}
          </div>

          {/* Customer Note */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">
              Special Instructions / Notes (Optional)
            </label>
            <textarea
              rows={2}
              placeholder="e.g. Prescribed after clinic visit, please check if 30-tablet pack is available..."
              value={customerNote}
              onChange={(e) => setCustomerNote(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-blue-500 outline-none"
            />
          </div>

          {/* Attachments Section: Prescription and Product Photo */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 sm:p-4 space-y-3">
            <span className="text-[11px] font-black uppercase tracking-wider text-slate-500 block">
              Attachments (Optional & Secure)
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Doctor Prescription */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  📄 Doctor Prescription
                </label>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  onChange={handlePrescriptionChange}
                  className="text-xs file:mr-2 file:py-1 file:px-2.5 file:rounded-lg file:border-0 file:text-[11px] file:font-bold file:bg-blue-100 file:text-blue-700 hover:file:bg-blue-200 cursor-pointer w-full text-slate-500"
                />
                {prescriptionPreview && (
                  <div className="mt-2 w-16 h-16 rounded-lg overflow-hidden border border-slate-200">
                    <img src={prescriptionPreview} alt="Prescription Preview" className="w-full h-full object-cover" />
                  </div>
                )}
                {prescriptionFile && !prescriptionPreview && (
                  <p className="text-[10px] text-emerald-700 mt-1 font-bold">
                    ✓ {prescriptionFile.name}
                  </p>
                )}
              </div>

              {/* Product Reference Photo */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  📷 Product / Strip Photo
                </label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleProductImageChange}
                  className="text-xs file:mr-2 file:py-1 file:px-2.5 file:rounded-lg file:border-0 file:text-[11px] file:font-bold file:bg-indigo-100 file:text-indigo-700 hover:file:bg-indigo-200 cursor-pointer w-full text-slate-500"
                />
                {imagePreview && (
                  <div className="mt-2 w-16 h-16 rounded-lg overflow-hidden border border-slate-200">
                    <img src={imagePreview} alt="Product Photo Preview" className="w-full h-full object-cover" />
                  </div>
                )}
                {productImageFile && (
                  <p className="text-[10px] text-emerald-700 mt-1 font-bold">
                    ✓ {productImageFile.name}
                  </p>
                )}
              </div>
            </div>
            <p className="text-[10px] text-slate-400">
              Attached files are securely encrypted and accessible only to registered pharmacists and your account.
            </p>
          </div>

          {/* Form Actions */}
          <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs rounded-xl shadow-md transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  <span>Submitting Request...</span>
                </>
              ) : (
                <>
                  <span>📋</span>
                  <span>Submit Medicine Request</span>
                </>
              )}
            </button>
          </div>

        </form>

      </div>
    </div>
  );
}
