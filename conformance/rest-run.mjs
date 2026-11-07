// Replays conformance/rest-suite/scenarios.json against a live rest controller over raw TCP.
// Exported for test/rest-suite.test.mjs; `node conformance/rest-run.mjs` runs it standalone.
import net from 'node:net';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Program } from '../src/core/program.mjs';
import { createRegistry } from '../src/std/index.mjs';
import { registerRest } from '../src/rest/index.mjs';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'rest-suite');
export const suite = JSON.parse(readFileSync(path.join(dir, 'scenarios.json'), 'utf8'));

export function startSuiteServer(options = {}) {
  const registry = createRegistry();
  const rest = registerRest(registry, { maxBodyBytes: suite.options.max_body_bytes, onHandlerError: () => {}, ...options });
  const program = Program.load(readFileSync(path.join(dir, 'app.dslb')), readFileSync(path.join(dir, 'host.schema.json')), registry);
  rest.run(program);
  return { registry, rest, program };
}

export function requestBytes(s) {
  if (s.raw !== undefined) return Buffer.from(s.raw, 'latin1');
  const body = Buffer.from(s.body_repeat ? s.body_repeat.text.repeat(s.body_repeat.count) : s.body ?? '', 'utf8');
  const lines = [`${s.method} ${s.target} HTTP/1.1`, 'Host: localhost', 'Connection: close'];
  for (const [name, value] of Object.entries(s.headers ?? {})) lines.push(`${name}: ${value}`);
  if (body.length || ['POST', 'PUT', 'PATCH'].includes(s.method)) lines.push(`Content-Length: ${body.length}`);
  return Buffer.concat([Buffer.from(lines.join('\r\n') + '\r\n\r\n', 'latin1'), body]);
}

export function exchange(port, bytes) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const chunks = [];
    socket.on('data', (c) => chunks.push(c));
    socket.on('error', reject);
    socket.on('close', () => resolve(Buffer.concat(chunks)));
    socket.write(bytes);
  });
}

export function parseResponse(buffer) {
  const end = buffer.indexOf('\r\n\r\n');
  if (end < 0) throw new Error(`incomplete response: ${JSON.stringify(buffer.toString('latin1'))}`);
  const lines = buffer.subarray(0, end).toString('latin1').split('\r\n');
  const status = Number(/^HTTP\/1\.1 (\d{3}) /.exec(lines[0])?.[1]);
  const headers = {};
  for (const line of lines.slice(1)) { const i = line.indexOf(':'); headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim(); }
  return { status, headers, body: buffer.subarray(end + 4) };
}

/** Throws on the first mismatch; returns the number of scenarios replayed. */
export async function replay(port, assert) {
  for (const s of suite.scenarios) {
    const r = parseResponse(await exchange(port, requestBytes(s)));
    const label = `${s.name} (${s.method} ${s.target})`;
    assert.equal(r.status, s.expect.status, `${label}: status`);
    for (const [name, want] of Object.entries(s.expect.headers ?? {})) {
      if (want === null) assert.equal(r.headers[name], undefined, `${label}: header ${name} must be absent`);
      else assert.equal(r.headers[name], want, `${label}: header ${name}`);
    }
    assert.equal(r.headers.connection, 'close', `${label}: connection`);
    if (s.method !== 'HEAD') assert.equal(Number(r.headers['content-length']), r.body.length, `${label}: content-length`);
    if (s.expect.body !== undefined) assert.equal(r.body.toString('utf8'), s.expect.body.replace('$PORT', String(port)), `${label}: body`);
  }
  return suite.scenarios.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const assert = (await import('node:assert/strict')).default;
  const { rest } = startSuiteServer();
  const port = rest.port;
  const count = await replay(port, assert);
  await rest.closed;
  await new Promise((resolve, reject) => net.connect({ port, host: '127.0.0.1' }).on('error', (e) => (e.code === 'ECONNREFUSED' ? resolve() : reject(e))).on('connect', () => reject(new Error('server still accepting after rest_stop()'))));
  console.log(`rest conformance: ${count}/${count} scenarios passed`);
}
