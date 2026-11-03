import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Program } from '../src/core/program.mjs';
import { LmcodeError } from '../src/core/errors.mjs';
import { createRegistry } from '../src/std/index.mjs';
import { Context } from '../src/core/registry.mjs';
import { InvocationResults, resultContractFromSchema } from '../src/host/invocation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'conformance', 'return-vectors');
const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
let failed = 0;
for (const vector of manifest.vectors) {
  const registry = createRegistry();
  const results = InvocationResults.fromCommand([vector.bytecode], {});
  const schema = await readFile(path.join(dir, manifest.schema));
  const contract = resultContractFromSchema(schema);
  const sink = results.select(0, registry, contract);
  registry.fn('fn entry_fail() -> void', () => { throw new LmcodeError('RUN_HOST', 'entry failure'); });
  registry.fn('fn expect_result(string) -> void', (text) => {
    if (sink.json() !== text) throw new LmcodeError('RUN_HOST', 'return overload payload mismatch');
  }, { internal: true });
  let runError = null;
  try {
    const bytecode = await readFile(path.join(dir, vector.bytecode));
    const program = Program.load(bytecode, schema, registry);
    sink.reset();
    const context = new Context();
    program.run(context);
    for (let repeat = 0; repeat < (vector.repeat ?? 1); repeat++) {
      for (let i = 0; i < program.entries.length; i++) {
        const result = program.call(i, context, []);
        if (typeof result !== 'bigint' || result !== 7n) throw new LmcodeError('RUN_HOST', 'entry HALT result changed');
      }
    }
  } catch (error) { runError = error; }
  if (runError) results.fail(0, 'run', runError);
  else {
    try { results.complete(0); } catch (error) { runError = error; }
  }
  const { frame, code } = results.writeFrame();
  const expectedBytes = await readFile(path.join(dir, vector.expect.file));
  const expected = expectedBytes.toString('utf8');
  const ok = code === vector.expect.exit && frame === expected;
  if (!ok) { failed++; console.error(`FAIL return ${vector.name}: exit ${code}/${vector.expect.exit}; frame=${JSON.stringify(frame)} expected=${JSON.stringify(expected)} error=${runError?.message ?? ''}`); }
  else console.log(`PASS return ${vector.name}`);
}
console.log(`${failed ? 'FAIL' : 'PASS'} ${manifest.vectors.length - failed}/${manifest.vectors.length} return vectors`);
if (failed) process.exitCode = 1;
