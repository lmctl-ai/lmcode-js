import { LmcodeError } from '../core/errors.mjs';
import { DryNull, VmObject, VOID } from '../core/values.mjs';

const supported = new Set(['null', 'bool', 'int', 'float', 'string', 'Json', 'StrList', 'IntList', 'FloatList', 'StrMap', 'IntMap', 'FloatMap']);
const safeInt = 9007199254740991n;
function mismatch(path, expected, got) { return new LmcodeError('RUN_HOST', `lmcode return: result type mismatch at ${path}: expected ${expected}; got ${got}`); }
function sourceType(value) {
  if (value === VOID || value === null || value instanceof DryNull) return 'null';
  if (typeof value === 'bigint') return 'int';
  if (typeof value === 'number') return 'float';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'boolean') return 'bool';
  if (value instanceof VmObject) return value.type;
  return 'handle';
}
function assignable(actual, expected) {
  return actual === expected || (actual === 'int' && expected === 'float') || (actual === 'IntList' && expected === 'FloatList') || (actual === 'IntMap' && expected === 'FloatMap');
}
function jsonKind(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'bigint') return value < -safeInt || value > safeInt ? 'unsafe int' : 'int';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'nonfinite';
    return Number.isInteger(value) && Math.abs(value) > Number(safeInt) ? 'unsafe int' : Number.isInteger(value) ? 'int' : 'float';
  }
  if (typeof value === 'string') return 'string';
  if (Array.isArray(value)) return 'array';
  if (value?.members instanceof Map) return 'object';
  return 'handle';
}
function validPrimitive(value, type) {
  const kind = jsonKind(value);
  if (type === 'int') return kind === 'int' || typeof value === 'bigint' && value >= -safeInt && value <= safeInt;
  if (type === 'float') return ['float', 'int'].includes(kind);
  if (type === 'string') return kind === 'string';
  if (type === 'bool') return kind === 'bool';
  return false;
}

export class ResultContract {
  constructor(type = '', nullable = false) { this.type = type; this.nullable = nullable; Object.freeze(this); }
  static fromSchema(schemaBytes) {
    let schema;
    try { schema = JSON.parse(Buffer.from(schemaBytes).toString('utf8')); }
    catch (error) { throw new LmcodeError('LOAD_BAD_SCHEMA', `lmcode result contract: ${error.message}`); }
    const bad = (message) => { throw new LmcodeError('LOAD_BAD_SCHEMA', `lmcode result contract: ${message}`); };
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) bad('schema must be an object');
    if (schema['dsl.schema'] !== 2) bad('requires schema 2');
    if (schema.result === undefined) return new ResultContract();
    const result = schema.result;
    if (!result || typeof result !== 'object' || Array.isArray(result)) bad('result must be an object');
    for (const key of Object.keys(result)) if (!['type', 'nullable'].includes(key)) bad(`unknown key ${key}`);
    if (typeof result.type !== 'string') bad('type must be a string');
    if (!supported.has(result.type)) bad(`unknown type ${result.type}`);
    if (result.type === 'null' && result.nullable !== undefined) bad('type null forbids nullable');
    if (result.nullable !== undefined && typeof result.nullable !== 'boolean') bad('nullable must be bool');
    return new ResultContract(result.type, result.nullable ?? false);
  }
  validateSource(value) {
    if (!this.type || this.type === 'Json' || value === VOID || value instanceof VmObject && value.type === 'Json') return;
    const actual = sourceType(value);
    if (!assignable(actual, this.type)) throw mismatch('', this.type, actual);
  }
  validateFieldSource(key, value) {
    const element = this.type === 'IntMap' ? 'int' : this.type === 'FloatMap' ? 'float' : this.type === 'StrMap' ? 'string' : '';
    if (!element || value instanceof VmObject && value.type === 'Json') return;
    const actual = sourceType(value);
    if (!assignable(actual, element)) throw mismatch(`/${String(key).replaceAll('~','~0').replaceAll('/','~1')}`, element, actual);
  }
  validate(value, path = '') {
    if (!this.type) return;
    const kind = jsonKind(value);
    if (kind === 'null') {
      if (this.nullable || this.type === 'null') return;
      throw mismatch(path, this.type, 'null');
    }
    if (this.type === 'Json' || validPrimitive(value, this.type)) return;
    const isList = ['StrList', 'IntList', 'FloatList'].includes(this.type);
    const isMap = ['StrMap', 'IntMap', 'FloatMap'].includes(this.type);
    if (isList && Array.isArray(value) || isMap && value?.members instanceof Map) {
      const element = this.type.startsWith('Str') ? 'string' : this.type.startsWith('Int') ? 'int' : 'float';
      const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v]) : [...value.members.entries()];
      for (const [key, item] of entries) {
        if (!validPrimitive(item, element)) throw mismatch(Array.isArray(value) ? `${path}/${key}` : `${path}/${String(key).replaceAll('~','~0').replaceAll('/','~1')}`, element, jsonKind(item));
      }
      return;
    }
    throw mismatch(path, this.type, kind);
  }
}
