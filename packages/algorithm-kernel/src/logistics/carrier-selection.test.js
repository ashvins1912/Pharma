import assert from 'node:assert/strict';
import test from 'node:test';
import { EpsilonGreedyCarrierBandit, HybridCarrierSelector, scoreCarriersTOPSIS } from './carrier-selection.js';

const criteria = [
  { key: 'cost', weight: 0.5, direction: 'min' },
  { key: 'etaMinutes', weight: 0.5, direction: 'min' }
];

test('TOPSIS excludes unserviceable carriers and ranks eligible alternatives', () => {
  const ranked = scoreCarriersTOPSIS([
    { providerId: 'slow', cost: 10, etaMinutes: 90 },
    { providerId: 'balanced', cost: 12, etaMinutes: 35 },
    { providerId: 'unserviceable', cost: 1, etaMinutes: 1, serviceable: false }
  ], criteria);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].providerId, 'balanced');
  assert.ok(ranked.every(item => item.topsisScore >= 0 && item.topsisScore <= 1));
});

test('TOPSIS is deterministic for equal inputs and stable on score ties', () => {
  const input = [
    { providerId: 'provider-b', cost: 5, etaMinutes: 10 },
    { providerId: 'provider-a', cost: 5, etaMinutes: 10 }
  ];
  assert.deepEqual(
    scoreCarriersTOPSIS(input, criteria).map(item => item.providerId),
    ['provider-a', 'provider-b']
  );
});

test('epsilon-greedy explores and then exploits learned verified carrier reliability', () => {
  const values = [0, 0.99];
  const exploring = new EpsilonGreedyCarrierBandit({ epsilon: 0.1, random: () => values.shift() });
  const ranked = [
    { providerId: 'cheap-low-success', topsisScore: 0.9 },
    { providerId: 'reliable', topsisScore: 0.8 }
  ];
  assert.equal(exploring.select(ranked).selectionMode, 'EXPLORE');
  assert.equal(exploring.select(ranked).providerId, 'reliable');

  const exploiting = new EpsilonGreedyCarrierBandit({ epsilon: 0, random: () => 0.99 });
  exploiting.recordOutcome('cheap-low-success', 0.1);
  exploiting.recordOutcome('reliable', 1);
  assert.equal(exploiting.select(ranked).providerId, 'reliable');
  assert.equal(exploiting.snapshot().reliable.pulls, 1);
});

test('hybrid selector updates rewards only through explicit verified outcomes', () => {
  const selector = new HybridCarrierSelector({
    criteria,
    bandit: new EpsilonGreedyCarrierBandit({ epsilon: 0, random: () => 0.99 })
  });
  const { selected } = selector.select([
    { providerId: 'carrier-a', cost: 10, etaMinutes: 45 },
    { providerId: 'carrier-b', cost: 12, etaMinutes: 30 }
  ]);
  assert.ok(selected);
  const reward = selector.recordVerifiedOutcome('carrier-b', {
    delivered: true, onTime: true, rto: false, damaged: false
  });
  assert.equal(reward, 0.85);
  assert.equal(selector.bandit.snapshot()['carrier-b'].pulls, 1);
});

test('invalid criterion weights and rewards fail closed', () => {
  assert.throws(() => scoreCarriersTOPSIS([{ providerId: 'x', cost: 1 }], [
    { key: 'cost', weight: -1, direction: 'min' }
  ]), /negative/i);
  const bandit = new EpsilonGreedyCarrierBandit();
  assert.throws(() => bandit.recordOutcome('carrier', 1.5), /between 0 and 1/i);
});
