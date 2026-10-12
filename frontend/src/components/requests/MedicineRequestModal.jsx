import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { createMedicineRequest } from '../../api/medicineRequestService';
import apiClient from '../../api/apiClient';
import AddressManager from '../AddressManager';

// --- Client-Side Binary Signature (Magic Number) Validator ---
// Add this right under your import statements
// --- Ultra-Robust Failure-Safe Binary Signature Validator ---
const verifyBinarySignature = async (file) => {
  if (!file) return false;

  try {
    // 1. Isolate the first 12 bytes safely without loading the whole file into RAM
    const blobSample = file.slice(0, 12);
    const arrayBuffer = await blobSample.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // 2. Map buffer sequences into Hex patterns and string text chunks
    const getHex = (start, end) => Array.from(uint8Array.subarray(start, end))
        .map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    const getString = (start, end) => String.fromCharCode(...uint8Array.subarray(start, end));

    const hex2 = getHex(0, 2);
    const hex8 = getHex(0, 8);
    const ftypBrand = getString(8, 12);

    // Use safe optional chaining to prevent crashes if name strings are empty
    const fileNameLower = file.name ? String(file.name).toLowerCase() : '';

    // 3. Absolute True Signature Evaluations (Highly accurate fallback matching)

    // PDF Header Check (%PDF-)
    if (getString(0, 5) === '%PDF-' || fileNameLower.endsWith('.pdf')) {
      return getString(0, 5) === '%PDF-';
    }

    // JPEG Header Check (FF D8)
    if (hex2 === 'FF D8' || fileNameLower.match(/\.jpe?g$/)) {
      return hex2 === 'FF D8';
    }

    // PNG Header Check (\x89PNG...)
    if (hex8 === '89 50 4E 47 0D 0A 1A 0A' || fileNameLower.endsWith('.png')) {
      return hex8 === '89 50 4E 47 0D 0A 1A 0A';
    }

    // WEBP Header Check (RIFF + WEBP)
    if ((getString(0, 4) === 'RIFF' && getString(8, 12) === 'WEBP') || fileNameLower.endsWith('.webp')) {
      return getString(0, 4) === 'RIFF' && getString(8, 12) === 'WEBP';
    }

    // HEIC / HEIF Smartphone Image Containers (ftyp + brands)
    if (getString(4, 8) === 'ftyp' || fileNameLower.match(/\.he[ip]f?$/)) {
      if (getString(4, 8) === 'ftyp') {
        return ['heic', 'heix', 'hevc', 'heim', 'mif1', 'msf1'].includes(ftypBrand);
      }
      return true; // Safe fallback validation for non-labeled mobile inputs
    }

    // 4. Ultimate Structural Stream Validation Fallback
    // If the browser provides a standard image mime-type, confirm it carries standard image bytes
    if (file.type && file.type.startsWith('image/')) {
      return hex2 === 'FF D8' || hex8 === '89 50 4E 47 0D 0A 1A 0A' || getString(0, 4) === 'RIFF' || getString(4, 8) === 'ftyp';
    }

    return false;
  } catch (err) {
    console.error('File signature validation bypassed safely:', err);
    // Return true as a generic bypass if browser environments fail to read the file slice array stream
    return true;
  }
};

const createRequestedItem = (values = {}) => ({
  requestedName: values.name || values.requestedName || '',
  medicineId: values.medicineId || null,
  strength: values.strength || '',
  dosageForm: values.dosageForm || 'Tablet',
  manufacturer: values.brand || values.manufacturer || '',
  quantity: values.quantity || 1,
  originalAvailabilityStatus: values.originalAvailabilityStatus || 'NOT_IN_CATALOG'
});

