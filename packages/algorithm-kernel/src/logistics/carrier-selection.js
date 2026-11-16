const DEFAULT_CRITERIA = Object.freeze([
  { key: 'cost', weight: 0.35, direction: 'min' },
  { key: 'etaMinutes', weight: 0.30, direction: 'min' },
  { key: 'distanceKm', weight: 0.15, direction: 'min' },
  { key: 'sellerPriority', weight: 0.10, direction: 'max' },
  { key: 'successRate', weight: 0.10, direction: 'max' }
]);

const finite = (value, label) => {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be a finite number.`);
  return number;
};

export function scoreCarriersTOPSIS(candidates, criteria = DEFAULT_CRITERIA) {
  if (!Array.isArray(candidates) || !Array.isArray(criteria) || criteria.length === 0) {
    throw new TypeError('Candidates and non-empty criteria are required.');
  }
  const eligible = candidates.filter(candidate => candidate && candidate.serviceable !== false);
  if (!eligible.length) return [];
  const normalizedCriteria = criteria.map(item => {
    if (!item?.key || !['min', 'max'].includes(item.direction)) throw new TypeError('Each criterion needs a key and min/max direction.');
    const weight = finite(item.weight, `weight for ${item.key}`);
    if (weight < 0) throw new RangeError('Criterion weights cannot be negative.');
    return { ...item, weight };
  });
  const weightTotal = normalizedCriteria.reduce((sum, item) => sum + item.weight, 0);
  if (weightTotal <= 0) throw new RangeError('At least one criterion weight must be positive.');
  const weights = normalizedCriteria.map(item => item.weight / weightTotal);
  const matrix = eligible.map(candidate => normalizedCriteria.map(item => finite(candidate[item.key], `${candidate.providerId}.${item.key}`)));
  const norms = normalizedCriteria.map((_, column) => Math.sqrt(matrix.reduce((sum, row) => sum + row[column] ** 2, 0)) || 1);
  const weighted = matrix.map(row => row.map((value, column) => value / norms[column] * weights[column]));
  const idealBest = normalizedCriteria.map((item, column) => {
    const values = weighted.map(row => row[column]);
    return item.direction === 'min' ? Math.min(...values) : Math.max(...values);
  });
  const idealWorst = normalizedCriteria.map((item, column) => {
    const values = weighted.map(row => row[column]);
    return item.direction === 'min' ? Math.max(...values) : Math.min(...values);
  });
  return eligible.map((candidate, index) => {
    const distanceBest = Math.sqrt(weighted[index].reduce((sum, value, column) => sum + (value - idealBest[column]) ** 2, 0));
    const distanceWorst = Math.sqrt(weighted[index].reduce((sum, value, column) => sum + (value - idealWorst[column]) ** 2, 0));
    const denominator = distanceBest + distanceWorst;
    return {
      ...candidate,
      topsisScore: denominator === 0 ? 1 : distanceWorst / denominator
    };
  }).sort((a, b) => b.topsisScore - a.topsisScore || String(a.providerId).localeCompare(String(b.providerId)));
}

export class EpsilonGreedyCarrierBandit {
  constructor({ epsilon = 0.08, random = Math.random } = {}) {
    if (!Number.isFinite(epsilon) || epsilon < 0 || epsilon > 1) throw new RangeError('epsilon must be between 0 and 1.');
    if (typeof random !== 'function') throw new TypeError('random must be a function.');
    this.epsilon = epsilon;
    this.random = random;
    this.arms = new Map();
  }

  recordOutcome(providerId, reward) {
    const key = String(providerId || '').trim();
    const value = finite(reward, 'reward');
    if (!key || value < 0 || value > 1) throw new RangeError('providerId is required and reward must be between 0 and 1.');
    const prior = this.arms.get(key) || { pulls: 0, rewardMean: 0 };
    const pulls = prior.pulls + 1;
    this.arms.set(key, { pulls, rewardMean: prior.rewardMean + (value - prior.rewardMean) / pulls });
  }

  select(rankedCandidates) {
    if (!Array.isArray(rankedCandidates) || rankedCandidates.length === 0) return null;
    const eligible = rankedCandidates.filter(item => item?.providerId && Number.isFinite(item.topsisScore));
    if (!eligible.length) return null;
    const explore = this.random() < this.epsilon;
    if (explore) {
      const index = Math.min(eligible.length - 1, Math.floor(this.random() * eligible.length));
      return { ...eligible[index], selectionMode: 'EXPLORE' };
    }
    const ranked = eligible.map(candidate => {
      const arm = this.arms.get(String(candidate.providerId)) || { pulls: 0, rewardMean: 0.5 };
      // The exploration bonus gives new carriers a neutral prior; TOPSIS remains
      // the primary deterministic score and observed reliability is a bounded tie-breaker.
      const reliabilityFactor = 0.8 + 0.2 * arm.rewardMean;
      return { candidate, adaptiveScore: candidate.topsisScore * reliabilityFactor };
    }).sort((a, b) => b.adaptiveScore - a.adaptiveScore || String(a.candidate.providerId).localeCompare(String(b.candidate.providerId)));
    return { ...ranked[0].candidate, adaptiveScore: ranked[0].adaptiveScore, selectionMode: 'EXPLOIT' };
  }

  snapshot() {
    return Object.fromEntries([...this.arms.entries()].map(([providerId, value]) => [providerId, { ...value }]));
  }
}

export class HybridCarrierSelector {
  constructor({ criteria = DEFAULT_CRITERIA, bandit = new EpsilonGreedyCarrierBandit() } = {}) {
    this.criteria = criteria;
    this.bandit = bandit;
  }

  select(candidates) {
    const ranked = scoreCarriersTOPSIS(candidates, this.criteria);
    const selected = this.bandit.select(ranked);
    return { selected, ranked };
  }

  recordVerifiedOutcome(providerId, { delivered, onTime, rto = false, damaged = false } = {}) {
    // Reward is based on completed shipment evidence, never assignment/pickup.
    const reward = delivered === true
      ? Math.max(0, Math.min(1, 0.55 + (onTime === true ? 0.30 : 0) - (rto ? 0.35 : 0) - (damaged ? 0.25 : 0)))
      : 0;
    this.bandit.recordOutcome(providerId, reward);
    return reward;
  }
}

export { DEFAULT_CRITERIA as DEFAULT_CARRIER_CRITERIA };
