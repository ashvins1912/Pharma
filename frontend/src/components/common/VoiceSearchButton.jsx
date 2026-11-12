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

export default function VoiceSearchButton({ onTranscript, currentQuery = '', className = '' }) {
    const [isListening, setIsListening] = useState(false);
    const [interimTranscript, setInterimTranscript] = useState('');
    const [errorMsg, setErrorMsg] = useState(null);
    const [isSupported, setIsSupported] = useState(true);

    const recognitionRef = useRef(null);

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
            setErrorMsg(null);
            setInterimTranscript('');
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
            console.warn('[VoiceSearch] Error:', event.error);
            setIsListening(false);
            setInterimTranscript('');
            if (event.error === 'not-allowed') {
                setErrorMsg('Microphone access denied. Enable permissions in browser.');
            } else if (event.error === 'no-speech') {
                setErrorMsg('No speech detected. Please try speaking again.');
            } else {
                setErrorMsg('Voice recognition error. Please try again.');
            }
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
        };
    }, [onTranscript]);

    const toggleListening = () => {
        if (!isSupported) {
            alert('Voice search is not natively supported in this browser. You can type your search query manually.');
            return;
        }

        if (isListening) {
            if (recognitionRef.current) {
                try { recognitionRef.current.stop(); } catch {}
            }
            setIsListening(false);
            setInterimTranscript('');
        } else {
            setErrorMsg(null);
            if (recognitionRef.current) {
                try {
                    recognitionRef.current.start();
                } catch (err) {
                    console.warn('[VoiceSearch] Start error:', err);
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
                        : 'bg-slate-100 text-slate-400 cursor-not-allowed opacity-60'
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

            {/* Accessibility Live Announcer & Listening Status Bubble */}
            <div aria-live="polite" aria-atomic="true" className="sr-only">
                {isListening ? `Listening for medicine search input. ${interimTranscript}` : ''}
            </div>

            {/* Floating Listening Feedback Tooltip / Interim Text */}
            {isListening && (
                <div className="absolute top-full right-0 mt-2 z-50 min-w-[200px] max-w-xs bg-slate-900 text-white p-2.5 rounded-2xl shadow-xl text-xs space-y-1 animate-fade-in border border-slate-700">
                    <div className="flex items-center gap-2 text-emerald-400 font-bold text-[11px]">
                        <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping shrink-0" />
                        <span>Listening... Speak medicine name</span>
                    </div>
                    {interimTranscript && (
                        <p className="text-[11px] font-mono text-slate-200 italic bg-slate-800 p-1.5 rounded-lg">
                            "{interimTranscript}"
                        </p>
                    )}
                </div>
            )}

            {/* Error Message Dropdown */}
            {errorMsg && !isListening && (
                <div className="absolute top-full right-0 mt-2 z-50 w-64 bg-rose-900 text-rose-100 p-2.5 rounded-2xl shadow-xl text-[11px] border border-rose-700 flex items-start justify-between gap-2">
                    <span>{errorMsg}</span>
                    <button
                        onClick={() => setErrorMsg(null)}
                        className="text-rose-300 hover:text-white font-bold p-0.5"
                        aria-label="Dismiss message"
                    >
                        ✕
                    </button>
                </div>
            )}
        </div>
    );
}
