// TCP transport thread. It owns the listener and the HTTP framing; the VM thread owns the handlers.
// Protocol over the MessagePort:  main → {type:'listen', host, port, maxBodyBytes, readTimeoutMs} | {type:'response', id, bytes}
//                                 | {type:'stop'}      worker → {type:'listening', port} | {type:'failed', message}
//                                 | {type:'request', id, request} | {type:'closed'}
import net from 'node:net';
import { parentPort, workerData } from 'node:worker_threads';
import { MAX_HEADER_BYTES, bodyLength, encodeResponse, errorResponse, parseHead } from './http.mjs';

const { control, shared } = workerData; // control: MessagePort the VM thread blocks on during listen; shared: Int32Array
const sockets = new Set(); const pending = new Map(); let nextId = 1; let server = null; let options = null;

function connection(socket) {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
  socket.on('error', () => {});
  socket.setTimeout(options.readTimeoutMs, () => socket.destroy());
  let buffer = Buffer.alloc(0); let head = null; let length = 0; let finished = false;
  const reply = (bytes) => { finished = true; socket.end(bytes); socket.removeAllListeners('data'); socket.resume(); };
  socket.on('data', (chunk) => {
    if (finished) return;
    buffer = Buffer.concat([buffer, chunk]);
    if (!head) {
      const end = buffer.indexOf('\r\n\r\n', 0, 'latin1');
      if (end < 0 || end > MAX_HEADER_BYTES) {
        if (buffer.length > MAX_HEADER_BYTES) reply(encodeResponse(errorResponse(431)));
        return;
      }
      const parsed = parseHead(buffer.subarray(0, end).toString('latin1'));
      if (parsed.error) return reply(encodeResponse(errorResponse(parsed.error)));
      const size = bodyLength(parsed.headers);
      if (size.error) return reply(encodeResponse(errorResponse(size.error)));
      if (size.length > options.maxBodyBytes) return reply(encodeResponse(errorResponse(413)));
      head = parsed; length = size.length; buffer = buffer.subarray(end + 4);
    }
    if (buffer.length < length) return;
    finished = true; socket.removeAllListeners('data');
    const id = nextId++;
    pending.set(id, socket);
    parentPort.postMessage({ type: 'request', id, request: { method: head.method, target: head.target, headers: head.headers, body: Uint8Array.from(buffer.subarray(0, length)) } });
  });
}

function answer(message) { // reply on `control` so the blocked VM thread can read it with receiveMessageOnPort
  control.postMessage(message);
  Atomics.store(shared, 0, 1);
  Atomics.notify(shared, 0);
}

parentPort.on('message', (message) => {
  if (message.type === 'listen') {
    options = message;
    server = net.createServer(connection);
    server.once('error', (error) => answer({ type: 'failed', message: error.code ? `${error.code}: ${error.message}` : error.message }));
    server.listen({ port: message.port, host: message.host }, () => answer({ type: 'listening', port: server.address().port }));
  } else if (message.type === 'response') {
    const socket = pending.get(message.id);
    pending.delete(message.id);
    if (socket && !socket.destroyed) { socket.end(Buffer.from(message.bytes)); socket.resume(); }
  } else if (message.type === 'stop') {
    const done = () => { parentPort.postMessage({ type: 'closed' }); process.exit(0); };
    if (!server) return done();
    server.close(done);
    // In-flight exchanges finish; idle or stalled connections are dropped after the response window.
    setTimeout(() => { for (const socket of sockets) socket.destroy(); }, message.graceMs ?? 250).unref();
  }
});
