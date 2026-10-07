import React, { useState, useEffect } from 'react';
import apiClient from '../../api/apiClient';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';

export default function VendorOnboardingView({ token, onClose, onSuccess }) {
  const { syncSession } = useAuth();
  const { addToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [initError, setInitError] = useState('');
  const [onboardingData, setOnboardingData] = useState(null);

  // Form State
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    gender: '',
    mobile: '',
    dateOfBirth: '',
    gender: '',
    password: '',
    confirmPassword: '',
    companyName: '',
    gstNumber: '',
    drugLicenseNumber: '',
    street: '',
    city: '',
    state: '',
    pincode: ''
  });

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [completedSuccess, setCompletedSuccess] = useState(false);
  const [createdTenant, setCreatedTenant] = useState(null);
  const [step, setStep] = useState(1);

  // Fetch Onboarding Details by Token
  useEffect(() => {
    if (!token) {
      setLoading(false);
      setInitError('No onboarding token provided in URL.');
      return;
    }

    const loadDetails = async () => {
      try {
        setLoading(true);
        setInitError('');
        const res = await apiClient.get(`/api/v1/vendor/onboarding/${encodeURIComponent(token)}`);
        const data = res.data?.data;
        setOnboardingData(data);

        // Pre-fill form
        if (data?.vendor) {
          const v = data.vendor;
          const nameParts = (v.name || '').trim().split(/\s+/);
          setFormData((prev) => ({
            ...prev,
            firstName: nameParts[0] || '',
            lastName: nameParts.slice(1).join(' ') || '',
            companyName: v.companyName || '',
            mobile: v.mobile || '',
            gstNumber: v.gstNumber || '',
            street: v.address?.line1 || v.address?.street || '',
            city: v.address?.city || '',
            state: v.address?.state || '',
            pincode: v.address?.pincode || ''
          }));
        }
      } catch (err) {
        const msg = err.response?.data?.error?.message
          || err.response?.data?.message
          || 'The onboarding link is invalid or has expired.';
        setInitError(msg);
      } finally {
        setLoading(false);
      }
    };

    loadDetails();
  }, [token]);

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (fieldErrors[field]) {
      setFieldErrors((prev) => ({ ...prev, [field]: '' }));
    }
  };

  const validate = () => {
    const errors = {};
    if (!formData.firstName.trim()) errors.firstName = 'First name is required.';
    if (!formData.lastName.trim()) errors.lastName = 'Last name is required.';
    if (!formData.dateOfBirth) errors.dateOfBirth = 'Date of birth is required.';
    else if (new Date(formData.dateOfBirth) > new Date()) errors.dateOfBirth = 'Date of birth cannot be in the future.';
    if (!formData.gender) errors.gender = 'Gender is required.';
    if (!formData.companyName.trim()) errors.companyName = 'Pharmacy / Company name is required.';
    if (!formData.drugLicenseNumber.trim()) errors.drugLicenseNumber = 'Drug licence number is required for pharmacy onboarding.';
    if (!formData.mobile.trim() || formData.mobile.replace(/\D/g, '').length < 10) {
      errors.mobile = 'Enter a valid 10-digit mobile number.';
    }
    if (!formData.dateOfBirth) errors.dateOfBirth = 'Date of birth is required.';
    if (!formData.gender) errors.gender = 'Gender is required.';
    if (!formData.password) {
      errors.password = 'Password is required.';
    } else if (formData.password.length < 8) {
      errors.password = 'Password must be at least 8 characters.';
    } else if (!/[A-Z]/.test(formData.password) || !/[a-z]/.test(formData.password) || !/[0-9]/.test(formData.password)) {
      errors.password = 'Use at least one uppercase letter, one lowercase letter, and one number.';
    }
    if (formData.password !== formData.confirmPassword) {
      errors.confirmPassword = 'Passwords do not match.';
    }
    if (!formData.city.trim()) errors.city = 'City is required.';
    if (!formData.state.trim()) errors.state = 'State is required.';
    if (!formData.pincode.trim() || formData.pincode.replace(/\D/g, '').length < 6) {
      errors.pincode = 'Enter a valid 6-digit pincode.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleProfileNext = () => {
    const errors = {};
    if (!formData.firstName.trim()) errors.firstName = 'First name is required.';
    if (!formData.lastName.trim()) errors.lastName = 'Last name is required.';
    if (!formData.dateOfBirth) errors.dateOfBirth = 'Date of birth is required.';
    if (formData.dateOfBirth && new Date(formData.dateOfBirth) > new Date()) errors.dateOfBirth = 'Date of birth cannot be in the future.';
    if (!formData.gender) errors.gender = 'Gender is required.';
    if (!formData.mobile.trim() || formData.mobile.replace(/\D/g, '').length < 10) errors.mobile = 'Enter a valid 10-digit mobile number.';
    if (!formData.password || formData.password.length < 8 || !/[A-Z]/.test(formData.password) || !/[a-z]/.test(formData.password) || !/[0-9]/.test(formData.password)) errors.password = 'Use at least 8 characters with uppercase, lowercase and a number.';
    if (formData.password !== formData.confirmPassword) errors.confirmPassword = 'Passwords do not match.';
    setFieldErrors(errors);
    if (!Object.keys(errors).length) setStep(2);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    try {
      setSubmitting(true);
      setSubmitError('');

      const payload = {
        firstName: formData.firstName.trim(),
        lastName: formData.lastName.trim(),
        dateOfBirth: formData.dateOfBirth,
        gender: formData.gender,
        mobile: formData.mobile.trim(),
        dateOfBirth: formData.dateOfBirth,
        gender: formData.gender,
        password: formData.password,
        company: {
          companyName: formData.companyName.trim(),
          gstNumber: formData.gstNumber.trim(),
          drugLicenseNumber: formData.drugLicenseNumber.trim()
        },
        address: {
          line1: formData.street.trim(),
          city: formData.city.trim(),
          state: formData.state.trim(),
          pincode: formData.pincode.trim()
        }
      };

      const res = await apiClient.post(`/api/v1/vendor/onboarding/${encodeURIComponent(token)}/complete`, payload);
      const data = res.data?.data;

      setCompletedSuccess(true);
      setCreatedTenant(data?.tenant);

      if (data?.user) {
        syncSession({ user: data.user }, data.user);
      }

      addToast('🎉 Vendor onboarding completed! Welcome to Ashvin Pharmacy Platform.', 'success');
      if (onSuccess) onSuccess(data);
    } catch (err) {
      const errData = err.response?.data?.error;
      const msg = errData?.message || err.response?.data?.message || 'Failed to complete onboarding.';
      setSubmitError(msg);

      if (Array.isArray(errData?.details)) {
        const detailsMap = {};
        errData.details.forEach((d) => {
          if (d.field) detailsMap[d.field] = d.message;
        });
        setFieldErrors(detailsMap);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
        <div className="bg-white rounded-2xl max-w-md w-full p-8 shadow-2xl text-center">
          <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <h3 className="text-lg font-bold text-slate-800">Validating Onboarding Token...</h3>
          <p className="text-xs text-slate-500 mt-2">Checking invitation status and retrieving vendor profile.</p>
        </div>
      </div>
    );
  }

  if (initError) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
        <div className="bg-white rounded-2xl max-w-md w-full p-8 shadow-2xl text-center border border-rose-100">
          <div className="w-14 h-14 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl font-bold">
            ✕
          </div>
          <h3 className="text-xl font-bold text-slate-800 mb-2">Onboarding Link Invalid</h3>
          <p className="text-sm text-slate-600 mb-6">{initError}</p>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-3 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-xl transition cursor-pointer"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  if (completedSuccess) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
        <div className="bg-white rounded-2xl max-w-lg w-full p-8 shadow-2xl text-center border border-teal-100">
          <div className="w-16 h-16 bg-teal-100 text-teal-600 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl font-bold">
            ✓
          </div>
          <h2 className="text-2xl font-black text-slate-800 mb-2">Onboarding Completed!</h2>
          <p className="text-sm text-slate-600 mb-6">
            Congratulations! <strong>{createdTenant?.name}</strong> has been registered onto the Ashvin Pharmacy Multi-Tenant Platform with active Tenant Administrator privileges.
          </p>
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-left mb-6 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-500 font-semibold">Tenant Identifier:</span>
              <span className="font-mono text-slate-800 font-bold">{createdTenant?.id}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 font-semibold">Status:</span>
              <span className="text-emerald-700 font-bold uppercase">{createdTenant?.status}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 font-semibold">Role:</span>
              <span className="text-indigo-700 font-bold">TENANT_ADMIN</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              if (onClose) onClose();
              window.location.reload();
            }}
            className="w-full py-3 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl shadow-md transition cursor-pointer"
          >
            Go to Tenant Operations Dashboard →
          </button>
        </div>
      </div>
    );
  }

  const vendor = onboardingData?.vendor;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-slate-100 my-8 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-900 via-indigo-800 to-slate-900 p-6 text-white">
          <div className="flex items-center justify-between mb-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-wider font-extrabold bg-indigo-500/30 px-3 py-1 rounded-full border border-indigo-400/30">
                First-time user
              </span>
              <span className="text-[10px] uppercase tracking-wider font-bold bg-amber-400/15 text-amber-100 px-3 py-1 rounded-full border border-amber-300/20">
                PROFILE_INCOMPLETE · TENANT ONBOARDING
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-300 hover:text-white text-lg font-bold"
            >
              ✕
            </button>
          </div>
          <h2 className="text-2xl font-black">Complete Pharmacy Onboarding</h2>
          <p className="text-xs text-indigo-200 mt-1">
            This secure invitation is your first-time account setup. Complete your personal details, create your password, and register your pharmacy tenant.
          </p>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 md:p-8 space-y-6">
          {step === 1 ? (
            <>
          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase text-indigo-700 tracking-wider flex items-center gap-2 border-b border-indigo-100 pb-2"><span>👤</span> First-time User Profile</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><label className="block text-xs font-bold text-slate-700 mb-1">First Name *</label><input value={formData.firstName} onChange={(e)=>handleChange('firstName',e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl" />{fieldErrors.firstName && <p className="text-rose-600 text-xs mt-1">{fieldErrors.firstName}</p>}</div>
              <div><label className="block text-xs font-bold text-slate-700 mb-1">Last Name *</label><input value={formData.lastName} onChange={(e)=>handleChange('lastName',e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl" />{fieldErrors.lastName && <p className="text-rose-600 text-xs mt-1">{fieldErrors.lastName}</p>}</div>
              <div><label className="block text-xs font-bold text-slate-700 mb-1">Date of Birth *</label><input type="date" value={formData.dateOfBirth} onChange={(e)=>handleChange('dateOfBirth',e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl" />{fieldErrors.dateOfBirth && <p className="text-rose-600 text-xs mt-1">{fieldErrors.dateOfBirth}</p>}</div>
              <div><label className="block text-xs font-bold text-slate-700 mb-1">Gender *</label><select value={formData.gender} onChange={(e)=>handleChange('gender',e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl"><option value="">Select gender</option><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option><option value="PREFER_NOT_TO_SAY">Prefer not to say</option></select>{fieldErrors.gender && <p className="text-rose-600 text-xs mt-1">{fieldErrors.gender}</p>}</div>
            </div>
          </div>
          {          {/* Action Buttons */}
          <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={submitting}
              className="px-7 py-3 text-xs font-black text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-md transition disabled:opacity-50 flex items-center gap-2 cursor-pointer"
            >
              {submitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Activating Workspace...</span>
                </>
              ) : (
                <span>Complete Onboarding & Activate Tenant →</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

              <div className="pt-4 flex justify-end border-t border-slate-100"><button type="button" onClick={handleProfileNext} className="px-7 py-3 text-xs font-black text-white bg-indigo-600 rounded-xl">Continue to Tenant Setup →</button></div>
            </>
          ) : (
            <>
{          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase text-indigo-700 tracking-wider flex items-center gap-2 border-b border-indigo-100 pb-2">
              <span>🏢</span> 1. Pharmacy / Vendor Information
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Company / Pharmacy Name *</label>
                <input
                  type="text"
                  value={formData.companyName}
                  onChange={(e) => handleChange('companyName', e.target.value)}
                  className={`w-full px-3 py-2 text-sm border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none ${
                    fieldErrors.companyName ? 'border-rose-400 bg-rose-50' : 'border-slate-200'
                  }`}
                  placeholder="e.g. Apollo Partner Chemist"
                />
                {fieldErrors.companyName && <p className="text-rose-600 text-xs mt-1">{fieldErrors.companyName}</p>}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Authorized Contact Email (Read-Only)</label>
                <input
                  type="email"
                  value={vendor?.email || ''}
                  disabled
                  className="w-full px-3 py-2 text-sm border border-slate-200 bg-slate-100 text-slate-500 rounded-xl cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Contact Phone / Mobile *</label>
                <input
                  type="tel"
                  value={formData.mobile}
                  onChange={(e) => handleChange('mobile', e.target.value)}
                  className={`w-full px-3 py-2 text-sm border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none ${
                    fieldErrors.mobile ? 'border-rose-400 bg-rose-50' : 'border-slate-200'
                  }`}
                  placeholder="+91 98765 43210"
                />
                {fieldErrors.mobile && <p className="text-rose-600 text-xs mt-1">{fieldErrors.mobile}</p>}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Drug Licence Number *</label>
                <input
                  type="text"
                  value={formData.drugLicenseNumber}
                  onChange={(e) => handleChange('drugLicenseNumber', e.target.value)}
                  className={`w-full px-3 py-2 text-sm border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none uppercase ${fieldErrors.drugLicenseNumber ? 'border-rose-400 bg-rose-50' : 'border-slate-200'}`}
                  placeholder="State pharmacy/drug licence number"
                />
                {fieldErrors.drugLicenseNumber && <p className="text-rose-600 text-xs mt-1">{fieldErrors.drugLicenseNumber}</p>}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">GSTIN / Tax Identification</label>
                <input
                  type="text"
                  value={formData.gstNumber}
                  onChange={(e) => handleChange('gstNumber', e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none uppercase"
                  placeholder="e.g. 23AAAAA0000A1Z5"
                />
              </div>
            </div>
          </div>
          {/* Section 2: Address Information */}
          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase text-indigo-700 tracking-wider flex items-center gap-2 border-b border-indigo-100 pb-2">
              <span>📍</span> 2. Physical Pharmacy Location
            </h3>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Street Address</label>
                <input
                  type="text"
                  value={formData.street}
                  onChange={(e) => handleChange('street', e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder="Shop No. 12, Commercial Complex, Main Road"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">City *</label>
                  <input
                    type="text"
                    value={formData.city}
                    onChange={(e) => handleChange('city', e.target.value)}
                    className={`w-full px-3 py-2 text-sm border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none ${
                      fieldErrors.city ? 'border-rose-400 bg-rose-50' : 'border-slate-200'
                    }`}
                    placeholder="Indore"
                  />
                  {fieldErrors.city && <p className="text-rose-600 text-xs mt-1">{fieldErrors.city}</p>}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">State *</label>
                  <input
                    type="text"
                    value={formData.state}
                    onChange={(e) => handleChange('state', e.target.value)}
                    className={`w-full px-3 py-2 text-sm border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none ${
                      fieldErrors.state ? 'border-rose-400 bg-rose-50' : 'border-slate-200'
                    }`}
                    placeholder="Madhya Pradesh"
                  />
                  {fieldErrors.state && <p className="text-rose-600 text-xs mt-1">{fieldErrors.state}</p>}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Pincode *</label>
                  <input
                    type="text"
                    value={formData.pincode}
                    onChange={(e) => handleChange('pincode', e.target.value)}
                    className={`w-full px-3 py-2 text-sm border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none ${
                      fieldErrors.pincode ? 'border-rose-400 bg-rose-50' : 'border-slate-200'
                    }`}
                    placeholder="452001"
                  />
                  {fieldErrors.pincode && <p className="text-rose-600 text-xs mt-1">{fieldErrors.pincode}</p>}
                </div>
              </div>
            </div>
          </div>


              <div className="pt-4 flex items-center justify-between gap-3 border-t border-slate-100">
                <button type="button" onClick={()=>setStep(1)} className="px-5 py-2.5 text-xs font-bold text-slate-600 rounded-xl">← Back to Profile</button>
                <button type="submit" disabled={submitting} className="px-7 py-3 text-xs font-black text-white bg-indigo-600 rounded-xl">{submitting ? 'Activating Tenant...' : 'Complete Onboarding & Activate Tenant →'}</button>
              </div>
            </>
          )}
          {/* Action Buttons */}
          <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={submitting}
              className="px-7 py-3 text-xs font-black text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-md transition disabled:opacity-50 flex items-center gap-2 cursor-pointer"
            >
              {submitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Activating Workspace...</span>
                </>
              ) : (
                <span>Complete Onboarding & Activate Tenant →</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
