import React, { useState, useEffect, useRef } from 'react';
import { normalizeText, rankVoiceMedicineMatches } from '../../utils/similarity';
import { useApp } from '../../context/AppContext';
import { useLanguage } from '../../context/LanguageContext';
import { getVoiceLocale, getVoiceResponse, speakVoiceText, stripVoiceSearchPrefix } from './voiceLanguage';

// Search examples only; each tap still runs through catalogue-aware matching.
const POPULAR_VOICE_MEDICINES = ['Paracetamol', 'Dolo 650', 'Cetirizine', 'Azithromycin'];

/**
 * Clean up common spoken prefixes in voice search
 * e.g. "search for Dolo 650" -> "Dolo 650"
 */
function cleanSpokenQuery(transcript, language = 'en') {
    if (!transcript) return '';
    return stripVoiceSearchPrefix(transcript, language);
}

/**
 * Refine only when the current pharmacy catalogue contains one clear,
 * strength-compatible match. Otherwise search the words the customer spoke.
 */
export function refineSpokenQueryWithFuzzyMatch(rawTranscript, catalog = [], language = 'en') {
    const cleaned = cleanSpokenQuery(rawTranscript, language);
    if (!cleaned || cleaned.length < 2) {
        return { originalText: cleaned, refinedText: cleaned, confidence: 0, alternatives: [], isRefined: false, reason: 'INSUFFICIENT_INPUT' };
    }
    const ranked = rankVoiceMedicineMatches(cleaned, catalog);
    return {
        originalText: cleaned,
        isConfident: ranked.isConfident,
        refinedText: ranked.isConfident ? (ranked.best.name || cleaned) : cleaned,
        confidence: ranked.confidence,
        isRefined: ranked.isConfident && Boolean(ranked.best?.name)
            && normalizeText(ranked.best.name) !== normalizeText(cleaned),
        alternatives: ranked.alternatives,
        reason: ranked.reason
    };
}

