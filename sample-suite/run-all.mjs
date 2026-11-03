import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const corpus = path.join(root, 'sample-suite', 'corpus');
const main = path.join(root, 'sample', 'main.mjs');
const node = process.execPath;
const manifest = JSON.parse(readFileSync(path.join(corpus, 'manifest.json'), 'utf8'));
const schemaBytes = readFileSync(path.join(corpus, manifest.schema));
const schema = JSON.parse(schemaBytes);

function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function command(args, env = process.env) {
  return spawnSync(node, [main, ...args], { cwd: root, env, encoding: null });
}
function frameValue(result) {
  const lines = result.stdout.toString('utf8').trimEnd().split('\n');
  if (lines.length < 3 || lines[0] !== 'LMCODE_RETURN_BEGIN' || lines.at(-1) !== 'LMCODE_RETURN_END') throw new Error('CLI usage did not produce one terminal lmcode frame');
  return JSON.parse(lines.at(-2));
}
function signatures(schemaValue) {
  const values = [];
  for (const [name, overloads] of Object.entries(schemaValue.functions ?? {})) for (const overload of overloads) {
    values.push(`fn ${name}(${overload.params.join(', ')}) -> ${overload.returns}`);
  }
  for (const [type, definition] of Object.entries(schemaValue.types ?? {})) for (const [name, overloads] of Object.entries(definition.methods ?? {})) for (const overload of overloads) {
    values.push(`method ${type}.${name}(${overload.params.join(', ')}) -> ${overload.returns}`);
  }
  return `${values.sort().join('\n')}\n`;
}
function verifyProtocol() {
  let result = command(['--version']);
  assert.equal(result.status, 0); assert.deepEqual(result.stdout, Buffer.from('lmcode-js-sample 0.1.0\n')); assert.equal(result.stderr.length, 0);
  for (const args of [['--lmcode-schema'], ['--lmcode-schema', '--json']]) {
    result = command(args); assert.equal(result.status, 0); assert.deepEqual(result.stdout, schemaBytes); assert.equal(result.stderr.length, 0);
  }
  result = command(['--lmcode-signatures']);
  assert.equal(result.status, 0); assert.equal(result.stdout.toString('utf8'), signatures(schema)); assert.equal(result.stderr.length, 0);
  const retired = `--${['d','s','l'].join('')}`;
  for (const args of [[retired, path.join(corpus, 'missing-bytecode')], [`${retired}-schema`], [`${retired}-signatures`], [], ['--unknown'], ['--lmcode']]) {
    result = command(args); const envelope = frameValue(result);
    assert.equal(result.status, 2); assert.equal(envelope.code, 'CLI_USAGE'); assert.equal(envelope.phase, 'cli'); assert.equal(result.stderr.length, 0);
  }
  console.log('PASS sample host CLI protocol');
}

function checkCompilerErrors() {
  const compiler = process.env.LMSCRIPT_BIN ?? path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'lmscript.cmd' : 'lmscript');
  const manifestPath = path.join(corpus, 'compile-errors', 'manifest.json');
  const cases = JSON.parse(readFileSync(manifestPath, 'utf8')).cases;
  for (const item of cases) {
    const result = spawnSync(compiler, ['--check', path.join(corpus, 'compile-errors', item.source)], {
      cwd: root, encoding: 'utf8', shell: process.platform === 'win32',
    });
    const location = item.line ? `:${item.line}:${item.column}:` : '';
    if (result.status !== item.exit || !result.stderr.includes(item.diagnostic) || (location && !result.stderr.includes(location))) {
      throw new Error(`compiler rejection ${item.source} differs: exit=${result.status}, stderr=${result.stderr}`);
    }
  }
  console.log(`PASS ${cases.length} compiler rejection cases`);
}

function checkCorpusPins() {
  if (sha(schemaBytes) !== manifest.schema_sha256) throw new Error('sample schema digest differs from manifest');
  for (const item of manifest.cases) {
    if (sha(readFileSync(path.join(corpus, item.bytecode))) !== item.bytecode_sha256) throw new Error(`${item.name}: bytecode digest mismatch`);
    if (item.source && sha(readFileSync(path.join(corpus, item.source))) !== item.source_sha256) throw new Error(`${item.name}: source digest mismatch`);
  }
}

function runCase(item) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lmcode-js-sample-'));
  try {
    for (const [name, hex] of Object.entries({ ...(manifest.fixtures ?? {}), ...(item.fixtures ?? {}) })) {
      if (path.basename(name) !== name) throw new Error(`unsafe fixture path ${name}`);
      writeFileSync(path.join(dir, name), Buffer.from(hex, 'hex'));
    }
    const result = command(['--lmcode', path.join(corpus, item.bytecode)], { ...process.env, SAMPLE_TMP: dir });
    const expected = readFileSync(path.join(corpus, 'expected', `${item.name}.out`));
    const expectedExit = Number(readFileSync(path.join(corpus, 'expected', `${item.name}.exit`), 'utf8'));
    if (result.status !== expectedExit || !result.stdout.equals(expected) || result.stderr.length) {
      throw new Error(`${item.name}: exit ${result.status}/${expectedExit}; stdout ${result.stdout.length}/${expected.length} bytes; stderr=${result.stderr.toString('utf8')}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

checkCorpusPins();
verifyProtocol();
checkCompilerErrors();
let passed = 0;
for (const item of manifest.cases) {
  try { runCase(item); passed++; }
  catch (error) { console.error(`FAIL ${item.name}: ${error.message}`); }
}
console.log(`${passed === manifest.cases.length ? 'PASS' : 'FAIL'} ${passed}/${manifest.cases.length} sample byte/exit cases`);
if (passed !== manifest.cases.length) process.exitCode = 1;
