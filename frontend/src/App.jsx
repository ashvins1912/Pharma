import { useState, useEffect } from 'react';
import axios from 'axios';
import { supabase } from './supabaseClient';
import { AppProvider, useApp } from './context/AppContext';
import Header from './components/Header';
import SearchFilter from './components/SearchFilter';
import MedicineCatalog from './components/MedicineCatalog';
import ShoppingCart from './components/ShoppingCart';
import AdminDashboard from './components/AdminDashboard';
import AddressManager from './components/AddressManager';

function CoreDashboard() {
  const [session, setSession] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);
  const { medicines, globalError, fetchMedicines, addToCart, cart } = useApp();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    supabase.auth.onAuthStateChange((_e, session) => setSession(session));
  }, []);

  useEffect(() => {
    if (session && showHistory) {
      axios.get('http://localhost:5000/api/orders/history', { headers: { 'Authorization': `Bearer ${session.access_token}` } })
          .then(res => setHistory(res.data));
    }
  }, [showHistory, session]);

  const userRole = session?.user?.user_metadata?.role || 'customer';
  const subtotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);

  if (!session) {
    return (
        <div className="max-w-sm mx-auto mt-32 p-6 bg-white border border-slate-200 rounded-2xl shadow-sm text-center">
          <span className="text-4xl block mb-2">⚕️</span>
          <h2 className="text-xl font-black mb-6">Welcome to FreeMed Rx</h2>
          <button onClick={() => supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })} className="w-full flex items-center justify-center gap-3 bg-white border border-slate-300 font-bold py-2.5 rounded-xl text-sm shadow-sm cursor-pointer hover:bg-slate-50">
            <img src="https://svgrepo.com" alt="G" className="w-4 h-4"/> Continue with Google [INDEX]
          </button>
        </div>
    );
  }

  return (
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        {globalError && <div className="bg-red-100 border border-red-300 text-red-700 text-xs font-bold p-3 rounded-xl shadow-sm animate-pulse">⚠️ Network Alert: {globalError}</div>}
        <Header totalItemsCount={cart.reduce((s,i)=>s+i.quantity,0)} cartSubtotal={subtotal} />
        <div className="flex justify-between items-center bg-slate-100 px-4 py-2 rounded-xl text-xs font-bold shadow-inner">
          <span>Identity: {session.user.email} ({userRole.toUpperCase()})</span>
          <button onClick={() => supabase.auth.signOut()} className="bg-red-500 text-white px-3 py-1 rounded-lg cursor-pointer">Sign Out</button>
        </div>

        {userRole === 'admin' ? (
            <AdminDashboard session={session} />
        ) : (
            <>
              <div className="flex gap-2 mb-4 border-b pb-2">
                <button onClick={() => setShowHistory(false)} className={`text-xs font-bold px-3 py-1.5 rounded-lg ${!showHistory ? 'bg-blue-600 text-white':'bg-slate-100 text-slate-600'}`}>Catalog Shelves</button>
                <button onClick={() => setShowHistory(true)} className={`text-xs font-bold px-3 py-1.5 rounded-lg ${showHistory ? 'bg-blue-600 text-white':'bg-slate-100 text-slate-600'}`}>Track Active Deliveries</button>
              </div>
              {!showHistory ? (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                    <div className="lg:col-span-2 space-y-4">
                      <AddressManager session={session} />
                      <SearchFilter onSearchChange={fetchMedicines} />
                      <MedicineCatalog medicines={medicines} onAddToCart={addToCart} />
                    </div>
                    <ShoppingCart session={session} />
                  </div>
              ) : (
                  <div className="bg-white border p-5 rounded-2xl shadow-sm space-y-3">
                    <h3 className="font-bold text-sm">📦 Personal Order Tracking Queue</h3>
                    {history.map(o => (
                        <div key={o._id} className="border p-3 bg-slate-50 rounded-xl flex justify-between items-center text-xs">
                          <div><p className="font-bold">ID: #{o._id.slice(-6)}</p><p className="text-slate-400">Paid Amount: ₹{o.finalTotal}</p></div>
                          <span className="bg-blue-100 text-blue-800 font-extrabold px-2.5 py-1 rounded-full">{o.orderStatus}</span>
                        </div>
                    ))}
                  </div>
              )}
            </>
        )}
      </div>
  );
}

export default function App() {
  return (<AppProvider><CoreDashboard /></AppProvider>);
}