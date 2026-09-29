import React from 'react';
export default function Header({ totalItemsCount, cartSubtotal }) {
    return (
        <header className="flex justify-between items-center bg-white border p-4 rounded-2xl shadow-sm">
            <h1 className="text-xl font-black text-blue-600 tracking-tight">⚕️ FreeMed Rx</h1>
            <div className="bg-slate-100 px-4 py-2 rounded-full text-xs font-bold text-slate-600">Items Count: {totalItemsCount} | Subtotal: ₹{cartSubtotal}</div>
        </header>
    );
}