export default function VoiceSearchButton({ onTranscript, onError, onListeningChange, onSuggestionsChange, currentQuery = '', className = '' }) {
    const { language = 'en' } = useLanguage();
    let medicines = [];
    try {
        const app = useApp();
        medicines = app?.medicines || [];
    } catch {
        // Safe fallback if rendered outside AppProvider scope
    }

    const [isListening, setIsListening] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [interimTranscript, setInterimTranscript] = useState('');
    const [finalText, setFinalText] = useState('');
    const [fuzzyMatchInfo, setFuzzyMatchInfo] = useState(null);
    const [errorState, setErrorState] = useState(null);
    const [isSupported, setIsSupported] = useState(true);
    const [showHelpGuide, setShowHelpGuide] = useState(false);
    const [ttsEnabled, setTtsEnabled] = useState(true);

    const recognitionRef = useRef(null);
    const autoDismissTimerRef = useRef(null);
    const callbacksRef = useRef({ onTranscript, onError, onListeningChange, onSuggestionsChange });
    const medicinesRef = useRef(medicines);
    const ttsEnabledRef = useRef(ttsEnabled);

    // Keep event handlers current without rebuilding (and aborting) an active mic session.
    callbacksRef.current = { onTranscript, onError, onListeningChange, onSuggestionsChange };
    medicinesRef.current = medicines;
    ttsEnabledRef.current = ttsEnabled;

    useEffect(() => {
        callbacksRef.current.onListeningChange?.(isListening);
    }, [isListening]);


    useEffect(() => {
        const SpeechRecognition = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
        if (!SpeechRecognition) { setIsSupported(false); return undefined; }
        let recognition = null;
        try {
            recognition = new SpeechRecognition();
            recognition.continuous = false;
            recognition.interimResults = true;
            recognition.lang = getVoiceLocale(language);
            recognition.onstart = () => { setIsListening(true); setErrorState(null); setInterimTranscript(''); };
            recognition.onresult = (event) => {
                let interim = '', finalText = '';
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const value = event.results[i][0].transcript;
                    if (event.results[i].isFinal) finalText += value; else interim += value;
                }
                if (interim) setInterimTranscript(interim);
                if (finalText.trim()) {
                    try { recognition.stop(); } catch {}
                    const match = refineSpokenQueryWithFuzzyMatch(finalText, medicinesRef.current, language);
                    setFuzzyMatchInfo(match);
                    setFinalText(match.refinedText);
                    setInterimTranscript('');
                    // Close the assistant as soon as speech has produced a usable result.
                    // Ambiguous catalogue matches require an explicit customer selection.
                    setIsOpen(false);
                    if (match.isConfident) {
                        callbacksRef.current.onSuggestionsChange?.(null);
                        callbacksRef.current.onTranscript?.(match.refinedText);
                        if (ttsEnabledRef.current) speakVoiceText(getVoiceResponse(match.isRefined ? 'MATCHED' : 'SEARCHING', language, match.refinedText), language);
                    } else if (match.alternatives?.length) {
                        callbacksRef.current.onSuggestionsChange?.({ originalText: match.originalText, alternatives: match.alternatives });
                    } else {
                        callbacksRef.current.onSuggestionsChange?.(null);
                        callbacksRef.current.onTranscript?.(match.originalText);
                        if (ttsEnabledRef.current) speakVoiceText(getVoiceResponse('SEARCHING', language, match.originalText), language);
                    }
                }
            };
            recognition.onerror = (event) => {
                console.warn('[VoiceSearch] Speech recognition error:', event.error);
                setIsListening(false);
                if (event.error === 'aborted') return;
                const errors = {
                    'not-allowed': ['Microphone Access Blocked', 'Allow microphone access in your browser site settings.', 'NOT_ALLOWED'],
                    'service-not-allowed': ['Speech Service Unavailable', 'The browser speech service is unavailable for this site.', 'SERVICE_NOT_ALLOWED'],
                    'audio-capture': ['Microphone Not Found', 'Check that a microphone is connected and enabled.', 'AUDIO_CAPTURE'],
                    network: ['Voice Network Error', 'Speech recognition could not connect. Check your internet connection.', 'NETWORK'],
                    'no-speech': ['No Speech Heard', 'No speech was detected. Try speaking clearly and again.', 'NO_SPEECH'],
                    'language-not-supported': ['Language Not Supported', 'This browser does not support speech recognition in the selected language.', 'LANGUAGE_UNSUPPORTED']
                };
                const [title, message, code] = errors[event.error] || ['Voice Input Notice', 'Voice recognition stopped. Please try again.', event.error || 'UNKNOWN'];
                const err = { title, message, code, timestamp: Date.now() }; setErrorState(err); callbacksRef.current.onError?.(err);
            };
            recognition.onend = () => setIsListening(false);
            recognitionRef.current = recognition; setIsSupported(true);
        } catch (error) { console.warn('[VoiceSearch] Recognition initialization failed:', error); setIsSupported(false); }
        return () => {
            if (recognition) { try { recognition.abort(); } catch {} if (recognitionRef.current === recognition) recognitionRef.current = null; }
            if (autoDismissTimerRef.current) clearTimeout(autoDismissTimerRef.current);
        };
    }, [language]);

    const handleSelectMedicine = (medName) => {
        const matchResult = refineSpokenQueryWithFuzzyMatch(medName, medicinesRef.current, language);
        setFuzzyMatchInfo(matchResult);
        const queryToUse = matchResult.refinedText || medName;

        setFinalText(queryToUse);
        setIsOpen(false);
        setFuzzyMatchInfo(null);
        setErrorState(null);
        callbacksRef.current.onSuggestionsChange?.(null);
        stopListening();
        // SearchFilter connects this callback to the shared product search query.
        callbacksRef.current.onTranscript?.(queryToUse);
        if (ttsEnabledRef.current) speakVoiceText(getVoiceResponse('SEARCHING', language, queryToUse), language);
    };

    const startListening = () => {
        setIsOpen(true);
        setErrorState(null);
        setInterimTranscript('');
        setFinalText('');
        setFuzzyMatchInfo(null);

        if (!isSupported || !recognitionRef.current) {
            const errObj = {
                title: 'Voice Search Unsupported',
                message: 'Web Speech API is not enabled in this browser. Use quick voice shortcuts below.',
                code: 'UNSUPPORTED'
            };
            setErrorState(errObj);
            callbacksRef.current.onError?.(errObj);
            if (ttsEnabled) speakVoiceText(getVoiceResponse('READY', language), language);
            return;
        }

        try {
            // Avoid speaking over an active recognition session; the browser may transcribe the prompt.
            recognitionRef.current.start();
        } catch (err) {
            console.warn('[VoiceSearch] Start error:', err);
            if (err.name !== 'InvalidStateError') {
                const errObj = {
                    title: 'Microphone Restricted',
                    message: 'Browser could not start microphone access. Check site microphone permission and try again.',
                    code: 'START_ERROR'
                };
                setErrorState(errObj);
                callbacksRef.current.onError?.(errObj);
            }
        }
    };

    const stopListening = () => {
        if (recognitionRef.current) {
            try { recognitionRef.current.stop(); } catch {}
        }
        setIsListening(false);
    };

    const toggleVoiceAssistant = () => {
        if (isOpen) {
            stopListening();
            setIsOpen(false);
        } else {
            startListening();
        }
    };

    return (
        <div className={`relative inline-flex items-center ${className}`}>
            <button
                type="button"
                onClick={toggleVoiceAssistant}
                aria-label={isListening ? "Stop voice search listening" : "Search medicine by voice input"}
                aria-pressed={isListening}
                title="Click for Voice Search & Audio Assistant"
                className={`relative group inline-flex items-center justify-center min-w-[38px] min-h-[38px] sm:min-w-[42px] sm:min-h-[42px] p-2 rounded-xl transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    isListening
                        ? 'bg-rose-600 text-white shadow-lg scale-105 animate-pulse'
                        : isOpen
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-900 border border-slate-200'
                }`}
            >
                <span className="text-sm sm:text-base select-none">
                    {<svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v5m-4 0h8" /></svg>}
                </span>
                {isListening && (
                    <span className="absolute -inset-1 rounded-xl bg-rose-500/30 animate-ping pointer-events-none" />
                )}
            </button>

            {/* Screen Reader Live Announcements */}
            <div aria-live="assertive" aria-atomic="true" className="sr-only">
                {isListening
                    ? `Listening for medicine name. ${interimTranscript}`
                    : errorState
                    ? `Voice Alert: ${errorState.title}`
                    : ''}
            </div>

            {/* Floating Voice Search & Audio Assistant Panel */}
            {isOpen && (
                <div role="dialog" aria-label="Voice medicine search" className="absolute top-full right-0 mt-2 z-[1200] w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-xl shadow-slate-900/15 animate-fade-in">
                    {/* Header Controls */}
                    <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3.5 py-3">
                        <div className="flex items-center gap-2">
                            <span className={`h-2.5 w-2.5 rounded-full ${isListening ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500'}`} />
                            <span className="font-bold text-sm text-slate-800">
                                {isListening ? 'Listening... Speak Now' : 'Voice Assistant Ready'}
                            </span>
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                onClick={() => setTtsEnabled(!ttsEnabled)}
                                title={ttsEnabled ? "Voice Feedback Enabled (Click to Mute)" : "Voice Feedback Muted (Click to Enable)"}
                                className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-semibold transition ${
                                    ttsEnabled ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-500'
                                }`}
                            >
                                {ttsEnabled ? 'Audio on' : 'Audio off'}
                            </button>
                            <button
                                type="button"
                                onClick={() => { stopListening(); setIsOpen(false); }}
                                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-800"
                                aria-label="Close voice panel"
                            >
                                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
                            </button>
                        </div>
                    </div>

                    {/* Live Audio Visualizer Wave */}
                    {isListening && (
                        <div className="flex items-center justify-center gap-1 py-1">
                            <span className="w-1.5 h-4 bg-rose-500 rounded-full animate-pulse" />
                            <span className="w-1.5 h-7 bg-rose-400 rounded-full animate-bounce" />
                            <span className="w-1.5 h-9 bg-rose-500 rounded-full animate-pulse" />
                            <span className="w-1.5 h-6 bg-rose-300 rounded-full animate-bounce" />
                            <span className="w-1.5 h-3 bg-rose-500 rounded-full animate-pulse" />
                        </div>
                    )}

                    {/* Live Transcript / Result Display */}
                    <div className={`mx-3.5 mt-3 rounded-xl border p-3 text-center min-h-[58px] flex items-center justify-center ${isListening ? 'border-rose-200 bg-rose-50' : 'border-blue-100 bg-blue-50/60'}`}>
                        {interimTranscript ? (
                            <p className="text-xs font-medium text-rose-700">
                                "{interimTranscript}"
                            </p>
                        ) : finalText ? (
                            <div className="space-y-0.5 w-full">
                                <span className="text-[9px] uppercase tracking-wider font-bold text-slate-500">Active Query</span>
                                <p className="text-xs font-bold text-blue-800">"{finalText}"</p>
                            </div>
                        ) : (
                            <p className="text-[11px] text-slate-500">
                                {isListening ? 'Speak medicine name clearly (e.g., "Dolo 650", "Paracetamol")' : 'Tap mic to speak or select a quick voice shortcut below'}
                            </p>
                        )}
                    </div>

                    {/* Fuzzy Match Refinement Indicator */}
                    {fuzzyMatchInfo && (
                        <div className="mx-3.5 mt-2 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 space-y-1.5 text-xs text-left">
                            <div className="flex items-center justify-between text-[10px] font-bold text-slate-500">
                                <span className="truncate max-w-[65%]">Spoken: "{fuzzyMatchInfo.originalText}"</span>
                                <span className="text-emerald-700 font-mono shrink-0">{fuzzyMatchInfo.confidence}% Match</span>
                            </div>
                            {fuzzyMatchInfo.isRefined && (
                                <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-700">
                                    <span>✨ Fuzzy Refined:</span>
                                    <span className="rounded-md border border-emerald-200 bg-white px-2 py-0.5 text-emerald-800 truncate">
                                        "{fuzzyMatchInfo.refinedText}"
                                    </span>
                                </div>
                            )}
                            {fuzzyMatchInfo.alternatives?.length > 0 && (
                                <div className="pt-2 border-t border-indigo-100 space-y-1">
                                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block">
                                        Similar Catalog Matches:
                                    </span>
                                    <div className="flex flex-wrap gap-1.5">
                                        {fuzzyMatchInfo.alternatives.map((alt) => (
                                            <button
                                                key={alt.name}
                                                type="button"
                                                onClick={() => handleSelectMedicine(alt.name)}
                                                className="rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-indigo-700 transition hover:bg-indigo-600 hover:text-white cursor-pointer"
                                            >
                                                {alt.name} ({alt.score}%)
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Status / Error Message Banner */}
                    {errorState && (
                        <div role="alert" className="mx-3.5 mt-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-[11px] text-rose-700 space-y-1">
                            <div className="flex items-center justify-between font-bold">
                                <span>{errorState.title}</span>
                                <span className="text-[9px] font-mono text-rose-600">{errorState.code}</span>
                            </div>
                            <p className="text-[10px] text-rose-700 leading-snug">{errorState.message}</p>
                        </div>
                    )}

                    {/* Action Controls */}
                    <div className="px-3.5 pt-3">
                        {isListening ? (
                            <button
                                type="button"
                                onClick={stopListening}
                                className="w-full rounded-xl bg-rose-600 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-rose-700 cursor-pointer"
                            >
                                Stop listening
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={startListening}
                                className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-700 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-blue-800 cursor-pointer"
                            >
                                <><svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v5m-4 0h8" /></svg> Tap to speak</>
                            </button>
                        )}
                    </div>

                    {/* Popular Voice Medicine Shortcuts */}
                    <div className="px-3.5 pb-3.5 pt-3 space-y-2">
                        <div className="flex items-center justify-between gap-2"><span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Try a medicine search</span><span className="text-[9px] text-slate-400">Examples</span></div>
                        <div className="flex flex-wrap gap-1.5">
                            {POPULAR_VOICE_MEDICINES.map((med) => (
                                <button
                                    key={med}
                                    type="button"
                                    onClick={() => handleSelectMedicine(med)}
                                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[10px] font-semibold text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 cursor-pointer"
                                >
                                    + {med}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Unblock Mic Instructions Toggle */}
                    <div className="border-t border-slate-100 px-3.5 py-2 text-center">
                        <button
                            type="button"
                            onClick={() => setShowHelpGuide(!showHelpGuide)}
                            className="text-[10px] font-semibold text-blue-700 hover:text-blue-900 underline cursor-pointer"
                        >
                            {showHelpGuide ? 'Hide Permission Help' : 'How to allow mic access in browser?'}
                        </button>
                    </div>

                    {showHelpGuide && (
                        <div className="mx-3.5 mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1 text-[10px] text-slate-600 font-medium">
                            <p className="font-bold text-slate-800">Browser Microphone Access:</p>
                            <ol className="list-decimal list-inside space-y-0.5 text-[10px] text-slate-600">
                                <li>Click the 🔒 icon beside the browser URL bar.</li>
                                <li>Set <strong className="text-slate-800">Microphone</strong> permission to <strong className="text-emerald-700">Allow</strong>.</li>
                                <li>Tap "Tap to Speak" above.</li>
                            </ol>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
