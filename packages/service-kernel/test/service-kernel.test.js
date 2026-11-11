import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError, Result, ServiceContainerBuilder, createSingleton, toAppError } from '../src/index.js';

test('container resolves singleton once and transient dependencies per resolution', () => {
  let singletonBuilds = 0;
  let transientBuilds = 0;
  const container = new ServiceContainerBuilder()
    .singleton('clock', () => ({ id: ++singletonBuilds }))
    .transient('requestContext', () => ({ id: ++transientBuilds }))
    .singleton('service', ({ clock }) => ({ clock }), ['clock'])
    .build();

  assert.equal(container.resolve('service'), container.resolve('service'));
  assert.equal(container.resolve('service').clock.id, 1);
  assert.notEqual(container.resolve('requestContext'), container.resolve('requestContext'));
  assert.equal(singletonBuilds, 1);
  assert.equal(transientBuilds, 2);
});

test('container rejects duplicate registrations, cycles and post-build mutations', () => {
  const builder = new ServiceContainerBuilder().singleton('a', ({ b }) => b, ['b']);
  assert.throws(() => builder.singleton('a', () => null), /already registered/);
  const container = builder.singleton('b', ({ a }) => a, ['a']).build();
  assert.throws(() => container.resolve('a'), /Circular dependency/);
  assert.throws(() => builder.value('late', true), /already finalized/);
});

test('container supports explicit values and rejects unknown dependencies', () => {
  const marker = Object.freeze({ ready: true });
  const container = new ServiceContainerBuilder().value('marker', marker).build();
  assert.equal(container.resolve('marker'), marker);
  assert.throws(() => container.resolve('missing'), /not registered/);
});

test('createSingleton initializes lazily and only once', () => {
  let calls = 0;
  const get = createSingleton(() => ({ id: ++calls }));
  assert.equal(calls, 0);
  assert.equal(get(), get());
  assert.equal(calls, 1);
});

test('Result and AppError expose predictable application outcomes', () => {
  assert.equal(Result.ok(42).getValue(), 42);
  assert.equal(Result.fail(new Error('no')).isFailure, true);
  assert.throws(() => Result.ok(1).getError());
  assert.equal(AppError.notFound().statusCode, 404);
  assert.equal(toAppError(new Error('secret')).expose, false);
});
