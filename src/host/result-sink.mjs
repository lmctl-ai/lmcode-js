import { LmcodeError } from '../core/errors.mjs';
import { DryNull, VmObject, VOID, formatFloat } from '../core/values.mjs';
import { ResultContract } from './result-contract.mjs';

const safe = 9007199254740991n;
const nullValue = Symbol('JSON null');

export class JsonObject {
  constructor() { this.members = new Map(); }
  set(key, value) { this.members.set(key, value); }
  get(key) { return this.members.get(key); }
  has(key) { return this.members.has(key); }
  entries() { return this.members.entries(); }
}
export class JsonArray extends Array {}

function quote(text) {
  return JSON.stringify(text).replace(/\u2028|\u2029/gi, (c) => c.toLowerCase());
}
function pointer(parent, key) { return `${parent}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`; }
function invalid(path, reason) { return new LmcodeError('RUN_HOST', `lmcode return: invalid JSON value at ${path}: ${reason}`); }
function decodeUtf8(value, path) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(value, 'latin1')); }
  catch { throw invalid(path, 'utf8'); }
}
function encode(value, path = '') {
  if (value === VOID || value === null || value === nullValue || value instanceof DryNull) return nullValue;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'bigint') {
    if (value > safe || value < -safe) throw invalid(path, 'unsafe_integer');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalid(path, 'nonfinite');
    if (Number.isInteger(value) && Math.abs(value) > Number(safe)) throw invalid(path, 'unsafe_integer');
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === 'string') {
    return decodeUtf8(value, path);
  }
  if (value instanceof VmObject) {
    const handle = value.value;
    if (value.type === 'Json' && handle?.__lmcodeJson) return fromJsonNode(handle.data, path);
    if (['StrList', 'IntList', 'FloatList'].includes(value.type) && handle?.__lmcodeCollection) {
      const out = new JsonArray();
      for (let i = 0; i < handle.data.values.length; i++) out.push(encode(handle.data.values[i], pointer(path, i)));
      return out;
    }
    if (['StrMap', 'IntMap', 'FloatMap'].includes(value.type) && handle?.__lmcodeCollection) {
      const out = new JsonObject();
      for (const entry of handle.data.entries) {
        const key = decodeUtf8(entry.key, path);
        out.set(key, encode(entry.value, pointer(path, key)));
      }
      return out;
    }
    throw invalid(path, 'handle');
  }
  if (Array.isArray(value)) {
    const out = new JsonArray();
    for (let i = 0; i < value.length; i++) out.push(encode(value[i], pointer(path, i)));
    return out;
  }
  if (value instanceof Map || value instanceof JsonObject) {
    const out = new JsonObject();
    const entries = value instanceof Map ? value.entries() : value.entries();
    for (const [key, child] of entries) {
      const normalized = typeof key === 'string' ? decodeUtf8(key, path) : String(key);
      out.set(normalized, encode(child, pointer(path, normalized)));
    }
    return out;
  }
  throw invalid(path, 'handle');
}
// Shared with invocation metadata before numeric token spellings are discarded.
export function jsonNumber(node, path) {
  if (node.kind === 'int' && (node.value > safe || node.value < -safe)) throw invalid(path, 'unsafe_integer');
  if (node.kind === 'float' && Number.isInteger(node.value) && Math.abs(node.value) > Number(safe)) throw invalid(path, 'unsafe_integer');
  if (node.kind === 'float' && node.value === 0 && /[1-9]/.test(node.raw.replace(/[eE].*/, '').replace(/[^0-9]/g, ''))) throw invalid(path, 'underflow');
  return Object.is(node.value, -0) ? 0 : node.value;
}
function fromJsonNode(node, path) {
  if (node.kind === 'null') return nullValue;
  if (node.kind === 'bool') return node.value;
  if (node.kind === 'int' || node.kind === 'float') return jsonNumber(node, path);
  if (node.kind === 'string') return node.value;
  if (node.kind === 'array') {
    const out = new JsonArray();
    for (let i = 0; i < node.items.length; i++) out.push(fromJsonNode(node.items[i], pointer(path, i)));
    return out;
  }
  if (node.kind === 'object') {
    const out = new JsonObject();
    for (const member of node.members) out.set(member.key, fromJsonNode(member.value, pointer(path, member.key)));
    return out;
  }
  throw invalid(path, 'handle');
}
export function stringifyResult(value) {
  if (value === nullValue) return 'null';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return formatFloat(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return quote(value);
  if (Array.isArray(value)) return `[${value.map(stringifyResult).join(',')}]`;
  if (value instanceof JsonObject) return `{${[...value.entries()].map(([key, v]) => `${quote(key)}:${stringifyResult(v)}`).join(',')}}`;
  return 'null';
}

export class ResultSink {
  constructor(contract = new ResultContract()) { this.root = null; this.sealed = false; this.contract = contract; }
  writable() { if (this.sealed) throw new LmcodeError('RUN_HOST', 'lmcode return: result sink is sealed'); }
  reset() { this.writable(); this.root = null; }
  set(value) {
    this.writable(); this.contract.validateSource(value);
    const owned = encode(value);
    this.contract.validate(owned === nullValue ? null : owned);
    this.root = owned;
  }
  setNull() { this.set(nullValue); }
  put(key, value) {
    this.writable();
    if (this.root !== null && this.root !== nullValue && !(this.root instanceof JsonObject)) {
      throw new LmcodeError('RUN_HOST', 'lmcode return: field assignment requires object or null');
    }
    if (typeof key !== 'string') throw invalid('', 'handle');
    key = decodeUtf8(key, '');
    this.contract.validateFieldSource(key, value);
    const encoded = encode(value, pointer('', key));
    const next = new JsonObject();
    if (this.root instanceof JsonObject) for (const [k, v] of this.root.entries()) next.set(k, v);
    next.set(key, encoded);
    this.contract.validate(next);
    this.root = next;
  }
  putNull(key) { this.put(key, nullValue); }
  json() { return stringifyResult(this.root ?? nullValue); }
  complete() {
    this.writable();
    const value = this.root ?? nullValue;
    this.contract.validate(value === nullValue ? null : value);
    this.sealed = true;
    return value;
  }
}

export function frameResult(value, ok = true, phase = null, error = null) {
  const payload = ok ? { ok: true, result: value } : { ok: false, phase, code: error.code, message: error.message };
  return `LMCODE_RETURN_BEGIN\n${JSON.stringify(payload)}\nLMCODE_RETURN_END\n`;
}
