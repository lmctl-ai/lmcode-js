import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Program, LmcodeError, Registry, wrapInt64 } from '../src/core/index.mjs';
import { verifyRegion } from '../src/core/verifier.mjs';

const vectors = new URL('../conformance/vectors/', import.meta.url);
const schema = await readFile(new URL('schema.json', vectors));
const schemaObject = JSON.parse(schema);
const stdSchema = JSON.parse(await readFile(new URL('../std/lmcode-std.schema.json', import.meta.url)));
const registry = new Registry();
for (const [name, type] of Object.entries(schemaObject.context)) registry.context(name, type);
for (const definition of [schemaObject, stdSchema]) {
  for (const [name, overloads] of Object.entries(definition.functions)) {
    for (const { params, returns } of overloads) {
      const signature = `fn ${name}(${params.join(', ')}) -> ${returns}`;
      if (!registry.functionBySignature(signature)) registry.fn(signature, () => undefined);
    }
  }
  for (const [type, typeDefinition] of Object.entries(definition.types)) {
    for (const [name, overloads] of Object.entries(typeDefinition.methods)) {
      for (const { params, returns } of overloads) {
        const signature = `method ${type}.${name}(${params.join(', ')}) -> ${returns}`;
        if (!registry.methodBySignature(signature)) registry.method(signature, () => undefined);
      }
    }
  }
}

async function expectLoadFailure(name, text) {
  const bytes = await readFile(new URL(`${name}.dslb`, vectors));
  assert.throws(() => Program.load(bytes, schema, registry), (error) => {
    assert.ok(error instanceof LmcodeError);
    assert.equal(error.code, 'LOAD_BAD_BYTECODE');
    assert.match(error.message, text);
    return true;
  });
}

test('hidden compiler-owned locals cannot be written by hostile bytecode', async () => {
  await expectLoadFailure('load-entry-hidden-store', /writes compiler-owned loop local/);
});

test('duplicate rule-entry names are rejected by verification', async () => {
  await expectLoadFailure('load-entry-dup-name', /duplicate entry name/);
});

test('unpaired backward jumps are rejected before execution', () => {
  const code = Uint8Array.of(0x0c, 0xff, 0xff, 0xff, 0xfb, 0x11);
  assert.throws(() => verifyRegion({ constants: [], imports: [], contexts: [] }, { code, locals: [], lines: [] }), (error) => {
    assert.equal(error.code, 'LOAD_BAD_BYTECODE');
    assert.match(error.message, /goes backwards/);
    return true;
  });
});

test('reachable operand stack underflow is rejected by the verifier', () => {
  const code = Uint8Array.of(0x10, 0x11);
  assert.throws(() => verifyRegion({ constants: [], imports: [], contexts: [] }, { code, locals: [], lines: [] }, 'int'), (error) => {
    assert.equal(error.code, 'LOAD_BAD_BYTECODE');
    assert.match(error.message, /operand stack underflow at offset 0/);
    return true;
  });
});

test('int64 arithmetic has exact wrapping without Number conversion', () => {
  assert.equal(wrapInt64((1n << 63n) - 1n + 1n), -(1n << 63n));
  assert.equal(wrapInt64(-(1n << 63n) - 1n), (1n << 63n) - 1n);
});

test('unequal branch stack depths are rejected at the join', () => {
  const code = Uint8Array.of(0x03, 1, 0x0d, 0, 0, 0, 9, 0x01, 0, 0, 0, 0, 0, 0, 0, 1, 0x11);
  assert.throws(() => verifyRegion({ constants: [], imports: [], contexts: [] }, { code, locals: [], lines: [] }, 'void'), (error) => {
    assert.equal(error.code, 'LOAD_BAD_BYTECODE');
    assert.match(error.message, /inconsistent operand stack depth at control-flow join 16: 0 versus 1/);
    return true;
  });
});