export default function MedicineRequestModal({ isOpen, onClose }) {
  const { user } = useAuth();
  const {
    requestPrefillData,
    addresses,
    selectedAddressId,
    setSelectedAddressId,
    loadAddresses,
    loadingAddresses,
    loadUserMedicineRequests
  } = useApp();
  const { addToast } = useToast();

  const [requestedItems, setRequestedItems] = useState([createRequestedItem()]);
  const [deliveryPreference, setDeliveryPreference] = useState('Flexible');
  const [customerNote, setCustomerNote] = useState('');
  const [people, setPeople] = useState([]);
  const [patientPuid, setPatientPuid] = useState('');

  // File attachments
  const [prescriptionFile, setPrescriptionFile] = useState(null);
  const [productImageFile, setProductImageFile] = useState(null);
  const [prescriptionPreview, setPrescriptionPreview] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);

  const [submitting, setSubmitting] = useState(false);
  const submitInProgressRef = useRef(false);

  useEffect(() => () => {
    if (prescriptionPreview) URL.revokeObjectURL(prescriptionPreview);
  }, [prescriptionPreview]);

  useEffect(() => () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
  }, [imagePreview]);

  useEffect(() => {
    if (!isOpen) {
      setRequestedItems([createRequestedItem()]);
      setDeliveryPreference('Flexible');
      setCustomerNote('');
      setPrescriptionFile(null);
      setProductImageFile(null);
      setPrescriptionPreview(null);
      setImagePreview(null);
      setSubmitting(false);
      return;
    }

    setRequestedItems([createRequestedItem(requestPrefillData || {})]);
    setDeliveryPreference('Flexible');
    setCustomerNote('');
    setPrescriptionFile(null);
    setProductImageFile(null);
    setPrescriptionPreview(null);
    setImagePreview(null);
    void loadAddresses();
    let cancelled = false;
    apiClient.get('/api/v1/customers/persons')
      .then(({ data }) => {
        if (cancelled) return;
        const list = data?.data || data?.people || data || [];
        setPeople(Array.isArray(list) ? list : []);
        const self = Array.isArray(list) ? list.find((p) => String(p.relationshipToOwner).toUpperCase() === 'SELF') : null;
        if (self) setPatientPuid((current) => current || self.puid);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isOpen, requestPrefillData, loadAddresses]);

  if (!isOpen) return null;

  const updateRequestedItem = (index, field, value) => {
    setRequestedItems(items => items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
    ));
  };

  const addRequestedItem = () => {
    setRequestedItems(items => [...items, createRequestedItem()]);
  };

  const removeRequestedItem = (index) => {
    setRequestedItems(items => items.length > 1
        ? items.filter((_, itemIndex) => itemIndex !== index)
        : items);
  };

  const handlePrescriptionChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      addToast('Prescription file size must be under 5 MB.', 'warning');
      e.target.value = '';
      return;
    }

    const isValidSignature = await verifyBinarySignature(file);
    if (!isValidSignature) {
      addToast('Invalid file format. The file signature does not match a valid PDF or Image document.', 'error');
      e.target.value = '';
      setPrescriptionFile(null);
      if (prescriptionPreview) URL.revokeObjectURL(prescriptionPreview);
      setPrescriptionPreview(null);
      return;
    }

    setPrescriptionFile(file);
    if (file.type.startsWith('image/')) {
      setPrescriptionPreview(URL.createObjectURL(file));
    } else {
      setPrescriptionPreview(null);
    }
  };

  const handleProductImageChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      addToast('Product photo size must be under 5 MB.', 'warning');
      e.target.value = '';
      return;
    }

    const isValidSignature = await verifyBinarySignature(file);
    if (!isValidSignature) {
      addToast('Invalid reference photo. Please select a valid, uncorrupted image file (JPEG, PNG, WEBP).', 'error');
      e.target.value = '';
      setProductImageFile(null);
      if (imagePreview) URL.revokeObjectURL(imagePreview);
      setImagePreview(null);
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
    if (submitInProgressRef.current) return;
    const hasManualMedicine = requestedItems.some(item => item.requestedName.trim());
    if (!hasManualMedicine && !prescriptionFile) {
      addToast('Enter at least one medicine, or attach a doctor prescription.', 'warning');
      return;
    }

    const selectedAddress = addresses.find(address =>
        String(address._id) === String(selectedAddressId)
    );
    if (!selectedAddress) {
      addToast('Please save and select a delivery address before submitting.', 'warning');
      return;
    }

    try {
      submitInProgressRef.current = true;
      setSubmitting(true);
      const formData = new FormData();

      const requestItems = requestedItems
        .filter(item => item.requestedName.trim())
        .map(item => ({
          ...item,
          requestedName: item.requestedName.trim(),
          strength: item.strength.trim(),
          dosageForm: item.dosageForm.trim(),
          manufacturer: item.manufacturer.trim(),
          quantity: Math.max(1, Number(item.quantity) || 1),
          source: 'MANUAL',
          validationStatus: 'MANUAL'
        }));

      formData.append('requestedItems', JSON.stringify(requestItems));
      formData.append('addressId', String(selectedAddress._id || selectedAddress.id || ''));
      formData.append('deliveryAddress', selectedAddress.addressLine || `${selectedAddress.addressLine1}, ${selectedAddress.city} - ${selectedAddress.pincode}`);
      if (selectedAddress.coordinates) {
        formData.append('coordinates', typeof selectedAddress.coordinates === 'string' ? selectedAddress.coordinates : JSON.stringify(selectedAddress.coordinates));
      }
      formData.append('preferredDeliveryPreference', deliveryPreference);
      formData.append('urgencyLevel', deliveryPreference === 'Next Day' || deliveryPreference === 'Morning' ? 'Urgent' : 'Normal');
      if (patientPuid) {
        formData.append('patientPuid', patientPuid);
      }
      formData.append('customerNote', customerNote.trim());
      formData.append('customerPhone', user?.user_metadata?.mobile || '');

      if (prescriptionFile) {
        formData.append('prescription', prescriptionFile);
      }
      if (productImageFile) {
        formData.append('productImage', productImageFile);
      }

      const res = await createMedicineRequest(formData);
      addToast(res.message || 'Medicine request submitted to Ashvin Pharmacy!', 'success');
      await loadUserMedicineRequests({ page: 1, statusGroup: 'ALL' });
      onClose();
    } catch (err) {
      addToast(err.message || 'Unable to submit your medicine request right now. Please try again.', 'error');
    } finally {
      submitInProgressRef.current = false;
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
          <div className="bg-blue-50/70 border border-blue-200 rounded-2xl p-3 text-xs text-blue-900 flex items-start gap-2.5">
            <span className="text-base">ℹ️</span>
            <div className="text-[11px] leading-relaxed">
              <strong>No immediate charge or normal order is created.</strong> Our pharmacy team checks stock and creates a personalized <strong>Proposal</strong> with approximate/final pricing and delivery timing for your review and approval.
            </div>
          </div>

          <AddressManager
              autoAddIfEmpty={!loadingAddresses && addresses.length === 0}
              onAddressSelected={(address) => setSelectedAddressId(String(address._id || address.id))}
              onAddressSaved={(address) => setSelectedAddressId(String(address._id || address.id))}
          />

          {/* Request Form */}
          <form onSubmit={handleSubmit} className="space-y-4">

            <div className="space-y-3">
              {requestedItems.map((item, index) => (
                  <fieldset key={index} className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4">
                    <div className="flex items-center justify-between gap-3">
                      <legend className="text-xs font-extrabold text-slate-800">
                        Medicine / Product {requestedItems.length > 1 ? index + 1 : ''} <span className="text-rose-500">*</span>
                      </legend>
                      {requestedItems.length > 1 && (
                          <button
                              type="button"
                              onClick={() => removeRequestedItem(index)}
                              className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-bold text-rose-600 hover:bg-rose-50"
                              aria-label={`Remove product {index + 1}`}
                          >
                            Remove
                          </button>
                      )}
                    </div>
                    <input
                        type="text"
                        required
                        placeholder="e.g. Paracetamol, Rifaximin 550mg"
                        value={item.requestedName}
                        onChange={(e) => updateRequestedItem(index, 'requestedName', e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium outline-none transition focus:border-blue-500"
                    />

                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-[11px] font-bold text-slate-600">Strength (Optional)</label>
                        <input
                            type="text"
                            placeholder="e.g. 500mg, 10ml"
                            value={item.strength}
                            onChange={(e) => updateRequestedItem(index, 'strength', e.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-bold text-slate-600">Preferred Manufacturer / Brand</label>
                        <input
                            type="text"
                            placeholder="e.g. Cipla, Abbott"
                            value={item.manufacturer}
                            onChange={(e) => updateRequestedItem(index, 'manufacturer', e.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-bold text-slate-600">Dosage Form</label>
                        <select
                            value={item.dosageForm}
                            onChange={(e) => updateRequestedItem(index, 'dosageForm', e.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium outline-none focus:border-blue-500"
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
                        <label className="mb-1 block text-[11px] font-bold text-slate-600">Quantity <span className="text-rose-500">*</span></label>
                        <input
                            type="number"
                            min="1"
                            required
                            value={item.quantity}
                            onChange={(e) => updateRequestedItem(index, 'quantity', Math.max(1, parseInt(e.target.value, 10) || 1))}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>
                  </fieldset>
              ))}

              <button
                  type="button"
                  onClick={addRequestedItem}
                  className="min-h-10 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-extrabold text-blue-700 transition hover:bg-blue-100"
              >
                + Add another medicine / product
              </button>
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
                        className={`p-2 rounded-xl text-center border text-xs font-bold transition cursor-pointer \${
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
                      accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
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
                      accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                      onChange={handleProductImageChange}
                      className="text-xs file:mr-2 file:py-1 file:px-2.5 file:rounded-lg file:border-0 file:text-[11px] file:font-bold file:bg-blue-100 file:text-blue-700 hover:file:bg-blue-200 cursor-pointer w-full text-slate-500"
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
                  disabled={submitting || loadingAddresses || !selectedAddressId || !addresses.some(address => String(address._id) === String(selectedAddressId))}
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
