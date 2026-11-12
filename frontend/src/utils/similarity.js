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
