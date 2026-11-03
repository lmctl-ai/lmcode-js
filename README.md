# lmcode-js

Pure ESM JavaScript runtime for lmcode bytecode v6. It runs on Node.js LTS without a native build or runtime dependencies.

The runtime includes the loader, strict bytecode verifier, synchronous VM, host registry, result sink, invocation manifest support, dry callbacks, and the canonical standard catalog. Integers stay exact as signed 64-bit `BigInt`; floats are JavaScript `number`. VM strings are byte strings represented as latin-1 code units, so a VM string's `.length` is its byte length.

## Use

The compiler is separate from the runtime. Use the current `@lmctl-ai/lmctl` compiler to produce bytecode and the exact schema bytes that were used to compile it. From this checkout, import the ESM entry point directly; no install or build step is required.

```js
import { Program, createRegistry } from './src/index.mjs';
import { readFile } from 'node:fs/promises';

const schema = await readFile('sample.dsl.json');
const bytecode = await readFile('program.dslb');
const registry = createRegistry()
  .context('greeter', 'Greeter')
  .method('method Greeter.say(string) -> void', (greeter, message) => {
    greeter.messages.push(message);
  });

const program = Program.load(bytecode, schema, registry);
program.run({ greeter: { messages: [] } });
```

`Registry` alone starts empty. `createRegistry()` installs the 206 canonical standard signatures. Registration uses the canonical signature string, which is also what `--lmcode-signatures` prints. Function callbacks receive declared arguments; method callbacks receive the host object first, followed by declared arguments.

Host callbacks receive lossless `BigInt` values by default. Set `{ ints: 'number' }` to convert safe integers to `number`; out of range values raise `RUN_HOST`. String callbacks receive UTF-8 text. Set `{ rawStrings: true }` to receive and return raw `Buffer` byte strings when a host needs invalid UTF-8 or embedded NUL bytes.

## Host results, invocation and dry mode

The `ResultSink` copies values into owned JSON data and validates any result contract. Host arrays/maps are copied and serialized iteratively, so deep finite results do not consume the native call stack; cycles fail with `RUN_HOST` without changing the previous result. `InvocationResults` reads the private version 1 manifest from `LMCODE_INVOCATION_FILE`, assigns each program an independent sink, and emits one terminal frame only after dispatch and application checks finish.

```js
import { Context, InvocationResults, Program, createRegistry, resultContractFromSchema } from '@lmctl-ai/lmcode-js';

const files = ['/absolute/path/a.dslb'];
const results = InvocationResults.fromCommand(files);
const registry = createRegistry();
const context = new Context({ greeter: { messages: [] } });
context.setDry(results.dryMode());

const contract = resultContractFromSchema(schemaBytes);
const sink = results.select(0, registry, contract);
const program = Program.load(bytecode, schemaBytes, registry);
program.run(context);
results.complete(0);
const { code, frame } = results.writeFrame();
```

In dry mode, callbacks without an override are skipped and return a typed dummy; mutable standard collection dummies are fresh per call. Provide `{ dry: previewCallback }` to run a preview once. The real callback remains unchanged in real mode. Dry support does not simulate vendor effects or add an execution budget.

## Bytecode and standard catalog

The loader verifies schema hashes, imports, context declarations, all code-region instruction boundaries, loop pairing and boundaries, hidden-local stores, duplicate entry names, and reachable stack depths before execution. Wire counts are consumed incrementally; the runtime does not preallocate arrays from untrusted counts. There is no instruction deadline, fixed string byte ceiling, matcher-work budget, or live object quota. String allocations retain only the actual Node platform string-length guard. Replacement scans matches into the result byte buffer without allocating an array per match. Catchable allocation failures become `RUN_HOST`. Fatal V8 heap exhaustion and operating-system process termination cannot be caught by this synchronous, in-process SDK; universal abort containment requires an external process boundary, not an implicit runtime quota.

The standard catalog covers strings and byte codecs, math, files, lists/maps/stacks/queues/priority queues, strict JSON access, text templates, and result operations. String matching uses constant auxiliary memory without a work budget. JSON parsing and template nesting follow the shared 256-level parser/render guard. JSON keys cross the host boundary as UTF-8 byte strings, and file paths preserve native bytes on Unix while requiring strict UTF-8 on Windows.

## Sample CLI host

`sample/main.mjs` is a small Shop/Ledger host using the shared sample contract. It supports `--version`, `--lmcode-schema`, `--lmcode-signatures`, and repeated `--lmcode FILE` arguments with `--first`/`--last` role fragments. A build is not required:

```sh
node sample/main.mjs --version
node sample/main.mjs --lmcode sample-suite/corpus/bytecode/001-literals.dslb
```

## Development and conformance

The SDK vendors pinned canonical fixtures. Set `LMCODE_CPP_DIR` to a clean lmcode-cpp checkout to update them:

```sh
LMCODE_CPP_DIR=/path/to/lmcode-cpp node scripts/sync-std.mjs
LMCODE_CPP_DIR=/path/to/lmcode-cpp node scripts/sync-vectors.mjs
LMCODE_CPP_DIR=/path/to/lmcode-cpp node scripts/sync-sample-suite.mjs
npm run verify:pins
npm test
npm run mutation
npm run conformance
npm run sample-suite
```

`npm run conformance` runs all core, standard, result-frame and invocation vectors, including the 29 exact-byte malformed-metadata cases through the sample CLI. The sample suite checks the CLI protocol, compiler rejection cases, and exact stdout/exit bytes for every canonical Shop/Ledger case. CI uses the latest published `@lmctl-ai/lmctl` compiler and runs the same gates on Ubuntu, macOS and Windows with Node 22 and 24.

The package is prepared for a future npm release, but CI does not publish it. There are no native install steps or global links.
