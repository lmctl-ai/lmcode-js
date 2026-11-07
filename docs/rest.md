# REST server (`rest` std module)

Opt-in module of [spec/std-rest.md](https://github.com/lmctl-ai/lmcode/blob/main/spec/std-rest.md); nothing is
registered by `createRegistry()`.

```js
import { createRegistry, Program } from '@lmctl-ai/lmcode-js';
import { registerRest } from '@lmctl-ai/lmcode-js/rest';

const registry = createRegistry();
const rest = registerRest(registry, { maxBodyBytes: 1 << 20, onHandlerError: (entry, msg) => console.error(entry, msg) });
const program = Program.load(bytecode, hostSchemaBytes, registry);   // host schema = lmcode-rest.schema.json (+ your own)
rest.run(program, context);          // runs the body: rest_route(...) calls, then rest_listen(8080)
console.log(rest.port);              // bound port (0 while not listening)
await rest.close();                  // or let a handler call rest_stop(); `await rest.closed`
```

* `rest.dispatch({method, target, headers, body})` is the transport-independent core used by the unit tests.
* The listener runs on a worker thread (Node cannot bind synchronously, but `rest_listen` must return the bound
  port); handlers always run on the VM thread, one at a time.
* Tests: `npm test` (unit: `test/rest.test.mjs`), `npm run conformance:rest` (shared 37-scenario suite).
