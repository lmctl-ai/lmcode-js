import { createHash } from 'node:crypto';
import { LmcodeError } from './errors.mjs';
import { Reader, bytesToByteString } from './binary.mjs';
import { verifyRegion } from './verifier.mjs';
import { Registry, parseCanonicalSignature } from './registry.mjs';
import { execute } from './vm.mjs';

const VERSION = 6;
const loadError = (message, code = 'LOAD_BAD_BYTECODE') => new LmcodeError(code, message);

function interfaceSignature(text) {
  const m = /^interface ([A-Za-z_][A-Za-z0-9_]*)\((.*)\) -> ([A-Za-z_][A-Za-z0-9_]*)$/.exec(text);
  if (!m) return null;
  const params = m[2] ? m[2].split(', ') : [];
  if (params.some((p) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(p) || p === 'void')) return null;
  return { params, returns: m[3] };
}

function readRegion(reader, constants) {
  const count = reader.u16();
  const locals = [];
  for (let i = 0; i < count; i++) {
    const typeIndex = reader.u32();
    if (typeIndex >= constants.length) throw loadError(`local type: constant index ${typeIndex} out of range (${constants.length} constants)`);
    const hidden = reader.u8();
    if (hidden > 1) throw loadError(`local ${i} hidden flag must be 0 or 1`);
    locals.push({ type: constants[typeIndex], hidden: hidden === 1 });
  }
  const maxStack = reader.u16();
  const codeLength = reader.u32();
  const code = reader.bytesOf(codeLength);
  const lineCount = reader.u32();
  const lines = [];
  for (let i = 0; i < lineCount; i++) {
    const line = { pc: reader.u32(), line: reader.u32(), column: reader.u16() };
    if (i > 0 && line.pc < lines[i - 1].pc) throw loadError(`line table is not sorted by pc at entry ${i}`);
    lines.push(line);
  }
  return { locals, maxStack, code, lines, loopPairs: new Map(), instructions: [] };
}

function entryError(name, error) {
  const separator = /^(declares |parameter )/.test(error.message) ? ' ' : ': ';
  return loadError(`entry '${name}'${separator}${error.message}`);
}

export class Program {
  constructor(data) { Object.assign(this, data); }

