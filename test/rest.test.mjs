import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { createRegistry } from '../src/std/index.mjs';
import { VmObject } from '../src/core/values.mjs';
import { registerRest, RouteTable, parseRoute, percentDecode, RestController } from '../src/rest/index.mjs';
import { parseHead, bodyLength, encodeResponse } from '../src/rest/http.mjs';
import { startSuiteServer, replay, suite, exchange, parseResponse } from '../conformance/rest-run.mjs';

const schema = JSON.parse(readFileSync(new URL('../conformance/rest-suite/host.schema.json', import.meta.url), 'utf8'));
const message = (re) => (e) => { assert.match(e.message, re); return true; };
const HANDLER = 'interface RestHandler(RestExchange) -> void';
const fakeProgram = (...entries) => ({ entries: entries.map(([annotation, iface = HANDLER, name = annotation]) => ({ annotation, iface, name })), call() {}, run() {} });
const controllerWith = (program, options) => { const c = new RestController(createRegistry(), options); c.program = program; return c; };

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
  assert.equal(text(encodeResponse({ status: 200, headers: [['A', 'b']], body: Buffer.from('hi') })), 'HTTP/1.1 200 OK\r\nA: b\r\nContent-Length: 2\r\nConnection: close\r\n\r\nhi');
  assert.equal(text(encodeResponse({ status: 299, headers: [], body: Buffer.from('hi') }, { head: true })), 'HTTP/1.1 299 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n');
});

// ---- unit: registration and exchange rules ------------------------------------------------------------------
test('registration: exactly the 20 declared signatures, absent from the default registry', () => {
  const declared = [
    ...Object.entries(schema.functions).flatMap(([n, ds]) => ds.map((d) => `fn ${n}(${d.params.join(', ')}) -> ${d.returns}`)),
    ...Object.entries(schema.types).flatMap(([t, def]) => Object.entries(def.methods).flatMap(([n, ds]) => ds.map((d) => `method ${t}.${n}(${d.params.join(', ')}) -> ${d.returns}`))),
  ].sort();
  assert.equal(declared.length, 20);
  const plain = createRegistry();
  assert.equal(plain.signatures().length, 206, 'default catalog is unchanged');
  assert.ok(!plain.signatures().some((s) => s.includes('rest_')));
  registerRest(plain);
  assert.deepEqual(plain.signatures().filter((s) => /rest_|RestExchange/.test(s)), declared);
  assert.equal(plain.signatures().length, 226);
});

test('listen validation happens before any socket is opened', () => {
  const none = controllerWith(fakeProgram());
  assert.throws(() => none.listen('127.0.0.1', 0), message(/rest: no routes registered/));
  const missing = controllerWith(fakeProgram());
  missing.route('GET', '/a', 'nope');
  assert.throws(() => missing.listen('127.0.0.1', 0), message(/rest: route GET \/a references missing annotation @nope/));
  const wrong = controllerWith(fakeProgram(['a', 'interface Rule(Node) -> void', 'check']));
  wrong.route('GET', '/a', 'a');
  assert.throws(() => wrong.listen('127.0.0.1', 0), message(/rest: entry check must implement RestHandler\(RestExchange\) -> void/));
  const dup = controllerWith(fakeProgram(['a'], ['a']));
  dup.route('GET', '/a', 'a');
  assert.throws(() => dup.listen('127.0.0.1', 0), message(/rest: duplicate annotation @a/));
  assert.equal(dup.port, 0);
  const unbound = new RestController(createRegistry());
  unbound.route('GET', '/a', 'a');
  assert.throws(() => unbound.listen('127.0.0.1', 0), message(/no program is bound/));
  for (const c of [none, missing, wrong, dup]) assert.equal(c.listening, false);
});

test('listen validation ignores entries that implement other interfaces', async () => {
  const c = controllerWith(fakeProgram(['a'], ['other', 'interface Rule(Node) -> void']));
  c.route('GET', '/a', 'a');
  assert.ok(c.listen('127.0.0.1', 0) > 0);
  await c.close();
});

test('lifecycle: routes freeze while listening, double listen fails, port reports, restart works', async () => {
  const c = controllerWith(fakeProgram(['a']));
  c.route('GET', '/a', 'a');
  const port = c.listen('localhost', 0);
  assert.ok(port > 0 && c.port === port && c.listening);
  assert.throws(() => c.route('GET', '/b', 'a'), message(/rest: routes are frozen once the server is listening/));
  assert.throws(() => c.listen('127.0.0.1', 0), message(/rest: server already listening/));
  await c.close();
  assert.equal(c.port, 0);
  await c.stop(); // idempotent
  const again = c.listen('127.0.0.1', 0);
  assert.ok(again > 0);
  await c.close();
});

