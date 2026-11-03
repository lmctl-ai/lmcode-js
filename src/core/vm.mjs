import { LmcodeError } from './errors.mjs';
import { Reader } from './binary.mjs';
import { MathFn, Op } from './opcodes.mjs';
import { DryNull, INT_MAX, INT_MIN, VOID, VmObject, formatG15, kindName, wrapInt64 } from './values.mjs';
import { Context } from './registry.mjs';

const runError = (message) => new LmcodeError('RUN_ERROR', message);
const hostError = (message) => new LmcodeError('RUN_HOST', message);

function pop(stack) {
  if (!stack.length) throw runError('stack underflow');
  return stack.pop();
}
function expect(value, type, message) {
  const valid = type === 'int' ? typeof value === 'bigint'
    : type === 'float' ? typeof value === 'number'
      : type === 'string' ? typeof value === 'string'
        : type === 'bool' ? typeof value === 'boolean'
          : false;
  if (!valid) throw runError(message ?? `expected ${type}, got ${kindName(value)}`);
  return value;
}
function minFloat(a, b) {
  if (Number.isNaN(a)) return a;
  if (Number.isNaN(b)) return b;
  return a < b ? a : b < a ? b : a;
}
function maxFloat(a, b) {
  if (Number.isNaN(a)) return a;
  if (Number.isNaN(b)) return b;
  return a > b ? a : b > a ? b : a;
}
function intFromFloat(value) {
  if (Number.isNaN(value)) return 0n;
  if (value >= 2 ** 63) return INT_MAX;
  if (value <= -(2 ** 63)) return INT_MIN;
  return BigInt(Math.trunc(value));
}
function sameValue(a, b) {
  if (typeof a !== typeof b) return false;
  if (a instanceof VmObject || a instanceof DryNull) return a.value === b.value && a.type === b.type;
  return a === b;
}

function located(program, region, pc, error) {
  if (!(error instanceof LmcodeError)) error = hostError(error?.message ?? String(error));
  if (error.line !== null && error.line !== undefined) return error;
  let line = null;
  for (const entry of region.lines) { if (entry.pc > pc) break; line = entry; }
  if (!line || line.line === 0) return error;
  error.line = line.line;
  error.column = line.column || null;
  error.message = line.column ? `dsl line ${line.line}:${line.column}: ${error.message}` : `dsl line ${line.line}: ${error.message}`;
  return error;
}

