const normalize = value => String(value ?? '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\b(six hundred and fifty|six hundred fifty|six fifty)\b/g, '650')
  .replace(/\b(six hundred and twenty five|six twenty five)\b/g, '625')
  .replace(/\b(five hundred)\b/g, '500')
  .replace(/\b(one hundred and twenty|one twenty)\b/g, '120')
  .replace(/\b(forty)\b/g, '40')
  .replace(/\b(ten)\b/g, '10')
  .replace(/(\d+(?:\.\d+)?)\s*(mcg|mg|gm|g|ml|iu)\b/g, '$1')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const numbers = value => normalize(value).match(/\d+(?:\.\d+)?/g) || [];

function jaroWinkler(left, right) {
  if (left === right) return 1;
  if (!left || !right) return 0;
  const distance = Math.max(0, Math.floor(Math.max(left.length, right.length) / 2) - 1);
  const leftMatches = new Array(left.length).fill(false);
  const rightMatches = new Array(right.length).fill(false);
  let matches = 0;
  for (let i = 0; i < left.length; i += 1) {
    for (let j = Math.max(0, i - distance); j < Math.min(right.length, i + distance + 1); j += 1) {
      if (rightMatches[j] || left[i] !== right[j]) continue;
      leftMatches[i] = true;
      rightMatches[j] = true;
      matches += 1;
      break;
    }
  }
  if (!matches) return 0;
  let transpositions = 0;
  let rightIndex = 0;
  for (let i = 0; i < left.length; i += 1) {
    if (!leftMatches[i]) continue;
    while (!rightMatches[rightIndex]) rightIndex += 1;
    if (left[i] !== right[rightIndex]) transpositions += 1;
    rightIndex += 1;
  }
  const jaro = (matches / left.length + matches / right.length + (matches - transpositions / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < Math.min(4, left.length, right.length) && left[prefix] === right[prefix]) prefix += 1;
  return jaro + prefix * 0.1 * (1 - jaro);
}

function editSimilarity(left, right) {
  if (left === right) return 1;
  if (!left || !right) return 0;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1)
      );
      if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) {
        current[j] = Math.min(current[j], (previous[j - 2] ?? 0) + 1);
      }
    }
    previous = current;
  }
  return Math.max(0, 1 - previous[right.length] / Math.max(left.length, right.length));
}

function scoreCandidate(query, product) {
  const queryKey = normalize(query);
  if (!queryKey) return 0;
  const queryNumbers = numbers(query);
  const productNumbers = numbers([product.name, product.genericName, product.strength].filter(Boolean).join(' '));
  if (queryNumbers.length && productNumbers.length
    && !queryNumbers.some(number => productNumbers.includes(number))) return 0;

  const fields = [
    product.name,
    product.genericName,
    product.strength ? `${product.name || ''} ${product.strength}` : '',
    product.strength ? `${product.genericName || ''} ${product.strength}` : ''
  ].map(normalize).filter(Boolean);
  let best = 0;
  for (const field of fields) {
    if (field === queryKey) return 100;
    if (field.startsWith(queryKey + ' ')) {
      best = Math.max(best, 98);
      continue;
    }
    const queryTokens = queryKey.split(' ');
    const fieldTokens = new Set(field.split(' '));
    const tokenCoverage = queryTokens.filter(token => fieldTokens.has(token)).length / queryTokens.length;
    const score = (jaroWinkler(queryKey, field) * 50)
      + (editSimilarity(queryKey, field) * 30)
      + (tokenCoverage * 20);
    best = Math.max(best, Math.round(score));
  }
  return best;
}

/**
 * Bounded second-pass typo-tolerant ranking for a tenant's own product catalogue.
 * Strength conflicts are excluded; only real product documents are returned.
 */
export function rankInventorySearchCandidates(query, candidates, { limit = 100, minimumScore = 68 } = {}) {
  if (!Array.isArray(candidates) || !normalize(query)) return [];
  return candidates.map(product => ({
    product,
    score: scoreCandidate(query, product)
  }))
    .filter(match => match.score >= minimumScore)
    .sort((a, b) => b.score - a.score
      || String(a.product.name || '').localeCompare(String(b.product.name || ''))
      || String(a.product._id || '').localeCompare(String(b.product._id || '')))
    .slice(0, Math.max(1, Math.min(100, Number(limit) || 100)));
}
