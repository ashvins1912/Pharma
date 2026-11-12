/**
 * High-Accuracy Phonetic & Ensemble Text Similarity Engine
 * Optimized for Pharmaceutical Voice Search & Natural Language Voice Commands
 */

export function normalizeText(text) {
    if (!text) return '';
    return String(text)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/gi, '')
        .replace(/\b(tab|tbl|tabs|tablets)\b/gi, 'tablet')
        .replace(/\b(cap|caps|capsules)\b/gi, 'capsule')
        .replace(/\b(syr|syrup)\b/gi, 'syrup')
        .replace(/\b(inj|injection)\b/gi, 'injection')
        .replace(/\b(\d+)\s*(mg|g|ml|mcg|iu)\b/gi, '$1$2')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Phonetic Sound-Alike Encoder (Simplified Metaphone Algorithm)
 * Maps sound-alike spoken medical terms to identical phonetic keys
 * e.g. "parasetamol" & "paracetamol" -> "PRSTML"
 * e.g. "azithromicin" & "azithromycin" -> "ASTRMSN"
 */
export function getPhoneticKey(text) {
    const norm = normalizeText(text);
    if (!norm) return '';

    return norm
        .replace(/ph/g, 'f')
        .replace(/c([eiy])/g, 's$1')
        .replace(/c/g, 'k')
        .replace(/ck/g, 'k')
        .replace(/z/g, 's')
        .replace(/th/g, 't')
        .replace(/x/g, 'ks')
        .replace(/[aeiouy]/g, '')
        .toUpperCase()
        .replace(/\s+/g, '');
}

/**
 * Jaro-Winkler Distance
 */
export function calculateJaroWinklerSimilarity(s1, s2) {
    const a = normalizeText(s1);
    const b = normalizeText(s2);
    if (a === b) return 1.0;
    if (!a || !b) return 0.0;

    const len1 = a.length;
    const len2 = b.length;
    const matchDistance = Math.floor(Math.max(len1, len2) / 2) - 1;

    const aMatches = new Array(len1).fill(false);
    const bMatches = new Array(len2).fill(false);

    let matches = 0;
    let transpositions = 0;

    for (let i = 0; i < len1; i++) {
        const start = Math.max(0, i - matchDistance);
        const end = Math.min(i + matchDistance + 1, len2);

        for (let j = start; j < end; j++) {
            if (bMatches[j]) continue;
            if (a[i] !== b[j]) continue;
            aMatches[i] = true;
            bMatches[j] = true;
            matches++;
            break;
        }
    }

    if (matches === 0) return 0.0;

    let k = 0;
    for (let i = 0; i < len1; i++) {
        if (!aMatches[i]) continue;
        while (!bMatches[k]) k++;
        if (a[i] !== b[k]) transpositions++;
        k++;
    }

    const m = matches;
    const jaro = (m / len1 + m / len2 + (m - transpositions / 2) / m) / 3;

    let p = 0.1;
    let l = 0;
    while (l < 4 && a[l] === b[l]) l++;

    return jaro + l * p * (1 - jaro);
}

/**
 * Damerau-Levenshtein Distance (handles insertions, deletions, substitutions & transpositions)
 */
export function calculateDamerauLevenshteinSimilarity(s1, s2) {
    const a = normalizeText(s1);
    const b = normalizeText(s2);
    if (a === b) return 1.0;
    if (!a || !b) return 0.0;

    const len1 = a.length;
    const len2 = b.length;
    const d = Array.from({ length: len1 + 1 }, () => new Array(len2 + 1).fill(0));

    for (let i = 0; i <= len1; i++) d[i][0] = i;
    for (let j = 0; j <= len2; j++) d[0][j] = j;

    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(
                d[i - 1][j] + 1,      // deletion
                d[i][j - 1] + 1,      // insertion
                d[i - 1][j - 1] + cost // substitution
            );

            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost); // transposition
            }
        }
    }

    const dist = d[len1][len2];
    const maxLen = Math.max(len1, len2);
    return Math.max(0, 1 - dist / maxLen);
}