  static load(bytecodeInput, schemaInput, registry = new Registry()) {
    const bytecode = bytecodeInput instanceof Uint8Array ? bytecodeInput : new Uint8Array(bytecodeInput);
    const schema = schemaInput instanceof Uint8Array ? schemaInput : new Uint8Array(schemaInput);
    if (bytecode.length < 4 || Buffer.from(bytecode.subarray(0, 4)).toString('ascii') !== 'DSLB') {
      throw loadError("not a DSL bytecode file: bad magic (expected 'DSLB')");
    }
    const r = new Reader(bytecode);
    r.bytesOf(4);
    const version = r.u16();
    if (version !== VERSION) throw loadError(`unsupported bytecode version ${version} (this runtime reads version ${VERSION})`);
    const schemaHash = r.bytesOf(32);
    const expectedHash = createHash('sha256').update(schema).digest();
    if (!Buffer.from(schemaHash).equals(expectedHash)) {
      throw loadError(`schema mismatch: bytecode was compiled against schema sha256 ${Buffer.from(schemaHash).toString('hex')}, the given schema has sha256 ${expectedHash.toString('hex')}`, 'LOAD_SCHEMA_MISMATCH');
    }

    const constants = [];
    const constantCount = r.u32();
    for (let i = 0; i < constantCount; i++) {
      const tag = r.u8();
      if (tag !== 1) throw loadError(`constant ${i} has unknown tag ${tag} (1 = string)`);
      const length = r.u32();
      constants.push(bytesToByteString(r.bytesOf(length)));
    }
    const constant = (index, label) => {
      if (index >= constants.length) throw loadError(`${label}: constant index ${index} out of range (${constants.length} constants)`);
      return constants[index];
    };

    const imports = [];
    const importCount = r.u16();
    for (let i = 0; i < importCount; i++) {
      const signature = constant(r.u32(), 'import');
      let parsed;
      try { parsed = parseCanonicalSignature(signature); }
      catch {
        throw loadError(`import '${signature}' is not a function or method signature`, 'LOAD_UNBOUND');
      }
      const callback = parsed.kind === 'fn' ? registry.functionBySignature(signature) : registry.methodBySignature(signature);
      if (!callback) {
        const have = registry.declaredFor(signature);
        throw loadError(`import '${signature}' is not provided by the host${have ? ` (the host declares ${have})` : ''}`, 'LOAD_UNBOUND');
      }
      imports.push(parsed);
    }

    const contexts = [];
    const contextCount = r.u16();
    for (let i = 0; i < contextCount; i++) {
      const name = constant(r.u32(), 'context name');
      const type = constant(r.u32(), 'context type');
      const declared = registry.contextType(name);
      if (declared === undefined) throw loadError(`context variable '${name}' is not declared by the host`, 'LOAD_UNBOUND');
      if (declared !== type) throw loadError(`context variable '${name}' is declared as ${type} by the bytecode, the host provides ${declared}`, 'LOAD_UNBOUND');
      contexts.push(name);
    }

    const body = readRegion(r, constants);
    const verificationInfo = { constants, imports, contexts };
    const entries = [];
    const entryCount = r.u16();
    for (let i = 0; i < entryCount; i++) {
      const name = constant(r.u32(), 'entry name');
      if (entries.some((entry) => entry.name === name)) throw loadError(`duplicate entry name '${name}'`);
      try {
        const annotation = constant(r.u32(), 'entry annotation');
        const iface = constant(r.u32(), 'entry interface');
        const parsedIface = interfaceSignature(iface);
        if (!parsedIface) throw loadError(`interface '${iface}' is not an interface signature`);
        const nparams = r.u16();
        const region = readRegion(r, constants);
        if (nparams !== parsedIface.params.length) throw loadError(`declares ${nparams} parameter(s); ${iface} has ${parsedIface.params.length}`);
        if (nparams > region.locals.length) throw loadError(`nparams ${nparams} exceeds nlocals ${region.locals.length}`);
        for (let j = 0; j < nparams; j++) {
          const local = region.locals[j];
          if (local.hidden) throw loadError(`parameter ${j + 1} is hidden`);
          if (local.type !== parsedIface.params[j]) throw loadError(`parameter ${j + 1} has type ${local.type}; the interface expects ${parsedIface.params[j]}`);
        }
        const entry = { name, annotation, iface, params: parsedIface.params, returns: parsedIface.returns, region };
        verifyRegion(verificationInfo, region, entry.returns);
        entries.push(entry);
      } catch (error) {
        if (error instanceof LmcodeError) throw entryError(name, error);
        throw error;
      }
    }
    if (!r.done) throw loadError(`bytecode has ${bytecode.length - r.pos} trailing byte(s) after the entries`);
    verifyRegion(verificationInfo, body);
    return new Program({ constants, imports, contexts, entries, ...body, registry, schema });
  }

  get constantCount() { return this.constants.length; }
  get importCount() { return this.imports.length; }
  get localCount() { return this.locals.length; }
  get codeSize() { return this.code.length; }
  lineOf(pc) {
    let found = null;
    for (const line of this.lines) { if (line.pc > pc) break; found = line; }
    return found;
  }
  run(context = {}) {
    const generation = this.registry.beginRun();
    try { return execute(this, this, context, [], false); }
    finally { this.registry.endRun(generation); }
  }
  call(entry, context = {}, args = []) {
    const item = typeof entry === 'number' ? this.entries[entry] : this.entries.find((e) => e.name === entry);
    if (!item) throw new LmcodeError('RUN_HOST', typeof entry === 'number' ? `call entry index ${entry} out of range (${this.entries.length} entries)` : `call entry '${entry}' not found`);
    if (args.length !== item.params.length) throw new LmcodeError('RUN_HOST', `call entry '${item.name}' expects ${item.params.length} argument(s); found ${args.length}`);
    const generation = this.registry.beginRun();
    try { return execute(this, item.region, context, args, item.returns !== 'void'); }
    finally { this.registry.endRun(generation); }
  }
}
