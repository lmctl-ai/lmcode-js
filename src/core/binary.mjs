import { LmcodeError } from './errors.mjs';

export class Reader {
  constructor(bytes, base = 0) {
    this.bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.pos = base;
  }
  get done() { return this.pos === this.bytes.length; }
  need(size) {
    if (!Number.isSafeInteger(size) || size < 0 || this.pos + size > this.bytes.length) {
      throw new LmcodeError('LOAD_BAD_BYTECODE', `bytecode is truncated: wanted ${size} byte(s) at offset ${this.pos}, file has ${this.bytes.length}`);
    }
  }
  u8() { this.need(1); return this.view.getUint8(this.pos++); }
  u16() { this.need(2); const v = this.view.getUint16(this.pos, false); this.pos += 2; return v; }
  u32() { this.need(4); const v = this.view.getUint32(this.pos, false); this.pos += 4; return v; }
  i32() { this.need(4); const v = this.view.getInt32(this.pos, false); this.pos += 4; return v; }
  i64() { this.need(8); const v = this.view.getBigInt64(this.pos, false); this.pos += 8; return v; }
  f64() { this.need(8); const v = this.view.getFloat64(this.pos, false); this.pos += 8; return v; }
  bytesOf(size) { this.need(size); const out = this.bytes.subarray(this.pos, this.pos + size); this.pos += size; return out; }
}

export function bytesToByteString(bytes) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
}

export function byteStringToBytes(value) {
  const out = Buffer.allocUnsafe(value.length);
  for (let i = 0; i < value.length; i++) out[i] = value.charCodeAt(i) & 0xff;
  return out;
}
