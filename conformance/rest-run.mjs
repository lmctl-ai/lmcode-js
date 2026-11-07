// Replays conformance/rest-suite/scenarios.json (groups: stream, fatal, silent) against the rest controller,
// through in-memory streams and through a real child process (stdin/stdout). No network is involved.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { Program } from '../src/core/program.mjs';
import { createRegistry } from '../src/std/index.mjs';
import { registerRest } from '../src/rest/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'conformance', 'rest-suite');
export const suite = JSON.parse(readFileSync(path.join(dir, 'scenarios.json'), 'utf8'));
const GOOD = Buffer.from('GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n');

export function requestBytes(s) {
  if (s.raw !== undefined) return Buffer.from(s.raw, 'latin1');
  const body = Buffer.from(s.body_repeat ? s.body_repeat.text.repeat(s.body_repeat.count) : s.body ?? '', 'utf8');
  const lines = [`${s.method} ${s.target} HTTP/1.1`, 'Host: localhost'];
  for (const [name, value] of Object.entries(s.headers ?? {})) lines.push(`${name}: ${value}`);
  if (body.length || ['POST', 'PUT', 'PATCH'].includes(s.method)) lines.push(`Content-Length: ${body.length}`);
  return Buffer.concat([Buffer.from(lines.join('\r\n') + '\r\n\r\n', 'latin1'), body]);
}

/** Parse every response in `buffer`; `methods[i]` is the request method of response i (HEAD responses carry no body bytes). */
export function parseResponses(buffer, methods) {
  const out = []; let pos = 0;
  while (pos < buffer.length) {
    const end = buffer.indexOf('\r\n\r\n', pos);
    if (end < 0) throw new Error(`incomplete response head: ${JSON.stringify(buffer.subarray(pos).toString('latin1'))}`);
    const lines = buffer.subarray(pos, end).toString('latin1').split('\r\n');
    const status = Number(/^HTTP\/1\.1 (\d{3}) /.exec(lines[0])?.[1]);
    const headers = {};
    for (const line of lines.slice(1)) { const i = line.indexOf(':'); headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim(); }
    const length = Number(headers['content-length']);
    const head = methods[out.length] === 'HEAD';
    const start = end + 4;
    out.push({ status, headers, body: buffer.subarray(start, head ? start : start + length), length });
    pos = head ? start : start + length;
  }
  return out;
}

function check(assert, label, r, expect) {
  assert.equal(r.status, expect.status, `${label}: status`);
  for (const [name, want] of Object.entries(expect.headers ?? {})) {
    if (want === null) assert.equal(r.headers[name], undefined, `${label}: header ${name} must be absent`);
    else assert.equal(r.headers[name], want, `${label}: header ${name}`);
  }
  assert.equal(r.headers.connection, undefined, `${label}: no Connection header`);
  assert.ok(Number.isInteger(r.length), `${label}: Content-Length present`);
  if (expect.body !== undefined) assert.equal(r.body.toString('utf8'), expect.body, `${label}: body`);
}

/** `serve(inputBuffer) → Promise<Buffer>` runs one fresh controller over the input and returns everything it wrote. */
export async function replay(serve, assert) {
  let count = 0;
  const answered = suite.stream.filter((s) => !s.unanswered);
  const out = await serve(Buffer.concat(suite.stream.map(requestBytes)));
  const responses = parseResponses(out, answered.map((s) => s.method));
  assert.equal(responses.length, answered.length, 'stream: exactly one response per answered request, none after rest_stop()');
  answered.forEach((s, i) => { check(assert, `${s.name} (${s.method} ${s.target ?? ''})`, responses[i], s.expect); count++; });
  for (const s of suite.fatal) {
    const r = parseResponses(await serve(Buffer.concat([requestBytes(s), GOOD])), [s.method]);
    assert.equal(r.length, 1, `${s.name}: one error response, then the end`);
    check(assert, s.name, r[0], s.expect); count++;
  }
  for (const s of suite.silent) { assert.equal((await serve(requestBytes(s))).length, 0, `${s.name}: no output`); count++; }
  return count;
}

export function newController(options = {}) {
  const registry = createRegistry();
  const rest = registerRest(registry, { maxBodyBytes: suite.options.max_body_bytes, onHandlerError: () => {}, ...options });
  const program = Program.load(readFileSync(path.join(dir, 'app.dslb')), readFileSync(path.join(dir, 'host.schema.json')), registry);
  return { registry, rest, program };
}

/** In-memory serve: the controller reads a PassThrough and writes a PassThrough. */
export async function serveInMemory(input, options = {}) {
  const inStream = new PassThrough(); const outStream = new PassThrough();
  const chunks = []; outStream.on('data', (c) => chunks.push(c));
  const { rest, program } = newController({ input: inStream, output: outStream, ...options });
  inStream.end(input);
  await rest.run(program);
  outStream.end();
  return Buffer.concat(chunks);
}

/** Process-level serve: spawn sample/rest-serve.mjs and talk to it over real pipes. */
export function serveProcess(input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'sample', 'rest-serve.mjs'), path.join(dir, 'app.dslb'), path.join(dir, 'host.schema.json'), '--max-body-bytes', String(suite.options.max_body_bytes)], { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = []; child.stdout.on('data', (c) => chunks.push(c));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`rest-serve exited ${code}`))));
    child.stdin.on('error', () => {}); // the server may stop reading (rest_stop, framing errors) before all input is written
    child.stdin.end(input);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const assert = (await import('node:assert/strict')).default;
  const a = await replay((i) => serveInMemory(i), assert);
  const b = await replay(serveProcess, assert);
  console.log(`rest conformance: ${a}/${a} in-memory, ${b}/${b} via child process stdin/stdout`);
}
