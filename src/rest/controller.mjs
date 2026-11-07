// The `rest` std module for lmcode-js: registration, the transport-independent dispatcher and the stdio pump.
import { LmcodeError } from '../core/errors.mjs';
import { VmObject, VOID } from '../core/values.mjs';
import { RouteTable, percentDecode } from './router.mjs';
import { encodeResponse, errorResponse, takeRequest } from './http.mjs';

export const HANDLER_INTERFACE = 'interface RestHandler(RestExchange) -> void';
const RESERVED = new Set(['content-length', 'connection', 'transfer-encoding']);
const host = (message) => new LmcodeError('RUN_HOST', message);
const latin1 = (value) => Buffer.from(value, 'latin1');

class Exchange {
  constructor(controller, request, params, query, path) {
    this.state = controller.state;
    this.request = request; this.params = params; this.query = query; this.path = path;
    this.status = 200; this.headers = new Map(); this.body = ''; this.json = false;
  }
  requestHeader(name) {
    const wanted = name.toLowerCase();
    return this.request.headers.filter(([n]) => n.toLowerCase() === wanted).map(([, v]) => v);
  }
}

export class RestController {
  constructor(registry, options = {}) {
    this.registry = registry;
    this.input = options.input ?? process.stdin;
    this.output = options.output ?? process.stdout;
    this.maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;
    this.onHandlerError = options.onHandlerError ?? ((entry, message) => process.stderr.write(`rest: handler ${entry} failed: ${message}\n`));
    this.state = { values: new Map(), counts: new Map() };
    this.table = new RouteTable();
    this.program = null; this.context = {}; this.entryIndex = new Map();
    this.serving = false; this.stopped = false;
  }

  /**
   * Binds `program`, runs its body, then (if the body called rest_serve and not rest_stop) serves the input stream
   * until EOF, rest_stop() or a framing error. Resolves with the body's result.
   */
  async run(program, context = {}) {
    this.program = program; this.context = context; this.stopped = false;
    const result = program.run(context);
    if (this.serving && !this.stopped) await this.#pump();
    return result;
  }

  // ---- lmcode-facing operations -------------------------------------------------------------------------
  route(method, path, annotation) {
    if (this.serving) throw host('rest: routes are frozen once rest_serve has been called');
    this.table.add(method, path, annotation);
  }

  serve() {
    if (this.serving) throw host('rest: rest_serve already called');
    if (!this.program) throw host('rest: no program is bound (run the program through the controller)');
    this.#bind();
    this.serving = true;
  }

  /** Ends serving once the current response is written. */
  stop() { this.stopped = true; }

  #bind() {
    if (!this.table.size) throw host('rest: no routes registered');
    this.entryIndex = new Map();
    this.program.entries.forEach((entry, index) => {
      if (entry.iface !== HANDLER_INTERFACE) return;
      if (this.entryIndex.has(entry.annotation)) throw host(`rest: duplicate annotation @${entry.annotation}`);
      this.entryIndex.set(entry.annotation, { index, name: entry.name });
    });
    for (const route of this.table.routes) {
      if (this.entryIndex.has(route.annotation)) continue;
      const wrong = this.program.entries.find((e) => e.annotation === route.annotation);
      if (wrong) throw host(`rest: entry ${wrong.name} must implement RestHandler(RestExchange) -> void`);
      throw host(`rest: route ${route.method} ${route.path} references missing annotation @${route.annotation}`);
    }
  }

  // ---- the transport-independent core -------------------------------------------------------------------
  /** request: { method, target, headers: [[name, value]], body: Buffer } → { status, headers: [[n, v]], body: Buffer } */
  dispatch(request) {
    const mark = request.target.indexOf('?');
    const rawPath = mark < 0 ? request.target : request.target.slice(0, mark);
    const queryText = mark < 0 ? '' : request.target.slice(mark + 1);
    const path = percentDecode(rawPath);
    const query = new Map();
    if (path === null) return errorResponse(400);
    if (queryText) {
      for (const pair of queryText.split('&')) {
        if (pair === '') continue;
        const eq = pair.indexOf('=');
        const key = percentDecode(eq < 0 ? pair : pair.slice(0, eq), true);
        const value = percentDecode(eq < 0 ? '' : pair.slice(eq + 1), true);
        if (key === null || value === null) return errorResponse(400);
        if (!query.has(key)) query.set(key, value);
      }
    }
    const match = this.table.match(request.method, rawPath);
    if (match.status === 404) return errorResponse(404);
    if (match.status === 405) return errorResponse(405, [['Allow', match.allow]]);
    const target = this.entryIndex.get(match.route.annotation);
    const exchange = new Exchange(this, { ...request, body: request.body.toString('latin1') }, match.params, query, path);
    try {
      this.program.call(target.index, this.context, [new VmObject('RestExchange', exchange)]);
    } catch (error) {
      this.onHandlerError(target.name, error instanceof Error ? error.message : String(error));
      return errorResponse(500);
    }
    return this.#response(exchange);
  }

  #response(x) {
    const headers = [...x.headers.values()];
    let body = latin1(x.body);
    if (x.status === 204 || x.status === 304) body = Buffer.alloc(0);
    else if (body.length && !x.headers.has('content-type')) headers.unshift(['Content-Type', 'text/plain; charset=utf-8']);
    return { status: x.status, headers, body };
  }

  async #pump() {
    let buffer = Buffer.alloc(0);
    const write = async (response, head) => {
      if (!this.output.write(encodeResponse(response, { head }))) await new Promise((resolve) => this.output.once('drain', resolve));
    };
    for await (const chunk of this.input) {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const taken = takeRequest(buffer, this.maxBodyBytes);
        if (taken.need) break;
        if (taken.fatal) { await write(errorResponse(taken.fatal), false); return; }
        buffer = taken.rest;
        await write(this.dispatch(taken.request), taken.request.method === 'HEAD');
        if (this.stopped) return;
      }
    }
  }
}

