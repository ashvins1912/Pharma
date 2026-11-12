import React, { useState, useEffect, useRef } from 'react';
import { rankVoiceMedicineMatches } from '../../utils/similarity';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { useLanguage } from '../../context/LanguageContext';
import { detectVoiceCommand, getVoiceLocale, getVoiceResponse, speakVoiceText, stripVoiceSearchPrefix } from './voiceLanguage';

/**
 * Voice Command Parser & Intent Classifier
 */
export function parseVoiceCommand(transcript, catalog = [], language = 'en') {
    const text = String(transcript || '').toLowerCase().trim();
    if (!text) return { intent: 'UNKNOWN', label: 'No input', spokenResponse: '' };
    const localizedCommand = detectVoiceCommand(text, language);
    if (localizedCommand && localizedCommand.intent !== 'SEARCH') {
        const labels = { OPEN_ORDERS: '📦 Open Orders & Tracking', OPEN_REQUESTS: '📋 Open Medicine Requests',
            NEW_REQUEST: '📋 Create New Request', OPEN_ADDRESSES: '🏠 Open Saved Addresses',
            OPEN_CART: '🛒 Open Shopping Cart', OPEN_PROFILE: '👤 Open User Profile',
            OPEN_STORE: '💊 Open Medicine Store', CLEAR_SEARCH: '✕ Clear Filters' };
        return { intent: localizedCommand.intent, label: labels[localizedCommand.intent] || 'Voice command',
            spokenResponse: getVoiceResponse(localizedCommand.intent, language) };
    }

    // 1. ORDERS / HISTORY / TRACKING
    if (/\b(orders|history|tracking|track|receipt|status)\b/i.test(text) || /\bmy order\b/i.test(text)) {
        return {
            intent: 'OPEN_ORDERS',
            label: '📦 Open Orders & Tracking',
            spokenResponse: 'Opening your order history and live tracking.'
        };
    }

    // 2. MEDICINE REQUESTS / PROPOSALS
    if (/request|proposal|procure|inquiry/i.test(text)) {
        if (/new|create|ask|add|submit/i.test(text)) {
            return {
                intent: 'NEW_REQUEST',
                label: '📋 Create New Request',
                spokenResponse: 'Opening new medicine request workspace.'
            };
        }
        return {
            intent: 'OPEN_REQUESTS',
            label: '📋 Open Medicine Requests',
            spokenResponse: 'Opening your medicine requests and proposals workspace.'
        };
    }

    // 3. SAVED ADDRESSES
    if (/address|location|delivery address|home address/i.test(text)) {
        return {
            intent: 'OPEN_ADDRESSES',
            label: '🏠 Open Saved Addresses',
            spokenResponse: 'Opening saved address directory.'
        };
    }

    // 4. CART / CHECKOUT
    if (/cart|checkout|bag|basket|item/i.test(text)) {
        return {
            intent: 'OPEN_CART',
            label: '🛒 Open Shopping Cart',
            spokenResponse: 'Opening your shopping cart.'
        };
    }

    // 5. USER PROFILE / ACCOUNT
    if (/profile|account|my details|settings|security/i.test(text)) {
        return {
            intent: 'OPEN_PROFILE',
            label: '👤 Open User Profile',
            spokenResponse: 'Opening user profile and account details.'
        };
    }

    // 6. STORE / CATALOG / HOME
    if (/store|shop|catalog|home|browse|products/i.test(text) && !/search/i.test(text)) {
        return {
            intent: 'OPEN_STORE',
            label: '💊 Open Medicine Store',
            spokenResponse: 'Opening medicine storefront catalog.'
        };
    }

    // 7. CLEAR SEARCH / RESET FILTERS
    if (/clear|reset|show all/i.test(text) && /search|filter/i.test(text)) {
        return {
            intent: 'CLEAR_SEARCH',
            label: '✕ Clear Filters',
            spokenResponse: 'Clearing search filters.'
        };
    }

    // 8. MEDICINE SEARCH WITH HIGH-ACCURACY ENSEMBLE FUZZY REFINEMENT
    const cleanSearch = stripVoiceSearchPrefix(localizedCommand?.query || text, language);

    if (cleanSearch) {
        // Refine only against real pharmacy-catalogue entries. If the match is
        // ambiguous or lacks strength evidence, preserve the customer's query.
        const ranked = rankVoiceMedicineMatches(cleanSearch, catalog);
        const isRefined = ranked.isConfident
            && Boolean(ranked.best?.name)
            && ranked.best.name.toLowerCase() !== cleanSearch.toLowerCase();
        const refinedText = isRefined ? ranked.best.name : cleanSearch;

        return {
            intent: 'SEARCH',
            label: `🔍 Search "${refinedText}"`,
            query: refinedText,
            isRefined,
            originalText: cleanSearch,
            confidence: ranked.confidence,
            matchReason: ranked.reason,
            spokenResponse: getVoiceResponse(isRefined ? 'MATCHED' : 'SEARCHING', language, refinedText)
        };
    }

    return {
        intent: 'UNKNOWN',
        label: 'Unrecognized Command',
        spokenResponse: 'Command not recognized. Select a voice shortcut below.'
    };
}

