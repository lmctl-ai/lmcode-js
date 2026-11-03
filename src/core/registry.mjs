import { DryNull, VmObject, VOID, wrapInt64 } from './values.mjs';
import { LmcodeError } from './errors.mjs';
import { makeHandle } from '../std/collections.mjs';

function parseSignature(text) {
  const fn = /^fn ([A-Za-z_][A-Za-z0-9_]*)\((.*)\) -> ([A-Za-z_][A-Za-z0-9_]*)$/.exec(text);
  if (fn) return { kind: 'fn', name: fn[1], params: fn[2] ? fn[2].split(', ') : [], returns: fn[3], canonical: text };
  const method = /^method ([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\((.*)\) -> ([A-Za-z_][A-Za-z0-9_]*)$/.exec(text);
  if (method) return { kind: 'method', type: method[1], name: method[2], params: method[3] ? method[3].split(', ') : [], returns: method[4], canonical: text };
  throw new TypeError(`invalid lmcode signature: ${text}`);
}

export class Registry {
  constructor() {
    this.functions = new Map();
    this.methods = new Map();
    this.contexts = new Map();
    this.enumTypes = new Set();
    this.runGeneration = 0;
    this.runActive = false;
    this.resultSink = null;
  }
  context(name, type) {
    if (this.contexts.has(name)) throw new TypeError(`registry: context '${name}' is declared twice`);
    this.contexts.set(name, type);
    return this;
  }
  enum(name) { this.enumTypes.add(name); return this; }
  fn(signature, callback, options = {}) {
    const parsed = parseSignature(signature);
    if (parsed.kind !== 'fn') throw new TypeError(`expected function signature: ${signature}`);
    if (typeof callback !== 'function') throw new TypeError(`registry: function '${parsed.name}' callback is empty`);
    if (this.functions.has(signature)) throw new TypeError(`registry: function '${parsed.name}${signature.slice(2 + parsed.name.length)}' is registered twice`);
    const dryCallback = options.dry ?? options.dryCallback ?? null;
    if (dryCallback !== null && typeof dryCallback !== 'function') throw new TypeError(`registry: dry function '${parsed.name}' callback is empty`);
    this.functions.set(signature, { ...parsed, callback, dryCallback, options: { ...options, enumTypes: this.enumTypes } });
    return this;
  }
  method(signature, callback, options = {}) {
    const parsed = parseSignature(signature);
    if (parsed.kind !== 'method') throw new TypeError(`expected method signature: ${signature}`);
    if (typeof callback !== 'function') throw new TypeError(`registry: method '${parsed.type}.${parsed.name}' callback is empty`);
    if (this.methods.has(signature)) throw new TypeError(`registry: method '${parsed.type}.${parsed.name}' is registered twice`);
    const dryCallback = options.dry ?? options.dryCallback ?? null;
    if (dryCallback !== null && typeof dryCallback !== 'function') throw new TypeError(`registry: dry method '${parsed.type}.${parsed.name}' callback is empty`);
    this.methods.set(signature, { ...parsed, callback, dryCallback, options: { ...options, enumTypes: this.enumTypes } });
    return this;
  }
  functionBySignature(signature) { return this.functions.get(signature); }
  methodBySignature(signature) {
    const exact = this.methods.get(signature);
    if (exact) return exact;
    try {
      const parsed = parseSignature(signature);
      if (parsed.kind !== 'method') return undefined;
      const normalized = parsed.returns === parsed.type
        ? signature.replace(`-> ${parsed.type}`, '-> self')
        : signature.replace('-> self', `-> ${parsed.type}`);
      return this.methods.get(normalized);
    } catch { return undefined; }
  }
  contextType(name) { return this.contexts.get(name); }
  declaredFor(signature) {
    const parsed = parseSignature(signature);
    const entries = parsed.kind === 'fn' ? this.functions.values() : this.methods.values();
    for (const entry of entries) {
      const same = parsed.kind === 'fn'
        ? entry.name === parsed.name
        : entry.type === parsed.type && entry.name === parsed.name;
      if (same) return `${entry.canonical}`;
    }
    return '';
  }
  signatures() { return [...this.functions.keys(), ...this.methods.keys()].sort(); }
  beginRun() { this.runGeneration++; this.runActive = true; return this.runGeneration; }
  endRun(generation) { if (generation === this.runGeneration) this.runActive = false; }
  setResultSink(sink) { this.resultSink = sink; return this; }

  invokeFunction(signature, args, { dry = false } = {}) {
    const entry = this.functions.get(signature);
    if (!entry) throw new Error(`host function '${signature}' is not bound`);
    if (dry && !entry.dryCallback) return this.dryDummy(entry.returns);
    if (dry && !entry.options.allowDryNull && args.some((v) => v instanceof DryNull)) throw new LmcodeError('RUN_HOST', 'dry null cannot be passed to a host callback');
    const converted = args.map((value, i) => toHost(value, entry.params[i], entry.options));
    const callback = dry ? entry.dryCallback : entry.callback;
    return toVm(callback(...converted), entry.returns, { ...entry.options, dryMode: dry });
  }
  invokeMethod(signature, self, args, { dry = false } = {}) {
    const entry = this.methodBySignature(signature);
    if (!entry) throw new Error(`host method '${signature}' is not bound`);
    if (dry && !entry.dryCallback) return this.dryDummy(entry.returns);
    if (dry && self instanceof DryNull) throw new LmcodeError('RUN_HOST', `method ${entry.type}.${entry.name} requires a concrete receiver after dry null`);
    if (dry && !entry.options.allowDryNull && args.some((v) => v instanceof DryNull)) throw new LmcodeError('RUN_HOST', 'dry null cannot be passed to a host callback');
    const converted = args.map((value, i) => toHost(value, entry.params[i], entry.options));
    const callback = dry ? entry.dryCallback : entry.callback;
    const resultType = entry.returns === 'self' ? entry.type : entry.returns;
    return toVm(callback(toHost(self, entry.type, entry.options), ...converted), resultType, { ...entry.options, dryMode: dry });
  }
  dryDummy(type) {
    if (type === 'void') return VOID;
    if (type === 'bool') return true;
    if (type === 'int' || type === 'integer' || type === 'int64') return 0n;
    if (type === 'float' || type === 'double' || type === 'number') return 0;
    if (type === 'string') return '';
    if (['StrList','IntList','FloatList','StrMap','IntMap','FloatMap','StrStack','IntStack','FloatStack','StrQueue','IntQueue','FloatQueue','StrPQ','IntPQ','FloatPQ'].includes(type)) {
      return new VmObject(type, makeHandle(this, type));
    }
    return new DryNull(type);
  }
}

export class Context {
  constructor(values = {}) { this.values = new Map(Object.entries(values)); this.dry = false; }
  set(name, value) { this.values.set(name, value); return this; }
  get(name) { return this.values.get(name); }
  setDry(value) { this.dry = Boolean(value); }
}

function toHost(value, type, options) {
  if (options.preserveObjects && value instanceof VmObject) return value;
  if (type === 'void') return undefined;
  if (value instanceof DryNull) {
    if (options.allowDryNull) return value;
    throw new LmcodeError('RUN_HOST', 'dry null cannot be passed to a host callback');
  }
  if (type === 'int' || type === 'integer' || type === 'int64') {
    if (typeof value !== 'bigint') throw new TypeError(`expected int, got ${typeof value}`);
    if (options.ints === 'number') {
      const max = BigInt(Number.MAX_SAFE_INTEGER);
      if (value < -max || value > max) throw new TypeError('int is outside the JavaScript safe integer range');
      return Number(value);
    }
    return value;
  }
  if (type === 'float' || type === 'double' || type === 'number') {
    if (typeof value !== 'number') throw new TypeError(`expected float, got ${typeof value}`);
    return value;
  }
  if (type === 'string') {
    if (typeof value !== 'string') throw new TypeError(`expected string, got ${typeof value}`);
    if (options.internal) return value;
    const raw = Buffer.from(value, 'latin1');
    return options.rawStrings ? raw : raw.toString('utf8');
  }
  if (type === 'bool') {
    if (typeof value !== 'boolean') throw new TypeError(`expected bool, got ${typeof value}`);
    return value;
  }
  if (options.enumTypes?.has(type)) {
    if (typeof value !== 'string') throw new TypeError(`expected ${type}, got ${typeof value}`);
    return value;
  }
  if (!(value instanceof VmObject) || value.type !== type) throw new TypeError(`expected ${type}, got ${value instanceof VmObject ? value.type : typeof value}`);
  return value.value;
}

function toVm(value, type, options) {
  if (type === 'void') {
    if (value !== undefined) throw new TypeError(`expected void, got ${typeof value}`);
    return VOID;
  }
  if (value instanceof DryNull) {
    if (options.dryMode && value.type === type) return value;
    throw new TypeError(`expected ${type}, got dry null`);
  }
  if (type === 'int' || type === 'integer' || type === 'int64') {
    if (typeof value === 'number' && options.ints === 'number' && Number.isSafeInteger(value)) value = BigInt(value);
    if (typeof value !== 'bigint') throw new TypeError(`expected int, got ${typeof value}`);
    return wrapInt64(value);
  }
  if (type === 'float' || type === 'double' || type === 'number') {
    if (typeof value !== 'number') throw new TypeError(`expected float, got ${typeof value}`);
    return value;
  }
  if (type === 'string') {
    if (options.internal && typeof value === 'string') return value;
    if (typeof value === 'string') return Buffer.from(value, 'utf8').toString('latin1');
    if (value instanceof Uint8Array && options.rawStrings) return Buffer.from(value).toString('latin1');
    throw new TypeError(`expected string, got ${typeof value}`);
  }
  if (type === 'bool') {
    if (typeof value !== 'boolean') throw new TypeError(`expected bool, got ${typeof value}`);
    return value;
  }
  if (options.enumTypes?.has(type)) {
    if (typeof value !== 'string') throw new TypeError(`expected ${type}, got ${typeof value}`);
    return value;
  }
  if (value instanceof VmObject) {
    if (options.unsafeReturn) return value;
    if (value.type !== type) throw new TypeError(`expected ${type}, got ${value.type}`);
    return value;
  }
  return new VmObject(type, value);
}


export function parseCanonicalSignature(text) { return parseSignature(text); }
export function Dry(callback) {
  if (typeof callback !== 'function') throw new TypeError('dry callback must be a function');
  return { dry: callback };
}
