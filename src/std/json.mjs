import { LmcodeError } from '../core/errors.mjs';
import { makeHandle } from './collections.mjs';
import { renderTemplate } from './template.mjs';

const MAX_DEPTH = 256;
const host = (message) => { throw new LmcodeError('RUN_HOST', message); };
const fail = (reason, at) => host(`json_parse: ${reason} at byte ${at}`);

function validUtf8(s) {
  const b = Buffer.from(s, 'latin1');
  for (let i = 0; i < b.length;) {
    const c = b[i];
    if (c < 0x80) { i++; continue; }
    let n = 0;
    if (c >= 0xc2 && c <= 0xdf) n = 1;
    else if (c >= 0xe0 && c <= 0xef) n = 2;
    else if (c >= 0xf0 && c <= 0xf4) n = 3;
    else return i;
    if (i + n >= b.length) return i;
    const b1 = b[i + 1];
    if (b1 < 0x80 || b1 > 0xbf || (c === 0xe0 && b1 < 0xa0) || (c === 0xed && b1 > 0x9f) || (c === 0xf0 && b1 < 0x90) || (c === 0xf4 && b1 > 0x8f)) return i;
    for (let j = 2; j <= n; j++) if (b[i + j] < 0x80 || b[i + j] > 0xbf) return i;
    i += n + 1;
  }
  return -1;
}