/**
 * Token Set Overlap & Dosage Weighting
 */
export function calculateTokenSetSimilarity(s1, s2) {
    const aTokens = normalizeText(s1).split(/\s+/).filter(Boolean);
    const bTokens = normalizeText(s2).split(/\s+/).filter(Boolean);
    if (!aTokens.length || !bTokens.length) return 0.0;

    const setA = new Set(aTokens);
    const setB = new Set(bTokens);

    let intersection = 0;
    setA.forEach(token => {
        if (setB.has(token)) intersection++;
    });

    const union = new Set([...setA, ...setB]).size;
    const tokenScore = union > 0 ? intersection / union : 0;

    // Check dosage number alignment (e.g. 650, 500, 625, 40)
    const numsA = aTokens.filter(t => /^\d+/.test(t));
    const numsB = bTokens.filter(t => /^\d+/.test(t));

    let dosageMultiplier = 1.0;
    if (numsA.length > 0 && numsB.length > 0) {
        const hasMatchingDosage = numsA.some(n => numsB.includes(n));
        if (hasMatchingDosage) dosageMultiplier = 1.25;
        else dosageMultiplier = 0.65; // Penalty if dosages conflict (e.g. Dolo 650 vs Dolo 500)
    }

    return Math.min(1.0, tokenScore * dosageMultiplier);
}

/**
 * Indian English & Regional Pharmaceutical Phonetic Encoder
 * Handles Indian speech-to-text sound-alikes, silent letters, aspirates & spoken number words
 * e.g. "parasetamol" -> "PRSTML"
 * e.g. "dholo six fifty" -> "DL650"
 * e.g. "setrizin" -> "STRSN"
 */
export function getIndianPhoneticKey(text) {
    let norm = normalizeText(text);
    if (!norm) return '';

    // Convert Indian spoken number phrases to standard numbers
    norm = norm
        .replace(/\bsix fifty\b/g, '650')
        .replace(/\bfive hundred\b/g, '500')
        .replace(/\bsix twenty five\b/g, '625')
        .replace(/\bforty\b/g, '40')
        .replace(/\bten\b/g, '10')
        .replace(/\bone twenty\b/g, '120');

    // Indian Phonetic Replacements
    return norm
        .replace(/ph/g, 'f')
        .replace(/v/g, 'f')
        .replace(/c([eiy])/g, 's$1')
        .replace(/c/g, 'k')
        .replace(/ck/g, 'k')
        .replace(/q/g, 'k')
        .replace(/g/g, 'k')
        .replace(/z/g, 's')
        .replace(/sh/g, 's')
        .replace(/ch/g, 's')
        .replace(/th/g, 'd')
        .replace(/dh/g, 'd')
        .replace(/bh/g, 'p')
        .replace(/b/g, 'p')
        .replace(/[aeiouyw]/g, '') // Remove vowels
        .toUpperCase()
        .replace(/\s+/g, '');
}

/**
 * Ensemble High-Accuracy Matcher
 * Combines Indian Phonetic Metaphone, Jaro-Winkler, Damerau-Levenshtein, and Token Set Matchers
 */
export function calculateEnsembleSimilarity(s1, s2) {
    const norm1 = normalizeText(s1);
    const norm2 = normalizeText(s2);
    if (!norm1 || !norm2) return 0.0;
    if (norm1 === norm2) return 1.0;

    const phoneticKey1 = getPhoneticKey(norm1);
    const phoneticKey2 = getPhoneticKey(norm2);
    const phoneticExact = phoneticKey1 && phoneticKey2 && phoneticKey1 === phoneticKey2;

    const indianKey1 = getIndianPhoneticKey(norm1);
    const indianKey2 = getIndianPhoneticKey(norm2);
    const indianPhoneticExact = indianKey1 && indianKey2 && indianKey1 === indianKey2;

    const jaroScore = calculateJaroWinklerSimilarity(norm1, norm2);
    const levScore = calculateDamerauLevenshteinSimilarity(norm1, norm2);
    const tokenScore = calculateTokenSetSimilarity(norm1, norm2);

    // Weighted Ensemble Calculation
    let ensemble = (tokenScore * 0.40) + (jaroScore * 0.30) + (levScore * 0.30);

    // Boost score if phonetic keys match
    if (indianPhoneticExact || phoneticExact) {
        ensemble = Math.max(ensemble, 0.90) + 0.08;
    }

    // Boost if one string contains the other
    if (norm1.includes(norm2) || norm2.includes(norm1)) {
        ensemble = Math.max(ensemble, 0.85);
    }

    return Math.min(1.0, ensemble);
}

