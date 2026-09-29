import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export default function AuthModal({ isOpen, onClose }) {
  const { loginWithGoogle, loginWithEmail, signUpWithEmail, loginDemoCustomer, loginDemoAdmin } = useAuth();
  const { addToast } = useToast();

  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);

    try {
      if (isSignUp) {
        await signUpWithEmail(email, password, name, mobile);
        addToast('Account created successfully!', 'success');
      } else {
        await loginWithEmail(email, password);
        addToast('Signed in successfully!', 'success');
      }
      onClose();
    } catch (err) {
      setErrorMsg(err.message || 'Authentication failed. Please verify credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setErrorMsg('');
    setLoading(true);
    try {
      await loginWithGoogle();
      onClose();
    } catch (err) {
      setErrorMsg(err.message || 'Google OAuth failed.');
      setLoading(false);
    }
  };

  const handleDemoCustomer = () => {
    loginDemoCustomer();
    addToast('Logged in as Demo Customer!', 'success');
    onClose();
  };

  const handleDemoAdmin = () => {
    loginDemoAdmin();
    addToast('Logged in as Pharmacist / Admin!', 'success');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white border border-slate-200 rounded-3xl shadow-2xl max-w-md w-full p-6 sm:p-8 relative overflow-hidden">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 hover:bg-slate-200 transition cursor-pointer"
        >
          ✕
        </button>

        {/* Shop Logo & Title */}
        <div className="text-center mb-6">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-blue-600 text-white flex items-center justify-center text-3xl shadow-md shadow-blue-500/25 mb-3">
            ⚕️
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
            Welcome to Ashvin Pharmacy
          </h2>
          <p className="text-xs text-slate-500 mt-1 font-medium">
            {isSignUp ? 'Create your prescription & healthcare account' : 'Your trusted pharmacy partner for everyday healthcare'}
          </p>
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-center gap-2">
            <span>⚠️</span>
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {isSignUp && (
            <>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Full Name</label>
                <input
                  type="text"
                  placeholder="e.g. Ashvin Singh"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:bg-white transition"
                  required
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Mobile Number</label>
                <input
                  type="tel"
                  placeholder="+91 95899 16475"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:bg-white transition"
                  required
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Email Address</label>
            <input
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:bg-white transition"
              required
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Password</label>
              {!isSignUp && (
                <button
                  type="button"
                  onClick={() => addToast('Password reset link will be sent to your email.', 'info')}
                  className="text-[11px] text-blue-600 hover:underline font-semibold"
                >
                  Forgot Password?
                </button>
              )}
            </div>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:bg-white transition"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold py-2.5 rounded-xl text-xs shadow-md shadow-blue-600/20 cursor-pointer transition"
          >
            {loading ? 'Please wait...' : (isSignUp ? 'Create Free Account' : 'Login to Pharmacy')}
          </button>
        </form>

        {/* Divider */}
        <div className="relative my-4 flex items-center">
          <div className="flex-grow border-t border-slate-200"></div>
          <span className="flex-shrink mx-3 text-slate-400 text-[10px] font-bold uppercase tracking-wider">OR</span>
          <div className="flex-grow border-t border-slate-200"></div>
        </div>

        {/* Google OAuth Button */}
        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold py-2.5 rounded-xl text-xs shadow-sm cursor-pointer transition mb-4"
        >
          <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
          </svg>
          Continue with Google
        </button>

        {/* Quick Demo Access */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 space-y-2">
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 text-center">Instant Demo Access</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleDemoCustomer}
              className="bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold py-1.5 px-2 rounded-xl text-[11px] cursor-pointer transition text-center"
            >
              🛒 Demo Customer
            </button>
            <button
              onClick={handleDemoAdmin}
              className="bg-purple-50 hover:bg-purple-100 text-purple-700 font-bold py-1.5 px-2 rounded-xl text-[11px] cursor-pointer transition text-center"
            >
              👨‍⚕️ Demo Admin
            </button>
          </div>
        </div>

        {/* Toggle Sign Up / Login */}
        <div className="mt-4 text-center">
          <p className="text-xs text-slate-500 font-medium">
            {isSignUp ? "Already have an account?" : "Don't have an account?"}{' '}
            <button
              onClick={() => { setIsSignUp(!isSignUp); setErrorMsg(''); }}
              className="text-blue-600 font-extrabold hover:underline cursor-pointer"
            >
              {isSignUp ? 'Login here' : 'Sign Up'}
            </button>
          </p>
        </div>

      </div>
    </div>
  );
}
