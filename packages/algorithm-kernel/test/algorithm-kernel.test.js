import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeText,
  calculateJaroWinklerSimilarity,
  AlgorithmRegistry,
  AlgorithmPipelineBuilder
} from '../src/index.js';

test('shared normalization preserves established catalogue normalization', () => {
  assert.equal(normalizeText('Dolo 650 MG TABLETS'), 'dolo 650mg tablet');
  assert.equal(normalizeText(null), '');
  assert.equal(normalizeText(0), '');
});

test('Jaro-Winkler is bounded and handles short strings safely', () => {
  assert.equal(calculateJaroWinklerSimilarity('a', 'a'), 1);
  assert.equal(calculateJaroWinklerSimilarity('a', 'b'), 0);
  const score = calculateJaroWinklerSimilarity('paracetamol', 'parasetamol');
  assert.ok(score > 0.8 && score <= 1);
});

test('registry rejects accidental replacement and supports explicit strategy swaps', async () => {
  const registry = new AlgorithmRegistry();
  registry.register('matcher', { execute: value => value + 1 }, { version: '1' });
  await assert.rejects(() => registry.register('matcher', { execute: value => value }, {}), /already registered/);
  registry.register('matcher', { execute: value => value + 2 }, { version: '2', replace: true });
  assert.equal(await registry.execute('matcher', 3), 5);
  assert.deepEqual(registry.list(), [{ name: 'matcher', version: '2' }]);
});

test('pipeline passes unhandled input to the next algorithm', async () => {
  const pipeline = new AlgorithmPipelineBuilder()
    .use('exact', { execute: () => null })
    .use('fallback', { execute: value => ({ selected: value }) })
    .build();
  assert.deepEqual(await pipeline.execute('Dolo 650'), { selected: 'Dolo 650' });
});

test('pipeline supports conditional handlers', async () => {
  const pipeline = new AlgorithmPipelineBuilder()
    .use('remote', { execute: () => 'remote' }, { when: (_, context) => context.remoteEnabled })
    .use('local', { execute: () => 'local' })
    .build();
  assert.equal(await pipeline.execute({}, { remoteEnabled: false }), 'local');
});