/**
 * Accuracy Benchmark & Verification Test Suite
 * Evaluates test voice inputs against catalog medicines and outputs accuracy report
 */
export function verifyVoiceAssistantAccuracy() {
    const testCases = [
        { spoken: 'doloo 650', expected: 'Dolo 650' },
        { spoken: 'parasetamol 500', expected: 'Paracetamol 500mg' },
        { spoken: 'augmenten 625', expected: 'Augmentin 625 Duo' },
        { spoken: 'montar lc', expected: 'Montair-LC' },
        { spoken: 'pan forty', expected: 'Pan-40' },
        { spoken: 'azithromicin 500', expected: 'Azithromycin 500mg' },
        { spoken: 'cetrizin 10mg', expected: 'Cetirizine 10mg' },
        { spoken: 'allegra 120', expected: 'Allegra 120mg' }
    ];

    let passed = 0;
    const results = testCases.map(tc => {
        const score = calculateEnsembleSimilarity(tc.spoken, tc.expected);
        const isMatch = score >= 0.70;
        if (isMatch) passed++;
        return {
            spoken: tc.spoken,
            expected: tc.expected,
            scorePercentage: Math.round(score * 100),
            passed: isMatch
        };
    });

    const accuracyRate = Math.round((passed / testCases.length) * 100);
    console.info(`[VoiceAssistantAccuracyBenchmark] Accuracy Rate: ${accuracyRate}% (${passed}/${testCases.length} Passed)`);
    return { accuracyRate, passed, total: testCases.length, results };
}


/**
 * Conservative voice-to-catalogue ranking.
 *
 * The matcher only ranks medicines actually present in the supplied catalogue.
 * It never invents popular-medicine candidates and it refuses automatic
 * refinement when strength information is missing or candidates are too close.
 */
const normalizeVoiceMedicineText = value => normalizeText(value)
    .replace(/\b(six hundred and fifty|six hundred fifty|six fifty)\b/g, '650')
    .replace(/\b(six hundred and twenty five|six twenty five)\b/g, '625')
    .replace(/\b(five hundred)\b/g, '500')
    .replace(/\b(one hundred and twenty|one twenty)\b/g, '120')
    .replace(/\b(forty)\b/g, '40')
    .replace(/\b(ten)\b/g, '10')
    .replace(/\b(\d+(?:\.\d+)?)(?:mg|mcg|gm|g|ml|iu)\b/g, '$1')
    .replace(/\b(tablets|tabs|tbl)\b/g, 'tablet')
    .replace(/\b(capsules|caps)\b/g, 'capsule')
    .replace(/\s+/g, ' ')
    .trim();

const getVoiceNumbers = value => normalizeVoiceMedicineText(value).match(/\d+(?:\.\d+)?/g) || [];

