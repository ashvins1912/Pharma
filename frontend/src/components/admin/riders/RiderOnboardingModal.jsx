import React from 'react';
import { useRiderOnboarding } from '../../../hooks/useRiderOnboarding';
import { useToast } from '../../../context/ToastContext';

/**
 * Pure Presentation Component: RiderOnboardingModal
 * Business logic is completely delegated to useRiderOnboarding hook.
 */
export default function RiderOnboardingModal({ isOpen, onClose, onRiderAdded }) {
    const { addToast } = useToast();
    const [locating, setLocating] = React.useState(false);
    const {
        values,
        photoPreview,
        isSubmitting,
        formErrors,
        handleInputChange,
        handleFileChange,
        handleSubmit,
        resetForm,
        setValues
    } = useRiderOnboarding({
        onSuccess: (data) => {
            if (onRiderAdded) onRiderAdded(data.rider);
            onClose();
        }
    });

    if (!isOpen) return null;

    const useCurrentLocation = () => {
        if (!navigator.geolocation) {
            addToast('Current location is not available in this browser.', 'error');
            return;
        }
        setLocating(true);
        navigator.geolocation.getCurrentPosition(
            ({ coords }) => {
                setValues(prev => ({
                    ...prev,
                    latitude: String(coords.latitude),
                    longitude: String(coords.longitude)
                }));
                setLocating(false);
            },
            error => {
                const message = error.code === error.PERMISSION_DENIED
                    ? 'Allow location access in your browser to use your current location.'
                    : error.code === error.POSITION_UNAVAILABLE
                        ? 'Your current location could not be determined.'
                        : 'Timed out while getting your current location. Try again.';
                addToast(message, 'error');
                setLocating(false);
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
        );
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
            <div className="bg-white border border-slate-200 rounded-3xl shadow-2xl max-w-lg w-full p-6 sm:p-8 relative overflow-hidden max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center text-xl shadow-md shadow-blue-500/25">
                            🛵
                        </div>
                        <div>
                            <h3 className="text-lg font-black text-slate-900">Onboard Courier Rider</h3>
                            <p className="text-xs text-slate-500">Add a new delivery partner to the automated dispatch fleet</p>
                        </div>
                    </div>
                    <button
                        onClick={() => {
                            resetForm();
                            onClose();
                        }}
                        className="text-slate-400 hover:text-slate-600 w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 hover:bg-slate-200 transition cursor-pointer"
                    >
                        ✕
                    </button>
                </div>

                {/* Form Error Banner */}
                {formErrors.server && (
                    <div className="mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-center gap-2">
                        <span>⚠️</span>
                        <span>{formErrors.server}</span>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="mt-5 space-y-4">
                    {/* Rider Photo Upload */}
                    <div>
                        <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                            Rider Photo (Uploaded to Storage Driver)
                        </label>
                        <div className="flex items-center gap-4">
                            <div className="w-16 h-16 rounded-2xl bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center flex-shrink-0">
                                {photoPreview ? (
                                    <img src={photoPreview} alt="Preview" className="w-full h-full object-cover" />
                                ) : (
                                    <span className="text-2xl text-slate-300">👤</span>
                                )}
                            </div>
                            <div className="flex-1">
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={handleFileChange}
                                    id="rider-photo-input"
                                    className="hidden"
                                />
                                <label
                                    htmlFor="rider-photo-input"
                                    className="inline-block bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold py-2 px-3.5 rounded-xl cursor-pointer transition border border-slate-200"
                                >
                                    {photoPreview ? 'Change Photo' : 'Upload Profile Picture'}
                                </label>
                                <p className="text-[10px] text-slate-400 mt-1">PNG, JPG, or WebP up to 5MB (Supabase Storage)</p>
                            </div>
                        </div>
                        {formErrors.photo && <p className="text-[11px] text-rose-500 mt-1">{formErrors.photo}</p>}
                    </div>

                    {/* Name & Mobile */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                                Full Name *
                            </label>
                            <input
                                type="text"
                                name="name"
                                value={values.name}
                                onChange={handleInputChange}
                                placeholder="e.g. Vikram Sharma"
                                className={`w-full px-3.5 py-2.5 text-xs bg-slate-50 border rounded-xl outline-none transition focus:bg-white ${
                                    formErrors.name ? 'border-rose-400' : 'border-slate-200 focus:border-blue-500'
                                }`}
                                required
                            />
                            {formErrors.name && <p className="text-[11px] text-rose-500 mt-0.5">{formErrors.name}</p>}
                        </div>

                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                                Mobile Number * (Unique)
                            </label>
                            <input
                                type="text"
                                name="mobile"
                                value={values.mobile}
                                onChange={handleInputChange}
                                placeholder="e.g. +91 98765 43210"
                                className={`w-full px-3.5 py-2.5 text-xs bg-slate-50 border rounded-xl outline-none transition focus:bg-white ${
                                    formErrors.mobile ? 'border-rose-400' : 'border-slate-200 focus:border-blue-500'
                                }`}
                                required
                            />
                            {formErrors.mobile && <p className="text-[11px] text-rose-500 mt-0.5">{formErrors.mobile}</p>}
                        </div>
                    </div>

                    {/* Vehicle Type */}
                    <div>
                        <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                            Dispatch Vehicle Type
                        </label>
                        <select
                            name="vehicleType"
                            value={values.vehicleType}
                            onChange={handleInputChange}
                            className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:bg-white transition"
                        >
                            <option value="EV Bike">⚡ EV Bike (Eco-delivery)</option>
                            <option value="Bike">🏍️ Motorbike</option>
                            <option value="Scooter">🛵 Scooter</option>
                            <option value="Cycle">🚲 Bicycle (Micro-hub)</option>
                        </select>
                    </div>

                    {/* Initial GPS Location & Presets */}
                    <div>
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                                Initial GPS Coordinates (GeoJSON)
                            </label>
                            <button
                                type="button"
                                onClick={useCurrentLocation}
                                disabled={locating}
                                className="text-[10px] bg-blue-50 hover:bg-blue-100 text-blue-700 px-2.5 py-1.5 rounded-lg font-bold transition disabled:opacity-50"
                            >
                                {locating ? 'Getting location...' : 'Use my current location'}
                            </button>
                        </div>
                        <p className="mb-2 text-[10px] text-slate-400">
                            Use your device location or enter coordinates manually. Quick hub presets are disabled.
                        </p>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <input
                                    type="text"
                                    name="latitude"
                                    value={values.latitude}
                                    onChange={handleInputChange}
                                    placeholder="Latitude"
                                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:bg-white transition"
                                />
                                {formErrors.latitude && <p className="text-[10px] text-rose-500">{formErrors.latitude}</p>}
                            </div>
                            <div>
                                <input
                                    type="text"
                                    name="longitude"
                                    value={values.longitude}
                                    onChange={handleInputChange}
                                    placeholder="Longitude"
                                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:bg-white transition"
                                />
                                {formErrors.longitude && <p className="text-[10px] text-rose-500">{formErrors.longitude}</p>}
                            </div>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
                        <button
                            type="button"
                            onClick={() => {
                                resetForm();
                                onClose();
                            }}
                            className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-black text-xs px-5 py-2.5 rounded-xl shadow-md shadow-blue-500/20 transition cursor-pointer flex items-center gap-1.5"
                        >
                            {isSubmitting ? (
                                <>
                                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                                    <span>Registering...</span>
                                </>
                            ) : (
                                <>
                                    <span>➕</span>
                                    <span>Onboard Rider</span>
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
