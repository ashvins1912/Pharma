import React from 'react';
import { useLanguage } from '../context/LanguageContext';

export default function Footer({ onNavigate }) {
  const { t, language, setLanguage, languages } = useLanguage();
  return (
    <footer className="bg-white border-t border-slate-200 mt-16 text-slate-600 text-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          
          {/* Pharmacy Info */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-2xl">⚕️</span>
              <span className="text-base font-black text-slate-900 tracking-tight">QuickMeds Rx</span>
            </div>
            <p className="text-slate-500 leading-relaxed text-[11px]">
              Licensed dispensing digital pharmacy providing authentic pharmaceuticals, cold-chain delivery, and instant prescription fulfillment.
            </p>
            <div className="text-[11px] text-slate-500 space-y-1">
              <p>📍 43 Richmond Road, Bengaluru - 560025</p>
              <p>📞 +91 95899 16475 (Dispensary Desk)</p>
              <p>🕒 Mon - Sun: 7:00 AM - 11:30 PM</p>
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="font-extrabold text-slate-900 uppercase tracking-wider text-[11px] mb-3">{t('footerShop')}</h4>
            <ul className="space-y-2 text-[11px]">
              <li>
                <button onClick={() => onNavigate('store')} className="hover:text-blue-600 transition cursor-pointer">
                  Prescription Drugs (Rx)
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate('store')} className="hover:text-blue-600 transition cursor-pointer">
                  Over-the-Counter (OTC)
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate('store')} className="hover:text-blue-600 transition cursor-pointer">
                  Vitamins & Supplements
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate('store')} className="hover:text-blue-600 transition cursor-pointer">
                  First Aid & Rehydration
                </button>
              </li>
            </ul>
          </div>

          {/* Customer Support */}
          <div>
            <h4 className="font-extrabold text-slate-900 uppercase tracking-wider text-[11px] mb-3">{t('footerCustomer')}</h4>
            <ul className="space-y-2 text-[11px]">
              <li>
                <button onClick={() => onNavigate('orders')} className="hover:text-blue-600 transition cursor-pointer">
                  Order Tracking
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate('addresses')} className="hover:text-blue-600 transition cursor-pointer">
                  Saved Delivery Addresses
                </button>
              </li>
              <li>
                <span className="text-slate-400">{t('codPolicy')}</span>
              </li>
              <li>
                <span className="text-slate-400">{t('prescriptionRules')}</span>
              </li>
            </ul>
          </div>

          {/* Regulatory & Safety */}
          <div>
            <h4 className="font-extrabold text-slate-900 uppercase tracking-wider text-[11px] mb-3">{t('footerCompliance')}</h4>
            <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl space-y-2">
              <span className="inline-block bg-emerald-100 text-emerald-800 text-[10px] font-black px-2 py-0.5 rounded">
                CDSCO & WHO-GMP Certified
              </span>
              <p className="text-[10px] text-slate-500 leading-tight">
                All scheduled medicines are dispensed strictly under registered pharmacist supervision with batch expiry validation.
              </p>
            </div>
          </div>

        </div>

        <div className="border-t border-slate-100 mt-10 pt-6 flex flex-col sm:flex-row justify-between items-center gap-3 text-slate-400 text-[11px]">
          <p>© {new Date().getFullYear()} QuickMeds Rx Operations. {t('allRightsReserved')}</p>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
              <span aria-hidden="true">🌐</span>
              <span>{t("language")}</span>
              <select aria-label={t("language")} value={language} onChange={(event) => setLanguage(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700">
                {languages.map((item) => <option key={item.code} value={item.code}>{item.nativeLabel}</option>)}
              </select>
            </label>
            <span>Privacy Policy</span>
            <span>Terms of Service</span>
            <span>Dispensary Licensing</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
