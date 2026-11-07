# REST conformance suite (`rest` std module)

Shared by every runtime; see [spec/std-rest.md](../../spec/std-rest.md).

| File | Role |
|---|---|
| `host.schema.json` | host schema = the module's declarations (identical to `std/rest/lmcode-rest.schema.json`; CI checks) |
| `app.lms` | the program: 14 routes, 13 handlers, `rest_listen(0)` |
| `app.dslb` | `app.lms` compiled with the published `@lmctl-ai/lmctl` (DSLB v6); `node build.mjs` regenerates it |
| `scenarios.json` | sequential HTTP exchanges and the options (`max_body_bytes`) the host must use |

## Running it in a runtime

1. Register the std **and** the rest module, load `app.dslb` against the bytes of `host.schema.json`, run the
   body through the rest controller (it calls `rest_listen(0)`), read the bound port.
2. For each scenario open a fresh TCP connection and write the request as bytes
   (`METHOD target HTTP/1.1`, `Host`, the scenario `headers`, `Content-Length` when there is a body,
   `Connection: close`; `raw` replaces the whole request; `body_repeat` is `text` × `count`), read to EOF.
3. Assert `expect`: `status`; every listed header (names lower-case; `null` = must be absent); `body` exactly
   (`$PORT` is replaced by the bound port; omitted = not checked); always `Content-Length` equal to the received
   body length (except `HEAD`, where it is the length of the GET body) and `Connection: close`.
4. The `stops_server` scenario must be answered, after which new connections are refused.
