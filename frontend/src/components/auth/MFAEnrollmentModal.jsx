import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';

/**
 * Presentation Component: MFAEnrollmentModal
 * Zero-Cost TOTP MFA Setup:
 * 1. Displays Canvas-generated QR code (Google Authenticator, Microsoft Authenticator, Bitwarden, Apple Passwords).
 * 2. Displays raw Base32 secret for manual key entry.
 * 3. Prompts user for 6-digit verification code to confirm enrollment.
 */
export default function MFAEnrollmentModal({ isOpen, onClose }) {
    const { enrollMfa, confirmMfaEnroll } = useAuth();
    const { addToast } = useToast();

    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [enrollData, setEnrollData] = useState(null);
    const [verificationCode, setVerificationCode] = useState('');
    const [copied, setCopied] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');

    useEffect(() => {
        if (!isOpen) {
            setEnrollData(null);
            setVerificationCode('');
            setErrorMsg('');
            setCopied(false);
            return;
        }

        const startEnrollment = async () => {
            setLoading(true);
            setErrorMsg('');
            try {
                const data = await enrollMfa();
                setEnrollData(data);
            } catch (err) {
                setErrorMsg(err.message || 'Could not initiate MFA setup.');
            } finally {
                setLoading(false);
            }
        };

        startEnrollment();
    }, [isOpen, enrollMfa]);

    if (!isOpen) return null;

    const handleCopySecret = () => {
        if (!enrollData?.secret) return;
        navigator.clipboard.writeText(enrollData.secret);
        setCopied(true);
        addToast('Secret key copied to clipboard!', 'info');
        setTimeout(() => setCopied(false), 3000);
    };

    const handleConfirm = async (e) => {
        e.preventDefault();
        setErrorMsg('');
        if (verificationCode.trim().length !== 6) {
            setErrorMsg('Please enter a 6-digit code.');
            return;
        }

        setSubmitting(true);
        try {
            await confirmMfaEnroll(verificationCode.trim());
            addToast('🎉 Two-Factor Authentication activated successfully!', 'success');
            onClose();
        } catch (err) {
            setErrorMsg(err.message || 'Invalid verification code. Please check your authenticator app.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
            <div className="bg-white border border-slate-200 rounded-3xl shadow-2xl max-w-md w-full p-6 sm:p-8 relative overflow-hidden max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center text-xl shadow-md shadow-blue-500/25">
                            🛡️
                        </div>
                        <div>
                            <h3 className="text-base font-black text-slate-900">Setup Two-Factor Authentication</h3>
                            <p className="text-xs text-slate-500">Zero-cost TOTP with your mobile authenticator app</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 hover:bg-slate-200 transition cursor-pointer"
                    >
                        ✕
                    </button>
                </div>

                {loading ? (
                    <div className="py-12 text-center text-xs text-slate-400 font-semibold space-y-2">
                        <span className="inline-block w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></span>
                        <p>Generating cryptographically secure TOTP secret...</p>
                    </div>
                ) : errorMsg && !enrollData ? (
                    <div className="py-8 text-center space-y-3">
                        <p className="text-xs text-rose-600 font-bold">{errorMsg}</p>
                        <button
                            onClick={onClose}
                            className="text-xs bg-slate-100 text-slate-700 px-4 py-2 rounded-xl font-bold"
                        >
                            Close
                        </button>
                    </div>
                ) : (
                    <div className="mt-5 space-y-5">
                        {/* Step 1 Instructions */}
                        <div className="space-y-1">
                            <span className="text-[10px] font-black uppercase tracking-wider text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                                Step 1 of 2
                            </span>
                            <h4 className="text-xs font-bold text-slate-800">Scan QR Code with Authenticator App</h4>
                            <p className="text-[11px] text-slate-500 leading-relaxed">
                                Open Google Authenticator, Microsoft Authenticator, Bitwarden, or Apple Passwords on your phone and scan:
                            </p>
                        </div>

                        {/* QR Code Presentation Canvas */}
                        {enrollData?.qrCode && (
                            <div className="flex flex-col items-center justify-center p-4 bg-slate-50 border border-slate-200 rounded-2xl">
                                <img
                                    src={enrollData.qrCode}
                                    alt="TOTP QR Code"
                                    className="w-48 h-48 rounded-xl shadow-xs border border-white"
                                />
                                <span className="text-[10px] text-slate-400 mt-2 font-medium">
                                    Issuer: Ashvin Pharmacy ({enrollData.accountName})
                                </span>
                            </div>
                        )}

                        {/* Raw Secret Fallback */}
                        <div className="space-y-1.5">
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                Or enter secret key manually
                            </label>
                            <div className="flex items-center gap-2">
                                <input
                                    type="text"
                                    readOnly
                                    value={enrollData?.secret || ''}
                                    className="font-mono text-xs bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 w-full text-slate-700 select-all outline-none"
                                />
                                <button
                                    type="button"
                                    onClick={handleCopySecret}
                                    className="shrink-0 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold px-3 py-2 rounded-xl transition cursor-pointer"
                                >
                                    {copied ? '✓ Copied' : 'Copy'}
                                </button>
                            </div>
                        </div>

                        {/* Step 2 Verification */}
                        <form onSubmit={handleConfirm} className="space-y-3 pt-3 border-t border-slate-100">
                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <label className="text-[11px] font-bold text-slate-700">
                                        Enter 6-digit Code from Authenticator
                                    </label>
                                    <span className="text-[10px] font-black uppercase text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                                        Step 2
                                    </span>
                                </div>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    maxLength={6}
                                    value={verificationCode}
                                    onChange={(e) => {
                                        const clean = e.target.value.replace(/\D/g, '').slice(0, 6);
                                        setVerificationCode(clean);
                                    }}
                                    placeholder="000 000"
                                    className="w-full text-center tracking-[0.3em] font-mono font-black text-xl py-2.5 bg-slate-50 border border-slate-200 focus:border-blue-600 focus:bg-white rounded-xl outline-none transition"
                                    autoFocus
                                    required
                                />
                            </div>

                            {errorMsg && (
                                <p className="text-xs text-rose-600 font-semibold bg-rose-50 border border-rose-200 p-2.5 rounded-xl">
                                    ⚠️ {errorMsg}
                                </p>
                            )}

                            <div className="flex items-center justify-end gap-2.5 pt-2">
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={submitting || verificationCode.length !== 6}
                                    className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white text-xs font-black px-5 py-2.5 rounded-xl shadow-md shadow-blue-600/20 transition cursor-pointer flex items-center gap-1.5"
                                >
                                    {submitting ? 'Verifying...' : 'Activate 2FA'}
                                </button>
                            </div>
                        </form>
                    </div>
                )}
            </div>
        </div>
    );
}
