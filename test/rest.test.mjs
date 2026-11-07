import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { readFileSync } from 'node:fs';
import { createRegistry } from '../src/std/index.mjs';
import { VmObject } from '../src/core/values.mjs';
import { registerRest, RouteTable, parseRoute, percentDecode, RestController } from '../src/rest/index.mjs';
import { parseHead, bodyLength, encodeResponse, takeRequest } from '../src/rest/http.mjs';
import { replay, suite, serveInMemory, serveProcess, newController, requestBytes, parseResponses } from '../conformance/rest-run.mjs';

const schema = JSON.parse(readFileSync(new URL('../conformance/rest-suite/host.schema.json', import.meta.url), 'utf8'));
const message = (re) => (e) => { assert.match(e.message, re); return true; };
const HANDLER = 'interface RestHandler(RestExchange) -> void';
const fakeProgram = (...entries) => ({ entries: entries.map(([annotation, iface = HANDLER, name = annotation]) => ({ annotation, iface, name })), call() {}, run() {} });
const controllerWith = (program, options) => { const c = new RestController(createRegistry(), options); c.program = program; return c; };
const GET = (target) => Buffer.from(`GET ${target} HTTP/1.1\r\nHost: x\r\n\r\n`);

// ---- unit: routes -------------------------------------------------------------------------------------------
test('route templates: valid shapes parse into literal, param and rest segments', () => {
  const r = parseRoute('GET', '/users/{id}/files/{path...}');
  assert.deepEqual(r.segments.map((s) => s.kind), ['literal', 'param', 'literal', 'rest']);
  assert.equal(parseRoute('GET', '/').segments.length, 1);
  assert.equal(parseRoute('GET', '/files/').segments.at(-1).value, '');
});

