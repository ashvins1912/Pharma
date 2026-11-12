import React, { useState, useEffect, useRef } from 'react';

/**
 * Clean up common spoken prefixes in voice search
 * e.g. "search for Dolo 650" -> "Dolo 650"
 */
function cleanSpokenQuery(transcript) {
    if (!transcript) return '';
    return transcript
        .replace(/^(search for|search|find me|look up|get me|where is|buy|order)\s+/i, '')
        .trim();
}

export default function VoiceSearchButton({ onTranscript, onError, onListeningChange, currentQuery = '', className = '' }) {
    const [isListening, setIsListening] = useState(false);
    const [interimTranscript, setInterimTranscript] = useState('');
    const [errorState, setErrorState] = useState(null); // { title, message, code, showHelp }
    const [isSupported, setIsSupported] = useState(true);
    const [showHelpGuide, setShowHelpGuide] = useState(false);

    const recognitionRef = useRef(null);
    const autoDismissTimerRef = useRef(null);

    useEffect(() => {
        if (onListeningChange) {
            onListeningChange(isListening);
        }
    }, [isListening, onListeningChange]);

    useEffect(() => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            setIsSupported(false);
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
            setIsListening(true);
            setErrorState(null);
            setShowHelpGuide(false);
            setInterimTranscript('');
            if (autoDismissTimerRef.current) clearTimeout(autoDismissTimerRef.current);
        };

        recognition.onresult = (event) => {
            let currentInterim = '';
            let finalTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcriptText = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcriptText;
                } else {
                    currentInterim += transcriptText;
                }
            }

            if (currentInterim) {
                setInterimTranscript(currentInterim);
            }

            if (finalTranscript) {
                const cleaned = cleanSpokenQuery(finalTranscript);
                if (cleaned && onTranscript) {
                    onTranscript(cleaned);
                }
                setIsListening(false);
                setInterimTranscript('');
            }
        };

        recognition.onerror = (event) => {
            console.warn('[VoiceSearch] Speech Recognition Error:', event.error);
            setIsListening(false);
            setInterimTranscript('');

            let title = 'Voice Input Error';
            let message = 'Could not process audio input. Please try again.';
            let code = event.error || 'unknown';

            if (event.error === 'not-allowed' || event.error === 'permission-denied') {
                title = 'Microphone Access Denied';
                message = 'Browser microphone permission is blocked. Click the lock/settings icon in your browser URL bar to allow microphone access.';
                code = 'NOT_ALLOWED';
            } else if (event.error === 'no-speech') {
                title = 'No Speech Detected';
                message = 'No voice sound was detected. Please speak clearly near your microphone and try again.';
                code = 'NO_SPEECH';
            } else if (event.error === 'audio-capture') {
                title = 'Microphone Hardware Error';
                message = 'No microphone device was found or audio capture failed. Check your microphone device connections.';
                code = 'AUDIO_CAPTURE';
            } else if (event.error === 'network') {
                title = 'Network Connection Error';
                message = 'Voice recognition network service unavailable. Check your internet connection.';
                code = 'NETWORK';
            }

            const errorObj = { title, message, code, timestamp: Date.now() };
            setErrorState(errorObj);
            if (onError) onError(errorObj);

            // Auto dismiss toast after 8 seconds unless user opens help guide
            if (autoDismissTimerRef.current) clearTimeout(autoDismissTimerRef.current);
            autoDismissTimerRef.current = setTimeout(() => {
                setErrorState(prev => (prev?.timestamp === errorObj.timestamp && !showHelpGuide ? null : prev));
            }, 8000);
        };

        recognition.onend = () => {
            setIsListening(false);
            setInterimTranscript('');
        };

        recognitionRef.current = recognition;

        return () => {
            if (recognitionRef.current) {
                try { recognitionRef.current.abort(); } catch {}
            }
            if (autoDismissTimerRef.current) clearTimeout(autoDismissTimerRef.current);
        };
    }, [onTranscript, onError, showHelpGuide]);

    const toggleListening = () => {
        if (!isSupported) {
            const errorObj = {
                title: 'Voice Search Unsupported',
                message: 'Voice-to-text search is not supported in this browser version. Please type your search query or use Chrome, Edge, or Safari.',
                code: 'UNSUPPORTED',
                timestamp: Date.now()
            };
            setErrorState(errorObj);
            if (onError) onError(errorObj);
            return;
        }

        if (isListening) {
            if (recognitionRef.current) {
                try { recognitionRef.current.stop(); } catch {}
            }
            setIsListening(false);
            setInterimTranscript('');
        } else {
            setErrorState(null);
            setShowHelpGuide(false);
            if (recognitionRef.current) {
                try {
                    recognitionRef.current.start();
                } catch (err) {
                    console.warn('[VoiceSearch] Start error:', err);
                    setErrorState({
                        title: 'Voice Search Error',
                        message: 'Could not activate microphone listener. Try again.',
                        code: 'START_ERROR',
                        timestamp: Date.now()
                    });
                }
            }
        }
    };

    return (
        <div className={`relative inline-flex items-center ${className}`}>
            <button
                type="button"
                onClick={toggleListening}
                aria-label={isListening ? "Stop voice search listening" : "Search medicine by voice input"}
                aria-pressed={isListening}
                title={isSupported ? "Click to speak medicine name (Voice Search)" : "Voice search not supported in this browser"}
                className={`relative group inline-flex items-center justify-center min-w-[38px] min-h-[38px] sm:min-w-[42px] sm:min-h-[42px] p-2 rounded-xl transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    isListening
                        ? 'bg-rose-600 text-white shadow-lg scale-105 animate-pulse'
                        : isSupported
                        ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-900 border border-slate-200'
                        : 'bg-slate-100 text-slate-400 opacity-70'
                }`}
            >
                {/* Visual Mic Symbol / Ripple Waveform */}
                <span className="text-sm sm:text-base select-none">
                    {isListening ? '🎙️' : '🎤'}
                </span>

                {/* Animated Pulsing Ring when Active Listening */}
                {isListening && (
                    <span className="absolute -inset-1 rounded-xl bg-rose-500/30 animate-ping pointer-events-none" />
                )}
            </button>

            {/* Accessibility Screen Reader Announcer for Listening & Error States */}
            <div aria-live="assertive" aria-atomic="true" className="sr-only">
                {isListening
                    ? `Listening for medicine search input. ${interimTranscript}`
                    : errorState
                    ? `Microphone Alert: ${errorState.title}. ${errorState.message}`
                    : ''}
            </div>

            {/* Floating Listening Feedback Tooltip / Interim Text */}
            {isListening && (
                <div className="absolute top-full right-0 mt-2 z-50 min-w-[220px] max-w-xs bg-slate-900 text-white p-3 rounded-2xl shadow-xl text-xs space-y-1.5 animate-fade-in border border-slate-700">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-[11px]">
                            <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping shrink-0" />
                            <span>Listening... Speak medicine name</span>
                        </div>
                        <button
                            type="button"
                            onClick={toggleListening}
                            className="text-slate-400 hover:text-white text-xs px-1"
                        >
                            Cancel
                        </button>
                    </div>
                    {interimTranscript ? (
                        <p className="text-[11px] font-mono text-slate-200 italic bg-slate-800/80 p-2 rounded-xl border border-slate-700">
                            "{interimTranscript}"
                        </p>
                    ) : (
                        <p className="text-[10px] text-slate-400">e.g. Say "Paracetamol", "Dolo 650", or "Augmentin"</p>
                    )}
                </div>
            )}

            {/* User-Facing Error State Toast / Inline Alert Card */}
            {errorState && !isListening && (
                <div className="absolute top-full right-0 mt-2 z-50 w-72 sm:w-80 bg-white border border-rose-200 rounded-2xl shadow-2xl p-3.5 text-xs text-slate-800 space-y-2 animate-fade-in">
                    <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <span className="p-1.5 bg-rose-100 text-rose-700 rounded-lg text-sm shrink-0">⚠️</span>
                            <div>
                                <h5 className="font-extrabold text-slate-900 text-xs">{errorState.title}</h5>
                                <span className="text-[9px] font-mono font-bold text-rose-600 uppercase tracking-wider">{errorState.code}</span>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => setErrorState(null)}
                            className="text-slate-400 hover:text-slate-700 text-xs p-1 rounded-full hover:bg-slate-100"
                            aria-label="Close error toast"
                        >
                            ✕
                        </button>
                    </div>

                    <p className="text-[11px] text-slate-600 leading-snug">
                        {errorState.message}
                    </p>

                    {/* Permission Instructions / Action Buttons */}
                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                        {errorState.code === 'NOT_ALLOWED' && (
                            <button
                                type="button"
                                onClick={() => setShowHelpGuide(!showHelpGuide)}
                                className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 underline cursor-pointer"
                            >
                                {showHelpGuide ? 'Hide Permission Steps' : 'How to Unblock Mic?'}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={toggleListening}
                            className="ml-auto px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-[10px] rounded-xl transition shadow-xs cursor-pointer shrink-0"
                        >
                            Retry Voice Input 🎙️
                        </button>
                    </div>

                    {/* Step-by-Step Permission Instruction Guide */}
                    {showHelpGuide && (
                        <div className="mt-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1 text-[10px] text-slate-700 font-medium">
                            <p className="font-bold text-slate-900">How to grant microphone access:</p>
                            <ol className="list-decimal list-inside space-y-0.5 text-[10px] text-slate-600">
                                <li>Click the 🔒 lock or settings icon beside the website address URL.</li>
                                <li>Find <strong className="text-slate-800">Microphone</strong> in site permissions.</li>
                                <li>Switch permission to <strong className="text-emerald-700">Allow</strong>.</li>
                                <li>Click "Retry Voice Input" button above.</li>
                            </ol>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