// ---- registration -------------------------------------------------------------------------------------------
const exchangeOf = (x) => { if (!x) throw host('invalid exchange'); return x; };

/** Registers the 18 `rest` signatures in `registry` and returns the controller that owns the server. */
export function registerRest(registry, options = {}) {
  const controller = new RestController(registry, options);
  const raw = { internal: true };
  const fn = (signature, callback) => registry.fn(signature, callback, raw);
  const method = (signature, callback) => registry.method(signature, (x, ...args) => callback(exchangeOf(x), ...args), raw);

  fn('fn rest_route(string, string, string) -> void', (m, p, a) => { controller.route(m, p, a); });
  fn('fn rest_serve() -> void', () => { controller.serve(); });
  fn('fn rest_stop() -> void', () => { controller.stop(); });

  method('method RestExchange.method() -> string', (x) => x.request.method);
  method('method RestExchange.path() -> string', (x) => x.path);
  method('method RestExchange.query(string) -> string', (x, key) => x.query.get(key) ?? '');
  method('method RestExchange.has_query(string) -> bool', (x, key) => x.query.has(key));
  method('method RestExchange.param(string) -> string', (x, name) => x.params[name] ?? '');
  method('method RestExchange.header(string) -> string', (x, name) => x.requestHeader(name).join(', '));
  method('method RestExchange.has_header(string) -> bool', (x, name) => x.requestHeader(name).length > 0);
  method('method RestExchange.body() -> string', (x) => x.request.body);
  method('method RestExchange.status(int) -> void', (x, code) => {
    if (code < 200n || code > 599n) throw host(`rest: status ${code} out of range 200..599`);
    x.status = Number(code);
  });
  method('method RestExchange.set_header(string, string) -> void', (x, name, value) => {
    if (name === '' || /[\x00-\x20\x7f:]/.test(name) || /[\r\n]/.test(value)) throw host('rest: invalid response header');
    if (RESERVED.has(name.toLowerCase())) throw host(`rest: response header ${name} is managed by the server`);
    x.headers.set(name.toLowerCase(), [name, value]);
  });
  method('method RestExchange.send(string) -> void', (x, body) => { x.body = body; });
  method('method RestExchange.json(string) -> void', (x, body) => { x.body = body; x.headers.set('content-type', ['Content-Type', 'application/json']); });
  method('method RestExchange.get(string) -> string', (x, key) => x.state.values.get(key) ?? '');
  method('method RestExchange.set(string, string) -> void', (x, key, value) => { x.state.values.set(key, value); });
  method('method RestExchange.increment(string) -> int', (x, key) => {
    const next = (x.state.counts.get(key) ?? 0n) + 1n; x.state.counts.set(key, next); return next;
  });
  return controller;
}

export { VOID };
