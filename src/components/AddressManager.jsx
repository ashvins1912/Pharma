import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';

export default function AddressManager({ isSelectOnly = false, onAddressSelected }) {
  const { addresses, selectedAddressId, setSelectedAddressId, saveAddress } = useApp();
  const { addToast } = useToast();

  const [showAddForm, setShowAddForm] = useState(false);
  const [gpsStatus, setGpsStatus] = useState('');
  const [locating, setLocating] = useState(false);

  // Form Fields
  const [label, setLabel] = useState('Home');
  const [fullName, setFullName] = useState('');
  const [mobile, setMobile] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState('Bengaluru');
  const [state, setState] = useState('Karnataka');
  const [pincode, setPincode] = useState('560025');
  const [landmark, setLandmark] = useState('');
  const [coords, setCoords] = useState({ lat: 12.9716, lng: 77.5946 });
  const [isDefault, setIsDefault] = useState(false);

  const getLabelIcon = (lbl) => {
    switch (lbl) {
      case 'Home': return '🏠';
      case 'Office': return '💼';
      case 'Hospital': return '🏥';
      default: return '📍';
    }
  };

  const handleUseCurrentLocation = () => {
    setGpsStatus('');
    if (!navigator.geolocation) {
      setGpsStatus('Location permission was unavailable. You can enter your address manually.');
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setCoords({ lat: latitude, lng: longitude });
        setAddressLine1(`Location Coordinates: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
        setLandmark('GPS Mapped Location');
        setGpsStatus('✅ Location detected successfully via device GPS.');
        setLocating(false);
        addToast('Location pinned from device GPS!', 'success');
      },
      (error) => {
        setLocating(false);
        setGpsStatus('Location permission was unavailable. You can enter your address manually.');
        setCoords({ lat: 12.9716, lng: 77.5946 });
      },
      { timeout: 7000, enableHighAccuracy: true }
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!addressLine1.trim()) return;

    const fullLine = `${addressLine1} ${addressLine2 ? `, ${addressLine2}` : ''}, ${city}, ${state} - ${pincode}`;
    const newAddress = {
      label,
      fullName: fullName || 'Patient Attendant',
      mobile: mobile || '+91 95899 16475',
      addressLine1,
      addressLine2,
      city,
      state,
      pincode,
      landmark,
      addressLine: fullLine,
      coordinates: coords,
      isDefault
    };

    const success = await saveAddress(newAddress);
    if (success) {
      setShowAddForm(false);
      // Reset form
      setAddressLine1('');
      setAddressLine2('');
      setLandmark('');
      setGpsStatus('');
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-5 sm:p-6 shadow-sm space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-extrabold text-slate-900">
            {isSelectOnly ? 'Delivery Address' : 'Multi-Address Directory'}
          </h3>
          <p className="text-xs text-slate-500">
            {isSelectOnly
              ? 'Select your delivery destination with one tap.'
              : 'Manage saved addresses for quick prescription deliveries.'}
          </p>
        </div>

        {!showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            className="bg-blue-50 hover:bg-blue-100 text-blue-700 font-extrabold text-xs px-3.5 py-2 rounded-xl transition cursor-pointer flex items-center gap-1.5"
          >
            <span>+</span>
            <span>Add Address</span>
          </button>
        )}
      </div>

      {/* Address List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {addresses.map((addr) => {
          const id = addr._id || addr.id;
          const isSelected = selectedAddressId === id;

          return (
            <div
              key={id}
              onClick={() => {
                setSelectedAddressId(id);
                if (onAddressSelected) onAddressSelected(addr);
              }}
              className={`p-4 rounded-2xl border-2 transition cursor-pointer flex items-start gap-3 relative ${
                isSelected
                  ? 'border-blue-600 bg-blue-50/50 shadow-sm'
                  : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
              }`}
            >
              <span className="text-2xl mt-0.5">{getLabelIcon(addr.label)}</span>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-black text-slate-900 uppercase tracking-wide">
                    {addr.label}
                  </span>
                  {addr.isDefault && (
                    <span className="bg-slate-200 text-slate-700 text-[10px] font-black px-1.5 py-0.2 rounded">
                      Default
                    </span>
                  )}
                </div>

                <p className="text-xs font-bold text-slate-700 truncate">{addr.fullName || 'Resident'}</p>
                <p className="text-[11px] text-slate-600 leading-snug mt-0.5 line-clamp-2">
                  {addr.addressLine || `${addr.addressLine1}, ${addr.city} - ${addr.pincode}`}
                </p>
                {addr.landmark && (
                  <p className="text-[10px] text-slate-400 mt-1">Landmark: {addr.landmark}</p>
                )}
                <p className="text-[10px] text-slate-500 font-medium mt-1">📞 {addr.mobile}</p>
              </div>

              <div className="flex items-center justify-center w-5 h-5 rounded-full border-2 border-slate-300 mt-0.5 flex-shrink-0">
                {isSelected && <div className="w-2.5 h-2.5 rounded-full bg-blue-600"></div>}
              </div>
            </div>
          );
        })}
      </div>

      {addresses.length === 0 && !showAddForm && (
        <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 space-y-2">
          <p className="text-2xl">🏠</p>
          <p className="text-xs font-bold text-slate-600">No saved addresses yet</p>
          <p className="text-[11px] text-slate-400">Add your home, office, or hospital address for delivery.</p>
          <button
            onClick={() => setShowAddForm(true)}
            className="mt-2 bg-blue-600 text-white font-bold text-xs px-4 py-2 rounded-xl cursor-pointer"
          >
            + Add First Address
          </button>
        </div>
      )}

      {/* Add New Address Form */}
      {showAddForm && (
        <form onSubmit={handleSubmit} className="border-t border-slate-200 pt-5 space-y-4 animate-fade-in">
          <div className="flex justify-between items-center">
            <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">
              ➕ Add New Delivery Address
            </h4>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="text-xs text-slate-400 hover:text-slate-600 font-bold"
            >
              Cancel
            </button>
          </div>

          {/* GPS Autofill Button */}
          <div className="space-y-1">
            <button
              type="button"
              onClick={handleUseCurrentLocation}
              disabled={locating}
              className="w-full bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 text-xs font-extrabold py-2.5 rounded-xl cursor-pointer transition flex items-center justify-center gap-2"
            >
              <span>📍</span>
              <span>{locating ? 'Locating device GPS...' : 'Use My Current Location'}</span>
            </button>
            {gpsStatus && (
              <p className={`text-[11px] font-semibold text-center mt-1 ${gpsStatus.includes('✅') ? 'text-emerald-700' : 'text-amber-700'}`}>
                {gpsStatus}
              </p>
            )}
          </div>

          {/* Label selector */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
              Address Label
            </label>
            <div className="grid grid-cols-4 gap-2">
              {['Home', 'Office', 'Hospital', 'Other'].map((l) => (
                <button
                  type="button"
                  key={l}
                  onClick={() => setLabel(l)}
                  className={`py-2 text-xs font-bold rounded-xl border transition cursor-pointer flex items-center justify-center gap-1 ${
                    label === l
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span>{getLabelIcon(l)}</span>
                  <span>{l}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Name & Mobile */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Full Name
              </label>
              <input
                type="text"
                placeholder="Receiver name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Contact Mobile
              </label>
              <input
                type="tel"
                placeholder="+91 95899 16475"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500"
                required
              />
            </div>
          </div>

          {/* Address Line 1 & Line 2 */}
          <div className="space-y-2">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Flat / House No. / Building / Street
              </label>
              <input
                type="text"
                placeholder="e.g. Flat 402, Greenfield Heights, Richmond Road"
                value={addressLine1}
                onChange={(e) => setAddressLine1(e.target.value)}
                className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Area / Colony / Sector
              </label>
              <input
                type="text"
                placeholder="e.g. Shanthala Nagar"
                value={addressLine2}
                onChange={(e) => setAddressLine2(e.target.value)}
                className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* City, State, Pincode, Landmark */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">City</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">State</label>
              <input
                type="text"
                value={state}
                onChange={(e) => setState(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Pincode</label>
              <input
                type="text"
                value={pincode}
                onChange={(e) => setPincode(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Landmark</label>
              <input
                type="text"
                placeholder="Near Circle"
                value={landmark}
                onChange={(e) => setLandmark(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-600 font-semibold cursor-pointer">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="rounded text-blue-600 cursor-pointer"
            />
            <span>Set as default delivery address</span>
          </label>

          <button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold py-2.5 rounded-xl text-xs shadow-md transition cursor-pointer"
          >
            Save Address Node
          </button>
        </form>
      )}
    </div>
  );
}