export default function GlobalVoiceAssistant({
    activeTab,
    setActiveTab,
    onOpenCart,
    onOpenProfile,
    onOpenRequestModal
}) {
    const { addToast } = useToast();
    const { language = 'en' } = useLanguage();
    let medicines = [];
    let setSearchQuery = () => {};
    try {
        const app = useApp();
        medicines = app?.medicines || [];
        setSearchQuery = app?.setSearchQuery || (() => {});
    } catch {
        // Safe fallback outside AppProvider
    }

    const [isListening, setIsListening] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [isMinimized, setIsMinimized] = useState(false);
    const [interimTranscript, setInterimTranscript] = useState('');
    const [lastExecutedCommand, setLastExecutedCommand] = useState(null);
    const [ttsEnabled, setTtsEnabled] = useState(true);
    const [isSupported, setIsSupported] = useState(true);

    const recognitionRef = useRef(null);
    const medicinesRef = useRef(medicines);
    const executeVoiceCommandRef = useRef(null);
    const minimizeTimeoutRef = useRef(null);
    const [recognitionError, setRecognitionError] = useState(null);
    medicinesRef.current = medicines;


    useEffect(() => {
        const SpeechRecognition = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
        if (!SpeechRecognition) { setIsSupported(false); return undefined; }
        let recognition = null;
        try {
            recognition = new SpeechRecognition();
            recognition.continuous = false;
            recognition.interimResults = true;
            recognition.lang = getVoiceLocale(language);
            recognition.onstart = () => { setIsListening(true); setInterimTranscript(''); };
            recognition.onresult = (event) => {
                let interim = '', finalText = '';
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const value = event.results[i][0].transcript;
                    if (event.results[i].isFinal) finalText += value; else interim += value;
                }
                if (interim) setInterimTranscript(interim);
                if (finalText.trim()) { try { recognition.stop(); } catch {} executeVoiceCommandRef.current?.(finalText); setInterimTranscript(''); }
            };
            recognition.onerror = (event) => {
                console.warn('[GlobalVoiceAssistant] Speech error:', event.error);
                setIsListening(false);
                const messages = {
                    'not-allowed': 'Microphone access is blocked. Allow microphone access in your browser site settings.',
                    'service-not-allowed': 'The browser speech service is unavailable for this site.',
                    'audio-capture': 'No microphone was found. Check your device microphone.',
                    network: 'Voice recognition could not connect. Check your internet connection and try again.',
                    'no-speech': 'No speech was detected. Tap the microphone and speak clearly.',
                    'language-not-supported': 'The browser does not support speech recognition for this language.'
                };
                if (event.error !== 'aborted') setRecognitionError(messages[event.error] || 'Voice recognition stopped. Please try again.');
            };
            recognition.onend = () => setIsListening(false);
            recognitionRef.current = recognition;
            setIsSupported(true);
        } catch (error) {
            console.warn('[GlobalVoiceAssistant] Recognition initialization failed:', error);
            setIsSupported(false);
            setRecognitionError('Voice recognition could not be initialized in this browser.');
        }
        return () => { if (recognition) { try { recognition.abort(); } catch {} if (recognitionRef.current === recognition) recognitionRef.current = null; } };
    }, [language]);

    const executeVoiceCommand = (transcript) => {
        const parsed = parseVoiceCommand(transcript, medicinesRef.current, language);
        setRecognitionError(null);
        setLastExecutedCommand(parsed);

        if (ttsEnabled && parsed.spokenResponse) speakVoiceText(parsed.spokenResponse, language);

        let actionSucceeded = false;
        switch (parsed.intent) {
            case 'OPEN_ORDERS':
                setActiveTab?.('orders');
                addToast('Opened Order History & Tracking workspace', 'info');
                actionSucceeded = true;
                break;
            case 'OPEN_REQUESTS':
                setActiveTab?.('requests');
                addToast('Opened Medicine Requests & Proposals workspace', 'info');
                actionSucceeded = true;
                break;
            case 'OPEN_ADDRESSES':
                setActiveTab?.('addresses');
                addToast('Opened Saved Address directory', 'info');
                actionSucceeded = true;
                break;
            case 'OPEN_STORE':
                setActiveTab?.('store');
                addToast('Opened Medicine Storefront', 'info');
                actionSucceeded = true;
                break;
            case 'OPEN_CART':
                onOpenCart?.();
                addToast('Opened Shopping Cart', 'info');
                actionSucceeded = true;
                break;
            case 'OPEN_PROFILE':
                onOpenProfile?.();
                addToast('Opened User Profile', 'info');
                actionSucceeded = true;
                break;
            case 'NEW_REQUEST':
                setActiveTab?.('requests');
                onOpenRequestModal?.();
                addToast('Opened New Medicine Request form', 'info');
                actionSucceeded = true;
                break;
            case 'CLEAR_SEARCH':
                setSearchQuery?.('');
                setActiveTab?.('store');
                addToast('Cleared search filters', 'info');
                actionSucceeded = true;
                break;
            case 'SEARCH':
                if (parsed.query) {
                    setSearchQuery?.(parsed.query);
                    setActiveTab?.('store');
                    addToast('Searching for "' + parsed.query + '"', 'success');
                    actionSucceeded = true;
                }
                break;
            default:
                addToast('Voice command not recognized. Tap a quick action shortcut.', 'warning');
                break;
        }

        if (actionSucceeded) {
            if (minimizeTimeoutRef.current) window.clearTimeout(minimizeTimeoutRef.current);
            minimizeTimeoutRef.current = window.setTimeout(() => {
                setIsMinimized(true);
                minimizeTimeoutRef.current = null;
            }, 850);
        }
    };
    executeVoiceCommandRef.current = executeVoiceCommand;

    const startListening = () => {
        setIsOpen(true);
        setInterimTranscript('');
        setRecognitionError(null);
        if (!isSupported || !recognitionRef.current) {
            setRecognitionError('Voice recognition is not supported in this browser. Use a quick command below.');
            if (ttsEnabled) speakVoiceText(getVoiceResponse('READY', language), language);
            return;
        }
        try {
            // Do not speak while the microphone is active; recognition can capture the assistant's prompt.
            recognitionRef.current.start();
        } catch (err) {
            console.warn('[GlobalVoiceAssistant] Start error:', err);
            setRecognitionError('Could not start the microphone. Check browser permission and try again.');
        }
    };

    const stopListening = () => {
        if (recognitionRef.current) {
            try { recognitionRef.current.stop(); } catch {}
        }
        setIsListening(false);
    };

    const minimizeAssistant = () => {
        // A minimized assistant must never keep the microphone active.
        stopListening();
        setIsMinimized(true);
    };

    const closeAssistant = () => {
        stopListening();
        setIsOpen(false);
        setIsMinimized(false);
        setInterimTranscript('');
    };

    const toggleAssistant = () => {
        if (isOpen && isMinimized) {
            setIsMinimized(false);
            return;
        }
        if (isOpen) {
            closeAssistant();
        } else {
            setIsMinimized(false);
            startListening();
        }
    };

    return (
        <div className="fixed bottom-20 right-4 sm:bottom-6 sm:right-6 z-[1100]">
            <button
                type="button"
                onClick={toggleAssistant}
                aria-label={isOpen && isMinimized ? "Restore voice assistant" : isOpen ? "Close voice assistant" : "Open voice assistant"}
                aria-expanded={isOpen && !isMinimized}
                title={isMinimized ? "Restore voice assistant" : "Voice assistant"}
                className={`relative flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-full text-white shadow-xl transition-all duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 motion-reduce:transition-none ${
                    isListening ? 'bg-rose-600 ring-4 ring-rose-200' : 'bg-blue-700 hover:bg-blue-800'
                }`}
            >
                <span aria-hidden="true" className="text-xl sm:text-2xl">{isListening ? '🎙️' : '✦'}</span>
                {isListening && <span className="absolute -inset-1 rounded-full border-2 border-rose-400/70 animate-ping pointer-events-none motion-reduce:animate-none" />}
            </button>

            {isOpen && !isMinimized && (
                <section
                    role="dialog"
                    aria-label="Voice assistant"
                    aria-modal="false"
                    className="absolute bottom-16 right-0 flex w-[min(22rem,calc(100vw-1.5rem))] max-h-[68vh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl shadow-slate-950/20 animate-fade-in motion-reduce:animate-none"
                >
                    <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                        <div className="flex min-w-0 items-center gap-3">
                            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                                isListening ? 'bg-rose-50 text-rose-600' : 'bg-blue-50 text-blue-700'
                            }`}>
                                <span aria-hidden="true" className="text-lg">{isListening ? '🎙️' : '✦'}</span>
                            </div>
                            <div className="min-w-0">
                                <h2 className="text-sm font-bold text-slate-900">Voice assistant</h2>
                                <p className="text-[11px] text-slate-500">
                                    {isListening ? 'Listening · Speak naturally' : isSupported ? 'Ready when you are' : 'Voice input unavailable'}
                                </p>
                            </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                            <button type="button" onClick={() => setTtsEnabled(!ttsEnabled)}
                                aria-label={ttsEnabled ? 'Mute spoken responses' : 'Enable spoken responses'}
                                title={ttsEnabled ? 'Mute spoken responses' : 'Enable spoken responses'}
                                className="rounded-lg px-2 py-2 text-xs text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                                {ttsEnabled ? '🔊' : '🔇'}
                            </button>
                            <button type="button" onClick={minimizeAssistant} aria-label="Minimize voice assistant" title="Minimize"
                                className="rounded-lg px-2.5 py-2 text-lg leading-none text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">−</button>
                            <button type="button" onClick={closeAssistant} aria-label="Close voice assistant" title="Close"
                                className="rounded-lg px-2.5 py-2 text-sm text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">✕</button>
                        </div>
                    </header>

                    <div className="space-y-4 overflow-y-auto p-4">
                        <div aria-live="polite" aria-atomic="true"
                            className={`rounded-xl border px-3 py-3 text-center ${
                                isListening ? 'border-rose-100 bg-rose-50' : 'border-slate-100 bg-slate-50'
                            }`}>
                            {isListening ? (
                                <>
                                    <div className="mb-2 flex h-7 items-center justify-center gap-1" aria-hidden="true">
                                        <span className="h-3 w-1 rounded-full bg-rose-400 animate-pulse motion-reduce:animate-none" />
                                        <span className="h-6 w-1 rounded-full bg-rose-500 animate-bounce motion-reduce:animate-none" />
                                        <span className="h-4 w-1 rounded-full bg-rose-400 animate-pulse motion-reduce:animate-none" />
                                        <span className="h-7 w-1 rounded-full bg-rose-500 animate-bounce motion-reduce:animate-none" />
                                        <span className="h-3 w-1 rounded-full bg-rose-400 animate-pulse motion-reduce:animate-none" />
                                    </div>
                                    <p className="text-xs font-semibold text-rose-700">{interimTranscript || 'I’m listening…'}</p>
                                </>
                            ) : lastExecutedCommand ? (
                                <div className="space-y-1">
                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">Last action</p>
                                    <p className="text-xs font-semibold text-slate-800">{lastExecutedCommand.label}</p>
                                </div>
                            ) : (
                                <>
                                    <p className="text-sm font-semibold text-slate-800">What can I help you find?</p>
                                    <p className="mt-1 text-[11px] text-slate-500">Try “open my orders” or “search paracetamol”.</p>
                                </>
                            )}
                        </div>

                        {recognitionError && (
                            <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs leading-relaxed text-rose-700">
                                {typeof recognitionError === 'string' ? recognitionError : recognitionError?.message || recognitionError?.code || 'Voice recognition encountered an error.'}
                            </div>
                        )}

                        <button type="button" onClick={isListening ? stopListening : startListening}
                            disabled={!isListening && !isSupported}
                            className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white shadow-sm transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 disabled:cursor-not-allowed disabled:bg-slate-300 ${
                                isListening ? 'bg-rose-600 hover:bg-rose-700' : 'bg-blue-700 hover:bg-blue-800'
                            }`}>
                            <span aria-hidden="true">{isListening ? '■' : '🎙️'}</span>
                            {isListening ? 'Stop listening' : 'Tap to speak'}
                        </button>

                        <div>
                            <div className="mb-2 flex items-center justify-between">
                                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Quick actions</h3>
                                <span className="text-[10px] text-slate-400">Tap to run</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                {[
                                    ['📦', 'Orders', 'open orders'],
                                    ['📋', 'Requests', 'open medicine requests'],
                                    ['＋', 'New request', 'create new medicine request'],
                                    ['⌖', 'Addresses', 'open addresses'],
                                    ['🛒', 'Cart', 'open cart'],
                                    ['💊', 'Medicine store', 'open store']
                                ].map(([icon, label, command]) => (
                                    <button key={command} type="button" onClick={() => executeVoiceCommand(command)}
                                        className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-xs font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                                        <span aria-hidden="true" className="text-sm">{icon}</span>
                                        <span>{label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                    <footer className="border-t border-slate-100 px-4 py-2.5 text-center text-[10px] text-slate-400">
                        Your microphone is active only while listening
                    </footer>
                </section>
            )}
        </div>
    );
}
