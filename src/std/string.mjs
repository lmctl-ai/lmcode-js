import { constants as bufferConstants } from 'node:buffer';
import { LmcodeError } from '../core/errors.mjs';
import { wrapInt64, INT_MAX, INT_MIN } from '../core/values.mjs';

const host = (message) => new LmcodeError('RUN_HOST', message);
const bytes = (s) => Buffer.from(s, 'latin1');
const fromBytes = (b) => Buffer.from(b).toString('latin1');
const maxStringLength = BigInt(bufferConstants.MAX_STRING_LENGTH);

function parseInt64(text) {
  if (!/^[+-]?[0-9]+$/.test(text)) return null;
  try {
    const n = BigInt(text);
    return n < INT_MIN || n > INT_MAX ? null : n;
  } catch { return null; }
}
function parseFloat64(text) {
  const re = /^[+-]?(?:(?:[0-9]+(?:\.[0-9]*)?)|(?:\.[0-9]+))(?:[eE][+-]?[0-9]+)?$/;
  if (!re.test(text)) return null;
  let nonzero = false;
  for (const c of text.split(/[eE]/, 1)[0]) if (c >= '1' && c <= '9') { nonzero = true; break; }
  const value = Number(text);
  if (!Number.isFinite(value) || (value === 0 && nonzero)) return null;
  return value;
}

function globToken(pattern, i, code) {
  const p = pattern;
  if (p[i] === '\\' && i + 1 < p.length) return { next: i + 2, match: p.charCodeAt(i + 1) === code };
  if (p[i] === '?') return { next: i + 1, match: true };
  if (p[i] === '[') {
    let q = i + 1; let negated = false;
    if (q < p.length && p[q] === '!') { negated = true; q++; }
    const first = q; let hit = false;
    const read = () => { if (p[q] === '\\' && q + 1 < p.length) q++; return p.charCodeAt(q++); };
    while (q < p.length && (p[q] !== ']' || q === first)) {
      const lo = read();
      if (q + 1 < p.length && p[q] === '-' && p[q + 1] !== ']') {
        q++; const hi = read(); if (lo <= hi && code >= lo && code <= hi) hit = true;
      } else if (lo === code) hit = true;
    }
    if (q < p.length) return { next: q + 1, match: hit !== negated };
  }
  return { next: i + 1, match: p.charCodeAt(i) === code };
}
function globMatch(text, pattern) {
  let t = 0; let p = 0; let star = -1; let starText = 0;
  while (t < text.length) {
    if (p < pattern.length && pattern[p] === '*') { star = p++; starText = t; continue; }
    if (p < pattern.length) {
      const token = globToken(pattern, p, text.charCodeAt(t));
      if (token.match) { p = token.next; t++; continue; }
    }
    if (star < 0) return false;
    p = star + 1; t = ++starText;
  }
  while (p < pattern.length && pattern[p] === '*') p++;
  return p === pattern.length;
}

export function registerString(reg) {
  const fn = (name, params, returns, callback) => reg.fn(`fn ${name}(${params.join(', ')}) -> ${returns}`, callback, { internal: true, dry: callback });
  fn('str_base64_encode', ['string'], 'string', (s) => bytes(s).toString('base64'));
  fn('str_base64_decode', ['string'], 'string', (s) => {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s)) throw host('str_base64_decode: invalid encoding');
    const decoded = Buffer.from(s, 'base64');
    if (decoded.toString('base64') !== s) throw host('str_base64_decode: invalid encoding');
    return fromBytes(decoded);
  });
  fn('str_hex_encode', ['string'], 'string', (s) => bytes(s).toString('hex'));
  fn('str_hex_decode', ['string'], 'string', (s) => {
    if (s.length % 2 || !/^(?:[0-9a-fA-F]{2})*$/.test(s)) throw host('str_hex_decode: invalid encoding');
    return fromBytes(Buffer.from(s, 'hex'));
  });
  fn('str_starts_with', ['string', 'string'], 'bool', (s, p) => s.startsWith(p));
  fn('str_ends_with', ['string', 'string'], 'bool', (s, p) => s.endsWith(p));
  fn('str_contains', ['string', 'string'], 'bool', (s, p) => s.includes(p));
  fn('str_len', ['string'], 'int', (s) => BigInt(s.length));
  fn('str_substr', ['string', 'int', 'int'], 'string', (s, start, count) => {
    const a = start < 0n ? 0n : start; if (count <= 0n || a >= BigInt(s.length)) return '';
    const end = a + count > BigInt(s.length) ? BigInt(s.length) : a + count;
    return s.slice(Number(a), Number(end));
  });
  fn('str_lower', ['string'], 'string', (s) => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32)));
  fn('str_upper', ['string'], 'string', (s) => s.replace(/[a-z]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 32)));
  fn('str_trim', ['string'], 'string', (s) => s.replace(/^[\x09-\x0d\x20]+|[\x09-\x0d\x20]+$/g, ''));
  fn('str_repeat', ['string', 'int'], 'string', (s, count) => {
    if (count < 0n) throw host('str_repeat: count must be nonnegative');
    const length = BigInt(s.length) * count;
    if (length > maxStringLength) throw host('str_repeat: result size exceeds platform capacity');
    try { return s.repeat(Number(count)); }
    catch (error) {
      if (error instanceof RangeError) throw host('str_repeat: allocation failed');
      throw error;
    }
  });
  fn('str_to_int', ['string'], 'int', (s) => parseInt64(s) ?? 0n);
  fn('str_is_int', ['string'], 'bool', (s) => parseInt64(s) !== null);
  fn('str_to_float', ['string'], 'float', (s) => parseFloat64(s) ?? 0);
  fn('str_is_float', ['string'], 'bool', (s) => parseFloat64(s) !== null);
  fn('str_find', ['string', 'string'], 'int', (s, n) => BigInt(s.indexOf(n)));
  fn('str_replace', ['string', 'string', 'string'], 'string', (s, from, to) => {
    if (!from) return s;
    if (from === to) return s;
    let matches = 0;
    for (let at = s.indexOf(from); at >= 0; at = s.indexOf(from, at + from.length)) matches++;
    if (!matches) return s;
    const size = BigInt(s.length) + BigInt(matches) * (BigInt(to.length) - BigInt(from.length));
    if (size < 0n || size > maxStringLength) throw host('str_replace: result size exceeds platform capacity');
    try {
      // Allocate the actual result bytes, not an array entry per match. The
      // latter can exhaust the JS heap for a small result with many matches.
      const output = Buffer.allocUnsafe(Number(size));
      const input = bytes(s); const replacement = bytes(to);
      let start = 0; let offset = 0;
      for (let at = s.indexOf(from); at >= 0; at = s.indexOf(from, start)) {
        offset += input.copy(output, offset, start, at);
        offset += replacement.copy(output, offset);
        start = at + from.length;
      }
      input.copy(output, offset, start);
      return output.toString('latin1');
    } catch (error) {
      if (error instanceof RangeError || error.code === 'ERR_MEMORY_ALLOCATION_FAILED') throw host('str_replace: allocation failed');
      throw error;
    }
  });
  fn('str_match', ['string', 'string'], 'bool', (s, pattern) => globMatch(s, pattern));
}