class JsonParser {
  constructor(source) { this.source = source; this.pos = 0; }
  whitespace() { while (this.pos < this.source.length && /[\x20\x09\x0a\x0d]/.test(this.source[this.pos])) this.pos++; }
  take(ch) { if (this.source[this.pos] !== ch) return false; this.pos++; return true; }
  literal(word) {
    if (!this.source.startsWith(word, this.pos)) fail('invalid literal', this.pos);
    this.pos += word.length;
  }
  hex4(at) {
    const text = this.source.slice(at, at + 4);
    if (text.length < 4) fail('invalid Unicode escape', at + text.length);
    for (let i = 0; i < 4; i++) if (!/[0-9a-fA-F]/.test(text[i])) fail('invalid Unicode escape', at + i);
    return Number.parseInt(text, 16);
  }
  string() {
    const start = this.pos;
    if (!this.take('"')) fail('expected string', this.pos);
    let out = ''; let rawStart = this.pos;
    const flush = (end) => { if (end > rawStart) out += Buffer.from(this.source.slice(rawStart, end), 'latin1').toString('utf8'); };
    while (this.pos < this.source.length) {
      const c = this.source.charCodeAt(this.pos++);
      if (c === 0x22) { flush(this.pos - 1); return { value: out, raw: this.source.slice(start, this.pos) }; }
      if (c < 0x20) fail('control byte in string', this.pos - 1);
      if (c !== 0x5c) continue;
      flush(this.pos - 1);
      if (this.pos >= this.source.length) fail('unterminated escape', this.pos);
      const esc = this.source[this.pos++];
      if (esc === '"' || esc === '\\' || esc === '/') out += esc;
      else if (esc === 'b') out += '\b';
      else if (esc === 'f') out += '\f';
      else if (esc === 'n') out += '\n';
      else if (esc === 'r') out += '\r';
      else if (esc === 't') out += '\t';
      else if (esc === 'u') {
        if (this.pos + 4 > this.source.length) fail('invalid Unicode escape', this.pos);
        let cp = this.hex4(this.pos); this.pos += 4;
        if (cp >= 0xd800 && cp <= 0xdbff) {
          if (this.source.slice(this.pos, this.pos + 2) !== '\\u' || this.pos + 6 > this.source.length) fail('unpaired high surrogate', this.pos);
          const low = this.hex4(this.pos + 2);
          if (low < 0xdc00 || low > 0xdfff) fail('unpaired high surrogate', this.pos);
          this.pos += 6; cp = 0x10000 + ((cp - 0xd800) << 10) + low - 0xdc00;
        } else if (cp >= 0xdc00 && cp <= 0xdfff) fail('unpaired low surrogate', this.pos - 4);
        out += String.fromCodePoint(cp);
      } else fail('invalid escape', this.pos - 1);
      rawStart = this.pos;
    }
    fail('unterminated string', this.pos);
  }
  number() {
    const start = this.pos;
    if (this.source[this.pos] === '-') this.pos++;
    if (this.pos >= this.source.length || !/[0-9]/.test(this.source[this.pos])) fail('invalid number', this.pos);
    if (this.source[this.pos] === '0') this.pos++;
    else while (/[0-9]/.test(this.source[this.pos] ?? '')) this.pos++;
    let isFloat = false;
    if (this.source[this.pos] === '.') {
      isFloat = true; this.pos++;
      if (!/[0-9]/.test(this.source[this.pos] ?? '')) fail('invalid number', this.pos);
      while (/[0-9]/.test(this.source[this.pos] ?? '')) this.pos++;
    }
    if (this.source[this.pos] === 'e' || this.source[this.pos] === 'E') {
      isFloat = true; this.pos++;
      if (this.source[this.pos] === '+' || this.source[this.pos] === '-') this.pos++;
      if (!/[0-9]/.test(this.source[this.pos] ?? '')) fail('invalid number', this.pos);
      while (/[0-9]/.test(this.source[this.pos] ?? '')) this.pos++;
    }
    const raw = this.source.slice(start, this.pos);
    if (!isFloat) {
      const value = BigInt(raw);
      if (value < -(1n << 63n) || value > (1n << 63n) - 1n) fail('integer out of range', start);
      return { kind: 'int', value, raw };
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) fail('nonfinite number', start);
    return { kind: 'float', value, raw };
  }
  value(depth = 0) {
    this.whitespace();
    if (this.pos >= this.source.length) fail('expected value', this.pos);
    const start = this.pos; const c = this.source[this.pos];
    if (c === 'n') { this.literal('null'); return { kind: 'null', raw: 'null' }; }
    if (c === 't') { this.literal('true'); return { kind: 'bool', value: true, raw: 'true' }; }
    if (c === 'f') { this.literal('false'); return { kind: 'bool', value: false, raw: 'false' }; }
    if (c === '"') { const s = this.string(); return { kind: 'string', value: s.value, raw: s.raw }; }
    if (c === '[' || c === '{') {
      if (depth + 1 > MAX_DEPTH) fail('maximum depth exceeded', this.pos);
      this.pos++;
      if (c === '[') {
        const items = []; this.whitespace();
        if (this.take(']')) return { kind: 'array', items };
        while (true) {
          items.push(this.value(depth + 1)); this.whitespace();
          if (this.take(']')) break;
          if (!this.take(',')) fail('expected comma', this.pos);
        }
        return { kind: 'array', items };
      }
      const members = []; const seen = new Set(); this.whitespace();
      if (this.take('}')) return { kind: 'object', members };
      while (true) {
        this.whitespace(); const keyAt = this.pos;
        if (this.source[this.pos] !== '"') fail('object key must be a string', this.pos);
        const key = this.string();
        if (seen.has(key.value)) fail('duplicate object key', keyAt);
        seen.add(key.value); this.whitespace();
        if (!this.take(':')) fail('expected colon', this.pos);
        const value = this.value(depth + 1);
        members.push({ key: key.value, rawKey: key.raw, value });
        this.whitespace(); if (this.take('}')) break;
        if (!this.take(',')) fail('expected comma', this.pos);
      }
      return { kind: 'object', members };
    }
    if (c === '-' || /[0-9]/.test(c)) return this.number();
    fail('unexpected value', start);
  }
}

export function parseJsonBytes(source) {
  const bad = validUtf8(source);
  if (bad >= 0) fail('invalid UTF-8', bad);
  if (source.startsWith('\xef\xbb\xbf')) fail('BOM is not allowed', 0);
  const parser = new JsonParser(source); const value = parser.value(); parser.whitespace();
  if (parser.pos !== source.length) fail('trailing input', parser.pos);
  return value;
}

