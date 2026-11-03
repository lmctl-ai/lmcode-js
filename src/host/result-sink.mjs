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
  let result;
  const active = new Set();
  const work = [{ value, path, assign: (child) => { result = child; } }];
  while (work.length) {
    const frame = work.pop();
    if (frame.iterator) {
      const next = frame.iterator.next();
      if (next.done) { active.delete(frame.source); continue; }
      const [key, child] = next.value;
      const normalized = frame.array ? key : typeof key === 'string' ? decodeUtf8(key, frame.path) : String(key);
      work.push(frame);
      work.push({ value: child, path: pointer(frame.path, normalized), assign: (owned) => {
        if (frame.array) frame.out.push(owned); else frame.out.set(normalized, owned);
      } });
      continue;
    }
    const { value: item, path: at, assign } = frame;
    if (item === VOID || item === null || item === nullValue || item instanceof DryNull) { assign(nullValue); continue; }
    if (typeof item === 'boolean') { assign(item); continue; }
    if (typeof item === 'bigint') {
      if (item > safe || item < -safe) throw invalid(at, 'unsafe_integer');
      assign(item); continue;
    }
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw invalid(at, 'nonfinite');
      if (Number.isInteger(item) && Math.abs(item) > Number(safe)) throw invalid(at, 'unsafe_integer');
      assign(Object.is(item, -0) ? 0 : item); continue;
    }
    if (typeof item === 'string') { assign(decodeUtf8(item, at)); continue; }
    let values; let array = false;
    if (item instanceof VmObject) {
      const handle = item.value;
      if (item.type === 'Json' && handle?.__lmcodeJson) { assign(fromJsonNode(handle.data, at)); continue; }
      if (['StrList', 'IntList', 'FloatList'].includes(item.type) && handle?.__lmcodeCollection) {
        values = handle.data.values.entries(); array = true;
      } else if (['StrMap', 'IntMap', 'FloatMap'].includes(item.type) && handle?.__lmcodeCollection) {
        values = (function* () { for (const entry of handle.data.entries) yield [entry.key, entry.value]; })();
      } else throw invalid(at, 'handle');
    } else if (Array.isArray(item)) { values = item.entries(); array = true; }
    else if (item instanceof Map || item instanceof JsonObject) values = item.entries();
    else throw invalid(at, 'handle');
    if (active.has(item)) throw invalid(at, 'cycle');
    active.add(item);
    const out = array ? new JsonArray() : new JsonObject();
    assign(out);
    work.push({ iterator: values, source: item, array, out, path: at });
  }
  return result;
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
  const output = [];
  const active = new Set();
  const work = [{ value }];
  while (work.length) {
    const frame = work.pop();
    if (frame.iterator) {
      const next = frame.iterator.next();
      if (next.done) { output.push(frame.array ? ']' : '}'); active.delete(frame.source); continue; }
      if (!frame.first) output.push(',');
      frame.first = false;
      const [key, child] = next.value;
      if (!frame.array) output.push(quote(key), ':');
      work.push(frame, { value: child });
      continue;
    }
    const item = frame.value;
    if (item === nullValue) output.push('null');
    else if (typeof item === 'bigint') output.push(item.toString());
    else if (typeof item === 'number') output.push(formatFloat(item));
    else if (typeof item === 'boolean') output.push(item ? 'true' : 'false');
    else if (typeof item === 'string') output.push(quote(item));
    else if (Array.isArray(item) || item instanceof JsonObject) {
      if (active.has(item)) throw invalid('', 'cycle');
      active.add(item);
      const array = Array.isArray(item);
      output.push(array ? '[' : '{');
      work.push({ iterator: item.entries(), source: item, array, first: true });
    } else output.push('null');
  }
  return output.join('');
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
