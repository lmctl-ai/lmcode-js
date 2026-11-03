#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context } from '../src/core/registry.mjs';
import { VmObject } from '../src/core/values.mjs';
import { LmcodeError } from '../src/core/errors.mjs';
import { Program } from '../src/core/program.mjs';
import { InvocationResults, failureFrame, resultContractFromSchema } from '../src/host/invocation.mjs';
import { Host, entryText, summary } from './host.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = path.join(root, 'sample-suite', 'corpus', 'sample.dsl.json');
const schema = readFileSync(schemaPath);
const version = '0.1.0';
const usage = 'usage: --version | --lmcode-schema [--json] | --lmcode-signatures | [--lmcode|--first|--last] FILE ...';
const cliError = () => new LmcodeError('CLI_USAGE', usage);
const failFrame = (phase, error) => {
  const result = failureFrame(phase, error);
  process.stdout.write(result.frame);
  return result.code;
};

function discover(args) {
  if (args.length === 1 && args[0] === '--version') {
    process.stdout.write(`lmcode-js-sample ${version}\n`); return 0;
  }
  if (args.length === 1 && args[0] === '--lmcode-schema' || args.length === 2 && args[0] === '--lmcode-schema' && args[1] === '--json') {
    process.stdout.write(schema); return 0;
  }
  if (args.length === 1 && args[0] === '--lmcode-signatures') {
    const host = new Host({ dry: false });
    process.stdout.write(`${host.registry.signatures().join('\n')}\n`); return 0;
  }
  return null;
}

function normalizedLoadError(error) {
  if (!(error instanceof LmcodeError)) return new LmcodeError('LOAD_BAD_BYTECODE', 'invalid sample bytecode');
  if (error.code === 'LOAD_SCHEMA_MISMATCH') return new LmcodeError(error.code, 'sample schema mismatch');
  if (error.code === 'LOAD_UNBOUND') return new LmcodeError(error.code, 'sample import mismatch');
  return new LmcodeError(error.code, 'invalid sample bytecode');
}

function parseCommand(args) {
  const parts = [];
  for (let i = 0; i < args.length; i += 2) {
    if (i + 1 >= args.length) throw cliError();
    const flag = args[i];
    if (flag !== '--lmcode' && flag !== '--first' && flag !== '--last') throw cliError();
    parts.push({ file: args[i + 1], priority: flag === '--first' ? 0 : flag === '--last' ? 2 : 1, index: parts.length });
  }
  if (!parts.length) throw cliError();
  return parts;
}

function run(args) {
  const inspection = discover(args);
  if (inspection !== null) return inspection;
  let parts;
  try { parts = parseCommand(args); } catch (error) { return failFrame('cli', error); }
  let results;
  try { results = InvocationResults.fromCommand(parts.map((p) => p.file)); }
  catch (error) { return failFrame('cli', error); }

  const host = new Host({ dry: results.dryMode(), print: (bytes) => process.stdout.write(bytes) });
  const contract = resultContractFromSchema(schema);
  const context = new Context({ shop: host.shop, ledger: host.ledger });
  context.setDry(results.dryMode());
  parts.sort((a, b) => a.priority - b.priority);
  let entriesCalled = 0;
  let failed = false;

  for (const part of parts) {
    let phase = 'load';
    try {
      let bytecode;
      try { bytecode = readFileSync(part.file); }
      catch { throw Object.assign(new LmcodeError('APP_FAIL', 'cannot read sample input'), { samplePhase: 'app' }); }
      let program;
      try { program = Program.load(bytecode, schema, host.registry); }
      catch (error) { throw normalizedLoadError(error); }
      results.select(part.index, host.registry, contract);
      phase = 'run';
      program.run(context);
      for (let index = 0; index < program.entries.length; index++) {
        const entry = program.entries[index];
        const invoke = (argument) => {
          const result = program.call(index, context, [argument]);
          entriesCalled++;
          if (result !== undefined && typeof result !== 'symbol') process.stdout.write(`entry ${entry.name} = ${entryText(result)}\n`);
        };
        if (entry.annotation === 'item') for (const item of host.shop.items.values) invoke(new VmObject('Money', item));
        else if (entry.annotation === 'total') invoke(host.totalMoney());
      }
      results.complete(part.index);
    } catch (error) {
      const phaseName = error.samplePhase ?? phase;
      results.fail(part.index, phaseName, error);
      failed = true; break;
    }
  }
  if (!failed && host.ledger.balance < 0n) results.fail(null, 'app', new LmcodeError('APP_FAIL', 'ledger: negative balance'));
  if (!failed && !results.failure) process.stdout.write(summary(host, entriesCalled));
  const output = results.writeFrame();
  process.stdout.write(output.frame);
  return output.code;
}

process.exitCode = run(process.argv.slice(2));
