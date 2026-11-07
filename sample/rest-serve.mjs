#!/usr/bin/env node
// Serve a compiled program's REST routes over stdin/stdout (the `rest` std module; no network).
//   node sample/rest-serve.mjs PROGRAM.dslb HOST.schema.json [--max-body-bytes N]
// stdout carries only HTTP responses; handler failures go to stderr.
import { readFileSync } from 'node:fs';
import { Program } from '../src/core/program.mjs';
import { createRegistry } from '../src/std/index.mjs';
import { registerRest } from '../src/rest/index.mjs';

const [code, schema, ...flags] = process.argv.slice(2);
if (!code || !schema) { process.stderr.write('usage: rest-serve.mjs PROGRAM.dslb HOST.schema.json [--max-body-bytes N]\n'); process.exit(2); }
const max = flags[0] === '--max-body-bytes' ? Number(flags[1]) : undefined;
const registry = createRegistry();
const rest = registerRest(registry, { maxBodyBytes: max });
try {
  await rest.run(Program.load(readFileSync(code), readFileSync(schema), registry));
} catch (error) {
  process.stderr.write(`rest-serve: ${error.message}\n`);
  process.exit(3);
}
process.exit(0);