test('route templates: invalid shapes are RUN_HOST errors with pinned text', () => {
  const bad = (method, path, re) => assert.throws(() => parseRoute(method, path), message(re), `${method} ${path}`);
  bad('get', '/x', /rest: invalid route get \/x: method must be one of GET, POST/);
  bad('GET', 'x', /path must start with '\/'/);
  bad('GET', '/a b', /whitespace/);
  assert.doesNotThrow(() => parseRoute('GET', '/caf\u00c3\u00a0'), 'UTF-8 bytes such as C3 A0 are not whitespace');
  bad('GET', '/a?b', /whitespace, control characters, \? or #/);
  bad('GET', '/a//b', /empty segment/);
  bad('GET', '/{1x}', /invalid parameter name '1x'/);
  bad('GET', '/{a}/{a}', /duplicate parameter 'a'/);
  bad('GET', '/{a...}/x', /must be the last segment/);
  bad('GET', '/a{b}', /malformed placeholder/);
  bad('GET', '/{b', /malformed placeholder/);
});

test('route table: duplicates are detected by shape, parameter names do not matter', () => {
  const t = new RouteTable();
  t.add('GET', '/a/{x}', 'one');
  t.add('POST', '/a/{x}', 'two');
  assert.throws(() => t.add('GET', '/a/{y}', 'three'), message(/rest: duplicate route GET \/a\/\{y\}/));
  t.add('GET', '/a/b', 'literal');
});

test('route table: specificity is literal > {param} > {rest...}, first difference wins', () => {
  const t = new RouteTable();
  t.add('GET', '/x/{rest...}', 'rest');
  t.add('GET', '/x/{p}/z', 'param-z');
  t.add('GET', '/x/{p}/{q}', 'param-param');
  t.add('GET', '/x/y/{q}', 'literal-param');
  t.add('GET', '/x/y/z', 'literal-literal');
  const pick = (path) => t.match('GET', path).route?.annotation;
  assert.equal(pick('/x/y/z'), 'literal-literal');
  assert.equal(pick('/x/y/w'), 'literal-param');
  assert.equal(pick('/x/a/z'), 'param-z');
  assert.equal(pick('/x/a/b'), 'param-param');
  assert.equal(pick('/x/a/b/c'), 'rest');
  assert.equal(pick('/x/'), 'rest');
  assert.equal(t.match('GET', '/x').status, 404);
});

test('route table: 404 vs 405, Allow header, HEAD fallback', () => {
  const t = new RouteTable();
  t.add('GET', '/r', 'g'); t.add('DELETE', '/r', 'd'); t.add('PUT', '/only-put', 'p');
  assert.deepEqual(t.match('POST', '/r'), { status: 405, allow: 'DELETE, GET, HEAD' });
  assert.deepEqual(t.match('GET', '/only-put'), { status: 405, allow: 'PUT' });
  assert.equal(t.match('GET', '/missing').status, 404);
  assert.equal(t.match('HEAD', '/r').route.method, 'GET');
  assert.equal(t.match('HEAD', '/only-put').status, 405);
});

test('route table: encoded slashes stay inside one segment; parameters are decoded, invalid escapes never match', () => {
  const t = new RouteTable();
  t.add('GET', '/f/{name}', 'f');
  assert.equal(t.match('GET', '/f/a%2Fb').params.name, 'a/b');
  assert.equal(t.match('GET', '/f/a%2Fb/c').status, 404);
  assert.equal(t.match('GET', '/f/%zz').status, 404);
  assert.equal(t.match('GET', '/f/').status, 404, 'empty segment is not a {param}');
  assert.equal(percentDecode('%C3%B6'), 'Ã¶', 'decoding yields bytes, not code points');
  assert.equal(percentDecode('a+b', true), 'a b');
  assert.equal(percentDecode('a+b'), 'a+b');
  assert.equal(percentDecode('%4'), null);
});

// ---- unit: HTTP subset --------------------------------------------------------------------------------------
test('http: request heads', () => {
  assert.deepEqual(parseHead('GET /a?b=1 HTTP/1.1\r\nHost: x\r\nX-A:  v  '), { method: 'GET', target: '/a?b=1', headers: [['Host', 'x'], ['X-A', 'v']] });
  for (const bad of ['garbage', 'GET /a HTTP/2.0', 'GET a HTTP/1.1', 'GET /a#f HTTP/1.1', 'get /a HTTP/1.1', 'GET /a HTTP/1.1\r\nNoColon', 'GET /a HTTP/1.1\r\n: v', 'GET /a HTTP/1.1\r\nBad Name: v']) {
    assert.deepEqual(parseHead(bad), { error: 400 }, bad);
  }
});

test('http: content-length rules', () => {
  assert.deepEqual(bodyLength([]), { length: 0 });
  assert.deepEqual(bodyLength([['content-length', '12']]), { length: 12 });
  assert.deepEqual(bodyLength([['Content-Length', '1'], ['content-length', '1']]), { length: 1 });
  assert.deepEqual(bodyLength([['Content-Length', '1'], ['content-length', '2']]), { error: 400 });
  for (const v of ['-1', '1.5', 'abc', '', '1'.repeat(16)]) assert.deepEqual(bodyLength([['Content-Length', v]]), { error: 400 }, v);
  assert.deepEqual(bodyLength([['Transfer-Encoding', 'chunked']]), { error: 501 });
});

test('http: response encoding', () => {
  const text = (bytes) => bytes.toString('latin1');
  assert.equal(text(encodeResponse({ status: 200, headers: [['A', 'b']], body: Buffer.from('hi') })), 'HTTP/1.1 200 OK\r\nA: b\r\nContent-Length: 2\r\n\r\nhi');
  assert.equal(text(encodeResponse({ status: 299, headers: [], body: Buffer.from('hi') }, { head: true })), 'HTTP/1.1 299 OK\r\nContent-Length: 2\r\n\r\n');
});

// ---- unit: registration and exchange rules ------------------------------------------------------------------
test('registration: exactly the 18 declared signatures, absent from the default registry', () => {
  const declared = [
    ...Object.entries(schema.functions).flatMap(([n, ds]) => ds.map((d) => `fn ${n}(${d.params.join(', ')}) -> ${d.returns}`)),
    ...Object.entries(schema.types).flatMap(([t, def]) => Object.entries(def.methods).flatMap(([n, ds]) => ds.map((d) => `method ${t}.${n}(${d.params.join(', ')}) -> ${d.returns}`))),
  ].sort();
  assert.equal(declared.length, 18);
  const plain = createRegistry();
  assert.equal(plain.signatures().length, 206, 'default catalog is unchanged');
  assert.ok(!plain.signatures().some((s) => s.includes('rest_')));
  registerRest(plain);
  assert.deepEqual(plain.signatures().filter((s) => /rest_|RestExchange/.test(s)), declared);
  assert.equal(plain.signatures().length, 224);
});

test('takeRequest: incremental framing, fatal errors and pipelined remainders', () => {
  const full = Buffer.from('POST /a HTTP/1.1\r\nContent-Length: 3\r\n\r\nabcGET /b HTTP/1.1\r\n\r\n');
  const one = takeRequest(full, 1024);
  assert.equal(one.request.body.toString(), 'abc');
  assert.equal(takeRequest(one.rest, 1024).request.target, '/b');
  assert.deepEqual(takeRequest(Buffer.from('GET /a HTT'), 1024), { need: true });
  assert.deepEqual(takeRequest(Buffer.from('POST /a HTTP/1.1\r\nContent-Length: 5\r\n\r\nab'), 1024), { need: true });
  assert.deepEqual(takeRequest(Buffer.from('POST /a HTTP/1.1\r\nContent-Length: 2000\r\n\r\n'), 1024), { fatal: 413 });
  assert.deepEqual(takeRequest(Buffer.alloc(20000, 97), 1024), { fatal: 431 });
  assert.deepEqual(takeRequest(Buffer.from('nonsense\r\n\r\n'), 1024), { fatal: 400 });
  assert.deepEqual(takeRequest(Buffer.from('POST /a HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n'), 1024), { fatal: 501 });
});

test('serve validation happens before any byte is read', () => {
  const none = controllerWith(fakeProgram());
  assert.throws(() => none.serve(), message(/rest: no routes registered/));
  const missing = controllerWith(fakeProgram());
  missing.route('GET', '/a', 'nope');
  assert.throws(() => missing.serve(), message(/rest: route GET \/a references missing annotation @nope/));
  const wrong = controllerWith(fakeProgram(['a', 'interface Rule(Node) -> void', 'check']));
  wrong.route('GET', '/a', 'a');
  assert.throws(() => wrong.serve(), message(/rest: entry check must implement RestHandler\(RestExchange\) -> void/));
  const dup = controllerWith(fakeProgram(['a'], ['a']));
  dup.route('GET', '/a', 'a');
  assert.throws(() => dup.serve(), message(/rest: duplicate annotation @a/));
  const unbound = new RestController(createRegistry());
  unbound.route('GET', '/a', 'a');
  assert.throws(() => unbound.serve(), message(/rest: no program is bound/));
  for (const c of [none, missing, wrong, dup]) assert.equal(c.serving, false);
});

test('serve validation ignores entries that implement other interfaces', () => {
  const c = controllerWith(fakeProgram(['a'], ['other', 'interface Rule(Node) -> void']));
  c.route('GET', '/a', 'a');
  c.serve();
  assert.equal(c.serving, true);
});

test('lifecycle: routes freeze after rest_serve, a second rest_serve fails', () => {
  const c = controllerWith(fakeProgram(['a']));
  c.route('GET', '/a', 'a');
  c.serve();
  assert.throws(() => c.route('GET', '/b', 'a'), message(/rest: routes are frozen once rest_serve has been called/));
  assert.throws(() => c.serve(), message(/rest: rest_serve already called/));
});

test('exchange rules: status range, header validation, reserved headers, counters', () => {
  const registry = createRegistry(); registerRest(registry);
  const x = new VmObject('RestExchange', { status: 200, headers: new Map(), body: '', state: { values: new Map(), counts: new Map() } });
  const call = (sig, ...args) => registry.invokeMethod(`method RestExchange.${sig}`, x, args);
  assert.throws(() => call('status(int) -> void', 199n), message(/rest: status 199 out of range 200\.\.599/));
  assert.throws(() => call('status(int) -> void', 600n), message(/out of range/));
  call('status(int) -> void', 599n);
  assert.equal(x.value.status, 599);
  for (const name of ['', 'a b', 'a:b', 'a\tb']) assert.throws(() => call('set_header(string, string) -> void', name, 'v'), message(/invalid response header/), JSON.stringify(name));
  assert.throws(() => call('set_header(string, string) -> void', 'X', 'a\r\nInjected: 1'), message(/invalid response header/));
  for (const name of ['Content-Length', 'connection', 'TRANSFER-ENCODING']) assert.throws(() => call('set_header(string, string) -> void', name, '1'), message(/managed by the server/));
  call('set_header(string, string) -> void', 'X-A', '1');
  call('set_header(string, string) -> void', 'x-a', '2');
  assert.deepEqual([...x.value.headers.values()], [['x-a', '2']], 'same name replaces, case-insensitively');
  assert.equal(call('increment(string) -> int', 'k'), 1n);
  assert.equal(call('increment(string) -> int', 'k'), 2n);
  assert.equal(call('get(string) -> string', 'k'), '', 'counters and strings are separate maps');
});

// ---- integration: stdio ---------------------------------------------------------------------------------------
test('conformance suite through in-memory streams (stream, fatal, silent groups)', async () => {
  assert.equal(await replay((input) => serveInMemory(input), assert), suite.stream.length - 1 + suite.fatal.length + suite.silent.length);
});

test('conformance suite through a real child process: stdin to stdout, exit code 0', async () => {
  assert.equal(await replay(serveProcess, assert), suite.stream.length - 1 + suite.fatal.length + suite.silent.length);
});

test('stdio: responses stream out while input is still arriving, request by request', async () => {
  const input = new PassThrough(); const output = new PassThrough();
  const { rest, program } = newController({ input, output });
  const done = rest.run(program);
  const next = () => new Promise((resolve) => output.once('data', resolve));
  input.write(GET('/health'));
  assert.match((await next()).toString(), /^HTTP\/1\.1 200 OK/);
  input.write(GET('/count'));
  assert.equal(parseResponses(await next(), []).at(0).body.toString(), '1');
  input.end(GET('/count'));
  assert.equal(parseResponses(await next(), []).at(0).body.toString(), '2');
  await done;
});

test('stdio: a request split across chunks (even mid-header and mid-body) is reassembled', async () => {
  const input = new PassThrough(); const output = new PassThrough();
  const chunks = []; output.on('data', (c) => chunks.push(c));
  const { rest, program } = newController({ input, output });
  const done = rest.run(program);
  const body = '{"values":[10,20,12]}';
  for (const part of ['POST /su', `m HTTP/1.1\r\nHost: x\r\nContent-Len`, `gth: ${body.length}\r\n\r\n{"values"`, ':[10,20,12]}']) {
    input.write(part);
    await new Promise((r) => setImmediate(r));
  }
  input.end();
  await done;
  const [r] = parseResponses(Buffer.concat(chunks), ['POST']);
  assert.equal(r.status, 201);
  assert.equal(r.body.toString(), '{"sum":42}');
});

test('stdio: pipelined requests in one chunk are answered in order', async () => {
  const out = await serveInMemory(Buffer.concat([GET('/hello/a'), GET('/hello/b'), GET('/nope'), GET('/hello/c')]));
  assert.deepEqual(parseResponses(out, []).map((r) => r.status), [200, 200, 404, 200]);
});

test('stdio: handler errors reach onHandlerError with the entry name and never the client; serving continues', async () => {
  const seen = [];
  const out = await serveInMemory(Buffer.concat([GET('/boom'), GET('/health')]), { onHandlerError: (entry, text) => seen.push([entry, text]) });
  const [a, b] = parseResponses(out, []);
  assert.equal(a.status, 500);
  assert.equal(a.body.toString(), '{"error":"internal error"}');
  assert.equal(b.status, 200);
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0], 'boom');
  assert.match(seen[0][1], /zero/i);
});

test('stdio: invalid percent escapes in the path or query are 400 and do not end serving', async () => {
  const out = await serveInMemory(Buffer.concat([GET('/nope?x=%zz'), GET('/hello/%zz'), GET('/health')]));
  assert.deepEqual(parseResponses(out, []).map((r) => r.status), [400, 400, 200]);
});

test('stdio: rest_stop() before rest_serve() means the body ends without reading', async () => {
  const { rest, program } = newController({ input: new PassThrough(), output: new PassThrough() });
  rest.stop = rest.stop.bind(rest);
  rest.serve = () => { rest.serving = true; rest.stopped = true; };
  await rest.run(program); // never resolves if it tried to read the (never ended) input
});

test('stdio: requestBytes composes valid HTTP for every stream scenario (self-check of the harness)', () => {
  for (const s of suite.stream) assert.ok(takeRequest(requestBytes(s), 1 << 20).request, s.name);
});
