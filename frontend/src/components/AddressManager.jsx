import React, { useState, useEffect } from 'react';
import apiClient from '../api/apiClient';
import { useApp } from '../context/AppContext';
import axios from 'axios';

export default function AddressManager({ session }) {
    const { selectedAddressId, setSelectedAddressId } = useApp();
    const [addresses, setAddresses] = useState([]);
    const [mobile, setMobile] = useState('');
    const [label, setLabel] = useState('Home');
    const [line, setLine] = useState('');
    const [status, setStatus] = useState('');

    useEffect(() => { if (session) loadProfile(); }, [session]);

    const loadProfile = async () => {
        const res = await apiClient.get('/api/user/profile');
        if (res.data) { setMobile(res.data.mobile || ''); setAddresses(res.data.addresses || []); }
    };

    const getGPS = () => {
        setStatus('Pinpointing location coordinate matrices...');
        if (!navigator.geolocation) return setStatus('GPS Hardware Unsupported');
        navigator.geolocation.getCurrentPosition(async (pos) => {
            const { latitude, longitude } = pos.coords;
            try {
                const geo = await axios.get(`https://openstreetmap.org{latitude}&lon=${longitude}`);
                setLine(geo.data.display_name || `Coordinates: ${latitude}, ${longitude}`);
                window.currentCoords = { lat: latitude, lng: longitude };
                setStatus('✅ Location securely locked via phone hardware GPS.');
            } catch { setLine(`📍 GPS Node: ${latitude}, ${longitude}`); window.currentCoords = { lat: latitude, lng: longitude }; setStatus('✅ Coordinates Mapped'); }
        }, () => setStatus('🔒 Location permissions denied'), { enableHighAccuracy: true });
    };

    const saveAddress = async (e) => {
        e.preventDefault();
        const coords = window.currentCoords || { lat: 12.9716, lng: 77.5946 };
        const updated = [...addresses, { label, addressLine: line, coordinates: coords }];
        await apiClient.post('/api/user/profile', { mobile: mobile || "9589916475", addresses: updated });
        setLine(''); window.currentCoords = null; setStatus(''); loadProfile();
    };

    return (
        <div className="bg-white border p-4 rounded-2xl shadow-sm space-y-4">
            <h3 className="font-bold text-xs text-slate-400 uppercase tracking-wider">🏠 Choose Shipping Destination</h3>
            <div className="space-y-2">
                {addresses.map(a => (
                    <label key={a._id} className={`flex items-start gap-3 p-3 rounded-xl border text-xs cursor-pointer ${selectedAddressId === a._id ? 'border-blue-500 bg-blue-50/40':'border-slate-100'}`}>
                        <input type="radio" checked={selectedAddressId === a._id} onChange={() => setSelectedAddressId(a._id)} className="mt-0.5"/>
                        <div><span className="bg-slate-200 px-1.5 py-0.5 font-bold rounded text-[10px]">{a.label}</span><p className="mt-1 text-slate-600">{a.addressLine}</p></div>
                    </label>
                ))}
            </div>
            <form onSubmit={saveAddress} className="border-t pt-3 space-y-2">
                <button type="button" onClick={getGPS} className="w-full bg-emerald-50 text-emerald-700 font-bold border border-emerald-200 text-xs py-2 rounded-xl cursor-pointer">📍 Autofill via Phone GPS</button>
                {status && <p className="text-[10px] text-center font-bold text-blue-600">{status}</p>}
                <textarea placeholder="Manual landmark info..." value={line} onChange={e=>setLine(e.target.value)} className="w-full text-xs border p-2 rounded-xl h-12 focus:outline-none resize-none" required/>
                <button type="submit" className="w-full bg-blue-600 text-white font-bold py-2 rounded-xl text-xs cursor-pointer">Save Address Node</button>
            </form>
        </div>
    );
}