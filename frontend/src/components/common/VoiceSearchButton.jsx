import React, { useState, useEffect, useRef } from 'react';
import { normalizeText, rankVoiceMedicineMatches } from '../../utils/similarity';
import { useApp } from '../../context/AppContext';

/**
 * Clean up common spoken prefixes in voice search
 * e.g. "search for Dolo 650" -> "Dolo 650"
 */
function cleanSpokenQuery(transcript) {
    if (!transcript) return '';
    return transcript
        .replace(/^(search for|search|find me|look up|get me|where is|buy|order|show me|find)\s+/i, '')
        .trim();
}

/**
 * Text-To-Speech (TTS) Feedback Helper
 */
function speakText(text) {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = 1.0;
            utterance.pitch = 1.0;
            utterance.volume = 1.0;
            utterance.lang = 'en-US';
            window.speechSynthesis.speak(utterance);
        } catch (e) {
            console.warn('[VoiceSearch] Speech synthesis failed:', e);
        }
    }
}

/**
 * Refine only when the current pharmacy catalogue contains one clear,
 * strength-compatible match. Otherwise search the words the customer spoke.
 */
export function refineSpokenQueryWithFuzzyMatch(rawTranscript, catalog = []) {
    const cleaned = cleanSpokenQuery(rawTranscript);
    if (!cleaned || cleaned.length < 2) {
        return { originalText: cleaned, refinedText: cleaned, confidence: 0, alternatives: [], isRefined: false, reason: 'INSUFFICIENT_INPUT' };
    }
    const ranked = rankVoiceMedicineMatches(cleaned, catalog);
    return {
        originalText: cleaned,
        refinedText: ranked.isConfident ? (ranked.best.name || cleaned) : cleaned,
        confidence: ranked.confidence,
        isRefined: ranked.isConfident && Boolean(ranked.best?.name)
            && normalizeText(ranked.best.name) !== normalizeText(cleaned),
        alternatives: ranked.alternatives,
        reason: ranked.reason
    };
}

