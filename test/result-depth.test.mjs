import assert from 'node:assert/strict';
import test from 'node:test';
import { ResultSink, LmcodeError, InvocationResults, Registry } from '../src/index.mjs';

test('deep owned results serialize without native recursion errors or a depth budget', () => {
  let value = 7n;
  for (let i = 0; i < 10000; i++) value = [value];
  const sink = new ResultSink();
  sink.set(value);
  assert.equal(sink.json(), '['.repeat(10000) + '7' + ']'.repeat(10000));
  const results = InvocationResults.fromCommand(['deep'], {});
  const selected = results.select(0, new Registry());
  selected.set(value);
  results.complete(0);
  assert.equal(results.writeFrame().frame, 'LMCODE_RETURN_BEGIN\n{"ok":true,"result":' + sink.json() + '}\nLMCODE_RETURN_END\n');
});

test('cyclic host results fail with RUN_HOST and preserve the previous result', () => {
  const sink = new ResultSink(); sink.set(3n);
  const array = []; array.push(array);
  const map = new Map(); map.set('self', map);
  for (const value of [array, map]) {
    assert.throws(() => sink.set(value), (e) => e instanceof LmcodeError && e.code === 'RUN_HOST' && /cycle/.test(e.message));
    assert.equal(sink.json(), '3');
    const field = new ResultSink();
    assert.throws(() => field.put('bad', value), (e) => e instanceof LmcodeError && e.code === 'RUN_HOST' && /cycle/.test(e.message));
    assert.equal(field.json(), 'null');
  }
  const shared = [1n];
  sink.set([shared, shared]);
  assert.equal(sink.json(), '[[1],[1]]');
});

test('declared host SDK subpath exports the same result classes', async () => {
  const host = await import('@lmctl-ai/lmcode-js/host');
  assert.equal(host.ResultSink, ResultSink);
  assert.equal(host.InvocationResults, InvocationResults);
});
