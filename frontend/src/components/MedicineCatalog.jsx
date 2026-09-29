import React from 'react';
import MedicineCard from './MedicineCard';
export default function MedicineCatalog({ medicines, onAddToCart }) {
    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {medicines.map(med => <MedicineCard key={med._id} med={med} onAddToCart={onAddToCart} />)}
        </div>
    );
}


