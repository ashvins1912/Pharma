import React, { createContext, useContext, useState } from 'react';
import apiClient from '../api/apiClient';

const AppContext = createContext();

export function AppProvider({ children }) {
    const [medicines, setMedicines] = useState([]);
    const [cart, setCart] = useState([]);
    const [selectedAddressId, setSelectedAddressId] = useState('');
    const [globalError, setGlobalError] = useState('');

    const fetchMedicines = async (filters = { query: '', hideRx: false }) => {
        try {
            setGlobalError('');
            const res = await apiClient.get('/api/medicines', { params: { search: filters.query, hideRx: filters.hideRx } });
            setMedicines(res.data);
        } catch (err) { setGlobalError(err.message); }
    };

    const addToCart = (med) => {
        setCart((curr) => {
            const found = curr.find(i => i._id === med._id);
            if (found) {
                if (found.quantity >= med.stock) { alert(`❌ Stock threshold reached! Only ${med.stock} packets available.`); return curr; }
                return curr.map(i => i._id === med._id ? { ...i, quantity: i.quantity + 1 } : i);
            }
            return [...curr, { ...med, quantity: 1 }];
        });
    };

    const updateQuantity = (id, delta) => {
        setCart(c => c.map(i => i._id === id ? { ...i, quantity: i.quantity + delta } : i).filter(i => i.quantity > 0));
    };

    return (
        <AppContext.Provider value={{ medicines, cart, selectedAddressId, setSelectedAddressId, globalError, setGlobalError, fetchMedicines, addToCart, updateQuantity, clearCart: () => setCart([]) }}>
            {children}
        </AppContext.Provider>
    );
}

export const useApp = () => useContext(AppContext);