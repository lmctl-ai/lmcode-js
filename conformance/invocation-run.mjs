import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context } from '../src/core/registry.mjs';
import { Program } from '../src/core/program.mjs';
import { LmcodeError } from '../src/core/errors.mjs';
import { createRegistry } from '../src/std/index.mjs';
import { InvocationResults, resultContractFromSchema } from '../src/host/invocation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'conformance', 'invocation-vectors');
const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
let failed = 0;

function makeRegistry() {
  const registry = createRegistry(); let counter = 0n;
  registry.fn('fn next_counter() -> int', () => ++counter);
  const entryFail = () => { throw new LmcodeError('RUN_HOST', 'native entry failure'); };
  registry.fn('fn entry_fail() -> void', entryFail, { dry: () => { throw new LmcodeError('RUN_HOST', 'preview failed'); } });
  registry.fn('fn wp90_Json() -> Json', () => { throw new LmcodeError('RUN_HOST', 'real dummy callback ran'); });
  registry.fn('fn wp90_consume(Json) -> int', () => { throw new LmcodeError('RUN_HOST', 'real consumer ran'); });
  const method = () => { throw new LmcodeError('RUN_HOST', 'preview received dry null'); };
  registry.method('method Json.wp90_consume(Json) -> int', method);
  registry.method('method Json.wp90_preview(Json) -> int', method, { dry: method });
  return registry;
}

for (const row of manifest.cases) {
  const caseConfig = JSON.parse(await readFile(path.join(dir, `${row.name}.json`), 'utf8'));
  const programs = row.programs;
  const files = programs.map((name, index) => path.resolve(dir, `${name}.slot-${index}.lmcode`));
  let results;
  try {
    if (row.mode === null) results = InvocationResults.fromCommand(files, {});
    else {
      const metadata = {
        version: 1,
        mode: row.mode,
        dry: row.dry ?? caseConfig.dry ?? false,
        parts: files.map((file, index) => ({ index, file })),
      };
      results = InvocationResults.fromMetadata(Buffer.from(JSON.stringify(metadata)), files);
    }
  } catch (error) {
    console.error(`FAIL invocation ${row.name}: manifest ${error.message}`); failed++; continue;
  }
  const registry = makeRegistry();
  const schemaRel = row.schema ?? manifest.schema;
  const schema = await readFile(path.join(dir, schemaRel));
  const contract = resultContractFromSchema(schema);
  const context = new Context(); context.setDry(results.dryMode());
  for (const index of caseConfig.execution) {
    let phase = 'load';
    try {
      const slot = files[index];
      if (!slot) throw new LmcodeError('CLI_USAGE', 'fixture index absent');
      const bytecode = await readFile(path.join(dir, `${programs[index]}.dslb`));
      const program = Program.load(bytecode, schema, registry);
      results.select(index, registry, contract);
      phase = 'run'; program.run(context);
      for (let i = 0; i < program.entries.length; i++) {
        const value = program.call(i, context, []);
        if (typeof value !== 'bigint' || value !== 7n) throw new LmcodeError('RUN_HOST', 'entry HALT result changed');
      }
      results.complete(index);
    } catch (error) {
      results.fail(index, phase, error); break;
    }
  }
  if (caseConfig.app_fail) results.fail(null, 'app', new LmcodeError('APP_FAIL', 'native validation failed'));
  const actual = results.writeFrame();
  const expected = await readFile(path.join(dir, `${row.name}.expect`), 'utf8');
  const ok = actual.code === row.exit && actual.frame === expected;
  if (!ok) { failed++; console.error(`FAIL invocation ${row.name}: exit ${actual.code}/${row.exit}; actual=${JSON.stringify(actual.frame)} expected=${JSON.stringify(expected)}`); }
  else console.log(`PASS invocation ${row.name}`);
}
console.log(`${failed ? 'FAIL' : 'PASS'} ${manifest.cases.length - failed}/${manifest.cases.length} invocation goldens`);
if (failed) process.exitCode = 1;
