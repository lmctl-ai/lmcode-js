// A small HTTP/1.1 subset (spec/std-rest.md §"HTTP subset"): request parsing and response encoding.
// Bytes travel as latin1 strings so lmcode byte strings round-trip untouched.
export const MAX_HEADER_BYTES = 16 * 1024;
const REASONS = { 200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 408: 'Request Timeout', 409: 'Conflict', 413: 'Payload Too Large', 415: 'Unsupported Media Type', 422: 'Unprocessable Entity', 429: 'Too Many Requests', 431: 'Request Header Fields Too Large', 500: 'Internal Server Error', 501: 'Not Implemented', 502: 'Bad Gateway', 503: 'Service Unavailable' };
export const reasonPhrase = (status) => REASONS[status] ?? (status < 300 ? 'OK' : status < 400 ? 'Redirect' : status < 500 ? 'Client Error' : 'Server Error');

export const ERRORS = {
  400: '{"error":"bad request"}', 404: '{"error":"not found"}', 405: '{"error":"method not allowed"}',
  413: '{"error":"payload too large"}', 431: '{"error":"request header too large"}',
  500: '{"error":"internal error"}', 501: '{"error":"not implemented"}',
};
export const errorResponse = (status, extra = []) => ({
  status, headers: [['Content-Type', 'application/json'], ...extra], body: Buffer.from(ERRORS[status], 'latin1'),
});

/**
 * Parse the header section (a latin1 string without the terminating blank line).
 * → { method, target, headers: [[name, value]] } or { error: status }.
 */
export function parseHead(text) {
  const lines = text.split('\r\n');
  const request = /^([A-Z]+) (\S+) HTTP\/1\.[01]$/.exec(lines[0]);
  if (!request) return { error: 400 };
  const [, method, target] = request;
  if (!target.startsWith('/') || target.includes('#')) return { error: 400 };
  const headers = [];
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(':');
    if (colon <= 0 || /[\s]/.test(line.slice(0, colon)) || /[\x00-\x08\x0a-\x1f\x7f]/.test(line)) return { error: 400 };
    headers.push([line.slice(0, colon), line.slice(colon + 1).trim()]);
  }
  return { method, target, headers };
}

/** Content-Length (or 0), or { error }. Transfer-Encoding is unsupported (501). */
export function bodyLength(headers) {
  if (headers.some(([n]) => n.toLowerCase() === 'transfer-encoding')) return { error: 501 };
  const values = headers.filter(([n]) => n.toLowerCase() === 'content-length').map(([, v]) => v);
  if (!values.length) return { length: 0 };
  if (values.length > 1 && new Set(values).size > 1) return { error: 400 };
  if (!/^\d{1,15}$/.test(values[0])) return { error: 400 };
  return { length: Number(values[0]) };
}

export function encodeResponse({ status, headers, body }, { head = false } = {}) {
  const lines = [`HTTP/1.1 ${status} ${reasonPhrase(status)}`];
  for (const [name, value] of headers) lines.push(`${name}: ${value}`);
  lines.push(`Content-Length: ${body.length}`, 'Connection: close', '', '');
  return head ? Buffer.from(lines.join('\r\n'), 'latin1') : Buffer.concat([Buffer.from(lines.join('\r\n'), 'latin1'), body]);
}
