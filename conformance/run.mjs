import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Program } from '../src/core/program.mjs';
import { LmcodeError } from '../src/core/errors.mjs';
import { VmObject, formatG15, kindName } from '../src/core/values.mjs';
import { makeStub, contextFor, Thing } from './stub.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vectorDir = path.resolve(process.argv[2] ?? path.join(root, 'conformance', 'vectors'));
const manifest = JSON.parse(await readFile(path.join(vectorDir, 'manifest.json'), 'utf8'));
const names = (await readdir(vectorDir)).filter((name) => name.endsWith('.expect')).map((name) => name.slice(0, -7)).sort();

function parseExpectation(text) {
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const kind = lines.shift() ?? '';
  let sink = null;
  if (lines.at(-1)?.startsWith('sink ')) sink = JSON.parse(lines.pop().slice(5));
  return { kind, lines: lines.map((line) => line.replaceAll('\\n', '\n')), sink };
}

function schemaFile(name) {
  return manifest.vectors.find((item) => item.name === name)?.schema ?? 'schema.json';
}
function traceMatches(actual, expected) {
  if (!expected.startsWith('~ ')) return actual === expected;
  const split = expected.lastIndexOf(' ');
  const prefix = expected.slice(2, split + 1);
  if (!actual.startsWith(prefix)) return false;
  const want = Number(expected.slice(split + 1)); const got = Number(actual.slice(prefix.length));
  return Number.isFinite(want) && Number.isFinite(got) && Math.abs(got - want) <= 1e-12 * Math.max(Math.abs(want), 1e-300);
}
function stripLocation(message, error) {
  if (error.column) return message.replace(`dsl line ${error.line}:${error.column}: `, '');
  if (error.line) return message.replace(`dsl line ${error.line}: `, '');
  return message;
}
function valueText(value) {
  if (typeof value === 'bigint') return `int ${value}`;
  if (typeof value === 'number') return `float ${formatG15(value)}`;
  if (typeof value === 'string') return `string ${value}`;
  if (typeof value === 'boolean') return `bool ${value}`;
  if (value instanceof VmObject && value.value instanceof Thing) return `thing ${value.value.id}`;
  return 'void';
}
function parseEntryArgs(text, params) {
  const values = JSON.parse(text);
  return values.map((value, index) => {
    const type = params[index];
    if (type === 'int' && typeof value === 'number') return BigInt(value);
    if (value && value.type === 'Thing') return new VmObject('Thing', new Thing(BigInt(value.id)));
    return value;
  });
}

async function check(name) {
  const expected = parseExpectation(await readFile(path.join(vectorDir, `${name}.expect`), 'utf8'));
  const bytecode = await readFile(path.join(vectorDir, `${name}.dslb`));
  const schema = await readFile(path.join(vectorDir, schemaFile(name)));
  const schemaText = schema.toString('utf8');
  const standard = vectorDir.endsWith(path.join('conformance', 'stdlib-vectors'))
    || ['"str_len"', '"math_abs"', '"str_list"', '"file_read"', '"print"'].some((key) => schemaText.includes(key));
  const stub = makeStub({ standard });
  let program = null; let loadError = null; let runError = null; let ran = false; let entryLines = [];
  try { program = Program.load(bytecode, schema, stub.registry); } catch (error) { loadError = error; }
  if (program) {
    try {
      if (expected.kind === 'entries') {
        entryLines = program.entries.map((entry) => `${entry.name} ${entry.annotation} ${entry.iface}`); ran = true;
      } else if (expected.kind.startsWith('call')) {
        const [selector, args = '[]'] = expected.lines[0].split(/ (.*)/s);
        const index = program.entries.findIndex((entry) => entry.name === selector);
        if (index < 0) throw new Error(`entry '${selector}' is not present`);
        program.run(contextFor(stub));
        const value = program.call(index, contextFor(stub), parseEntryArgs(args, program.entries[index].params));
        entryLines = [`result ${valueText(value)}`, ...stub.trace]; ran = true;
      } else {
        program.run(contextFor(stub, !standard)); ran = true;
      }
    } catch (error) { runError = error; }
  }
  let ok = false;
  switch (expected.kind) {
    case 'trace':
      ok = ran && stub.trace.length === expected.lines.length && stub.trace.every((line, i) => traceMatches(line, expected.lines[i])); break;
    case 'entries':
      ok = ran && entryLines.length === expected.lines.length && entryLines.every((line, i) => line === expected.lines[i]); break;
    case 'call':
      ok = ran && entryLines.length === expected.lines.length - 1 && entryLines.every((line, i) => traceMatches(line, expected.lines[i + 1])); break;
    case 'call_error':
    case 'call_error_at':
      ok = Boolean(program && runError instanceof LmcodeError && expected.lines[1] === runError.code && stripLocation(runError.message, runError).includes(expected.lines.at(-1))); break;
    case 'runtime_error':
      ok = Boolean(program && runError && runError.message.includes(expected.lines[0])); break;
    case 'runtime_error_file': {
      const message = runError instanceof LmcodeError ? stripLocation(runError.message, runError) : '';
      const last = message.slice(message.lastIndexOf(':') + 1).trim();
      ok = Boolean(program && runError instanceof LmcodeError && runError.code === expected.lines[0]
        && message.includes(`${expected.lines[1]}: `) && message.includes(expected.lines[2]) && last);
      break;
    }
    case 'runtime_error_at':
      ok = Boolean(program && runError instanceof LmcodeError && runError.code === expected.lines[0]
        && (Number(expected.lines[1]) === (runError.line ?? 0)) && (Number(expected.lines[2]) === (runError.column ?? 0))
        && runError.message.includes(expected.lines[3])); break;
    case 'runtime_error_exact':
      ok = Boolean(program && runError instanceof LmcodeError && runError.code === expected.lines[0] && stripLocation(runError.message, runError) === expected.lines[1]); break;
    case 'load_error':
      ok = Boolean(!program && loadError instanceof LmcodeError && loadError.code === expected.lines[0] && loadError.message.includes(expected.lines[1])); break;
    default:
      throw new Error(`unsupported expectation kind '${expected.kind}'`);
  }
  stub.cleanup();
  if (!ok) {
    const actualError = loadError ? `load: ${loadError.message}` : runError ? `run: ${runError.message}` : `trace: ${JSON.stringify(stub.trace)}`;
    throw new Error(`${name}: expected ${expected.kind} ${JSON.stringify(expected.lines)}, got ${actualError}`);
  }
  return expected.kind;
}

let failed = 0;
for (const name of names) {
  try { await check(name); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
}
console.log(`${failed ? 'FAIL' : 'PASS'} ${names.length - failed}/${names.length} core vectors`);
if (failed) process.exitCode = 1;
