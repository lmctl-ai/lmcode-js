import { readFileSync } from 'node:fs';
import path from 'node:path';
import { LmcodeError } from '../core/errors.mjs';
import { parseJsonBytes } from '../std/json.mjs';
import { ResultContract } from './result-contract.mjs';
import { ResultSink, stringifyResult, jsonNumber } from './result-sink.mjs';

const cliError = (message) => new LmcodeError('CLI_USAGE', `lmcode invocation: ${message}`);
function native(node, pointer = '') {
  if (!node || node.kind === 'null') return null;
  if (node.kind === 'bool' || node.kind === 'string') return node.value;
  if (node.kind === 'int' || node.kind === 'float') return jsonNumber(node, pointer);
  if (node.kind === 'array') return node.items.map((item, index) => native(item, `${pointer}/${index}`));
  if (node.kind === 'object') return Object.fromEntries(node.members.map((m) => [m.key, native(m.value, `${pointer}/${m.key.replaceAll('~', '~0').replaceAll('/', '~1')}`)]));
  return undefined;
}
function parseManifest(bytes) {
  try { return parseJsonBytes(Buffer.from(bytes).toString('latin1')); }
  catch (error) {
    let message = error.message;
    if (message === 'json_parse: BOM is not allowed at byte 0') message = 'JSON BOM is not allowed';
    if (message.startsWith('json_parse: trailing input at byte ')) message = 'trailing JSON input';
    throw cliError(message);
  }
}
function onlyKeys(object, allowed) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) throw cliError('object required');
  for (const key of Object.keys(object)) if (!allowed.includes(key)) throw cliError(`unknown key ${key}`);
}
function integer(value) {
  if (typeof value === 'bigint' && value >= -(1n << 63n) && value <= (1n << 63n) - 1n) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  return null;
}
function manifestMetadata(metadata, files) {
  onlyKeys(metadata, ['version', 'mode', 'dry', 'parts']);
  if (integer(metadata.version) !== 1n) throw cliError('unsupported version');
  if (metadata.mode !== 'single' && metadata.mode !== 'builder') throw cliError('invalid mode');
  if (typeof metadata.dry !== 'boolean') throw cliError('dry must be boolean');
  if (!Array.isArray(metadata.parts) || metadata.parts.length === 0 || metadata.mode === 'single' && metadata.parts.length !== 1) throw cliError('invalid parts');
  const indices = new Map();
  for (let i = 0; i < metadata.parts.length; i++) {
    const part = metadata.parts[i]; onlyKeys(part, ['index', 'file']);
    if (integer(part.index) !== BigInt(i)) throw cliError('noncontiguous index');
    if (typeof part.file !== 'string' || part.file.includes('\0') || !path.isAbsolute(part.file)) throw cliError('file must be absolute');
    if (indices.has(part.file)) throw cliError('duplicate file');
    indices.set(part.file, i);
  }
  if (files.length !== indices.size) throw cliError('registration count mismatch');
  const registrations = []; const seen = new Set();
  for (const file of files) {
    if (!indices.has(file)) throw cliError('extra registration');
    const index = indices.get(file);
    if (seen.has(index)) throw cliError('duplicate registration');
    seen.add(index); registrations.push({ file, index });
  }
  return { mode: metadata.mode, dry: metadata.dry, registrations };
}
function exitFor(phase) {
  if (phase === 'cli') return 2;
  if (phase === 'load' || phase === 'run') return 3;
  if (phase === 'app') return 4;
  throw new LmcodeError('RUN_HOST', 'lmcode invocation: invalid failure phase');
}

