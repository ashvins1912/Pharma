import React, { useState } from 'react';
import apiClient from '../../api/apiClient';

export default function TenantOnboardingView({ onSuccess }) {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    shopName: '',
    street: '',
    city: '',
    state: '',
    zipCode: '',
    longitude: '',
    latitude: '',
    shopPhotoUrl: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&q=80',
    ownerName: '',
    ownerEmail: '',
    ownerPhone: '',
    isOwnerAdmin: true,
    adminName: '',
    adminEmail: '',
    adminPassword: '',
    adminRole: 'TENANT_ADMIN'
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleGeolocation = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser');
      return;
    }
    setError('');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setFormData(prev => ({
          ...prev,
          longitude: position.coords.longitude.toString(),
          latitude: position.coords.latitude.toString()
        }));
      },
      (err) => {
        setError(`Unable to retrieve your location: ${err.message}`);
      }
    );
  };

  const validateStep = (currentStep) => {
    setError('');
    if (currentStep === 1) {
      if (!formData.shopName.trim() || !formData.street.trim() || !formData.city.trim() || !formData.state.trim() || !formData.zipCode.trim()) {
        setError('Please fill in all mandatory shop details and address fields.');
        return false;
      }
    }
    if (currentStep === 2) {
      const lng = parseFloat(formData.longitude);
      const lat = parseFloat(formData.latitude);
      if (Number.isNaN(lng) || Number.isNaN(lat)) {
        setError('Please use the Geolocation button to auto-populate valid longitude and latitude coordinates.');
        return false;
      }
      if (!formData.shopPhotoUrl.trim()) {
        setError('Please provide a valid shop photo URL.');
        return false;
      }
    }
    if (currentStep === 3) {
      if (!formData.ownerName.trim() || !formData.ownerEmail.trim() || !formData.ownerPhone.trim()) {
        setError('Please complete all mandatory owner contact details.');
        return false;
      }
      if (!formData.isOwnerAdmin) {
        if (!formData.adminName.trim() || !formData.adminEmail.trim() || !formData.adminPassword.trim()) {
          setError('Please complete all standalone administrative account details.');
          return false;
        }
      }
    }
    return true;
  };

  const handleNext = () => {
    if (validateStep(step)) {
      setStep(prev => Math.min(prev + 1, 3));
    }
  };

  const handlePrev = () => {
    setError('');
    setStep(prev => Math.max(prev - 1, 1));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateStep(3)) return;

    setError('');
    setSuccessMsg('');
    setLoading(true);

    try {
      const lng = parseFloat(formData.longitude);
      const lat = parseFloat(formData.latitude);

      const payload = {
        shopName: formData.shopName.trim(),
        address: {
          street: formData.street.trim(),
          city: formData.city.trim(),
          state: formData.state.trim(),
          zipCode: formData.zipCode.trim()
        },
        geoLocation: {
          type: 'Point',
          coordinates: [lng, lat]
        },
        shopPhotoUrl: formData.shopPhotoUrl.trim(),
        ownerDetails: {
          name: formData.ownerName.trim(),
          email: formData.ownerEmail.toLowerCase().trim(),
          phone: formData.ownerPhone.trim()
        },
        isOwnerAdmin: formData.isOwnerAdmin,
        adminDetails: formData.isOwnerAdmin ? undefined : {
          name: formData.adminName.trim(),
          email: formData.adminEmail.toLowerCase().trim(),
          passwordHash: formData.adminPassword,
          role: formData.adminRole
        }
      };

      const response = await apiClient.post('/api/tenant/onboard', payload);
      setSuccessMsg(`Tenant "${response.data.shopName}" successfully registered and onboarded!`);
      if (onSuccess) onSuccess(response.data);
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Tenant onboarding failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-8 bg-white dark:bg-gray-900 rounded-3xl shadow-2xl border border-gray-100 dark:border-gray-800 my-8">
      {/* Header & Step Indicator */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Pharmacy Tenant Registration</h2>
          <span className="text-xs font-semibold px-3 py-1 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 rounded-full">
            Step {step} of 3
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className={`h-2 rounded-full transition-all ${step >= 1 ? 'bg-emerald-600' : 'bg-gray-200 dark:bg-gray-800'}`} />
          <div className={`h-2 rounded-full transition-all ${step >= 2 ? 'bg-emerald-600' : 'bg-gray-200 dark:bg-gray-800'}`} />
          <div className={`h-2 rounded-full transition-all ${step >= 3 ? 'bg-emerald-600' : 'bg-gray-200 dark:bg-gray-800'}`} />
        </div>
        <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-2 font-medium">
          <span className={step === 1 ? 'text-emerald-600 font-bold' : ''}>1. Shop & Address</span>
          <span className={step === 2 ? 'text-emerald-600 font-bold' : ''}>2. Location & Media</span>
          <span className={step === 3 ? 'text-emerald-600 font-bold' : ''}>3. Owner & Admin</span>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 rounded-2xl text-sm">
          {error}
        </div>
      )}

      {successMsg && (
        <div className="mb-6 p-4 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300 rounded-2xl text-sm">
          {successMsg}
        </div>
      )}

      <form onSubmit={step === 3 ? handleSubmit : (e) => e.preventDefault()} className="space-y-6">
        {/* STEP 1: Shop & Address Details */}
        {step === 1 && (
          <div className="space-y-4 animate-fadeIn">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Shop Information & Physical Address</h3>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Shop Name *</label>
              <input
                type="text"
                name="shopName"
                required
                value={formData.shopName}
                onChange={handleChange}
                placeholder="e.g. Metro Health Pharmacy"
                className="w-full px-4 py-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Street Address *</label>
              <input
                type="text"
                name="street"
                required
                value={formData.street}
                onChange={handleChange}
                placeholder="123 Healthcare Ave"
                className="w-full px-4 py-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none transition"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">City *</label>
                <input
                  type="text"
                  name="city"
                  required
                  value={formData.city}
                  onChange={handleChange}
                  placeholder="City"
                  className="w-full px-4 py-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">State *</label>
                <input
                  type="text"
                  name="state"
                  required
                  value={formData.state}
                  onChange={handleChange}
                  placeholder="State"
                  className="w-full px-4 py-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Zip Code *</label>
                <input
                  type="text"
                  name="zipCode"
                  required
                  value={formData.zipCode}
                  onChange={handleChange}
                  placeholder="Zip Code"
                  className="w-full px-4 py-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none transition"
                />
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: Geolocation & Storefront Photo */}
        {step === 2 && (
          <div className="space-y-6 animate-fadeIn">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Geolocation & Storefront Image</h3>
            
            <div className="p-5 bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/50 rounded-2xl">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h4 className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">Browser Geolocation Sensor</h4>
                  <p className="text-xs text-emerald-700 dark:text-emerald-400">Auto-populate precise GPS shop coordinates for delivery dispatch.</p>
                </div>
                <button
                  type="button"
                  onClick={handleGeolocation}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl shadow-md transition flex items-center gap-1.5"
                >
                  📍 Detect Coordinates
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4 mt-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Longitude *</label>
                  <input
                    type="number"
                    step="any"
                    name="longitude"
                    required
                    value={formData.longitude}
                    onChange={handleChange}
                    placeholder="e.g. 77.2090"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Latitude *</label>
                  <input
                    type="number"
                    step="any"
                    name="latitude"
                    required
                    value={formData.latitude}
                    onChange={handleChange}
                    placeholder="e.g. 28.6139"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Shop Photo URL *</label>
              <input
                type="url"
                name="shopPhotoUrl"
                required
                value={formData.shopPhotoUrl}
                onChange={handleChange}
                placeholder="https://images.unsplash.com/photo-..."
                className="w-full px-4 py-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none transition"
              />
              <p className="text-xs text-gray-400 mt-1">Provide a direct persistent image link of the pharmacy storefront.</p>
            </div>
          </div>
        )}

        {/* STEP 3: Owner & Administrative User Setup */}
        {step === 3 && (
          <div className="space-y-6 animate-fadeIn">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Owner & Administrative User Accounts</h3>
            
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Owner Contact Details</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Owner Name *</label>
                  <input
                    type="text"
                    name="ownerName"
                    required
                    value={formData.ownerName}
                    onChange={handleChange}
                    placeholder="Full Name"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Owner Email *</label>
                  <input
                    type="email"
                    name="ownerEmail"
                    required
                    value={formData.ownerEmail}
                    onChange={handleChange}
                    placeholder="owner@pharmacy.com"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Owner Phone *</label>
                  <input
                    type="tel"
                    name="ownerPhone"
                    required
                    value={formData.ownerPhone}
                    onChange={handleChange}
                    placeholder="+19876543210"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                  />
                </div>
              </div>
            </div>

            <div className="border-t border-gray-100 dark:border-gray-800 pt-6">
              <label className="flex items-center space-x-3 cursor-pointer p-4 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-gray-200 dark:border-gray-700">
                <input
                  type="checkbox"
                  name="isOwnerAdmin"
                  checked={formData.isOwnerAdmin}
                  onChange={handleChange}
                  className="w-5 h-5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                />
                <div>
                  <span className="text-sm font-semibold text-gray-900 dark:text-white block">
                    Owner acts as initial Tenant Administrator
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    Automatically provisions the owner credentials with administrative permissions.
                  </span>
                </div>
              </label>

              {!formData.isOwnerAdmin && (
                <div className="mt-4 p-5 bg-gray-50 dark:bg-gray-800/50 rounded-2xl space-y-4 border border-gray-200 dark:border-gray-700 animate-fadeIn">
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Standalone Admin Account Setup</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Admin Name *</label>
                      <input
                        type="text"
                        name="adminName"
                        required={!formData.isOwnerAdmin}
                        value={formData.adminName}
                        onChange={handleChange}
                        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Admin Email *</label>
                      <input
                        type="email"
                        name="adminEmail"
                        required={!formData.isOwnerAdmin}
                        value={formData.adminEmail}
                        onChange={handleChange}
                        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Password Hash / Secret *</label>
                      <input
                        type="password"
                        name="adminPassword"
                        required={!formData.isOwnerAdmin}
                        value={formData.adminPassword}
                        onChange={handleChange}
                        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Role *</label>
                      <select
                        name="adminRole"
                        value={formData.adminRole}
                        onChange={handleChange}
                        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm"
                      >
                        <option value="TENANT_ADMIN">TENANT_ADMIN</option>
                        <option value="MANAGER">MANAGER</option>
                        <option value="OPERATOR">OPERATOR</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Navigation Actions */}
        <div className="flex items-center justify-between pt-6 border-t border-gray-100 dark:border-gray-800">
          {step > 1 ? (
            <button
              type="button"
              onClick={handlePrev}
              className="px-6 py-3 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-semibold rounded-2xl transition"
            >
              Back
            </button>
          ) : <div />}

          {step < 3 ? (
            <button
              type="button"
              onClick={handleNext}
              className="px-8 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-2xl shadow-lg transition"
            >
              Continue
            </button>
          ) : (
            <button
              type="submit"
              disabled={loading}
              className="px-8 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-2xl shadow-lg transition disabled:opacity-50"
            >
              {loading ? 'Registering Tenant...' : 'Complete Registration'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
