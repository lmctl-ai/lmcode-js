import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { formatG15 } from '../src/core/values.mjs';
import { ResultSink } from '../src/host/result-sink.mjs';
import { createRegistry, registerTesting } from '../src/std/index.mjs';
import { makeHandle } from '../src/std/collections.mjs';
import stdSchema from '../std/lmcode-std.schema.json' with { type: 'json' };

export class Thing { constructor(id = 0n) { this.id = id; } }

export function makeStub({ standard = false } = {}) {
  const trace = [];
  const root = new Thing(0n);
  const variable = new Thing(0n);
  const output = [];
  const temp = standard ? mkdtempSync(path.join(tmpdir(), 'lmcode-js-conformance-')) : '';
  let currentSink = new ResultSink();
  const registry = createRegistry();
  const fn = (sig, cb, options) => registry.fn(sig, cb, options);
  const method = (sig, cb, options) => registry.method(sig, cb, options);
  const ctx = (name, type) => registry.context(name, type);

  ctx('t', 'Trace'); ctx('root', 'Thing'); ctx('v', 'Var');
  registry.enum('Status');
  if (!standard) ctx('xs', 'IntList');
  method('method Trace.int(int) -> void', (_self, x) => { trace.push(`int ${x}`); });
  method('method Trace.int(float) -> void', (_self, x) => { trace.push(`float ${formatG15(x)}`); });
  method('method Trace.float(float) -> void', (_self, x) => { trace.push(`float ${formatG15(x)}`); });
  method('method Trace.str(string) -> void', (_self, x) => { trace.push(`str ${x}`); });
  method('method Trace.bool(bool) -> void', (_self, x) => { trace.push(`bool ${x}`); });
  method('method Trace.thing(Thing) -> void', (_self, x) => { trace.push(`thing ${x.id}`); });
  method('method Trace.hex(string) -> void', (_self, bytes) => { trace.push(`hex ${Buffer.from(bytes).toString('hex')}`); }, { rawStrings: true });
  method('method Trace.status() -> Status', () => 'OPTIMAL');
  method('method Thing.len() -> int', (self) => { trace.push(`len ${self.id}`); return self.id; });
  method('method Thing.at(int) -> Thing', (_self, id) => { trace.push(`at ${id}`); return new Thing(id); });
  method('method Thing.id() -> int', (self) => self.id);
  method('method Thing.next() -> Thing', (self) => new Thing(self.id + 1n));
  method('method Thing.name() -> string', (self) => `thing-${self.id}`);
  method('method Thing.scaled(float) -> float', (self, x) => Number(self.id) * x);
  method('method Thing.plus(Thing) -> Thing', (self, other) => new Thing(self.id + other.id));
  method('method Thing.minus(Thing) -> Thing', (self, other) => new Thing(self.id - other.id));
  method('method Thing.times(int) -> Thing', (self, x) => new Thing(self.id * x));
  method('method Thing.neg() -> Thing', (self) => new Thing(-self.id));
  method('method Thing.rminus(int) -> Thing', (self, x) => new Thing(x - self.id));
  method('method Thing.set(int) -> Thing', (self, x) => { self.id = x; return self; });
  method('method Var.id() -> int', (self) => self.id);
  method('method Var.expr() -> Thing', (self) => { trace.push(`expr ${self.id}`); return new Thing(self.id); });
  fn('fn var(int) -> Var', (id) => { trace.push(`var ${id}`); return new Thing(id); });
  fn('fn twice(int) -> int', (x) => x * 2n);
  fn('fn twice(float) -> float', (x) => x * 2);
  fn('fn thing(int) -> Thing', (x) => new Thing(x));
  fn('fn bound(int) -> int', (x) => { trace.push(`bound ${x}`); return x; });
  fn('fn half(float) -> float', (x) => x / 2);
  fn('fn yes() -> bool', () => { trace.push('yes'); return true; });
  fn('fn fail(string) -> void', (message) => { throw new Error(message); });
  fn('fn bad_int() -> int', () => 'x');
  fn('fn bytes(string) -> string', (hex) => {
    if (hex instanceof Uint8Array) hex = Buffer.from(hex).toString('ascii');
    if (typeof hex !== 'string' || !/^(?:[0-9a-f]{2})*$/.test(hex)) throw new Error('bytes: expected lowercase hexadecimal pairs');
    return Buffer.from(hex, 'hex');
  }, { rawStrings: true });

  const xsHandle = makeHandle(registry, 'IntList');
  xsHandle.__lmcodeExternal = true;
  xsHandle.data.values = [0n, 1n, 2n, 3n];
  const fallback = (type) => type === 'void' ? undefined : type === 'int' ? 0n : type === 'float' ? 0 : type === 'string' ? '' : type === 'bool' ? false : new Thing(0n);
  for (const [name, overloads] of Object.entries(stdSchema.functions)) for (const { params, returns } of overloads) {
    if (name.startsWith('lmcode_return_')) continue;
    const signature = `fn ${name}(${params.join(', ')}) -> ${returns}`;
    if (!registry.functionBySignature(signature)) fn(signature, () => fallback(returns), { internal: true });
  }
  for (const [type, definition] of Object.entries(stdSchema.types)) for (const [name, overloads] of Object.entries(definition.methods)) for (const { params, returns } of overloads) {
    const signature = `method ${type}.${name}(${params.join(', ')}) -> ${returns}`;
    if (!registry.methodBySignature(signature)) method(signature, () => fallback(returns), { internal: true });
  }

  registerTesting(registry, (bytes) => output.push(Buffer.from(bytes)));
  fn('fn printed() -> string', () => Buffer.concat(output).toString('latin1'), { internal: true });
  fn('fn test_temp_dir() -> string', () => temp, { internal: true });
  fn('fn test_long_path() -> string', () => {
    const dir = path.join(temp, ...Array.from({ length: 12 }, () => 'segment-0123456789abcdef'));
    mkdirSync(dir, { recursive: true });
    return path.join(dir, 'résumé-文件-😀.bin');
  });
  registry.setResultSink(currentSink);
  const stub = { registry, trace, root, variable, xs: xsHandle, output, temp, get resultSink() { return currentSink; }, setResultSink(sink) { currentSink = sink; registry.setResultSink(sink); }, cleanup() { if (temp) rmSync(temp, { recursive: true, force: true }); } };
  return stub;
}

export function contextFor(stub, includeXs = true) {
  const values = { t: stub, root: stub.root, v: stub.variable };
  if (includeXs) values.xs = stub.xs;
  return values;
}

export function addTrace(stub, line) { stub.trace.push(line); }