export class InvocationResults {
  constructor({ builder, dry, registrations }) {
    this.builder = builder; this.dry = dry; this.registrations = registrations;
    this.slots = Array.from({ length: registrations.length }, () => ({ sink: null, result: undefined }));
    this.failure = null; this.writing = false;
  }
  static fromCommand(files, env = process.env) {
    if (Object.hasOwn(env, 'LMCODE_INVOCATION_FILE')) {
      const manifest = env.LMCODE_INVOCATION_FILE;
      if (!manifest || manifest.includes('\0') || !path.isAbsolute(manifest)) throw cliError('manifest path must be absolute');
      let raw;
      try { raw = readFileSync(manifest); } catch { throw cliError('cannot read manifest'); }
      return InvocationResults.fromMetadata(raw, files);
    }
    if (!files.length) throw cliError('empty parts');
    const registrations = files.map((file, index) => {
      if (typeof file !== 'string' || !file || file.includes('\0')) throw cliError('invalid command file');
      return { file, index };
    });
    return new InvocationResults({ builder: files.length > 1, dry: false, registrations });
  }
  static fromMetadata(raw, files) {
    let dry = false;
    try {
      const root = parseManifest(raw);
      if (root.kind !== 'object') throw cliError('object required');
      const member = (name) => root.members.find((m) => m.key === name)?.value;
      // Match the collectors: validate version first, then establish the dry
      // marker before validating every remaining value and registration.
      if (integer(native(member('version'), '/version')) !== 1n) throw cliError('unsupported version');
      const mode = member('mode');
      if (mode?.kind !== 'string' || !['single', 'builder'].includes(mode.value)) throw cliError('invalid mode');
      const flag = member('dry');
      if (flag?.kind !== 'bool') throw cliError('dry must be boolean');
      dry = flag.value;
      const data = manifestMetadata(native(root), files);
      return new InvocationResults({ builder: data.mode === 'builder', dry: data.dry, registrations: data.registrations });
    } catch (error) {
      const failure = error instanceof LmcodeError && error.code === 'CLI_USAGE' ? error : cliError(error.message);
      if (dry) failure.invocationDry = true;
      throw failure;
    }
  }
  dryMode() { return this.dry; }
  registrationsCopy() { return this.registrations.map((r) => ({ ...r })); }
  select(index, registry, contract = new ResultContract()) {
    if (this.writing) throw new LmcodeError('RUN_HOST', 'lmcode invocation: finalized');
    if (!Number.isInteger(index) || index < 0 || index >= this.slots.length) throw new LmcodeError('RUN_HOST', 'lmcode invocation: invalid slot index');
    if (this.failure) throw new LmcodeError('RUN_HOST', 'lmcode invocation: cannot start work after failure');
    const slot = this.slots[index];
    if (!slot.sink) slot.sink = new ResultSink(contract);
    else if (slot.sink.contract.type !== contract.type || slot.sink.contract.nullable !== contract.nullable) throw new LmcodeError('RUN_HOST', 'lmcode invocation: result contract changed');
    registry.setResultSink(slot.sink);
    return slot.sink;
  }
  complete(index) {
    if (this.writing) throw new LmcodeError('RUN_HOST', 'lmcode invocation: finalized');
    const slot = this.slots[index];
    if (!slot) throw new LmcodeError('RUN_HOST', 'lmcode invocation: invalid slot index');
    if (!slot.sink) throw new LmcodeError('RUN_HOST', 'lmcode invocation: slot was not selected');
    try { slot.result = slot.sink.complete(); }
    catch (error) { this.fail(index, 'run', error); throw error; }
  }
  fail(index, phase, error) {
    if (this.writing) throw new LmcodeError('RUN_HOST', 'lmcode invocation: finalized');
    if (this.failure) return;
    if (index !== null && index !== undefined && !this.slots[index]) throw new LmcodeError('RUN_HOST', 'lmcode invocation: invalid slot index');
    const nativeError = error instanceof LmcodeError ? error : new LmcodeError('RUN_HOST', error?.message ?? String(error));
    exitFor(phase);
    this.failure = { phase, error: nativeError, part: this.builder && index !== null && index !== undefined ? index : null };
  }
  writeFrame() {
    if (this.writing) throw new LmcodeError('RUN_HOST', 'lmcode invocation: finalized');
    if (!this.failure) {
      for (let i = 0; i < this.slots.length; i++) if (this.slots[i].result === undefined) {
        this.fail(i, 'run', new LmcodeError('RUN_HOST', 'lmcode invocation: slot not completed')); break;
      }
    }
    let payload; let code = 0;
    if (this.failure) {
      const { phase, error, part } = this.failure;
      const data = { ok: false, phase, code: error.code, message: error.message };
      if (error.line) data.line = error.line;
      if (error.column) data.column = error.column;
      if (part !== null) data.part = part;
      if (this.dry) data.dry = true;
      payload = JSON.stringify(data); code = exitFor(phase);
    } else {
      const results = this.slots.map((slot) => stringifyResult(slot.result));
      payload = `{"ok":true,"result":${this.builder ? `[${results.join(',')}],"parts":${results.length}` : results[0]}${this.dry ? ',"dry":true' : ''}}`;
    }
    this.writing = true;
    return { code, frame: `LMCODE_RETURN_BEGIN\n${payload}\nLMCODE_RETURN_END\n` };
  }
}

export function resultContractFromSchema(schemaBytes) { return ResultContract.fromSchema(schemaBytes); }
export function failureFrame(phase, error) {
  const results = new InvocationResults({ builder: false, dry: error?.invocationDry === true, registrations: [] });
  results.fail(null, phase, error);
  return results.writeFrame();
}
