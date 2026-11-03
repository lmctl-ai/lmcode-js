import { LmcodeError } from './errors.mjs';
import { Reader } from './binary.mjs';
import { MathFn, Op } from './opcodes.mjs';

const bad = (message) => { throw new LmcodeError('LOAD_BAD_BYTECODE', message); };
const simple = new Set([
  Op.EQ, Op.NE, Op.NOT, Op.DUP, Op.POP, Op.ADD_I, Op.SUB_I, Op.MUL_I, Op.DIV_I, Op.MOD_I,
  Op.ADD_F, Op.SUB_F, Op.MUL_F, Op.DIV_F, Op.NEG_I, Op.NEG_F, Op.LT_I, Op.LE_I, Op.GT_I,
  Op.GE_I, Op.LT_F, Op.LE_F, Op.GT_F, Op.GE_F, Op.I2F, Op.CONCAT, Op.I2S, Op.F2S, Op.B2S,
  Op.WHILE_BEGIN, Op.HALT,
]);

export function verifyRegion(program, region, returns = null) {
  const r = new Reader(region.code);
  const instructions = [];
  const open = [];
  const ordinary = [];
  const whileExits = [];
  const regions = new Map();
  const usedRangeSlots = new Set();
  region.loopPairs = new Map();
  const noOwner = -1;
  let halted = false;
  const checkIndex = (index, length, label) => {
    if (index >= length) bad(`${label} index ${index} out of range (${length} entries)`);
  };
  const hiddenInt = (slot, role) => {
    checkIndex(slot, region.locals.length, role);
    if (region.locals[slot].type !== 'int' || !region.locals[slot].hidden) bad(`${role} slot ${slot} must be a hidden int local`);
  };
  const add = (pc, op) => {
    const owner = open.length ? open.at(-1).pc : noOwner;
    const instruction = { pc, op, owner, depth: open.length, next: 0, target: null };
    instructions.push(instruction);
    return instruction;
  };

  while (!r.done) {
    const pc = r.pos;
    const op = r.u8();
    const ins = add(pc, op);
    halted = false;
    switch (op) {
      case Op.PUSH_INT: r.i64(); break;
      case Op.PUSH_FLOAT: r.f64(); break;
      case Op.PUSH_STR: {
        const index = r.u32();
        checkIndex(index, program.constants.length, 'constant');
        break;
      }
      case Op.PUSH_BOOL: {
        const value = r.u8();
        if (value > 1) bad('PUSH_BOOL operand must be 0 or 1');
        break;
      }
      case Op.LOAD_LOCAL:
      case Op.STORE_LOCAL: {
        ins.a = r.u16();
        checkIndex(ins.a, region.locals.length, 'local slot');
        break;
      }
      case Op.LOAD_CTX:
        ins.a = r.u16();
        checkIndex(ins.a, program.contexts.length, 'context');
        break;
      case Op.CALL_FN:
      case Op.CALL_METHOD: {
        ins.a = r.u16(); ins.argc = r.u8();
        checkIndex(ins.a, program.imports.length, 'import');
        const imported = program.imports[ins.a];
        if (op === Op.CALL_FN && imported.kind !== 'fn') bad(`CALL_FN at offset ${pc} names import ${ins.a}, which is a method`);
        if (op === Op.CALL_METHOD && imported.kind !== 'method') bad(`CALL_METHOD at offset ${pc} names import ${ins.a}, which is a function`);
        if (imported.params.length !== ins.argc) {
          const opcode = op === Op.CALL_FN ? 'CALL_FN' : 'CALL_METHOD';
          bad(`${opcode} at offset ${pc} passes ${ins.argc} argument(s), the import takes ${imported.params.length}`);
        }
        break;
      }
      case Op.MATH:
        ins.a = r.u8();
        if (ins.a > MathFn.CLAMP_I) bad(`unknown MATH function ${ins.a} at offset ${pc}`);
        break;
      case Op.JUMP:
      case Op.JUMP_IF_FALSE:
      case Op.JUMP_IF_TRUE: {
        ins.rel = r.i32();
        if (ins.rel < 0) bad(`jump at offset ${pc} goes backwards (only paired LOOP_BACK may jump backward)`);
        ins.target = r.pos + ins.rel;
        ordinary.push({ from: pc, target: ins.target });
        break;
      }
      case Op.FOR_RANGE: {
        ins.counter = r.u16(); ins.end = r.u16(); ins.rel = r.i32();
        hiddenInt(ins.counter, 'FOR_RANGE counter');
        hiddenInt(ins.end, 'FOR_RANGE end');
        if (ins.counter === ins.end) bad('FOR_RANGE counter and end slots must be distinct');
        for (const slot of [ins.counter, ins.end]) {
          if (usedRangeSlots.has(slot)) bad(`FOR_RANGE slot ${slot} is already owned by another range loop`);
          usedRangeSlots.add(slot);
        }
        if (ins.rel < 0) bad(`FOR_RANGE at offset ${pc} exits backwards`);
        ins.exit = r.pos + ins.rel;
        ins.target = ins.exit;
        open.push({ op, pc, next: r.pos, exit: ins.exit, counter: ins.counter, end: ins.end, parent: ins.owner });
        break;
      }
      case Op.FOR_NEXT: {
        ins.end = r.u16(); ins.rel = r.i32();
        if (!open.length || open.at(-1).op !== Op.FOR_RANGE) bad(`FOR_NEXT at offset ${pc} has no matching FOR_RANGE`);
        const loop = open.pop();
        if (ins.end !== loop.end) bad(`FOR_NEXT at offset ${pc} names end slot ${ins.end}, expected ${loop.end}`);
        if (r.pos + ins.rel !== loop.next) bad(`FOR_NEXT at offset ${pc} must return to its FOR_RANGE body`);
        if (loop.exit !== r.pos) bad(`FOR_RANGE at offset ${loop.pc} must exit immediately after its FOR_NEXT`);
        region.loopPairs.set(pc, { counter: loop.counter, end: loop.end, next: loop.next });
        ins.target = r.pos + ins.rel;
        regions.set(loop.pc, { exit: loop.exit, parent: loop.parent, test: 0, op: Op.FOR_RANGE });
        break;
      }
      case Op.WHILE_BEGIN:
        open.push({ op, pc, next: r.pos, parent: ins.owner, tested: false });
        break;
      case Op.WHILE_TEST: {
        ins.rel = r.i32();
        if (ins.rel < 0) bad(`WHILE_TEST at offset ${pc} exits backwards`);
        if (!open.length || open.at(-1).op !== Op.WHILE_BEGIN) bad(`WHILE_TEST at offset ${pc} has no matching WHILE_BEGIN`);
        const loop = open.at(-1);
        if (loop.tested) bad(`WHILE_BEGIN at offset ${loop.pc} has more than one WHILE_TEST`);
        loop.test = pc; loop.tested = true; loop.exit = r.pos + ins.rel;
        ins.target = loop.exit;
        whileExits.push({ from: pc, target: loop.exit });
        break;
      }
      case Op.LOOP_BACK: {
        ins.rel = r.i32();
        if (!open.length || open.at(-1).op !== Op.WHILE_BEGIN) bad(`LOOP_BACK at offset ${pc} has no matching WHILE_BEGIN`);
        const loop = open.pop();
        if (!loop.tested) bad(`WHILE_BEGIN at offset ${loop.pc} has no WHILE_TEST`);
        if (r.pos + ins.rel !== loop.pc) bad(`LOOP_BACK at offset ${pc} does not target its paired WHILE_BEGIN`);
        if (loop.exit !== r.pos) bad(`WHILE_TEST at offset ${loop.test} must exit immediately after its LOOP_BACK`);
        regions.set(loop.pc, { exit: loop.exit, parent: loop.parent, test: loop.test, op: Op.WHILE_BEGIN });
        ins.target = r.pos + ins.rel;
        break;
      }
      case Op.EQ: case Op.NE: case Op.NOT: case Op.DUP: case Op.POP:
      case Op.ADD_I: case Op.SUB_I: case Op.MUL_I: case Op.DIV_I: case Op.MOD_I:
      case Op.ADD_F: case Op.SUB_F: case Op.MUL_F: case Op.DIV_F:
      case Op.NEG_I: case Op.NEG_F: case Op.LT_I: case Op.LE_I: case Op.GT_I: case Op.GE_I:
      case Op.LT_F: case Op.LE_F: case Op.GT_F: case Op.GE_F: case Op.I2F: case Op.CONCAT:
      case Op.I2S: case Op.F2S: case Op.B2S:
        break;
      case Op.HALT:
        if (ins.depth !== 0) bad('HALT inside loop');
        halted = true;
        break;
      default:
        bad(`unknown opcode ${op} at offset ${pc}`);
    }
    ins.next = r.pos;
  }

  if (open.length) {
    const top = open.at(-1);
    bad(top.op === Op.FOR_RANGE ? `unclosed FOR_RANGE at offset ${top.pc}` : `unclosed WHILE_BEGIN at offset ${top.pc}`);
  }
  if (!halted) bad('code does not end with HALT');

  const at = new Map(instructions.map((ins, i) => [ins.pc, i]));
  const find = (pc) => at.has(pc) ? instructions[at.get(pc)] : null;
  for (const edge of ordinary) {
    const from = find(edge.from); const to = find(edge.target);
    if (!to) bad(`jump at offset ${edge.from} targets ${edge.target}, not an instruction start`);
    const loop = regions.get(from.owner);
    if (loop?.op === Op.WHILE_BEGIN && from.pc < loop.test && to.pc > loop.test) bad(`jump at offset ${from.pc} skips its WHILE_TEST`);
    if (from.owner === to.owner) continue;
    if (!loop || edge.target !== loop.exit || to.owner !== loop.parent) {
      bad(`jump at offset ${edge.from} crosses a loop boundary (only a break to the innermost loop exit is allowed)`);
    }
  }
  for (const ins of instructions) {
    if (ins.op === Op.STORE_LOCAL) {
      if (usedRangeSlots.has(ins.a)) bad(`STORE_LOCAL at offset ${ins.pc} writes a read-only range slot ${ins.a}`);
      if (region.locals[ins.a].hidden) bad(`STORE_LOCAL at offset ${ins.pc} writes compiler-owned loop local ${ins.a}`);
    }
    if (ins.op === Op.FOR_RANGE) {
      const target = find(ins.exit);
      if (!target || target.owner !== ins.owner) bad(`FOR_RANGE at offset ${ins.pc} exits to an invalid loop region`);
    }
  }
  for (const edge of whileExits) {
    const from = find(edge.from); const to = find(edge.target); const loop = regions.get(from?.owner);
    if (!from || !to || from.owner === -1 || !loop || loop.op !== Op.WHILE_BEGIN || loop.exit !== edge.target || to.owner !== loop.parent) {
      bad(`WHILE_TEST at offset ${edge.from} exits to an invalid loop region`);
    }
  }

  verifyStack(program, region, instructions, at, returns);
  for (const line of region.lines) if (line.pc >= region.code.length) bad(`line table entry points at pc ${line.pc}, beyond the code`);
  region.instructions = instructions;
}

