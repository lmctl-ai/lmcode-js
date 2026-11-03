import assert from 'node:assert/strict';
import test from 'node:test';
import { Registry } from '../src/core/registry.mjs';
import { createRegistry } from '../src/std/index.mjs';

test('dry mode does not invoke an effectful real callback', () => {
  let sentinel = 0;
  const registry = new Registry().fn('fn effect() -> int', () => { sentinel++; return 1n; });
  const value = registry.invokeFunction('fn effect() -> int', [], { dry: true });
  assert.equal(sentinel, 0);
  assert.equal(value, 0n);
});

test('a dry override runs once and real mode keeps the real callback', () => {
  let real = 0; let preview = 0;
  const registry = new Registry().fn('fn effect() -> int', () => { real++; return 3n; }, { dry: () => { preview++; return 9n; } });
  assert.equal(registry.invokeFunction('fn effect() -> int', [], { dry: true }), 9n);
  assert.equal(preview, 1); assert.equal(real, 0);
  assert.equal(registry.invokeFunction('fn effect() -> int', [], { dry: false }), 3n);
  assert.equal(real, 1);
});

test('each skipped object-returning dry call gets a fresh mutable dummy', () => {
  const registry = createRegistry();
  registry.fn('fn fresh_list() -> IntList', () => { throw new Error('real callback ran'); });
  const generation = registry.beginRun();
  try {
    const first = registry.invokeFunction('fn fresh_list() -> IntList', [], { dry: true });
    const second = registry.invokeFunction('fn fresh_list() -> IntList', [], { dry: true });
    first.value.data.values.push(1n);
    assert.deepEqual(second.value.data.values, []);
  } finally { registry.endRun(generation); }
});
