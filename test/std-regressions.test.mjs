import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRegistry, LmcodeError } from '../src/index.mjs';
const bytes = (s) => Buffer.from(s).toString('latin1');
const hostError = (error) => error instanceof LmcodeError && error.code === 'RUN_HOST';

test('JSON keys preserve UTF-8 byte strings across get, has and keys', () => {
  const r = createRegistry(); r.beginRun();
  const j = r.invokeFunction('fn json_parse(string) -> Json', [bytes('{"é":7,"😀":8,"a/b~":9}')]);
  for (const [key, value] of [['é', 7n], ['😀', 8n], ['a/b~', 9n]]) {
    assert.equal(r.invokeMethod('method Json.has(string) -> bool', j, [bytes(key)]), true);
    const child = r.invokeMethod('method Json.get(string) -> Json', j, [bytes(key)]);
    assert.equal(r.invokeMethod('method Json.as_int() -> int', child, []), value);
  }
  const keys = r.invokeMethod('method Json.keys() -> StrList', j, []);
  assert.deepEqual(keys.value.data.values, ['é', '😀', 'a/b~'].map(bytes));
  // An invalid byte cannot alias a valid replacement-character Unicode key.
  const replacement = r.invokeFunction('fn json_parse(string) -> Json', [bytes('{"�":1}')]);
  assert.equal(r.invokeMethod('method Json.has(string) -> bool', replacement, ['\xff']), false);
});

test('float zero exponents are valid and preserve negative zero', () => {
  const r = createRegistry();
  for (const s of ['0e1', '0.0e-10', '-0e2', '+0e99']) {
    assert.equal(r.invokeFunction('fn str_is_float(string) -> bool', [s]), true, s);
    assert.equal(Object.is(r.invokeFunction('fn str_to_float(string) -> float', [s]), s.startsWith('-') ? -0 : 0), true, s);
  }
  assert.equal(r.invokeFunction('fn str_is_float(string) -> bool', ['1e-9999']), false);
});

test('file paths preserve Unix bytes and reject invalid Windows UTF-8', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lmcode-byte-path-'));
  const r = createRegistry(); r.beginRun();
  const name = bytes(path.join(dir, 'file-')) + '\xff';
  const write = (content, dry = false) => r.invokeFunction('fn file_write(string, string) -> void', [name, content], { dry });
  try {
    if (process.platform === 'win32') {
      assert.throws(() => write('one'), hostError);
      return;
    }
    write('one');
    r.invokeFunction('fn file_append(string, string) -> void', [name, '\ntwo']);
    assert.equal(r.invokeFunction('fn file_exists(string) -> bool', [name]), true);
    assert.equal(r.invokeFunction('fn file_read(string) -> string', [name]), 'one\ntwo');
    assert.deepEqual(r.invokeFunction('fn file_lines(string) -> StrList', [name]).value.data.values, ['one', 'two']);
    write('changed', true);
    assert.equal(r.invokeFunction('fn file_read(string) -> string', [name]), 'one\ntwo');
    assert.throws(() => r.invokeFunction('fn file_exists(string) -> bool', [name + '\0']), hostError);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('priority queue insertion sequence exhaustion is atomic for all payload types', () => {
  const r = createRegistry(); r.beginRun();
  for (const [kind, prefix, type, value] of [['StrPQ','str_pq','string','s'], ['IntPQ','int_pq','int',1n], ['FloatPQ','float_pq','float',1]]) {
    const q = r.invokeFunction(`fn ${prefix}() -> ${kind}`, []);
    const push = () => r.invokeMethod(`method ${kind}.push(${type}, float) -> ${kind}`, q, [value, 1]);
    q.value.data.next = (1n << 63n) - 2n;
    push();
    assert.equal(q.value.data.next, (1n << 63n) - 1n);
    assert.throws(push, (e) => hostError(e) && e.message === `${kind}.push: insertion sequence exhausted`);
    assert.equal(q.value.data.items.length, 1);
    assert.equal(q.value.data.next, (1n << 63n) - 1n);
    r.invokeMethod(`method ${kind}.clear() -> ${kind}`, q, []);
    push();
    assert.equal(q.value.data.next, 1n);
  }
});

test('platform string capacity failures retain canonical errors', () => {
  const r = createRegistry();
  assert.throws(() => r.invokeFunction('fn str_repeat(string, int) -> string', ['a', 1n << 62n]),
    (e) => hostError(e) && e.message === 'str_repeat: result size exceeds platform capacity');
  const original = String.prototype.repeat;
  try {
    String.prototype.repeat = () => { throw new RangeError('synthetic allocation failure'); };
    assert.throws(() => r.invokeFunction('fn str_repeat(string, int) -> string', ['a', 2n]),
      (e) => hostError(e) && e.message === 'str_repeat: allocation failed');
  } finally { String.prototype.repeat = original; }
});
