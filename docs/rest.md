# REST server over stdio (`rest` std module)

Opt-in module of [spec/std-rest.md](https://github.com/lmctl-ai/lmcode/blob/main/spec/std-rest.md). There is **no network
listener**: the host process reads HTTP/1.1 requests from stdin and writes responses to stdout. Nothing is registered by `createRegistry()`.

```js
import { createRegistry, Program } from '@lmctl-ai/lmcode-js';
import { registerRest } from '@lmctl-ai/lmcode-js/rest';

const registry = createRegistry();
const rest = registerRest(registry, { maxBodyBytes: 1 << 20, input: process.stdin, output: process.stdout,
                                      onHandlerError: (entry, msg) => console.error(entry, msg) });
const program = Program.load(bytecode, hostSchemaBytes, registry);   // host schema includes lmcode-rest.schema.json
await rest.run(program, context);   // body: rest_route(...) then rest_serve(); then serves until EOF / rest_stop()
```

Try it: `printf 'GET /health HTTP/1.1\r\nHost: x\r\n\r\n' | node sample/rest-serve.mjs conformance/rest-suite/app.dslb conformance/rest-suite/host.schema.json`

* `rest.dispatch({method, target, headers, body})` is the transport-independent core used by the unit tests.
* Keep stdout clean while serving: `print` and diagnostics belong on stderr.
* Tests: `npm test` (`test/rest.test.mjs`), `npm run conformance:rest` (shared suite: in-memory streams and a real child process).
