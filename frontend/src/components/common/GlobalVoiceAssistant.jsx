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

        if (ttsEnabled && parsed.spokenResponse) {
            speakVoiceText(parsed.spokenResponse, language);
        }

        switch (parsed.intent) {
            case 'OPEN_ORDERS':
                setActiveTab?.('orders');
                addToast('Opened Order History & Tracking workspace', 'info');
                break;
            case 'OPEN_REQUESTS':
                setActiveTab?.('requests');
                addToast('Opened Medicine Requests & Proposals workspace', 'info');
                break;
            case 'OPEN_ADDRESSES':
                setActiveTab?.('addresses');
                addToast('Opened Saved Address directory', 'info');
                break;
            case 'OPEN_STORE':
                setActiveTab?.('store');
                addToast('Opened Medicine Storefront', 'info');
                break;
            case 'OPEN_CART':
                onOpenCart?.();
                addToast('Opened Shopping Cart', 'info');
                break;
            case 'OPEN_PROFILE':
                onOpenProfile?.();
                addToast('Opened User Profile', 'info');
                break;
            case 'NEW_REQUEST':
                setActiveTab?.('requests');
                onOpenRequestModal?.();
                addToast('Opened New Medicine Request form', 'info');
                break;
            case 'CLEAR_SEARCH':
                setSearchQuery?.('');
                setActiveTab?.('store');
                addToast('Cleared search filters', 'info');
                break;
            case 'SEARCH':
                if (parsed.query) {
                    setSearchQuery?.(parsed.query);
                    setActiveTab?.('store');
                    addToast(`Searching for "${parsed.query}"`, 'success');
                }
                break;
            default:
                addToast('Voice command not recognized. Tap a quick action shortcut.', 'warning');
                break;
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
            {/* Main Trigger Button */}
            <button
                type="button"
                onClick={toggleAssistant}
                aria-label={isOpen && isMinimized ? "Restore Application Voice Assistant" : isOpen ? "Close Application Voice Assistant" : "Open Application Voice Assistant"}
                title={isMinimized ? "Restore Voice Assistant" : "Application Voice Assistant (Commands: Open Orders, Medicine Requests, Search, Cart)"}
                className={`flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-full text-white shadow-2xl transition-all duration-300 cursor-pointer ${
                    isListening
                        ? 'bg-rose-600 shadow-rose-600/50 scale-105 animate-pulse'
                        : isOpen
                        ? 'bg-blue-700 shadow-blue-700/40 ring-4 ring-blue-300'
                        : 'bg-gradient-to-r from-blue-600 to-indigo-700 hover:from-blue-700 hover:to-indigo-800 shadow-blue-600/30'
                }`}
            >
                <span className="text-xl sm:text-2xl select-none">
                    {isListening ? '🎙️' : '🤖'}
                </span>
                {isListening && (
                    <span className="absolute -inset-1 rounded-full bg-rose-500/30 animate-ping pointer-events-none" />
                )}
            </button>

            {/* Voice Assistant Floating Control Panel */}
            {isOpen && !isMinimized && (
                <div className="absolute bottom-16 right-0 w-[min(24rem,calc(100vw-2rem))] max-h-[70vh] overflow-y-auto bg-slate-900 text-white p-4 rounded-3xl shadow-2xl border border-slate-700 space-y-3 animate-fade-in z-[1200]">
                    {/* Header Controls */}
                    <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                        <div className="flex items-center gap-2">
                            <span className={`w-2.5 h-2.5 rounded-full ${isListening ? 'bg-rose-500 animate-ping' : 'bg-emerald-400'}`} />
                            <div>
                                <h4 className="font-extrabold text-xs text-white">App Voice Assistant</h4>
                                <span className="text-[9px] text-slate-400 block">Say "Open orders", "Medicine requests", "Search Dolo"</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                onClick={() => setTtsEnabled(!ttsEnabled)}
                                title={ttsEnabled ? "Audio Spoken Feedback ON" : "Audio Spoken Feedback Muted"}
                                className={`px-2 py-1 text-[10px] font-bold rounded-lg border transition ${
                                    ttsEnabled ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-slate-800 text-slate-400 border-slate-700'
                                }`}
                            >
                                {ttsEnabled ? '🔊 Audio ON' : '🔇 Muted'}
                            </button>
                            <button
                                type="button"
                                onClick={minimizeAssistant}
                                className="text-slate-400 hover:text-white text-base leading-none p-1.5 rounded-lg"
                                aria-label="Minimize Assistant"
                                title="Minimize"
                            >
                                −
                            </button>
                            <button
                                type="button"
                                onClick={closeAssistant}
                                className="text-slate-400 hover:text-white text-xs p-1.5 rounded-lg"
                                aria-label="Close Assistant"
                                title="Close"
                            >
                                ✕
                            </button>
                        </div>
                    </div>

                    {/* Live Audio Visualizer */}
                    {isListening && (
                        <div className="flex items-center justify-center gap-1 py-1">
                            <span className="w-1.5 h-4 bg-rose-500 rounded-full animate-pulse" />
                            <span className="w-1.5 h-7 bg-rose-400 rounded-full animate-bounce" />
                            <span className="w-1.5 h-9 bg-rose-500 rounded-full animate-pulse" />
                            <span className="w-1.5 h-6 bg-rose-300 rounded-full animate-bounce" />
                            <span className="w-1.5 h-3 bg-rose-500 rounded-full animate-pulse" />
                        </div>
                    )}

                    {/* Live Transcript / Executed Action Card */}
                    <div className="bg-slate-800/90 border border-slate-700 p-3 rounded-2xl min-h-[54px] flex items-center justify-center text-center">
                        {interimTranscript ? (
                            <p className="text-xs font-mono text-emerald-300 italic animate-pulse">
                                "{interimTranscript}"
                            </p>
                        ) : lastExecutedCommand ? (
                            <div className="space-y-1 w-full text-left">
                                <div className="flex items-center justify-between text-[10px] font-bold text-slate-400">
                                    <span>Executed Command</span>
                                    {lastExecutedCommand.confidence && (
                                        <span className="text-emerald-400 font-mono">{lastExecutedCommand.confidence}% Match</span>
                                    )}
                                </div>
                                <p className="text-xs font-black text-emerald-400">{lastExecutedCommand.label}</p>
                            </div>
                        ) : (
                            <p className="text-[11px] text-slate-400">
                                {isListening ? 'Speak a voice command (e.g. "Open Orders", "Medicine Requests")' : 'Tap mic to speak or select a quick voice command below'}
                            </p>
                        )}
                    </div>

                    {recognitionError && (
                        <div role="alert" className="rounded-xl border border-rose-800 bg-rose-950/60 px-3 py-2 text-[11px] text-rose-200">
                            {typeof recognitionError === 'string' ? recognitionError : recognitionError?.message || recognitionError?.code || 'Voice recognition encountered an error.'}
                        </div>
                    )}

                    {/* Mic Toggle Button */}
                    <div className="flex items-center gap-2">
                        {isListening ? (
                            <button
                                type="button"
                                onClick={stopListening}
                                className="w-full py-2 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs rounded-xl transition cursor-pointer"
                            >
                                ⏹️ Stop Listening
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={startListening}
                                className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5"
                            >
                                🎙️ Tap to Speak Voice Command
                            </button>
                        )}
                    </div>

                    {/* Quick Voice Command Navigation Shortcuts */}
                    <div className="pt-2 border-t border-slate-800 space-y-1.5">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                            Quick Application Voice Commands:
                        </span>
                        <div className="grid grid-cols-2 gap-1.5">
                            <button
                                type="button"
                                onClick={() => executeVoiceCommand('open orders')}
                                className="px-2.5 py-1.5 bg-slate-800 hover:bg-blue-600/40 text-blue-200 hover:text-white border border-slate-700 rounded-xl font-bold text-xs transition cursor-pointer text-left flex items-center gap-1.5"
                            >
                                <span>📦</span>
                                <span>Open Orders</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => executeVoiceCommand('open medicine requests')}
                                className="px-2.5 py-1.5 bg-slate-800 hover:bg-blue-600/40 text-blue-200 hover:text-white border border-slate-700 rounded-xl font-bold text-xs transition cursor-pointer text-left flex items-center gap-1.5"
                            >
                                <span>📋</span>
                                <span>Medicine Requests</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => executeVoiceCommand('create new medicine request')}
                                className="px-2.5 py-1.5 bg-slate-800 hover:bg-blue-600/40 text-blue-200 hover:text-white border border-slate-700 rounded-xl font-bold text-xs transition cursor-pointer text-left flex items-center gap-1.5"
                            >
                                <span>➕</span>
                                <span>New Request</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => executeVoiceCommand('open addresses')}
                                className="px-2.5 py-1.5 bg-slate-800 hover:bg-blue-600/40 text-blue-200 hover:text-white border border-slate-700 rounded-xl font-bold text-xs transition cursor-pointer text-left flex items-center gap-1.5"
                            >
                                <span>🏠</span>
                                <span>Saved Addresses</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => executeVoiceCommand('open cart')}
                                className="px-2.5 py-1.5 bg-slate-800 hover:bg-blue-600/40 text-blue-200 hover:text-white border border-slate-700 rounded-xl font-bold text-xs transition cursor-pointer text-left flex items-center gap-1.5"
                            >
                                <span>🛒</span>
                                <span>Open Cart</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => executeVoiceCommand('open store')}
                                className="px-2.5 py-1.5 bg-slate-800 hover:bg-blue-600/40 text-blue-200 hover:text-white border border-slate-700 rounded-xl font-bold text-xs transition cursor-pointer text-left flex items-center gap-1.5"
                            >
                                <span>💊</span>
                                <span>Medicine Store</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
