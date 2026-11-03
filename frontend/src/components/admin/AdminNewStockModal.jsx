import React, { useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import apiClient from '../../api/apiClient';
import { useToast } from '../../context/ToastContext';
import { useFocusTrap } from '../../hooks/useFocusTrap';

const CATEGORIES = [
  'Prescription Medicines',
  'Over-The-Counter (OTC)',
  'Wellness & Supplements',
  'Ayurveda & Herbal',
  'Surgical & Medical Devices',
  'Baby Care & Maternity',
  'Chronic Care',
  'Emergency & Critical Care'
];

const PRESET_IMAGE_ASSETS = [
  { label: 'Tablet Strip', url: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&q=80' },
  { label: 'Syrup Bottle', url: 'https://images.unsplash.com/photo-1550572017-edd951b55106?w=500&q=80' },
  { label: 'Capsules', url: 'https://images.unsplash.com/photo-1471864190281-a93a3070b6de?w=500&q=80' },
  { label: 'Inhaler', url: 'https://images.unsplash.com/photo-1583947215259-38e31be8751f?w=500&q=80' },
  { label: 'Medical Kit', url: 'https://images.unsplash.com/photo-1516549655169-df83a0774514?w=500&q=80' },
  { label: 'Herbal Herb', url: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=500&q=80' }
];

export default function AdminNewStockModal({ isOpen, onClose, onStockCreated }) {
  const { t } = useLanguage();
  const { addToast } = useToast();
  const modalRef = useFocusTrap(isOpen, onClose);

  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [keepOpenForMultiple, setKeepOpenForMultiple] = useState(true);
  const [selectedAssetTab, setSelectedAssetTab] = useState('presets'); // 'presets' | 'upload' | 'custom'

  const [form, setForm] = useState({
    name: '',
    brand: '',
    sku: '',
    drug: '',
    batchNumber: '',
    hsnSac: '3004',
    category: 'Prescription Medicines',
    description: '',
    dosage: '',
    price: '',
    sellingPrice: '',
    stockQuantity: 100,
    expiryDate: '',
    isPrescriptionRequired: true,
    imageUrl: PRESET_IMAGE_ASSETS[0].url
  });

  if (!isOpen) return null;

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('image', file);

    try {
      setUploadingImage(true);
      const res = await apiClient.post('/api/upload/image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const url = res.data?.data?.url;
      if (url) {
        setForm(prev => ({ ...prev, imageUrl: url }));
        addToast('Image compressed, optimized & stored in folder successfully!', 'success');
      }
    } catch (err) {
      addToast(err?.response?.data?.error || err.message || 'Image upload failed.', 'error');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSubmit = async (e, shouldContinue = false) => {
    e.preventDefault();
    if (!form.name || !form.price) {
      addToast(t('pleaseTryAgain'), 'warning');
      return;
    }

    try {
      setSaving(true);
      const payload = {
        ...form,
        price: Number(form.price),
        sellingPrice: form.sellingPrice ? Number(form.sellingPrice) : Number(form.price),
        stockQuantity: Number(form.stockQuantity)
      };

      await apiClient.post('/api/medicines', payload);
      addToast(`Successfully added "${form.name}" to inventory catalog!`, 'success');

      if (onStockCreated) onStockCreated();

      if (shouldContinue && keepOpenForMultiple) {
        setForm({
          name: '',
          brand: '',
          sku: '',
          drug: '',
          batchNumber: '',
          hsnSac: '3004',
          category: form.category,
          description: '',
          dosage: '',
          price: '',
          sellingPrice: '',
          stockQuantity: 100,
          expiryDate: '',
          isPrescriptionRequired: form.isPrescriptionRequired,
          imageUrl: form.imageUrl
        });
      } else {
        onClose();
      }
    } catch (err) {
      addToast(err?.response?.data?.error || err.message || t('saveMedicineFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/45 backdrop-blur-[2px] animate-fade-in overscroll-none" aria-modal="true" role="dialog">
      <div
        className="modal-backdrop absolute inset-0 touch-none"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-stock-modal-title"
        tabIndex={-1}
        className="pharma-modal-surface relative z-10 m-auto flex h-[90dvh] max-h-[calc(100dvh-1.5rem)] min-h-0 w-full max-w-2xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white text-slate-800 shadow-2xl overscroll-contain"
      >
        <header className="relative shrink-0 bg-white dark:bg-gray-900 border-b border-slate-100 dark:border-slate-800 px-5 pt-5 pb-4 w-full">
          <button
            onClick={onClose}
            aria-label={t("close")}
            className="absolute right-4 top-4 h-8 w-8 rounded-full bg-slate-100 dark:bg-gray-800 flex items-center justify-center text-slate-500 hover:text-slate-800 dark:hover:text-white transition cursor-pointer"
          >
            ✕
          </button>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">{t('inventoryCatalogCdn')}</span>
            <h3 id="new-stock-modal-title" className="text-base sm:text-lg font-black text-gray-900 dark:text-white mt-0.5">{t('addNewStockAsset')}</h3>
          </div>
        </header>

        <main className="content-area p-5 sm:p-6 space-y-5 bg-white dark:bg-gray-900 text-slate-800 dark:text-slate-100 overflow-y-auto flex-1">
          <form onSubmit={(e) => handleSubmit(e, false)} className="space-y-5">
            {/* Section 1: Basic Information & Future-Proof Categories */}
            <div className="space-y-4">
              <h4 className="text-xs font-black uppercase tracking-wider text-blue-600 dark:text-blue-400">{`1. ${t('productMedicineName')}`}</h4>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-300 mb-1">{t('productMedicineName')} *</label>
                  <input
                    type="text"
                    name="name"
                    required
                    value={form.name}
                    onChange={handleChange}
                    placeholder={t('productMedicineName')}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-300 mb-1">{t('manufacturerBrand')}</label>
                  <input
                    type="text"
                    name="brand"
                    value={form.brand}
                    onChange={handleChange}
                    placeholder={t('manufacturerBrand')}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-300 mb-1">{t('futureProofCategory')}</label>
                  <select
                    name="category"
                    value={form.category}
                    onChange={handleChange}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-300 mb-1">{t('activeSaltFormula')}</label>
                  <input
                    type="text"
                    name="drug"
                    value={form.drug}
                    onChange={handleChange}
                    placeholder={t('activeSaltFormula')}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-300 mb-1">{t('skuBarcode')}</label>
                  <input
                    type="text"
                    name="sku"
                    value={form.sku}
                    onChange={handleChange}
                    placeholder={t('skuBarcode')}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Section 2: Decoupled Compressed Image Asset & Storage */}
            <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-black uppercase tracking-wider text-blue-600 dark:text-blue-400">{`2. ${t('inventoryCatalogCdn')}`}</h4>
                  <p className="text-[11px] text-slate-400">{t('imagesCompressed')}</p>
                </div>
                <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl w-fit">
                  <button
                    type="button"
                    onClick={() => setSelectedAssetTab('presets')}
                    className={`px-3 py-1 text-[10px] font-black rounded-lg transition ${selectedAssetTab === 'presets' ? 'bg-blue-600 text-white' : 'text-slate-600 dark:text-slate-400'}`}
                  >
                    Preset Gallery
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedAssetTab('upload')}
                    className={`px-3 py-1 text-[10px] font-black rounded-lg transition ${selectedAssetTab === 'upload' ? 'bg-blue-600 text-white' : 'text-slate-600 dark:text-slate-400'}`}
                  >
                    Upload &amp; Optimize
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedAssetTab('custom')}
                    className={`px-3 py-1 text-[10px] font-black rounded-lg transition ${selectedAssetTab === 'custom' ? 'bg-blue-600 text-white' : 'text-slate-600 dark:text-slate-400'}`}
                  >
                    Custom URL
                  </button>
                </div>
              </div>

              {selectedAssetTab === 'presets' ? (
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {PRESET_IMAGE_ASSETS.map((asset, i) => (
                    <div
                      key={i}
                      onClick={() => setForm(prev => ({ ...prev, imageUrl: asset.url }))}
                      className={`cursor-pointer rounded-xl border-2 p-1.5 transition text-center space-y-1 ${
                        form.imageUrl === asset.url ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40' : 'border-slate-200 dark:border-slate-700 hover:border-blue-400'
                      }`}
                    >
                      <img src={asset.url} alt={asset.label} className="w-full h-12 object-cover rounded-lg" />
                      <span className="text-[9px] font-bold text-slate-600 dark:text-slate-300 block truncate">{asset.label}</span>
                    </div>
                  ))}
                </div>
              ) : selectedAssetTab === 'upload' ? (
                <div className="p-4 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl bg-slate-50 dark:bg-slate-800/40 text-center space-y-2">
                  {uploadingImage ? (
                    <div className="py-4 text-xs font-bold text-blue-600 animate-pulse">{t('compressingImage')}</div>
                  ) : (
                    <>
                      <div className="text-2xl">📁</div>
                      <div className="text-xs font-bold text-slate-700 dark:text-slate-300">{t('chooseProductImage')}</div>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleFileChange}
                        className="block mx-auto text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-extrabold file:bg-blue-600 file:text-white hover:file:bg-blue-700 cursor-pointer"
                      />
                      {form.imageUrl && form.imageUrl.includes('/uploads/') && (
                        <div className="text-[11px] text-emerald-600 font-bold">✓ Optimized Asset Stored: {form.imageUrl}</div>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div>
                  <input
                    type="url"
                    name="imageUrl"
                    value={form.imageUrl}
                    onChange={handleChange}
                    placeholder={t('inventoryCatalogCdn')}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}
            </div>

            {/* Section 3: Pricing, Batch & Inventory Quantities */}
            <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              <h4 className="text-xs font-black uppercase tracking-wider text-blue-600 dark:text-blue-400">3. Pricing, Batch &amp; Stock Quantities</h4>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-300 mb-1">{t('mrpPrice')} *</label>
                  <input
                    type="number"
                    name="price"
                    required
                    min="1"
                    value={form.price}
                    onChange={handleChange}
                    placeholder="250"
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-300 mb-1">{t('sellingPrice')}</label>
                  <input
                    type="number"
                    name="sellingPrice"
                    min="1"
                    value={form.sellingPrice}
                    onChange={handleChange}
                    placeholder="199"
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-300 mb-1">{t('initialStockUnits')}</label>
                  <input
                    type="number"
                    name="stockQuantity"
                    min="0"
                    value={form.stockQuantity}
                    onChange={handleChange}
                    placeholder="100"
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-300 mb-1">{t('expiry')}</label>
                  <input
                    type="date"
                    name="expiryDate"
                    value={form.expiryDate}
                    onChange={handleChange}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-300 mb-1">{t('batchNumber')}</label>
                  <input
                    type="text"
                    name="batchNumber"
                    value={form.batchNumber}
                    onChange={handleChange}
                    placeholder={t('batchNumber')}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="flex items-center pt-5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      name="isPrescriptionRequired"
                      checked={form.isPrescriptionRequired}
                      onChange={handleChange}
                      className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                    />
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{t('prescriptionStrict')}</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-300 mb-1">{t('usageDosage')}</label>
                <textarea
                  name="dosage"
                  rows="2"
                  value={form.dosage}
                  onChange={handleChange}
                  placeholder={t('usageDosage')}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Footer Actions: Smooth Multiple Add & Single Submit */}
            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={keepOpenForMultiple}
                  onChange={(e) => setKeepOpenForMultiple(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
                />
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{t('keepModalOpenBatch')}</span>
              </label>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 sm:flex-initial px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-extrabold text-xs rounded-xl transition cursor-pointer"
                >
                  Cancel
                </button>
                
                {keepOpenForMultiple && (
                  <button
                    type="button"
                    disabled={saving || uploadingImage}
                    onClick={(e) => handleSubmit(e, true)}
                    className="flex-1 sm:flex-initial px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-xl shadow-md transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    {saving ? <span>{t('savingAddress')}</span> : <span>{t('saveAddAnother')}</span>}
                  </button>
                )}

                <button
                  type="submit"
                  disabled={saving || uploadingImage}
                  className="flex-1 sm:flex-initial px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs rounded-xl shadow-md transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {saving ? <span>{t('savingAddress')}</span> : <span>{t('saveClose')}</span>}
                </button>
              </div>
            </div>
          </form>
        </main>
      </div>
    </div>
  );
}
