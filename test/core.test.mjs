import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Program, Registry } from '../src/core/index.mjs';

function u8(n) { return Buffer.from([n]); }
function u16(n) { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; }
function i64(n) { const b = Buffer.alloc(8); b.writeBigInt64BE(n); return b; }
function region(code, maxStack, lines = []) {
  return Buffer.concat([u16(0), u16(maxStack), u32(code.length), code, u32(lines.length), ...lines.flatMap(([pc, line, col]) => [u32(pc), u32(line), u16(col)])]);
}
function program(schema, entryCode) {
  const pool = ['sum', 'test', 'interface Score() -> int'];
  const constants = Buffer.concat([u32(pool.length), ...pool.map((s) => { const b = Buffer.from(s); return Buffer.concat([u8(1), u32(b.length), b]); })]);
  const body = region(Buffer.from([0x11]), 0);
  const entry = Buffer.concat([u32(0), u32(1), u32(2), u16(0), region(entryCode, 2, [[0, 1, 1]])]);
  return Buffer.concat([Buffer.from('DSLB'), u16(6), createHash('sha256').update(schema).digest(), constants, u16(0), u16(0), body, u16(1), entry]);
}

test('loader and VM execute exact BigInt arithmetic in a rule entry', () => {
  const schema = Buffer.from('{}');
  const code = Buffer.concat([u8(0x01), i64(7n), u8(0x01), i64(5n), u8(0x13), u8(0x11)]);
  const loaded = Program.load(program(schema, code), schema, new Registry());
  assert.equal(loaded.call(0), 12n);
  assert.equal(typeof loaded.call('sum'), 'bigint');
});

test('int64 arithmetic wraps at both signed boundaries', () => {
  const schema = Buffer.from('{}');
  const maxPlusOne = Buffer.concat([u8(0x01), i64((1n << 63n) - 1n), u8(0x01), i64(1n), u8(0x13), u8(0x11)]);
  const minMinusOne = Buffer.concat([u8(0x01), i64(-(1n << 63n)), u8(0x01), i64(1n), u8(0x14), u8(0x11)]);
  assert.equal(Program.load(program(schema, maxPlusOne), schema, new Registry()).call(0), -(1n << 63n));
  assert.equal(Program.load(program(schema, minMinusOne), schema, new Registry()).call(0), (1n << 63n) - 1n);
});
