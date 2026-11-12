import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useTenant } from '../../context/TenantContext';
import { createMedicineRequest } from '../../api/medicineRequestService';
import apiClient from '../../api/apiClient';
import AddressManager from '../AddressManager';
import ContextualHelpBanner from '../common/ContextualHelpBanner';
import { compressImageFile } from '../../utils/imageCompressor';
import { fetchMedicineCatalog } from '../../api/medicineCatalogService';
import { scanMedicineProductLabel, uploadAndReadPrescription } from '../../api/medicineScanService';
import { extractMedicineLabelDetails, isValidGtin, rankScannedMedicineCandidates } from '../../utils/medicineScanMatching';

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
  originalAvailabilityStatus: values.originalAvailabilityStatus || 'NOT_IN_CATALOG',
  dose: values.dose || '',
  frequency: values.frequency || '',
  duration: values.duration || '',
  instructions: values.instructions || '',
  source: values.source || 'MANUAL',
  validationStatus: values.validationStatus || 'MANUAL',
  confidence: Number(values.confidence) || 0,
  requiresReview: Boolean(values.requiresReview)
});

export default function MedicineRequestModal({ isOpen, onClose }) {
  const { user } = useAuth();
  const { tenantId, activeTenant } = useTenant();
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
  const [prescriptionId, setPrescriptionId] = useState('');
  const [prescriptionScanLoading, setPrescriptionScanLoading] = useState(false);
  const [prescriptionScanStatus, setPrescriptionScanStatus] = useState('');
  const [productScanLoading, setProductScanLoading] = useState(false);
  const [productScanText, setProductScanText] = useState('');
  const [productScanMessage, setProductScanMessage] = useState('');
  const [productScanCandidates, setProductScanCandidates] = useState([]);
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
      setPrescriptionId('');
      setPrescriptionScanLoading(false);
      setPrescriptionScanStatus('');
      setProductScanLoading(false);
      setProductScanText('');
      setProductScanMessage('');
      setProductScanCandidates([]);
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
    setPrescriptionId('');
    setPrescriptionScanStatus('');
    setProductScanText('');
    setProductScanMessage('');
    setProductScanCandidates([]);
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
    let file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 15 * 1024 * 1024) {
      addToast('Prescription file size must be under 15 MB.', 'warning');
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

    if (file.type.startsWith('image/')) {
      try {
        const compressed = await compressImageFile(file, { maxWidth: 1600, maxHeight: 1600, quality: 0.8 });
        file = compressed.file;
      } catch (err) {
        console.warn('[MedicineRequest] Compression notice:', err);
      }
    }

    setPrescriptionFile(file);
    setPrescriptionId('');
    setPrescriptionScanStatus('');
    if (file.type.startsWith('image/')) {
      setPrescriptionPreview(URL.createObjectURL(file));
    } else {
      setPrescriptionPreview(null);
    }
  };

  const handleProductImageChange = async (e) => {
    let file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 15 * 1024 * 1024) {
      addToast('Product photo size must be under 15 MB.', 'warning');
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

    if (file.type.startsWith('image/')) {
      try {
        const compressed = await compressImageFile(file, { maxWidth: 1600, maxHeight: 1600, quality: 0.8 });
        file = compressed.file;
      } catch (err) {
        console.warn('[MedicineRequest] Compression notice:', err);
      }
    }

    setProductImageFile(file);
    setProductScanText('');
    setProductScanMessage('');
    setProductScanCandidates([]);
    if (file.type.startsWith('image/')) {
      setImagePreview(URL.createObjectURL(file));
    } else {
      setImagePreview(null);
    }
  };

  const handleReadPrescription = async () => {
    if (!prescriptionFile || prescriptionScanLoading) return;
    setPrescriptionScanLoading(true);
    setPrescriptionScanStatus('Uploading securely and reading prescription…');
    try {
      const result = await uploadAndReadPrescription(prescriptionFile, {
        patientPuid,
        onStatus: status => setPrescriptionScanStatus(
          status.status === 'PROCESSING' || status.status === 'QUEUED'
            ? 'Reading prescription…'
            : 'Prescription status: ' + String(status.status || 'Uploaded').replace(/_/g, ' ')
        )
      });
      setPrescriptionId(result.prescriptionId);
      const medicines = Array.isArray(result.medicines) ? result.medicines : [];
      if (medicines.length) {
        const extractedItems = medicines.map(medicine => {
          const strength = medicine.strength && typeof medicine.strength === 'object'
            ? [medicine.strength.value, medicine.strength.unit].filter(Boolean).join(' ')
            : medicine.strength || '';
          const dose = medicine.dose && typeof medicine.dose === 'object'
            ? [medicine.dose.value, medicine.dose.unit].filter(Boolean).join(' ')
            : medicine.dose || '';
          const duration = medicine.duration && typeof medicine.duration === 'object'
            ? [medicine.duration.value, medicine.duration.unit].filter(Boolean).join(' ')
            : medicine.duration || '';
          const instructions = medicine.instructions?.value || medicine.instructions || '';
          return createRequestedItem({
            name: medicine.normalizedName || medicine.rawName || '',
            strength,
            dosageForm: /\b(capsule|cap)\b/i.test(medicine.rawName || '') ? 'Capsule'
              : /\b(syrup|suspension)\b/i.test(medicine.rawName || '') ? 'Syrup'
                : /\b(injection|vial)\b/i.test(medicine.rawName || '') ? 'Injection' : 'Other',
            quantity: medicine.course?.calculatedQuantity || 1,
            dose,
            frequency: medicine.frequency?.raw || medicine.frequency?.normalized || '',
            duration,
            instructions: String(instructions || ''),
            source: 'PRESCRIPTION_OCR',
            validationStatus: 'OCR_REVIEW',
            confidence: Number(medicine.confidence) || 0,
            requiresReview: true
          });
        }).filter(item => item.requestedName);
        if (extractedItems.length) {
          setRequestedItems(current => current.length === 1 && !current[0].requestedName.trim()
            ? extractedItems
            : [...current, ...extractedItems]);
        }
        setPrescriptionScanStatus('Read ' + extractedItems.length + ' medicine line(s). Please verify every field.');
      } else {
        setPrescriptionScanStatus(
          'Prescription saved for pharmacist review. No reliable medicine lines were extracted; enter the medicines manually.'
        );
      }
      if (result.quality?.requiresReview || String(result.status).toUpperCase() === 'REVIEW_REQUIRED') {
        addToast('Prescription needs pharmacist verification. Please check the extracted details.', 'warning');
      } else {
        addToast('Prescription scan completed. Review the extracted medicine details before submitting.', 'success');
      }
    } catch (error) {
      setPrescriptionScanStatus(error?.response?.data?.detail?.message || error.message || 'Prescription scan failed. You can still attach it for pharmacist review.');
      addToast(error?.response?.data?.detail?.message || error.message || 'Could not read this prescription.', 'error');
    } finally {
      setPrescriptionScanLoading(false);
    }
  };

  const handleScanProductLabel = async () => {
    if (!productImageFile || productScanLoading) return;
    if (!tenantId) {
      addToast('Select a pharmacy before searching its medicine catalogue.', 'warning');
      return;
    }
    setProductScanLoading(true);
    setProductScanMessage('Reading the product label…');
    setProductScanCandidates([]);
    try {
      const ocr = await scanMedicineProductLabel(productImageFile);
      const extracted = extractMedicineLabelDetails(ocr.text);
      let barcode = null;
      if (typeof window !== 'undefined' && 'BarcodeDetector' in window && typeof createImageBitmap === 'function') {
        try {
          const supported = await window.BarcodeDetector.getSupportedFormats();
          const formats = ['ean_13', 'ean_8', 'upc_a'].filter(format => supported.includes(format));
          if (formats.length) {
            const bitmap = await createImageBitmap(productImageFile);
            try {
              const detected = await new window.BarcodeDetector({ formats }).detect(bitmap);
              const valid = [...new Set(detected.map(item => String(item.rawValue || '').replace(/\D/g, '')).filter(isValidGtin))];
              if (valid.length === 1) barcode = valid[0];
            } finally {
              bitmap.close?.();
            }
          }
        } catch (barcodeError) {
          console.info('[MedicineScan] Native barcode detection unavailable:', barcodeError?.message || barcodeError);
        }
      }
      const scanDetails = { ...extracted, ...(barcode ? { barcode, barcodeCandidates: [barcode] } : {}) };
      setProductScanText(ocr.text);
      const query = scanDetails.barcode || scanDetails.name || scanDetails.normalizedText;
      let catalogue = await fetchMedicineCatalog({ tenantId, page: 1, limit: 50, search: query });
      let medicines = catalogue.medicines || [];
      if (!medicines.length && scanDetails.name && query !== scanDetails.name) {
        catalogue = await fetchMedicineCatalog({ tenantId, page: 1, limit: 50, search: scanDetails.name });
        medicines = catalogue.medicines || [];
      }
      const ranked = rankScannedMedicineCandidates(scanDetails, medicines);
      const candidates = ranked.status === 'MATCHED' && ranked.best
        ? [{ product: ranked.best, score: Math.round(ranked.confidence * 100), exact: true }]
        : ranked.alternatives;
      setProductScanCandidates(candidates);
      if (ranked.status === 'MATCHED') {
        setProductScanMessage('Best catalogue match found. Confirm the medicine below to add it to your request.');
      } else if (candidates.length) {
        setProductScanMessage('Possible matches found. Select the exact strength and form, or enter the details manually.');
      } else {
        setProductScanMessage('Label text was read, but no catalogue match was found. Enter the medicine details manually.');
      }
    } catch (error) {
      setProductScanMessage(error?.response?.data?.detail?.message || error.message || 'Could not scan this product. Try another photo.');
      addToast(error?.response?.data?.detail?.message || error.message || 'Product scan failed.', 'error');
    } finally {
      setProductScanLoading(false);
    }
  };

  const addScannedCandidate = candidate => {
    const product = candidate?.product || candidate;
    if (!product) return;
    const item = createRequestedItem({
      name: product.name || product.productName || product.brandName || product.genericName || '',
      medicineId: product._id || product.productId || product.medicineId || null,
      strength: product.strength || '',
      dosageForm: product.dosageForm || product.form || 'Other',
      brand: product.brandName || product.brand || product.manufacturer || '',
      quantity: productScanCandidates[0]?.exact ? (extractMedicineLabelDetails(productScanText).packSize || 1) : 1,
      source: 'PRODUCT_SCAN',
      validationStatus: candidate.exact ? 'CATALOGUE_MATCH_REVIEW' : 'CATALOGUE_CANDIDATE_REVIEW',
      confidence: Number(candidate.score || 0) / 100,
      requiresReview: true
    });
    setRequestedItems(current => current.length === 1 && !current[0].requestedName.trim()
      ? [item]
      : [...current, item]);
    addToast('Medicine details added. Please review before submitting.', 'success');
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
      if (!tenantId) {
        addToast('Select a pharmacy before submitting your medicine request.', 'warning');
        return;
      }
      const formData = new FormData();
      formData.append('tenantId', String(tenantId));

      const requestItems = requestedItems
        .filter(item => item.requestedName.trim())
        .map(item => ({
          ...item,
          requestedName: item.requestedName.trim(),
          strength: item.strength.trim(),
          dosageForm: item.dosageForm.trim(),
          manufacturer: item.manufacturer.trim(),
          quantity: Math.max(1, Number(item.quantity) || 1),
          source: item.source || 'MANUAL',
          validationStatus: item.validationStatus || 'MANUAL'
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

      if (prescriptionId) {
        formData.append('prescriptionId', prescriptionId);
      } else if (prescriptionFile) {
        formData.append('prescription', prescriptionFile);
      }
      if (productImageFile) {
        formData.append('productImage', productImageFile);
      }

      const res = await createMedicineRequest(formData);
      addToast(res.message || 'Medicine request submitted to QuickMeds Rx!', 'success');
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
      <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4" role="presentation">
        <div role="dialog" aria-modal="true" aria-labelledby="medicine-procurement-request-title" tabIndex={-1} className="pharma-medicine-request-modal bg-white rounded-3xl max-w-xl w-full p-5 sm:p-7 shadow-2xl space-y-5 animate-fade-in max-h-[92vh] overflow-y-auto border border-slate-100">

          {/* Modal Header */}
          <div className="flex items-start justify-between border-b border-slate-100 pb-3">
            <div>
            <span className="text-[10px] font-black uppercase tracking-wider text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full inline-block mb-1">
              Dispensary Procurement Request
            </span>
              <h3 id="medicine-procurement-request-title" className="text-base sm:text-lg font-black text-slate-900">
                Request Medicine from {activeTenant?.shopName || activeTenant?.name || 'Selected Pharmacy'}
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

          <ContextualHelpBanner topic="requests" />

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

            <section className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-3 sm:p-4 space-y-3" aria-label="Medicine scanning tools">
              <div>
                <h4 className="text-xs font-black text-slate-800">Scan medicine or prescription</h4>
                <p className="mt-1 text-[10px] leading-relaxed text-slate-600">Use your phone camera or upload a clear photo. Scans only suggest details; verify every medicine before sending your request.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="rounded-xl border border-indigo-200 bg-white p-3 text-xs font-bold text-indigo-800 cursor-pointer">
                  <span className="block">Scan product / medicine pack</span>
                  <span className="mt-1 block text-[10px] font-normal text-slate-500">Camera or image upload</span>
                  <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={handleProductImageChange} className="mt-2 block w-full text-[10px]" />
                </label>
                <label className="rounded-xl border border-indigo-200 bg-white p-3 text-xs font-bold text-indigo-800 cursor-pointer">
                  <span className="block">Scan doctor prescription</span>
                  <span className="mt-1 block text-[10px] font-normal text-slate-500">Camera, image or PDF</span>
                  <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" onChange={handlePrescriptionChange} className="mt-2 block w-full text-[10px]" />
                </label>
              </div>
              {productImageFile && (
                <div className="rounded-xl bg-white border border-slate-200 p-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold text-slate-600 truncate">{productImageFile.name}</span>
                    <button type="button" onClick={handleScanProductLabel} disabled={productScanLoading} className="shrink-0 rounded-lg bg-indigo-600 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50">
                      {productScanLoading ? 'Scanning…' : 'Read product details'}
                    </button>
                  </div>
                  {imagePreview && <img src={imagePreview} alt="Selected medicine package" className="h-24 max-w-full rounded-lg object-contain" />}
                  {productScanMessage && <p className="text-[10px] text-slate-600" role="status">{productScanMessage}</p>}
                  {productScanText && <p className="text-[10px] text-slate-500 line-clamp-3">{productScanText}</p>}
                  {productScanCandidates.length > 0 && (
                    <div className="space-y-1.5">
                      {productScanCandidates.slice(0, 5).map((candidate, index) => {
                        const product = candidate.product || candidate;
                        return (
                          <button type="button" key={product._id || product.productId || product.name || index} onClick={() => addScannedCandidate(candidate)} className="w-full rounded-lg border border-slate-200 p-2 text-left hover:border-indigo-400">
                            <span className="block text-[11px] font-bold text-slate-800">{product.name || product.productName || product.brandName || 'Catalogue medicine'}</span>
                            <span className="block text-[10px] text-slate-500">{[product.strength, product.dosageForm || product.form, product.manufacturer || product.brand].filter(Boolean).join(' • ')} {candidate.score != null ? ' • ' + candidate.score + '%' : ''}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              {prescriptionFile && (
                <div className="rounded-xl bg-white border border-slate-200 p-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold text-slate-600 truncate">{prescriptionFile.name}</span>
                    <button type="button" onClick={handleReadPrescription} disabled={prescriptionScanLoading} className="shrink-0 rounded-lg bg-indigo-600 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50">
                      {prescriptionScanLoading ? 'Reading…' : prescriptionId ? 'Read again' : 'Read prescription'}
                    </button>
                  </div>
                  {prescriptionPreview && <img src={prescriptionPreview} alt="Selected prescription" className="h-24 max-w-full rounded-lg object-contain" />}
                  {prescriptionScanStatus && <p className="text-[10px] text-slate-600" role="status">{prescriptionScanStatus}</p>}
                  {prescriptionId && <p className="text-[10px] font-semibold text-emerald-700">Prescription securely uploaded and linked to this request.</p>}
                </div>
              )}
            </section>

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
                    {(item.dose || item.frequency || item.duration || item.instructions || item.source === 'PRESCRIPTION_OCR') && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                        <div>
                          <label className="mb-1 block text-[10px] font-bold text-slate-600">Dose (verify)</label>
                          <input type="text" value={item.dose} onChange={e => updateRequestedItem(index, 'dose', e.target.value)} placeholder="Dose as written" className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs" />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-bold text-slate-600">Frequency (verify)</label>
                          <input type="text" value={item.frequency} onChange={e => updateRequestedItem(index, 'frequency', e.target.value)} placeholder="e.g. BD / twice daily" className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs" />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-bold text-slate-600">Duration (verify)</label>
                          <input type="text" value={item.duration} onChange={e => updateRequestedItem(index, 'duration', e.target.value)} placeholder="e.g. 5 days" className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs" />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-bold text-slate-600">Prescription instructions (verify)</label>
                          <input type="text" value={item.instructions} onChange={e => updateRequestedItem(index, 'instructions', e.target.value)} placeholder="Instructions as written" className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs" />
                        </div>
                        <p className="sm:col-span-2 text-[10px] text-amber-800">OCR suggestions only — confirm these instructions against the original prescription. The pharmacist must verify before dispensing.</p>
                      </div>
                    )}
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

            {/* Scan controls above also attach the selected source files to this request. */}

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
