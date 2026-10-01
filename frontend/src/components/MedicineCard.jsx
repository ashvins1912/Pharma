import React from 'react';

export default function MedicineCard({ med, onAddToCart }) {
    const stock = med.stock !== undefined ? med.stock : (med.quantity || 0);
    const isOut = stock <= 0;

    return (
        <div className={`bg-white border border-slate-200 rounded-2xl p-3 flex flex-col justify-between transition ${isOut ? 'opacity-50 bg-slate-50' : 'hover:shadow-sm hover:border-slate-300'}`}>
            <div>
                <div className="w-full h-28 sm:h-36 bg-slate-50 rounded-xl overflow-hidden mb-3 flex items-center justify-center relative">
                    <img
                        src={med.imageUrl || "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300&q=80"}
                        alt={med.name}
                        className="w-full h-full object-cover p-1 rounded-xl"
                        loading="lazy"
                        onError={e => {
                            e.target.onerror = null;
                            e.target.src = "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300&q=80";
                        }}
                    />
                    {stock <= 5 && stock > 0 && (
                        <span className="absolute top-2 right-2 bg-amber-500 text-white font-bold text-[9px] px-1.5 py-0.5 rounded shadow">
                            Only {stock} left
                        </span>
                    )}
                </div>
                <div className="flex justify-between items-start gap-1 text-xs font-bold">
                    <h4 className="line-clamp-2 text-slate-800 leading-tight">{med.name}</h4>
                    {med.requiresPrescription && (
                        <span className="text-[9px] bg-rose-50 text-rose-600 border border-rose-200 px-1 py-0.5 rounded font-extrabold flex-shrink-0">
                            Rx Only
                        </span>
                    )}
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">{med.brand} • {med.composition}</p>
            </div>
            <div className="mt-3">
                <div className="flex justify-between items-center text-xs mb-2">
                    <span className="text-slate-400">Price</span>
                    <span className="font-extrabold text-emerald-600 text-sm">₹{med.price}</span>
                </div>
                <button
                    onClick={() => !isOut && onAddToCart(med)}
                    disabled={isOut}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs py-2 rounded-xl cursor-pointer disabled:bg-slate-300 disabled:cursor-not-allowed transition shadow-sm"
                >
                    {isOut ? 'Sold Out' : '+ Add to Cart'}
                </button>
            </div>
        </div>
    );
}
