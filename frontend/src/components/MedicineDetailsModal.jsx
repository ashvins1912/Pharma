import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '../context/LanguageContext';
import { matchStoreMedicineToMaster } from '../api/medicineMasterService';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';

const listFields = [
  ['indications', 'Indications'],
  ['uses', 'Uses'],
  ['contraindications', 'Contraindications'],
  ['sideEffects', 'Possible side effects'],
  ['drugInteractions', 'Drug interactions']
];

const asList = value => Array.isArray(value)
  ? value.map(item => typeof item === 'string' ? item : String(item?.name || item?.description || '')).filter(Boolean)
  : typeof value === 'string' && value.trim() ? [value.trim()] : [];

function DetailSection({ title, values }) {
  const items = asList(values);
  if (!items.length) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-500">{title}</h3>
      <ul className="grid gap-1.5 pl-4 text-sm leading-6 text-slate-700 list-disc">
        {items.map((item, index) => <li key={index}>{item}</li>)}
      </ul>
    </section>
  );
}

export default function MedicineDetailsModal({ product, onClose }) {
  const { t } = useLanguage();
  const { cart, addToCart, updateQuantity } = useApp();
  const { user } = useAuth();
  const [match, setMatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const closeButtonRef = useRef(null);
  const titleId = useMemo(() => `medicine-detail-${String(product?._id || product?.sku || 'selected').replace(/[^a-zA-Z0-9_-]/g, '')}`, [product]);
  const matchProduct = useMemo(() => product ? ({
    name: product.name, brand: product.brand, genericName: product.genericName,
    composition: product.composition, strength: product.strength,
    dosageForm: product.dosageForm, form: product.form, packSize: product.packSize
  }) : null, [product?.name, product?.brand, product?.genericName, product?.composition, product?.strength, product?.dosageForm, product?.form, product?.packSize]);

  useEffect(() => {
    if (!matchProduct) return undefined;
    let active = true;
    setLoading(true);
    setError('');
    setMatch(null);
    matchStoreMedicineToMaster(matchProduct)
      .then(result => { if (active) setMatch(result); })
      .catch(() => { if (active) setError('Catalogue details are temporarily unavailable.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [matchProduct]);

  useEffect(() => {
    if (!product || typeof document === 'undefined') return undefined;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    const onKeyDown = event => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
    };
  }, [product, onClose]);

  if (!product || typeof document === 'undefined') return null;
  const medicine = match?.medicine;
  const stock = Number(product.availableQuantity ?? product.quantity ?? product.stock ?? 0);
  const cartItem = cart.find(item => String(item._id) === String(product._id));
  const cartQty = cartItem?.quantity || 0;
  const maxCartQuantity = stock > 0 && stock <= 5 ? stock + 5 : stock;
  const canAddToCart = Boolean(user && product._id && stock > 0 && !product.isExpired);
  const price = Number(product.price ?? product.sellingPrice ?? 0);
  const showClinicalWarning = medicine && (
    medicine.clinicalDataVerification !== 'VERIFIED'
    || medicine.dataQualityStatus === 'NEEDS_REVIEW'
    || medicine.dataQualityStatus === 'PARTIAL'
  );

  return createPortal(
    <div className="fixed inset-0 z-[12000] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-h-[88dvh] sm:rounded-3xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="mb-1 text-[10px] font-black uppercase tracking-[.14em] text-blue-600">{t('medicineDetails')}</p>
            <h2 id={titleId} className="break-words text-base font-black leading-snug text-slate-900 sm:text-xl">{product.name || product.brand || 'Medicine'}</h2>
            <p className="mt-1 text-xs text-slate-500">{product.genericName || product.composition || product.brand || ''}</p>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label={t('close')} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xl font-bold text-slate-600 hover:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">×</button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="rounded-2xl bg-blue-50 p-3">
              <p className="text-[10px] font-bold uppercase text-blue-700">{t('priceLabel')}</p>
              <p className="mt-1 text-lg font-black text-blue-950">₹{price.toFixed(2)}</p>
            </div>
            <div className="col-span-2 rounded-2xl bg-slate-50 p-3 sm:col-span-1">
              <p className="text-[10px] font-bold uppercase text-slate-500">{t('manufacturer')}</p>
              <p className="mt-1 break-words text-sm font-extrabold text-slate-900">{medicine?.manufacturer || '—'}</p>
            </div>
          </div>

          {loading && <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600"><span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />{t('matchingMedicineCatalogue')}</div>}
          {error && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}

          {!loading && !error && !medicine && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <h3 className="text-sm font-extrabold text-amber-950">{match?.status === 'AMBIGUOUS' || match?.status === 'NO_CONFIDENT_MATCH' || match?.status === 'NEEDS_ADMIN_MAPPING' ? t('catalogueMatchNeedsReview') : t('catalogueDetailsNotLinked')}</h3>
              <p className="mt-1 text-xs leading-5 text-amber-900">{t('catalogueMatchSafetyNote')}</p>
              {Array.isArray(match?.alternatives) && match.alternatives.length > 0 && (
                <>
                <ul className="mt-3 space-y-2">
                  {match.alternatives.map((item, index) => <li key={index} className="rounded-xl bg-white/80 p-3 text-xs text-slate-700"><div><strong>{item.brandName}</strong>{item.genericName ? ` · ${item.genericName}` : ''}{item.strength ? ` · ${item.strength}` : ''}{item.dosageForm ? ` · ${item.dosageForm}` : ''}</div>{item.matchReason === 'SHARED_BRAND_STEM_REVIEW_REQUIRED' && <p className="mt-1 text-[10px] font-bold text-amber-800">Shared brand stem · manual confirmation required</p>}</li>)}
                </ul>
                {canAddToCart && <div className="mt-3 flex justify-end">{cartQty > 0 ? <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 p-1"><button type="button" onClick={() => updateQuantity(product._id, -1)} aria-label={t('decreaseQuantity')} className="h-9 w-9 rounded-lg font-black text-blue-800 hover:bg-blue-100">−</button><span className="min-w-6 text-center text-sm font-extrabold text-blue-900 tabular-nums">{cartQty}</span><button type="button" onClick={() => updateQuantity(product._id, 1)} disabled={cartQty >= (cartItem?.maxCartQuantity || maxCartQuantity)} aria-label={t('increaseQuantity')} className="h-9 w-9 rounded-lg font-black text-blue-800 hover:bg-blue-100 disabled:opacity-30">+</button></div> : <button type="button" onClick={() => addToCart(product)} className="min-h-10 rounded-xl bg-blue-600 px-4 py-2 text-xs font-extrabold text-white hover:bg-blue-700">+ {t('addToCart')}</button>}</div>}
                </>
              )}
            </div>
          )}

          {medicine && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${match.status === 'EXACT' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'}`}>{match.status === 'EXACT' ? t('exactCatalogueMatch') : t('strongCatalogueMatch')}</span>
                <span className="text-[10px] font-bold text-slate-500">{t('matchConfidence')}: {match.confidence}%</span>
                {medicine.prescriptionVerification === 'VERIFIED' && medicine.requiresPrescription === true && <span className="rounded-full bg-rose-100 px-2.5 py-1 text-[10px] font-black text-rose-700">{t('rxOnly')}</span>}
              </div>

              <section className="space-y-3">
                <h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-500">{t('productInformation')}</h3>
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {[
                    [t('brand'), medicine.brandName],
                    [t('genericName'), medicine.genericName],
                    [t('composition'), medicine.composition],
                    [t('strength'), medicine.strength],
                    [t('dosageForm'), medicine.dosageForm],
                    [t('packSize'), medicine.packSize],
                    [t('medicineType'), medicine.medicineType],
                    [t('therapeuticClass'), medicine.therapeuticClass],
                    [t('route'), asList(medicine.routes).join(', ')]
                  ].filter(([, value]) => value).map(([label, value]) => (
                    <div key={label} className="min-w-0 rounded-xl border border-slate-100 bg-white p-3">
                      <dt className="text-[10px] font-bold text-slate-500">{label}</dt>
                      <dd className="mt-1 break-words text-xs font-bold leading-5 text-slate-900">{value}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              {listFields.map(([field, label]) => <DetailSection key={field} title={t(field) || label} values={medicine[field]} />)}
              {medicine.prescriptionVerification !== 'VERIFIED' && (
                <p className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">{t('prescriptionStatusUnverified')}</p>
              )}
              {showClinicalWarning && (
                <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">{t('catalogueClinicalDisclaimer')}</p>
              )}
            </>
          )}
        </div>
        <footer className="shrink-0 border-t border-slate-100 bg-white px-4 py-3 text-right sm:px-6">
          <button type="button" onClick={onClose} className="min-h-10 rounded-xl bg-slate-900 px-5 py-2 text-xs font-extrabold text-white hover:bg-slate-700">{t('close')}</button>
        </footer>
      </section>
    </div>,
    document.body
  );
}
