import React, { useMemo } from 'react';
import { calculateJaroWinklerSimilarity } from '../../utils/similarity';

const COMMON_MEDICINES = [
    'Dolo 650mg',
    'Paracetamol 500mg',
    'Augmentin 625 Duo',
    'Montair-LC',
    'Pan-40',
    'Azithromycin 500mg',
    'Cetirizine 10mg',
    'Allegra 120mg',
    'Ibuprofen 400mg',
    'Zerodol-P',
    'Telma 40mg',
    'Glycomet 500mg',
    'Thyronorm 50mcg',
    'Limcee Vitamin C',
    'Volini Pain Spray',
    'Electral ORS',
    'Gelusil MPS',
    'Becosules Z'
];

export default function VoiceSuggestedCorrections({ searchQuery, onSelectSuggestion }) {
    const suggestions = useMemo(() => {
        if (!searchQuery || searchQuery.trim().length < 2) return [];

        const queryNorm = searchQuery.trim().toLowerCase();
        const matches = [];

        for (const med of COMMON_MEDICINES) {
            const medNorm = med.toLowerCase();
            const score = calculateJaroWinklerSimilarity(queryNorm, medNorm);
            if (score >= 0.45) {
                matches.push({
                    name: med,
                    score: Math.round(score * 100)
                });
            }
        }

        matches.sort((a, b) => b.score - a.score);
        return matches.slice(0, 4);
    }, [searchQuery]);

    if (!suggestions || suggestions.length === 0) return null;

    return (
        <div className="p-3.5 bg-indigo-50/70 border border-indigo-200/80 rounded-2xl space-y-2 text-left animate-fade-in">
            <div className="flex items-center gap-1.5 text-xs font-black text-indigo-950">
                <span className="text-base">🎙️✨</span>
                <span>Did you mean one of these spoken medicine names?</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                {suggestions.map((s) => (
                    <button
                        key={s.name}
                        type="button"
                        onClick={() => onSelectSuggestion(s.name)}
                        className="px-3 py-1.5 bg-white hover:bg-indigo-600 text-indigo-900 hover:text-white border border-indigo-200 hover:border-indigo-600 rounded-xl text-xs font-bold transition shadow-xs cursor-pointer flex items-center gap-1.5"
                    >
                        <span>{s.name}</span>
                        <span className="text-[10px] opacity-75 font-mono">({s.score}%)</span>
                    </button>
                ))}
            </div>
        </div>
    );
}
