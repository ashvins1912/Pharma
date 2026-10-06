import React, { useState, useEffect } from 'react';
import apiClient from '../../api/apiClient';

export default function VerifyEmailView({ token, onClose, onOpenSignIn }) {
  const [loading, setLoading] = useState(true);
  const [verified, setVerified] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setErrorMessage('No activation token was provided in the link.');
      return;
    }

    const verify = async () => {
      try {
        setLoading(true);
        setErrorMessage('');
        try {
          await apiClient.post('/api/v1/auth/activate', { token });
        } catch (postErr) {
          // Fallback to /api/v1/auth/verify-email
          await apiClient.post('/api/v1/auth/verify-email', { token });
        }
        setVerified(true);
      } catch (err) {
        const msg = err.response?.data?.error?.message
          || err.response?.data?.message
          || 'The activation link is invalid, already used, or has expired.';
        setErrorMessage(msg);
      } finally {
        setLoading(false);
      }
    };

    verify();
  }, [token]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-8 shadow-2xl border border-slate-100 text-center animate-in fade-in zoom-in-95 duration-200">
        <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center mb-5 text-2xl font-black">
          {loading ? (
            <div className="w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
          ) : verified ? (
            <div className="w-16 h-16 bg-teal-100 text-teal-600 rounded-full flex items-center justify-center">
              ✓
            </div>
          ) : (
            <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center">
              ✕
            </div>
          )}
        </div>

        <h2 className="text-xl font-black text-slate-800 mb-2">
          {loading
            ? 'Activating Your Account...'
            : verified
            ? 'Account Activated Successfully!'
            : 'Activation Failed'}
        </h2>

        <p className="text-sm text-slate-600 mb-6">
          {loading
            ? 'Please wait while we confirm your activation token with the secure pharmacy identity gateway.'
            : verified
            ? 'Your Ashvin Pharmacy account is now active and verified. You can now log in, submit medicine requests, and place orders.'
            : errorMessage}
        </p>

        <div className="flex flex-col gap-2">
          {verified ? (
            <button
              type="button"
              onClick={() => {
                if (onClose) onClose();
                if (onOpenSignIn) onOpenSignIn();
              }}
              className="w-full py-3 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl shadow-sm transition cursor-pointer"
            >
              Sign In to Your Account
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition cursor-pointer"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
