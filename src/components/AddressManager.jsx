import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';

const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
let googlePlacesScriptPromise;

function loadGooglePlaces() {
  if (window.google?.maps?.places?.PlaceAutocompleteElement || window.google?.maps?.places?.Autocomplete) {
    return Promise.resolve(window.google.maps.places);
  }
  if (googlePlacesScriptPromise) return googlePlacesScriptPromise;

  googlePlacesScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.id = 'google-maps-places-script';
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(googleMapsApiKey)}&libraries=places&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.maps?.places?.PlaceAutocompleteElement || window.google?.maps?.places?.Autocomplete) {
        resolve(window.google.maps.places);
      } else {
        googlePlacesScriptPromise = null;
        reject(new Error('Google Places library did not load.'));
      }
    };
    script.onerror = () => {
      googlePlacesScriptPromise = null;
      reject(new Error('Google Maps could not be loaded.'));
    };
    document.head.appendChild(script);
  });

  return googlePlacesScriptPromise;
}

export default function AddressManager({ isSelectOnly = false, onAddressSelected }) {
  const { addresses, selectedAddressId, setSelectedAddressId, saveAddress } = useApp();
  const { addToast } = useToast();

  const [showAddForm, setShowAddForm] = useState(false);
  const [gpsStatus, setGpsStatus] = useState('');
  const [locating, setLocating] = useState(false);
  const [placesStatus, setPlacesStatus] = useState('');
  const [modernPlacesEnabled, setModernPlacesEnabled] = useState(false);
  const addressInputRef = useRef(null);
  const placesWidgetRef = useRef(null);

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

  useEffect(() => {
    if (!showAddForm) return undefined;
    if (!googleMapsApiKey) {
      setPlacesStatus('Address suggestions are not configured. You can still enter your address manually.');
      return undefined;
    }

    let cancelled = false;
    let autocompleteListener;
    let placeAutocomplete;
    let placeSelectedListener;
    const applyPlace = (place) => {
      const components = place.addressComponents || place.address_components || [];
      const getComponent = (type, format = 'long') => {
        const component = components.find((item) => item.types.includes(type));
        return component?.[format === 'short' ? 'shortText' : 'longText'] ||
          component?.[format === 'short' ? 'short_name' : 'long_name'] || '';
      };
      const street = [
        getComponent('subpremise'),
        getComponent('street_number'),
        getComponent('route')
      ].filter(Boolean).join(' ');

      setAddressLine1(
        street || place.displayName || place.name || place.formattedAddress || place.formatted_address || ''
      );
      setAddressLine2(
        getComponent('sublocality_level_1') ||
        getComponent('sublocality') ||
        getComponent('neighborhood')
      );
      setCity(
        getComponent('locality') ||
        getComponent('postal_town') ||
        getComponent('administrative_area_level_2') ||
        city
      );
      setState(getComponent('administrative_area_level_1') || state);
      setPincode(getComponent('postal_code') || pincode);

      const location = place.location || place.geometry?.location;
      if (location) {
        setCoords({ lat: location.lat(), lng: location.lng() });
      }
      setPlacesStatus('✅ Address selected from Google Maps suggestions.');
    };

    loadGooglePlaces()
      .then((places) => {
        if (cancelled) return;

        if (places.PlaceAutocompleteElement && placesWidgetRef.current) {
          placeAutocomplete = new places.PlaceAutocompleteElement({
            includedRegionCodes: ['in']
          });
          placeAutocomplete.style.display = 'block';
          placeAutocomplete.style.width = '100%';
          placeAutocomplete.placeholder = 'Search for your delivery address';
          placeSelectedListener = async (event) => {
            try {
              const place = event.placePrediction.toPlace();
              await place.fetchFields({
                fields: ['addressComponents', 'displayName', 'formattedAddress', 'location']
              });
              applyPlace(place);
            } catch {
              setPlacesStatus('Could not load that address. Please choose another suggestion or enter it manually.');
            }
          };
          placeAutocomplete.addEventListener('gmp-select', placeSelectedListener);
          placesWidgetRef.current.replaceChildren(placeAutocomplete);
          setModernPlacesEnabled(true);
          setPlacesStatus('Type an address and choose a Google Maps suggestion to autofill the details.');
          return;
        }

        if (!places.Autocomplete || !addressInputRef.current) {
          throw new Error('Google Places autocomplete is unavailable.');
        }

        const autocomplete = new places.Autocomplete(addressInputRef.current, {
          componentRestrictions: { country: 'in' },
          fields: ['address_components', 'formatted_address', 'geometry', 'name']
        });
        autocompleteListener = autocomplete.addListener('place_changed', () => {
          applyPlace(autocomplete.getPlace());
          setPlacesStatus('✅ Address selected from Google Maps suggestions.');
        });
        setPlacesStatus('Type an address and choose a Google Maps suggestion to autofill the details.');
      })
      .catch(() => {
        if (!cancelled) {
          setModernPlacesEnabled(false);
          setPlacesStatus('Address suggestions could not be loaded. You can enter your address manually.');
        }
      });

    return () => {
      cancelled = true;
      autocompleteListener?.remove();
      if (placeAutocomplete && placeSelectedListener) {
        placeAutocomplete.removeEventListener('gmp-select', placeSelectedListener);
        placeAutocomplete.remove();
      }
    };
  }, [showAddForm]);

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
    if (!window.isSecureContext && window.location.hostname !== 'localhost') {
      setGpsStatus('Location requires a secure HTTPS connection. Enter your address manually or open this site over HTTPS.');
      return;
    }

    if (!navigator.geolocation) {
      setGpsStatus('Location is not supported by this browser. You can enter your address manually.');
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setCoords({ lat: latitude, lng: longitude });
        setGpsStatus(`✅ Location pinned (${latitude.toFixed(4)}, ${longitude.toFixed(4)}). Enter your street address below.`);
        setLocating(false);
        addToast('Location pinned from device GPS!', 'success');
      },
      (error) => {
        setLocating(false);
        if (error.code === error.PERMISSION_DENIED) {
          setGpsStatus('Location access is blocked. Allow location access for this site in your browser settings, then try again.');
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          setGpsStatus('Your device could not determine your location. Turn on location services or enter your address manually.');
        } else if (error.code === error.TIMEOUT) {
          setGpsStatus('Location request timed out. Check your device location services and try again, or enter your address manually.');
        } else {
          setGpsStatus('Could not detect your location. Check browser permissions and device location services, or enter your address manually.');
        }
      },
      { timeout: 15000, enableHighAccuracy: false, maximumAge: 60_000 }
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!addressLine1.trim()) {
      setPlacesStatus('Choose a suggested location or enter your street address before saving.');
      return;
    }

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
              <div ref={placesWidgetRef}>
                <input
                  ref={addressInputRef}
                  type="text"
                  placeholder="e.g. Flat 402, Greenfield Heights, Richmond Road"
                  value={addressLine1}
                  onChange={(e) => setAddressLine1(e.target.value)}
                  className={`w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 ${modernPlacesEnabled ? 'hidden' : ''}`}
                  required={!modernPlacesEnabled}
                />
              </div>
            </div>
            {placesStatus && (
              <p className={`text-[11px] font-medium ${placesStatus.includes('✅') ? 'text-emerald-700' : 'text-slate-500'}`}>
                {placesStatus}
              </p>
            )}
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