function scoreVoiceCandidate(query, candidate) {
    const queryKey = normalizeVoiceMedicineText(query);
    const fields = [
        candidate.brandName, candidate.brand, candidate.name, candidate.productName,
        candidate.genericName, candidate.composition,
        candidate.strength ? `${candidate.brandName || candidate.brand || candidate.name || ''} ${candidate.strength}` : '',
        candidate.strength ? `${candidate.genericName || ''} ${candidate.strength}` : ''
    ].filter(value => typeof value === 'string' && value.trim());
    if (!queryKey || !fields.length) return 0;

    const queryNumbers = getVoiceNumbers(query);
    const candidateNumbers = getVoiceNumbers([
        candidate.brandName, candidate.name, candidate.productName,
        candidate.strength
    ].filter(Boolean).join(' '));
    if (queryNumbers.length && candidateNumbers.length
        && !queryNumbers.some(number => candidateNumbers.includes(number))) return 0;

    let best = 0;
    for (const field of fields) {
        const fieldKey = normalizeVoiceMedicineText(field);
        if (!fieldKey) continue;
        if (fieldKey === queryKey) best = Math.max(best, 1);
        else if (fieldKey.startsWith(queryKey + ' ') || fieldKey.includes(' ' + queryKey + ' ')) {
            best = Math.max(best, 0.97);
        } else {
            const jaro = calculateJaroWinklerSimilarity(queryKey, fieldKey);
            const edit = calculateDamerauLevenshteinSimilarity(queryKey, fieldKey);
            const queryTokens = queryKey.split(' ').filter(Boolean);
            const fieldTokens = new Set(fieldKey.split(' ').filter(Boolean));
            const tokenCoverage = queryTokens.length
                ? queryTokens.filter(token => fieldTokens.has(token)).length / queryTokens.length
                : 0;
            let score = (jaro * 0.5) + (edit * 0.3) + (tokenCoverage * 0.2);
            if (queryKey.length >= 5 && getPhoneticKey(queryKey) === getPhoneticKey(fieldKey)) {
                score = Math.max(score, 0.92);
            }
            best = Math.max(best, score);
        }
    }
    return best;
}

export function rankVoiceMedicineMatches(query, catalog = []) {
    const cleanedQuery = String(query || '').trim();
    if (cleanedQuery.length < 2 || !Array.isArray(catalog)) {
        return { best: null, alternatives: [], confidence: 0, isConfident: false, reason: 'INSUFFICIENT_INPUT' };
    }

    const ranked = catalog
        .filter(item => item && typeof item === 'object')
        .map(item => {
            const score = scoreVoiceCandidate(cleanedQuery, item);
            const name = item.name || item.productName || item.brandName || item.brand || item.genericName || '';
            const strength = String(item.strength || '').trim();
            const form = String(item.dosageForm || item.form || '').trim();
            const queryNumbers = getVoiceNumbers(cleanedQuery);
            const candidateNumbers = getVoiceNumbers([name, strength].filter(Boolean).join(' '));
            const missingStrength = Boolean(strength || candidateNumbers.length) && queryNumbers.length === 0;
            const identity = [
                item.medicineId || item.productId || item._id || name,
                strength, form
            ].join('|').toLowerCase();
            return { item, name, score, strength, form, missingStrength, identity };
        })
        .filter(item => item.name && item.score >= 0.5)
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

    const unique = [];
    const seen = new Set();
    for (const match of ranked) {
        if (seen.has(match.identity)) continue;
        seen.add(match.identity);
        unique.push(match);
    }

    const best = unique[0] || null;
    const runnerUp = unique[1] || null;
    const margin = best ? best.score - (runnerUp?.score || 0) : 0;
    const hasStrengthConflict = Boolean(best && getVoiceNumbers(cleanedQuery).length
        && getVoiceNumbers([best.name, best.strength].filter(Boolean).join(' '))
            .length
        && !getVoiceNumbers(cleanedQuery).some(number =>
            getVoiceNumbers([best.name, best.strength].filter(Boolean).join(' ')).includes(number)));
    const isConfident = Boolean(best
        && best.score >= 0.9
        && margin >= 0.08
        && !best.missingStrength
        && !hasStrengthConflict);

    return {
        best,
        alternatives: unique.slice(0, 3).map(item => ({
            name: item.name,
            score: Math.round(item.score * 100),
            strength: item.strength,
            dosageForm: item.form
        })),
        confidence: Math.round((best?.score || 0) * 100),
        isConfident,
        reason: !best ? 'NO_CATALOG_MATCH'
            : best.missingStrength ? 'STRENGTH_REQUIRED'
            : margin < 0.08 ? 'AMBIGUOUS_CANDIDATES'
            : best.score < 0.9 ? 'LOW_CONFIDENCE'
            : 'CONFIDENT_MATCH'
    };
}