function verifyStack(program, region, instructions, at, returns) {
  const hasLoops = instructions.some((ins) => ins.op === Op.FOR_RANGE || ins.op === Op.WHILE_BEGIN);
  if (!hasLoops && returns === null) return;
  if (!instructions.length) bad('code is empty');
  const depths = new Array(instructions.length).fill(null);
  const work = [0]; depths[0] = 0;
  const merge = (pc, depth) => {
    const index = at.get(pc);
    if (index === undefined) bad(`control flow targets ${pc}, not an instruction start`);
    if (depths[index] === null) { depths[index] = depth; work.push(index); }
    else if (depths[index] !== depth) bad(`inconsistent operand stack depth at control-flow join ${pc}: ${depths[index]} versus ${depth}`);
  };
  const mathArity = (id) => {
    if ([0, 1, 2, 3, 4, 10, 11, 12, 13, 14].includes(id)) return 1;
    if ([5, 6, 7, 15, 16].includes(id)) return 2;
    if ([8, 9, 17].includes(id)) return 3;
    bad(`unknown MATH function ${id}`);
  };
  while (work.length) {
    const ix = work.pop(); const ins = instructions[ix];
    let pop = 0; let push = 0; let branch = false; let conditional = false; let fall = true;
    const op = ins.op;
    if ([Op.PUSH_INT, Op.PUSH_FLOAT, Op.PUSH_STR, Op.PUSH_BOOL, Op.LOAD_LOCAL, Op.LOAD_CTX].includes(op)) push = 1;
    else if ([Op.STORE_LOCAL, Op.POP].includes(op)) pop = 1;
    else if (op === Op.CALL_FN) { pop = ins.argc; if (program.imports[ins.a].returns !== 'void') push = 1; }
    else if (op === Op.CALL_METHOD) { pop = ins.argc + 1; if (program.imports[ins.a].returns !== 'void') push = 1; }
    else if ([Op.EQ, Op.NE, Op.ADD_I, Op.SUB_I, Op.MUL_I, Op.DIV_I, Op.MOD_I, Op.ADD_F, Op.SUB_F, Op.MUL_F, Op.DIV_F,
      Op.LT_I, Op.LE_I, Op.GT_I, Op.GE_I, Op.LT_F, Op.LE_F, Op.GT_F, Op.GE_F, Op.CONCAT].includes(op)) { pop = 2; push = 1; }
    else if ([Op.NOT, Op.NEG_I, Op.NEG_F, Op.I2F, Op.I2S, Op.F2S, Op.B2S].includes(op)) { pop = 1; push = 1; }
    else if (op === Op.MATH) { pop = mathArity(region.code[ins.pc + 1]); push = 1; }
    else if (op === Op.DUP) { pop = 1; push = 2; }
    else if (op === Op.JUMP) { branch = true; fall = false; }
    else if ([Op.JUMP_IF_FALSE, Op.JUMP_IF_TRUE].includes(op)) { pop = 1; branch = true; conditional = true; }
    else if (op === Op.FOR_RANGE) { pop = 2; branch = true; conditional = true; }
    else if (op === Op.FOR_NEXT) { branch = true; conditional = true; }
    else if (op === Op.WHILE_TEST) { pop = 1; branch = true; conditional = true; }
    else if (op === Op.LOOP_BACK) { branch = true; fall = false; }
    else if (op === Op.HALT) fall = false;

    const depth = depths[ix];
    if (depth < pop) bad(`operand stack underflow at offset ${ins.pc}`);
    const after = depth - pop + push;
    if (op === Op.HALT && returns !== null) {
      const expected = returns === 'void' ? 0 : 1;
      if (after !== expected) bad(`HALT leaves ${after} values, interface returns ${returns}`);
    }
    if (branch) merge(ins.target, after);
    if (conditional) merge(ins.next, after);
    else if (fall) {
      if (ix + 1 < instructions.length) merge(ins.next, after);
      else bad('control flow falls past the end of code');
    }
  }
  for (const ins of instructions) {
    if (ins.op !== Op.WHILE_TEST || depths[at.get(ins.pc)] === null) continue;
    const head = depths[at.get(ins.owner)];
    if (depths[at.get(ins.pc)] !== head + 1) bad(`WHILE_TEST must leave the loop-head stack depth at offset ${ins.pc}`);
  }
}