export function execute(program, region, context, args, capture) {
  if (!(context instanceof Context)) context = new Context(context ?? {});
  for (const value of context.values.values()) {
    if (value?.__lmcodeExternal && (value.__lmcodeCollection || value.__lmcodeJson)) value.generation = program.registry.runGeneration;
  }
  const stack = [];
  const locals = Array(region.locals.length).fill(VOID);
  for (let i = 0; i < args.length; i++) locals[i] = args[i];
  const reader = new Reader(region.code);
  const jump = (rel) => {
    const target = reader.pos + rel;
    if (target < 0) throw runError('jump before the code start');
    if (target > region.code.length) throw runError(`jump target ${target} is outside the code`);
    reader.pos = target;
  };
  const readU16 = () => reader.u16();
  const readU8 = () => reader.u8();
  const boolCond = (value) => {
    if (typeof value !== 'boolean') throw runError(`condition is a ${kindName(value)}, not a bool`);
    return value;
  };

  while (true) {
    const faultPc = reader.pos;
    try {
      const op = readU8();
      switch (op) {
        case Op.PUSH_INT: stack.push(reader.i64()); break;
        case Op.PUSH_FLOAT: stack.push(reader.f64()); break;
        case Op.PUSH_STR: stack.push(program.constants[reader.u32()]); break;
        case Op.PUSH_BOOL: stack.push(readU8() !== 0); break;
        case Op.LOAD_LOCAL: {
          const slot = readU16();
          if (locals[slot] === VOID) throw runError(`local slot ${slot} read before assignment`);
          stack.push(locals[slot]); break;
        }
        case Op.STORE_LOCAL: locals[readU16()] = pop(stack); break;
        case Op.LOAD_CTX: {
          const index = readU16(); const name = program.contexts[index]; const value = context.get(name);
          if (value === undefined || value === null) throw runError(`context variable '${name}' was not provided by the host for this run`);
          stack.push(value instanceof VmObject ? value : new VmObject(program.registry.contextType(name), value));
          break;
        }
        case Op.CALL_FN: {
          const index = readU16(); const argc = readU8(); const imported = program.imports[index];
          const callArgs = Array(argc);
          for (let i = argc - 1; i >= 0; i--) callArgs[i] = pop(stack);
          let result;
          try { result = program.registry.invokeFunction(imported.canonical, callArgs, { dry: context.dry }); }
          catch (error) { throw error instanceof LmcodeError ? error : hostError(error?.message ?? String(error)); }
          if (result !== VOID) stack.push(result);
          break;
        }
        case Op.CALL_METHOD: {
          const index = readU16(); const argc = readU8(); const imported = program.imports[index];
          const callArgs = Array(argc);
          for (let i = argc - 1; i >= 0; i--) callArgs[i] = pop(stack);
          const self = pop(stack);
          if (self instanceof DryNull && (!context.dry || program.registry.methodBySignature(imported.canonical)?.dryCallback)) throw hostError(`method ${imported.type}.${imported.name} requires a concrete receiver after dry null`);
          if (context.dry && self instanceof DryNull && !program.registry.methodBySignature(imported.canonical)?.dryCallback) {
            const result = program.registry.invokeMethod(imported.canonical, self, callArgs, { dry: true });
            if (result !== VOID) stack.push(result);
            break;
          }
          if (!(self instanceof VmObject) || self.type !== imported.type) {
            const kind = self instanceof VmObject ? self.type : kindName(self);
            throw runError(`method ${imported.type}.${imported.name} called on a ${kind}`);
          }
          let result;
          try { result = program.registry.invokeMethod(imported.canonical, self, callArgs, { dry: context.dry }); }
          catch (error) { throw error instanceof LmcodeError ? error : hostError(error?.message ?? String(error)); }
          if (result !== VOID) stack.push(result);
          break;
        }
        case Op.EQ: case Op.NE: {
          const b = pop(stack); const a = pop(stack);
          if (kindName(a) !== kindName(b)) throw runError(`cannot compare ${kindName(a)} with ${kindName(b)}`);
          const equal = sameValue(a, b);
          stack.push(op === Op.EQ ? equal : !equal); break;
        }
        case Op.NOT: {
          const a = pop(stack);
          if (typeof a !== 'boolean') throw runError(`! applied to a ${kindName(a)}`);
          stack.push(!a); break;
        }
        case Op.ADD_I: case Op.SUB_I: case Op.MUL_I: case Op.DIV_I: case Op.MOD_I:
        case Op.LT_I: case Op.LE_I: case Op.GT_I: case Op.GE_I: {
          const b = pop(stack); const a = pop(stack);
          if (typeof a !== 'bigint' || typeof b !== 'bigint') throw runError(`int operator applied to ${kindName(a)} and ${kindName(b)}`);
          if (op === Op.ADD_I) stack.push(wrapInt64(a + b));
          else if (op === Op.SUB_I) stack.push(wrapInt64(a - b));
          else if (op === Op.MUL_I) stack.push(wrapInt64(a * b));
          else if (op === Op.DIV_I) {
            if (b === 0n) throw runError('int division by zero');
            stack.push(wrapInt64(a / b));
          } else if (op === Op.MOD_I) {
            if (b === 0n) throw runError('int modulo by zero');
            stack.push(a % b);
          } else if (op === Op.LT_I) stack.push(a < b);
          else if (op === Op.LE_I) stack.push(a <= b);
          else if (op === Op.GT_I) stack.push(a > b);
          else stack.push(a >= b);
          break;
        }
        case Op.ADD_F: case Op.SUB_F: case Op.MUL_F: case Op.DIV_F:
        case Op.LT_F: case Op.LE_F: case Op.GT_F: case Op.GE_F: {
          const b = pop(stack); const a = pop(stack);
          if (typeof a !== 'number' || typeof b !== 'number') throw runError(`float operator applied to ${kindName(a)} and ${kindName(b)}`);
          if (op === Op.ADD_F) stack.push(a + b);
          else if (op === Op.SUB_F) stack.push(a - b);
          else if (op === Op.MUL_F) stack.push(a * b);
          else if (op === Op.DIV_F) stack.push(a / b);
          else if (op === Op.LT_F) stack.push(a < b);
          else if (op === Op.LE_F) stack.push(a <= b);
          else if (op === Op.GT_F) stack.push(a > b);
          else stack.push(a >= b);
          break;
        }
        case Op.NEG_I: {
          const a = pop(stack); expect(a, 'int', `int negation applied to ${kindName(a)}`); stack.push(wrapInt64(-a)); break;
        }
        case Op.NEG_F: {
          const a = pop(stack); expect(a, 'float', `float negation applied to ${kindName(a)}`); stack.push(-a); break;
        }
        case Op.I2F: {
          const a = pop(stack); expect(a, 'int', `float() applied to ${kindName(a)}`); stack.push(Number(a)); break;
        }
        case Op.CONCAT: {
          const b = pop(stack); const a = pop(stack);
          if (typeof a !== 'string' || typeof b !== 'string') throw runError(`string + applied to ${kindName(a)} and ${kindName(b)}`);
          stack.push(a + b); break;
        }
        case Op.I2S: {
          const a = pop(stack); expect(a, 'int', `str(int) applied to ${kindName(a)}`); stack.push(a.toString()); break;
        }
        case Op.F2S: {
          const a = pop(stack); expect(a, 'float', `str(float) applied to ${kindName(a)}`); stack.push(formatG15(a)); break;
        }
        case Op.B2S: {
          const a = pop(stack); if (typeof a !== 'boolean') throw runError(`str(bool) applied to ${kindName(a)}`); stack.push(a ? 'true' : 'false'); break;
        }
        case Op.MATH: {
          const fn = readU8();
          if ([MathFn.SIN_F, MathFn.COS_F, MathFn.SQRT_F, MathFn.ABS_F, MathFn.FLOOR_F, MathFn.EASE_F, MathFn.EASE_IN_F, MathFn.EASE_OUT_F].includes(fn)) {
            const x = pop(stack); expect(x, 'float', `math applied to ${kindName(x)}`);
            if (fn === MathFn.SIN_F) stack.push(Math.sin(x));
            else if (fn === MathFn.COS_F) stack.push(Math.cos(x));
            else if (fn === MathFn.SQRT_F) stack.push(Math.sqrt(x));
            else if (fn === MathFn.ABS_F) stack.push(Math.abs(x));
            else if (fn === MathFn.FLOOR_F) stack.push(Math.floor(x));
            else if (fn === MathFn.EASE_F) { const t = minFloat(maxFloat(x, 0), 1); stack.push(t * t * (3 - 2 * t)); }
            else if (fn === MathFn.EASE_IN_F) { const t = minFloat(maxFloat(x, 0), 1); stack.push(t * t); }
            else { const t = minFloat(maxFloat(x, 0), 1); const d = 1 - t; stack.push(1 - d * d); }
          } else if (fn === MathFn.INT_F) {
            const x = pop(stack); expect(x, 'float', `math applied to ${kindName(x)}`); stack.push(intFromFloat(x));
          } else if (fn === MathFn.ABS_I) {
            const x = pop(stack); expect(x, 'int', `math applied to ${kindName(x)}`); stack.push(wrapInt64(x < 0n ? -x : x));
          } else if ([MathFn.POW_F, MathFn.MIN_F, MathFn.MAX_F, MathFn.MIN_I, MathFn.MAX_I].includes(fn)) {
            const b = pop(stack); const a = pop(stack);
            if ([MathFn.MIN_I, MathFn.MAX_I].includes(fn)) {
              if (typeof a !== 'bigint' || typeof b !== 'bigint') throw runError(`math applied to ${kindName(a)} and ${kindName(b)}`);
              stack.push(fn === MathFn.MIN_I ? (a < b ? a : b) : (a > b ? a : b));
            } else {
              if (typeof a !== 'number' || typeof b !== 'number') throw runError(`math applied to ${kindName(a)} and ${kindName(b)}`);
              if (fn === MathFn.POW_F) stack.push(a ** b);
              else stack.push(fn === MathFn.MIN_F ? minFloat(a, b) : maxFloat(a, b));
            }
          } else {
            const hi = pop(stack); const lo = pop(stack); const x = pop(stack);
            if (fn === MathFn.CLAMP_I) {
              if ([x, lo, hi].some((v) => typeof v !== 'bigint')) throw runError('math applied to non-int value');
              const lower = x < lo ? lo : x;
              stack.push(lower < hi ? lower : hi);
            } else if (fn === MathFn.CLAMP_F) {
              if ([x, lo, hi].some((v) => typeof v !== 'number')) throw runError('math applied to non-float value');
              stack.push(minFloat(maxFloat(x, lo), hi));
            } else if (fn === MathFn.LERP_F) {
              if ([x, lo, hi].some((v) => typeof v !== 'number')) throw runError('math applied to non-float value');
              const delta = lo - x; stack.push(x + delta * hi);
            } else throw runError(`unknown MATH function ${fn}`);
          }
          break;
        }
        case Op.JUMP: jump(reader.i32()); break;
        case Op.JUMP_IF_FALSE: case Op.JUMP_IF_TRUE: {
          const rel = reader.i32(); const condition = boolCond(pop(stack));
          if (condition === (op === Op.JUMP_IF_TRUE)) jump(rel);
          break;
        }
        case Op.FOR_RANGE: {
          const counter = readU16(); const end = readU16(); const rel = reader.i32();
          const finish = pop(stack); const begin = pop(stack);
          expect(finish, 'int'); expect(begin, 'int');
          locals[end] = finish; locals[counter] = begin;
          if (begin >= finish) jump(rel);
          break;
        }
        case Op.FOR_NEXT: {
          readU16(); const rel = reader.i32();
          const loop = region.loopPairs.get(faultPc);
          if (!loop) throw runError(`FOR_NEXT at offset ${faultPc} has no verified loop metadata`);
          locals[loop.counter] = wrapInt64(locals[loop.counter] + 1n);
          if (locals[loop.counter] < locals[loop.end]) jump(rel);
          break;
        }
        case Op.WHILE_BEGIN: break;
        case Op.WHILE_TEST: {
          const rel = reader.i32(); const condition = pop(stack);
          if (condition !== true) jump(rel);
          break;
        }
        case Op.LOOP_BACK: jump(reader.i32()); break;
        case Op.DUP: { const top = stack.at(-1); if (top === undefined) throw runError('stack underflow'); stack.push(top); break; }
        case Op.POP: pop(stack); break;
        case Op.HALT: return capture ? pop(stack) : VOID;
        default: throw runError(`unknown opcode ${op}`);
      }
    } catch (error) {
      throw located(program, region, faultPc, error);
    }
  }
}
