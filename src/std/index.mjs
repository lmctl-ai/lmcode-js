import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Registry } from '../core/registry.mjs';
import { LmcodeError } from '../core/errors.mjs';
import { ResultSink } from '../host/result-sink.mjs';
import { formatG15 } from '../core/values.mjs';
import { registerString } from './string.mjs';
import { registerMath } from './math.mjs';
import { registerCollections } from './collections.mjs';
import { registerFile } from './file.mjs';
import { registerJson } from './json.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const schema = JSON.parse(readFileSync(path.join(root, 'std/lmcode-std.schema.json'), 'utf8'));
export const signatureSet = new Set();

export function registerStandard(registry) {
  if (registry.stdRegistered) return registry;
  registerString(registry);
  registerMath(registry);
  registerCollections(registry, schema);
  registerFile(registry);
  registerJson(registry);
  registerReturn(registry);
  registry.stdRegistered = true;
  const expected = Object.entries(schema.functions).reduce((n, [, overloads]) => n + overloads.length, 0)
    + Object.values(schema.types).reduce((n, type) => n + Object.values(type.methods).reduce((m, overloads) => m + overloads.length, 0), 0);
  const actual = registry.signatures().length;
  if (actual !== expected) throw new Error(`lmcode std signature count ${actual}, expected ${expected}`);
  for (const signature of registry.signatures()) signatureSet.add(signature);
  return registry;
}

function registerReturn(reg) {
  const types = ['bool', 'float', 'FloatList', 'FloatMap', 'int', 'IntList', 'IntMap', 'Json', 'StrList', 'StrMap', 'string'];
  for (const type of types) {
    const set = (value) => {
      if (!reg.resultSink) throw new LmcodeError('RUN_HOST', 'lmcode return: no result sink');
      reg.resultSink.set(value);
    };
    const put = (key, value) => {
      if (!reg.resultSink) throw new LmcodeError('RUN_HOST', 'lmcode return: no result sink');
      reg.resultSink.put(key, value);
    };
    reg.fn(`fn lmcode_return_set(${type}) -> void`, set, { internal: true, preserveObjects: true, allowDryNull: true, dry: set });
    reg.fn(`fn lmcode_return_put(string, ${type}) -> void`, put, { internal: true, preserveObjects: true, allowDryNull: true, dry: put });
  }
  const setNull = () => {
    if (!reg.resultSink) throw new LmcodeError('RUN_HOST', 'lmcode return: no result sink');
    reg.resultSink.setNull();
  };
  const putNull = (key) => {
    if (!reg.resultSink) throw new LmcodeError('RUN_HOST', 'lmcode return: no result sink');
    reg.resultSink.putNull(key);
  };
  reg.fn('fn lmcode_return_null() -> void', setNull, { internal: true, dry: setNull });
  reg.fn('fn lmcode_return_put_null(string) -> void', putNull, { internal: true, dry: putNull });
}

export function createRegistry() { return registerStandard(new Registry()); }

export function registerTesting(registry, write = (bytes) => process.stdout.write(bytes)) {
  registry.fn('fn print(string) -> void', (value) => { write(Buffer.concat([Buffer.from(value, 'latin1'), Buffer.from('\n') ])); }, { internal: true });
  const assertClose = (actual, expected, tolerance) => {
    if (!(Math.abs(actual - expected) <= tolerance)) {
      throw new LmcodeError('RUN_HOST', `assert_close failed: ${formatG15(actual)} vs ${formatG15(expected)} (tol ${formatG15(tolerance)})`);
    }
  };
  registry.fn('fn assert_close(float, float, float) -> void', assertClose, { internal: true, dry: assertClose });
}

export { registerFile } from './file.mjs';
export { registerCollections } from './collections.mjs';
