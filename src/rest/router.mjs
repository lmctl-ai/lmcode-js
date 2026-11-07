// Route templates and matching for the `rest` std module (spec/std-rest.md §"Route templates").
// All strings are lmcode byte strings: JavaScript strings whose code units are bytes (latin1).
import { LmcodeError } from '../core/errors.mjs';

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const fail = (message) => { throw new LmcodeError('RUN_HOST', message); };

/** Percent-decode a byte string. Returns null on an invalid escape. `plus` turns '+' into a space (queries). */
export function percentDecode(text, plus = false) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '%') {
      const hex = text.slice(i + 1, i + 3);
      if (!/^[0-9A-Fa-f]{2}$/.test(hex)) return null;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 2;
    } else if (plus && c === '+') out += ' ';
    else out += c;
  }
  return out;
}

export function parseRoute(method, path) {
  const label = `${method} ${path}`;
  const invalid = (reason) => fail(`rest: invalid route ${label}: ${reason}`);
  if (!METHODS.includes(method)) invalid('method must be one of ' + METHODS.join(', '));
  if (!path.startsWith('/')) invalid("path must start with '/'");
  if (/[\x00-\x20\x7f?#]/.test(path)) invalid('path must not contain whitespace, control characters, ? or #');
  const raw = path.slice(1).split('/');
  const names = new Set();
  const segments = raw.map((text, index) => {
    const last = index === raw.length - 1;
    if (text === '' && !last) invalid("empty segment ('//')");
    const placeholder = /^\{(.*?)(\.\.\.)?\}$/.exec(text);
    if (!placeholder) {
      if (/[{}]/.test(text)) invalid(`malformed placeholder in segment '${text}'`);
      return { kind: 'literal', value: text };
    }
    const [, name, rest] = placeholder;
    if (!NAME.test(name)) invalid(`invalid parameter name '${name}'`);
    if (names.has(name)) invalid(`duplicate parameter '${name}'`);
    names.add(name);
    if (rest && !last) invalid(`'{${name}...}' must be the last segment`);
    return { kind: rest ? 'rest' : 'param', name };
  });
  const shape = segments.map((s) => (s.kind === 'literal' ? `L${s.value}` : s.kind === 'param' ? 'P' : 'R')).join('/');
  return { method, path, segments, shape };
}

const RANK = { literal: 0, param: 1, rest: 2 };
/** Negative when route a is more specific than b (segment by segment, literal < {p} < {p...}). */
function compareSpecificity(a, b) {
  const n = Math.min(a.segments.length, b.segments.length);
  for (let i = 0; i < n; i++) {
    const d = RANK[a.segments[i].kind] - RANK[b.segments[i].kind];
    if (d !== 0) return d;
  }
  return a.segments.length - b.segments.length;
}

function matchSegments(route, rawSegments) {
  const params = {};
  const segs = route.segments;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.kind === 'rest') {
      if (rawSegments.length <= i) return null;
      const parts = [];
      for (const raw of rawSegments.slice(i)) { const d = percentDecode(raw); if (d === null) return null; parts.push(d); }
      params[s.name] = parts.join('/');
      return params;
    }
    if (i >= rawSegments.length) return null;
    const decoded = percentDecode(rawSegments[i]);
    if (decoded === null) return null;
    if (s.kind === 'literal') { if (decoded !== s.value) return null; }
    else { if (decoded === '') return null; params[s.name] = decoded; }
  }
  return rawSegments.length === segs.length ? params : null;
}

export class RouteTable {
  constructor() { this.routes = []; }
  get size() { return this.routes.length; }
  add(method, path, annotation) {
    const route = parseRoute(method, path);
    if (this.routes.some((r) => r.method === method && r.shape === route.shape)) fail(`rest: duplicate route ${method} ${path}`);
    route.annotation = annotation;
    this.routes.push(route);
    return route;
  }
  /** → { route, params } | { status: 404 } | { status: 405, allow } ; `rawPath` is the undecoded path without the query. */
  match(method, rawPath) {
    const rawSegments = rawPath.slice(1).split('/');
    const hits = [];
    for (const route of this.routes) {
      const params = matchSegments(route, rawSegments);
      if (params) hits.push({ route, params });
    }
    if (!hits.length) return { status: 404 };
    const best = (verb) => hits.filter((h) => h.route.method === verb).sort((a, b) => compareSpecificity(a.route, b.route))[0];
    const direct = best(method) ?? (method === 'HEAD' ? best('GET') : undefined);
    if (direct) return direct;
    const allow = new Set(hits.map((h) => h.route.method));
    if (allow.has('GET')) allow.add('HEAD');
    return { status: 405, allow: [...allow].sort().join(', ') };
  }
}