test('listen failures: bad port, bad host, port in use', async () => {
  const c = controllerWith(fakeProgram(['a'])); c.route('GET', '/a', 'a');
  assert.throws(() => c.listen('127.0.0.1', 70000), message(/rest: port 70000 out of range 0\.\.65535/));
  assert.throws(() => c.listen('example.com', 0), message(/host must be an IP address or localhost/));
  const first = controllerWith(fakeProgram(['a'])); first.route('GET', '/a', 'a');
  const taken = first.listen('127.0.0.1', 0);
  assert.throws(() => c.listen('127.0.0.1', taken), message(/rest: cannot listen on 127\.0\.0\.1:\d+: EADDRINUSE/));
  assert.equal(c.listening, false);
  await first.close();
});

test('exchange rules: status range, header validation, reserved headers', () => {
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

// ---- integration: transport ---------------------------------------------------------------------------------
test('conformance suite: all scenarios over real TCP, then rest_stop() refuses connections', async () => {
  const { rest } = startSuiteServer();
  const port = rest.port;
  assert.equal(await replay(port, assert), suite.scenarios.length);
  await rest.closed;
  await assert.rejects(exchange(port, Buffer.from('GET /health HTTP/1.1\r\n\r\n')), (e) => e.code === 'ECONNREFUSED');
});

test('transport: a request split across TCP segments is reassembled', async () => {
  const { rest } = startSuiteServer();
  const socket = net.connect({ port: rest.port, host: '127.0.0.1' });
  const chunks = [];
  socket.on('data', (c) => chunks.push(c));
  const closed = new Promise((resolve) => socket.on('close', resolve));
  const body = '{"values":[10,20,12]}';
  for (const part of [`POST /su`, `m HTTP/1.1\r\nHost: x\r\nContent-Len`, `gth: ${body.length}\r\n\r\n{"values"`, `:[10,20,12]}`]) {
    socket.write(part);
    await new Promise((r) => setTimeout(r, 20));
  }
  await closed;
  const r = parseResponse(Buffer.concat(chunks));
  assert.equal(r.status, 201);
  assert.equal(r.body.toString(), '{"sum":42}');
  await rest.close();
});

test('transport: concurrent clients are serialized, state increments are atomic and ordered', async () => {
  const { rest } = startSuiteServer();
  const get = async () => parseResponse(await exchange(rest.port, Buffer.from('GET /count HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'))).body.toString();
  const results = await Promise.all(Array.from({ length: 40 }, get));
  assert.deepEqual(results.map(Number).sort((a, b) => a - b), Array.from({ length: 40 }, (_, i) => i + 1));
  await rest.close();
});

test('transport: an idle connection is dropped after readTimeoutMs and the server keeps serving', async () => {
  const { rest } = startSuiteServer({ readTimeoutMs: 100 });
  const idle = net.connect({ port: rest.port, host: '127.0.0.1' });
  const dropped = new Promise((resolve) => idle.on('close', resolve));
  idle.write('GET /hea');
  await dropped;
  const r = parseResponse(await exchange(rest.port, Buffer.from('GET /health HTTP/1.1\r\nHost: x\r\n\r\n')));
  assert.equal(r.status, 200);
  await rest.close();
});

test('transport: handler errors reach onHandlerError with the entry name and never the client', async () => {
  const seen = [];
  const { rest } = startSuiteServer({ onHandlerError: (entry, text) => seen.push([entry, text]) });
  const r = parseResponse(await exchange(rest.port, Buffer.from('GET /boom HTTP/1.1\r\nHost: x\r\n\r\n')));
  assert.equal(r.status, 500);
  assert.equal(r.body.toString(), '{"error":"internal error"}');
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0], 'boom');
  assert.match(seen[0][1], /division by zero|zero/i);
  await rest.close();
});

test('transport: close() while idle and while a request is in flight both terminate cleanly', async () => {
  const { rest } = startSuiteServer();
  await rest.close();
  assert.equal(rest.port, 0);
  const second = startSuiteServer();
  const pending = exchange(second.rest.port, Buffer.from('GET /health HTTP/1.1\r\nHost: x\r\n\r\n')).catch(() => 'reset');
  await second.rest.close();
  await pending; // either a normal response or a reset: closing must never hang
});