export function jsonString(node) {
  if (node.kind === 'null') return 'null';
  if (node.kind === 'bool' || node.kind === 'int' || node.kind === 'float' || node.kind === 'string') return node.raw;
  if (node.kind === 'array') return `[${node.items.map(jsonString).join(',')}]`;
  return `{${node.members.map((m) => `${m.rawKey}:${jsonString(m.value)}`).join(',')}}`;
}

function live(reg, self, method) {
  if (!self?.__lmcodeJson || self.generation !== reg.runGeneration || !reg.runActive) host(`Json.${method}: handle is not active in this run`);
  return self.data;
}
function childHandle(reg, value) { return { __lmcodeJson: true, type: 'Json', generation: reg.runGeneration, data: value }; }

export function registerJson(reg) {
  const parse = (text) => childHandle(reg, parseJsonBytes(text));
  const render = (source, context) => renderTemplate(source, context);
  reg.fn('fn json_parse(string) -> Json', parse, { internal: true, dry: parse });
  reg.fn('fn template_render(string, Json) -> string', render, { internal: true, dry: render });
  const method = (signature, callback) => reg.method(signature, callback, { internal: true, dry: callback });
  method('method Json.kind() -> string', (self) => live(reg, self, 'kind').kind);
  method('method Json.len() -> int', (self) => {
    const n = live(reg, self, 'len');
    if (n.kind === 'array') return BigInt(n.items.length);
    if (n.kind === 'object') return BigInt(n.members.length);
    host('Json.len: expected array or object');
  });
  method('method Json.at(int) -> Json', (self, index) => {
    const n = live(reg, self, 'at');
    if (n.kind !== 'array') host('Json.at: expected array');
    if (index < 0n || index >= BigInt(n.items.length)) host(`Json.at: index out of range: ${index}`);
    return childHandle(reg, n.items[Number(index)]);
  });
  method('method Json.get(string) -> Json', (self, key) => {
    const n = live(reg, self, 'get'); if (n.kind !== 'object') host('Json.get: expected object');
    const item = n.members.find((m) => Buffer.from(m.key, 'utf8').toString('latin1') === key); if (!item) host('Json.get: missing key');
    return childHandle(reg, item.value);
  });
  method('method Json.has(string) -> bool', (self, key) => {
    const n = live(reg, self, 'has'); if (n.kind !== 'object') host('Json.has: expected object');
    return n.members.some((m) => Buffer.from(m.key, 'utf8').toString('latin1') === key);
  });
  method('method Json.keys() -> StrList', (self) => {
    const n = live(reg, self, 'keys'); if (n.kind !== 'object') host('Json.keys: expected object');
    const list = makeHandle(reg, 'StrList'); list.data.values = n.members.map((m) => Buffer.from(m.key, 'utf8').toString('latin1')); return list;
  });
  method('method Json.as_string() -> string', (self) => { const n=live(reg,self,'as_string'); if(n.kind!=='string')host('Json.as_string: expected string'); return Buffer.from(n.value, 'utf8').toString('latin1'); });
  method('method Json.as_int() -> int', (self) => { const n=live(reg,self,'as_int'); if(n.kind!=='int')host('Json.as_int: expected int'); return n.value; });
  method('method Json.as_float() -> float', (self) => { const n=live(reg,self,'as_float'); if(n.kind==='float')return n.value;if(n.kind==='int')return Number(n.value);host('Json.as_float: expected number'); });
  method('method Json.as_bool() -> bool', (self) => { const n=live(reg,self,'as_bool'); if(n.kind!=='bool')host('Json.as_bool: expected bool'); return n.value; });
  method('method Json.to_json() -> string', (self) => jsonString(live(reg, self, 'to_json')));
}
