import React, { useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';

const initial = {
  firstName: '', lastName: '', dateOfBirth: '', gender: '', mobile: '',
  password: '', confirmPassword: '', companyName: '', gstNumber: '',
  drugLicenseNumber: '', street: '', city: '', state: '', pincode: ''
};

export default function VendorOnboardingView({ token, onClose, onSuccess }) {
  const { syncSession } = useAuth();
  const { addToast } = useToast();
  const [data, setData] = useState(null);
  const [form, setForm] = useState(initial);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [tenant, setTenant] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await apiClient.get(`/api/v1/vendor/onboarding/${encodeURIComponent(token)}`);
        const d = res.data?.data || res.data;
        if (!mounted) return;
        setData(d);
        const v = d?.vendor || {};
        const parts = (v.name || '').trim().split(/\s+/).filter(Boolean);
        setForm(p => ({
          ...p,
          firstName: parts[0] || '', lastName: parts.slice(1).join(' ') || '',
          companyName: v.companyName || '', mobile: v.mobile || '',
          gstNumber: v.gstNumber || '', street: v.address?.line1 || '',
          city: v.address?.city || '', state: v.address?.state || '', pincode: v.address?.pincode || ''
        }));
      } catch (e) {
        setError(e.response?.data?.error?.message || e.response?.data?.message || 'This onboarding link is invalid or expired.');
      } finally { if (mounted) setLoading(false); }
    })();
    return () => { mounted = false; };
  }, [token]);

  const set = (name, value) => {
    setForm(p => ({ ...p, [name]: value }));
    setFieldErrors(p => ({ ...p, [name]: '' }));
    setError('');
  };

  const validateProfile = () => {
    const e = {};
    if (!form.firstName.trim()) e.firstName = 'First name is required.';
    if (!form.lastName.trim()) e.lastName = 'Last name is required.';
    if (!form.dateOfBirth) e.dateOfBirth = 'Date of birth is required.';
    else if (new Date(form.dateOfBirth) > new Date()) e.dateOfBirth = 'Date of birth cannot be in the future.';
    if (!form.gender) e.gender = 'Gender is required.';
    if (!form.mobile.trim() || form.mobile.replace(/\D/g, '').length < 10) e.mobile = 'Enter a valid 10-digit mobile number.';
    if (!form.password || form.password.length < 8 || !/[A-Z]/.test(form.password) || !/[a-z]/.test(form.password) || !/[0-9]/.test(form.password)) e.password = 'Use at least 8 characters with uppercase, lowercase and a number.';
    if (form.password !== form.confirmPassword) e.confirmPassword = 'Passwords do not match.';
    setFieldErrors(e);
    return !Object.keys(e).length;
  };

  const validateTenant = () => {
    const e = {};
    if (!form.companyName.trim()) e.companyName = 'Pharmacy / Company name is required.';
    if (!form.drugLicenseNumber.trim()) e.drugLicenseNumber = 'Drug licence number is required.';
    if (!form.city.trim()) e.city = 'City is required.';
    if (!form.state.trim()) e.state = 'State is required.';
    if (!/^\d{6}$/.test(form.pincode.replace(/\D/g, ''))) e.pincode = 'Enter a valid 6-digit pincode.';
    setFieldErrors(e);
    return !Object.keys(e).length;
  };

  const submit = async (event) => {
    event.preventDefault();
    if (step === 1) { if (validateProfile()) setStep(2); return; }
    if (!validateTenant()) return;
    setSubmitting(true); setError('');
    try {
      const res = await apiClient.post(`/api/v1/vendor/onboarding/${encodeURIComponent(token)}/complete`, {
        firstName: form.firstName.trim(), lastName: form.lastName.trim(),
        dateOfBirth: form.dateOfBirth, gender: form.gender, mobile: form.mobile.trim(),
        password: form.password,
        company: { companyName: form.companyName.trim(), gstNumber: form.gstNumber.trim(), drugLicenseNumber: form.drugLicenseNumber.trim() },
        address: { line1: form.street.trim(), city: form.city.trim(), state: form.state.trim(), pincode: form.pincode.replace(/\D/g, '') }
      });
      const result = res.data?.data || res.data;
      setTenant(result?.tenant || null);
      setDone(true);
      if (result?.user) syncSession({ user: result.user }, result.user);
      addToast('Pharmacy tenant onboarding completed.', 'success');
      onSuccess?.(result);
    } catch (e) {
      const detail = e.response?.data?.error || {};
      setError(detail.message || e.response?.data?.message || 'Could not complete onboarding.');
      const mapped = {};
      (detail.details || []).forEach(x => { if (x.field) mapped[x.field] = x.message; });
      setFieldErrors(mapped);
      if (mapped.firstName || mapped.lastName || mapped.dateOfBirth || mapped.gender || mapped.mobile || mapped.password) setStep(1);
    } finally { setSubmitting(false); }
  };

  if (loading) return <Overlay><Spinner /><h3 className="text-lg font-bold">Opening your onboarding...</h3><p className="text-xs text-slate-500 mt-2">Validating the secure invitation and loading required details.</p></Overlay>;
  if (error && !data) return <Overlay><div className="text-rose-600 text-3xl mb-3">✕</div><h3 className="text-xl font-bold">Onboarding Link Invalid</h3><p className="text-sm text-slate-600 my-5">{error}</p><button onClick={onClose} className="w-full py-3 bg-slate-800 text-white rounded-xl font-bold">Back to Home</button></Overlay>;
  if (done) return <Overlay><div className="text-emerald-600 text-5xl mb-3">✓</div><h2 className="text-2xl font-black">Tenant Onboarding Completed</h2><p className="text-sm text-slate-600 my-5"><strong>{tenant?.name}</strong> is active and your account has <strong>TENANT_ADMIN</strong> access.</p><div className="p-4 bg-slate-50 rounded-xl text-left text-xs mb-5"><div>Tenant: <strong>{tenant?.name}</strong></div><div>Status: <strong>{tenant?.status}</strong></div><div>Role: <strong>TENANT_ADMIN</strong></div></div><button onClick={() => { onClose?.(); window.location.reload(); }} className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold">Open Tenant Operations →</button></Overlay>;

  const v = data?.vendor || {};
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl my-8 overflow-hidden">
        <div className="bg-gradient-to-r from-blue-900 via-blue-800 to-slate-900 p-6 text-white">
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase font-extrabold bg-blue-500/30 px-3 py-1 rounded-full">First-time user</span>
            <span className="text-[10px] uppercase font-bold bg-amber-400/15 text-amber-100 px-3 py-1 rounded-full">PROFILE_INCOMPLETE</span>
          </div>
          <h2 className="text-2xl font-black mt-3">Welcome to Pharma</h2>
          <p className="text-xs text-blue-200 mt-1">Complete your personal profile first, then activate your pharmacy tenant.</p>
          <div className="flex gap-2 mt-5"><div className={`h-1.5 flex-1 rounded-full ${step >= 1 ? 'bg-emerald-400' : 'bg-white/20'}`} /><div className={`h-1.5 flex-1 rounded-full ${step >= 2 ? 'bg-emerald-400' : 'bg-white/20'}`} /></div>
          <div className="text-[11px] mt-2 text-blue-200">Step {step} of 2 — {step === 1 ? 'Personal Profile' : 'Tenant / Pharmacy Setup'}</div>
        </div>

        <form onSubmit={submit} className="p-6 md:p-8 space-y-6">
          {error && <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl">{error}</div>}

          {step === 1 && <>
            <Section title="1. First-time user profile">
              <div className="grid md:grid-cols-2 gap-4">
                <Field label="First name *" value={form.firstName} onChange={x => set('firstName', x)} error={fieldErrors.firstName} />
                <Field label="Last name *" value={form.lastName} onChange={x => set('lastName', x)} error={fieldErrors.lastName} />
                <Field label="Date of birth *" type="date" value={form.dateOfBirth} onChange={x => set('dateOfBirth', x)} error={fieldErrors.dateOfBirth} />
                <div><label className="block text-xs font-bold text-slate-700 mb-1">Gender *</label><select className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" value={form.gender} onChange={e => set('gender', e.target.value)}><option value="">Select gender</option><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option><option value="PREFER_NOT_TO_SAY">Prefer not to say</option></select><Err x={fieldErrors.gender}/></div>
                <Field label="Mobile *" type="tel" value={form.mobile} onChange={x => set('mobile', x)} error={fieldErrors.mobile} />
                <div><label className="block text-xs font-bold text-slate-700 mb-1">Email</label><input className="input bg-slate-100" value={v.email || ''} disabled /></div>
              </div>
            </Section>
            <Section title="2. Secure account">
              <div className="grid md:grid-cols-2 gap-4">
                <Field label="Password *" type={showPassword ? 'text' : 'password'} value={form.password} onChange={x => set('password', x)} error={fieldErrors.password} />
                <Field label="Confirm password *" type={showPassword ? 'text' : 'password'} value={form.confirmPassword} onChange={x => set('confirmPassword', x)} error={fieldErrors.confirmPassword} />
              </div>
              <button type="button" onClick={() => setShowPassword(x => !x)} className="text-xs text-blue-600 font-bold">{showPassword ? 'Hide password' : 'Show password'}</button>
            </Section>
            <div className="flex justify-end border-t pt-4"><button className="px-7 py-3 bg-blue-600 text-white rounded-xl font-black">Continue to Tenant Setup →</button></div>
          </>}

          {step === 2 && <>
            <div className="p-4 rounded-2xl bg-blue-50 border border-blue-200 text-xs text-blue-800">Profile complete ✓. Configure the pharmacy tenant that will be linked to your account as <strong>TENANT_ADMIN</strong>.</div>
            <Section title="3. Pharmacy tenant">
              <div className="grid md:grid-cols-2 gap-4">
                <Field label="Pharmacy / Company name *" value={form.companyName} onChange={x => set('companyName', x)} error={fieldErrors.companyName} />
                <Field label="GSTIN / Tax ID" value={form.gstNumber} onChange={x => set('gstNumber', x)} />
                <Field label="Drug License Number *" value={form.drugLicenseNumber} onChange={x => set('drugLicenseNumber', x)} error={fieldErrors.drugLicenseNumber} />
              </div>
            </Section>
            <Section title="4. Pharmacy location">
              <Field label="Street address" value={form.street} onChange={x => set('street', x)} />
              <div className="grid md:grid-cols-3 gap-4 mt-4"><Field label="City *" value={form.city} onChange={x => set('city', x)} error={fieldErrors.city}/><Field label="State *" value={form.state} onChange={x => set('state', x)} error={fieldErrors.state}/><Field label="Pincode *" value={form.pincode} onChange={x => set('pincode', x)} error={fieldErrors.pincode}/></div>
            </Section>
            <div className="flex justify-between border-t pt-4"><button type="button" onClick={() => setStep(1)} className="px-5 py-3 text-xs font-bold text-slate-600">← Back to Profile</button><button disabled={submitting} className="px-7 py-3 bg-blue-600 text-white rounded-xl font-black disabled:opacity-50">{submitting ? 'Activating Tenant...' : 'Complete Onboarding & Activate Tenant →'}</button></div>
          </>}
        </form>
      </div>
    </div>
  );
}

function Overlay({ children }) { return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"><div className="bg-white rounded-2xl max-w-lg w-full p-8 shadow-2xl text-center">{children}</div></div>; }
function Spinner() { return <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />; }
function Section({ title, children }) { return <section className="space-y-4"><h3 className="text-xs font-black uppercase text-blue-700 tracking-wider border-b border-blue-100 pb-2">{title}</h3>{children}</section>; }
function Field({ label, value, onChange, error, type='text' }) { return <div><label className="block text-xs font-bold text-slate-700 mb-1">{label}</label><input type={type} value={value} onChange={e => onChange(e.target.value)} className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />{error && <Err x={error}/>}</div>; }
function Err({ x }) { return x ? <p className="text-rose-600 text-xs mt-1">{x}</p> : null; }
