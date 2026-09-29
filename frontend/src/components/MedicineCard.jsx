import React from 'react';
export default function MedicineCard({ med, onAddToCart }) {
    const isOut = med.stock <= 0;
    return (
        <div className={`bg-white border rounded-2xl p-3 flex flex-col justify-between ${isOut ? 'opacity-50 bg-slate-50' : 'hover:shadow-sm'}`}>
            <div>
                <div className="w-full h-24 sm:h-32 bg-slate-50 rounded-xl overflow-hidden mb-3 flex items-center justify-center">
                    <img src={med.imageUrl} alt={med.name} className="w-full h-full object-contain p-2 mix-blend-multiply" loading="lazy" onError={e=>{e.target.src="https://placehold.co";}}/>
                </div>
                <div className="flex justify-between items-start gap-1 text-xs font-bold">
                    <h4 className="line-clamp-2 text-slate-800 leading-tight">{med.name}</h4>
                    {med.requiresPrescription && <span className="text-[8px] bg-rose-50 text-rose-600 border px-1 rounded">Rx</span>}
                </div>
            </div>
            <div className="mt-4">
                <div className="flex justify-between text-xs mb-2"><span>Price</span><span className="font-bold text-emerald-600">₹{med.price}</span></div>
                <button onClick={() => !isOut && onAddToCart(med)} disabled={isOut} className="w-full bg-blue-600 text-white font-bold text-xs py-2 rounded-xl cursor-pointer disabled:bg-slate-300">
                    {isOut ? 'Sold Out' : '+ Add'}
                </button>
            </div>
        </div>
    );
}
