/**
 * Shared, deterministic catalogue text primitives.
 * Domain-specific medicine safety rules intentionally live in their owning services.
 */
export function normalizeText(value) {
  if (!value) return '';
  return String(value)
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

/** Jaro-Winkler similarity in the inclusive range [0, 1]. */
export function calculateJaroWinklerSimilarity(left, right, normalize = normalizeText) {
  const a = normalize(left);
  const b = normalize(right);
  if (a === b) return 1;
  if (!a || !b) return 0;

  const matchDistance = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatches = new Array(a.length).fill(false);
  const bMatches = new Array(b.length).fill(false);
  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < a.length; i += 1) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, b.length);
    for (let j = start; j < end; j += 1) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches += 1;
      break;
    }
  }
  if (!matches) return 0;

  let k = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!aMatches[i]) continue;
    while (k < b.length && !bMatches[k]) k += 1;
    if (k < b.length && a[i] !== b[k]) transpositions += 1;
    k += 1;
  }

  const jaro = (
    matches / a.length +
    matches / b.length +
    (matches - transpositions / 2) / matches
  ) / 3;
  let prefixLength = 0;
  while (prefixLength < Math.min(4, a.length, b.length) && a[prefixLength] === b[prefixLength]) {
    prefixLength += 1;
  }
  return jaro + prefixLength * 0.1 * (1 - jaro);
}