export default function VoiceSearchButton({ onTranscript, onError, onListeningChange, currentQuery = '', className = '' }) {
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
    const callbacksRef = useRef({ onTranscript, onError, onListeningChange });
    const medicinesRef = useRef(medicines);
    const ttsEnabledRef = useRef(ttsEnabled);

    // Keep event handlers current without rebuilding (and aborting) an active mic session.
    callbacksRef.current = { onTranscript, onError, onListeningChange };
    medicinesRef.current = medicines;
    ttsEnabledRef.current = ttsEnabled;

    useEffect(() => {
        callbacksRef.current.onListeningChange?.(isListening);
    }, [isListening]);

    useEffect(() => {
        const SpeechRecognition = typeof window !== 'undefined'
            ? (window.SpeechRecognition || window.webkitSpeechRecognition)
            : null;

        if (!SpeechRecognition) {
            setIsSupported(false);
            return;
        }

        try {
            const recognition = new SpeechRecognition();
            // A medicine search is a single command; continuous mode can hear our own TTS feedback.
            recognition.continuous = false;
            recognition.interimResults = true;
            recognition.lang = typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-US';

            recognition.onstart = () => {
                setIsListening(true);
                setErrorState(null);
                setInterimTranscript('');
            };

            recognition.onresult = (event) => {
                let currentInterim = '';
                let latestFinal = '';

                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const transcriptText = event.results[i][0].transcript;
                    if (event.results[i].isFinal) {
                        latestFinal += transcriptText;
                    } else {
                        currentInterim += transcriptText;
                    }
                }

                if (currentInterim) {
                    setInterimTranscript(currentInterim);
                }

                if (latestFinal) {
                    const cleaned = cleanSpokenQuery(latestFinal);
                    if (cleaned) {
                        // Stop capture before updating search state or speaking feedback.
                        try { recognition.stop(); } catch {}
                        const matchResult = refineSpokenQueryWithFuzzyMatch(cleaned, medicinesRef.current);
                        setFuzzyMatchInfo(matchResult);
                        const queryToUse = matchResult.refinedText;

                        setFinalText(queryToUse);
                        callbacksRef.current.onTranscript?.(queryToUse);

                        if (ttsEnabledRef.current) {
                            if (matchResult.isRefined) {
                                speakText(`Refined to ${queryToUse}`);
                            } else {
                                speakText(`Searching for ${queryToUse}`);
                            }
                        }
                        setInterimTranscript('');
                    }
                }
            };

            recognition.onerror = (event) => {
                console.warn('[VoiceSearch] Speech Recognition Error:', event.error);
                setIsListening(false);

                if (event.error === 'aborted') return;

                let title = 'Voice Input Notice';
                let message = 'Microphone input ended. Select a quick voice shortcut below or try speaking again.';
                let code = event.error || 'UNKNOWN';

                if (event.error === 'not-allowed' || event.error === 'permission-denied') {
                    title = 'Microphone Access Blocked';
                    message = 'Browser permission is blocked in this window. Allow microphone access in site settings or select quick voice shortcuts.';
                    code = 'NOT_ALLOWED';
                } else if (event.error === 'no-speech') {
                    title = 'No Speech Heard';
                    message = 'No spoken sound detected. Speak clearly into your mic or tap a medicine shortcut below.';
                    code = 'NO_SPEECH';
                } else if (event.error === 'network') {
                    title = 'Voice Network Error';
                    message = 'Voice recognition service unreachable. You can select a quick voice shortcut below.';
                    code = 'NETWORK';
                }

                setErrorState({ title, message, code, timestamp: Date.now() });
                callbacksRef.current.onError?.({ title, message, code });
            };

            recognition.onend = () => {
                setIsListening(false);
            };

            recognitionRef.current = recognition;
        } catch (err) {
            console.warn('[VoiceSearch] Failed to instantiate SpeechRecognition:', err);
            setIsSupported(false);
        }

        return () => {
            try { recognition.abort(); } catch {}
            if (recognitionRef.current === recognition) recognitionRef.current = null;
            if (autoDismissTimerRef.current) clearTimeout(autoDismissTimerRef.current);
        };
    }, []);

    const handleSelectMedicine = (medName) => {
        const matchResult = refineSpokenQueryWithFuzzyMatch(medName, medicinesRef.current);
        setFuzzyMatchInfo(matchResult);
        const queryToUse = matchResult.refinedText || medName;

        setFinalText(queryToUse);
        callbacksRef.current.onTranscript?.(queryToUse);
        if (ttsEnabledRef.current) speakText(`Searching for ${queryToUse}`);
        setErrorState(null);
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
            if (ttsEnabled) speakText('Select a medicine shortcut');
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
                    {isListening ? '🎙️' : '🎤'}
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
                <div className="absolute top-full right-0 mt-2 z-[1200] w-72 sm:w-80 bg-slate-900 text-white p-4 rounded-2xl shadow-2xl border border-slate-700 space-y-3 animate-fade-in">
                    {/* Header Controls */}
                    <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                        <div className="flex items-center gap-2">
                            <span className={`w-2.5 h-2.5 rounded-full ${isListening ? 'bg-rose-500 animate-ping' : 'bg-emerald-400'}`} />
                            <span className="font-extrabold text-xs text-white">
                                {isListening ? 'Listening... Speak Now' : 'Voice Assistant Ready'}
                            </span>
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                onClick={() => setTtsEnabled(!ttsEnabled)}
                                title={ttsEnabled ? "Voice Feedback Enabled (Click to Mute)" : "Voice Feedback Muted (Click to Enable)"}
                                className={`px-2 py-1 text-[10px] font-bold rounded-lg border transition ${
                                    ttsEnabled ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-slate-800 text-slate-400 border-slate-700'
                                }`}
                            >
                                {ttsEnabled ? '🔊 Audio ON' : '🔇 Audio OFF'}
                            </button>
                            <button
                                type="button"
                                onClick={() => { stopListening(); setIsOpen(false); }}
                                className="text-slate-400 hover:text-white text-xs p-1 rounded-lg"
                                aria-label="Close voice panel"
                            >
                                ✕
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
                    <div className="bg-slate-800/90 border border-slate-700 p-3 rounded-xl min-h-[50px] flex items-center justify-center text-center">
                        {interimTranscript ? (
                            <p className="text-xs font-mono text-emerald-300 italic animate-pulse">
                                "{interimTranscript}"
                            </p>
                        ) : finalText ? (
                            <div className="space-y-0.5 w-full">
                                <span className="text-[9px] uppercase tracking-wider font-bold text-slate-400">Active Query</span>
                                <p className="text-xs font-black text-emerald-400">"{finalText}"</p>
                            </div>
                        ) : (
                            <p className="text-[11px] text-slate-400">
                                {isListening ? 'Speak medicine name clearly (e.g., "Dolo 650", "Paracetamol")' : 'Tap mic to speak or select a quick voice shortcut below'}
                            </p>
                        )}
                    </div>

                    {/* Fuzzy Match Refinement Indicator */}
                    {fuzzyMatchInfo && (
                        <div className="bg-slate-800/90 border border-indigo-500/40 p-2.5 rounded-xl space-y-1.5 text-xs text-left">
                            <div className="flex items-center justify-between text-[10px] font-bold text-slate-400">
                                <span className="truncate max-w-[65%]">🎙️ Spoken: "{fuzzyMatchInfo.originalText}"</span>
                                <span className="text-emerald-400 font-mono shrink-0">{fuzzyMatchInfo.confidence}% Match</span>
                            </div>
                            {fuzzyMatchInfo.isRefined && (
                                <div className="flex items-center gap-1.5 text-[11px] font-black text-emerald-300">
                                    <span>✨ Fuzzy Refined:</span>
                                    <span className="bg-emerald-500/20 text-emerald-200 px-2 py-0.5 rounded-md border border-emerald-500/30 truncate">
                                        "{fuzzyMatchInfo.refinedText}"
                                    </span>
                                </div>
                            )}
                            {fuzzyMatchInfo.alternatives?.length > 0 && (
                                <div className="pt-1 border-t border-slate-700/60 space-y-1">
                                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block">
                                        Similar Catalog Matches:
                                    </span>
                                    <div className="flex flex-wrap gap-1">
                                        {fuzzyMatchInfo.alternatives.map((alt) => (
                                            <button
                                                key={alt.name}
                                                type="button"
                                                onClick={() => handleSelectMedicine(alt.name)}
                                                className="px-2 py-0.5 bg-slate-700 hover:bg-indigo-600 text-indigo-200 hover:text-white rounded-md text-[10px] font-bold transition cursor-pointer"
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
                        <div className="bg-rose-950/60 border border-rose-800 p-2.5 rounded-xl text-[11px] text-rose-200 space-y-1">
                            <div className="flex items-center justify-between font-bold">
                                <span>🎙️ {errorState.title}</span>
                                <span className="text-[9px] font-mono text-rose-400">{errorState.code}</span>
                            </div>
                            <p className="text-[10px] text-rose-300 leading-snug">{errorState.message}</p>
                        </div>
                    )}

                    {/* Action Controls */}
                    <div className="flex items-center justify-between gap-2">
                        {isListening ? (
                            <button
                                type="button"
                                onClick={stopListening}
                                className="w-full py-2 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs rounded-xl transition shadow-sm cursor-pointer"
                            >
                                ⏹️ Stop Listening
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={startListening}
                                className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs rounded-xl transition shadow-sm cursor-pointer flex items-center justify-center gap-1.5"
                            >
                                🎙️ Tap to Speak
                            </button>
                        )}
                    </div>

                    {/* Popular Voice Medicine Shortcuts */}
                    <div className="pt-2 border-t border-slate-800 space-y-1.5">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Quick Voice Shortcuts:</span>
                        <div className="flex flex-wrap gap-1">
                            {POPULAR_VOICE_MEDICINES.map((med) => (
                                <button
                                    key={med}
                                    type="button"
                                    onClick={() => handleSelectMedicine(med)}
                                    className="px-2 py-1 bg-slate-800 hover:bg-blue-600/40 text-blue-300 hover:text-white border border-slate-700 hover:border-blue-500 font-extrabold text-[10px] rounded-lg transition cursor-pointer"
                                >
                                    + {med}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Unblock Mic Instructions Toggle */}
                    <div className="pt-1 text-center">
                        <button
                            type="button"
                            onClick={() => setShowHelpGuide(!showHelpGuide)}
                            className="text-[10px] font-bold text-blue-400 hover:text-blue-300 underline cursor-pointer"
                        >
                            {showHelpGuide ? 'Hide Permission Help' : 'How to allow mic access in browser?'}
                        </button>
                    </div>

                    {showHelpGuide && (
                        <div className="p-2.5 bg-slate-800 border border-slate-700 rounded-xl space-y-1 text-[10px] text-slate-300 font-medium">
                            <p className="font-bold text-white">Browser Microphone Access:</p>
                            <ol className="list-decimal list-inside space-y-0.5 text-[10px] text-slate-300">
                                <li>Click the 🔒 icon beside the browser URL bar.</li>
                                <li>Set <strong className="text-white">Microphone</strong> permission to <strong className="text-emerald-400">Allow</strong>.</li>
                                <li>Tap "Tap to Speak" above.</li>
                            </ol>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
