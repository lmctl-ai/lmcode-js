import { LmcodeError } from '../core/errors.mjs';
import { INT_MAX, INT_MIN, formatG15, wrapInt64 } from '../core/values.mjs';

const host = (message) => { throw new LmcodeError('RUN_HOST', message); };
function mathMin(a, b) { if (Number.isNaN(a)) return a; if (Number.isNaN(b)) return b; return b < a ? b : a; }
function mathMax(a, b) { if (Number.isNaN(a)) return a; if (Number.isNaN(b)) return b; return b > a ? b : a; }
function sqrtInt(value) {
  if (value < 0n) return host('math_sqrt: integer argument must be nonnegative');
  if (value < 2n) return value;
  let x = value; let y = (x + 1n) >> 1n;
  while (y < x) { x = y; y = (x + value / x) >> 1n; }
  return x;
}
function powInt(base, exponent) {
  if (exponent < 0n) return host('math_pow: integer exponent must be nonnegative');
  let result = 1n; let factor = base; let n = exponent;
  while (n !== 0n) {
    if (n & 1n) result = wrapInt64(result * factor);
    n >>= 1n;
    if (n !== 0n) factor = wrapInt64(factor * factor);
  }
  return result;
}
function powFloat(base, exponent) {
  if (exponent === 0 || base === 1) return 1;
  if (Math.abs(base) === 1 && !Number.isFinite(exponent)) return 1;
  return Math.pow(base, exponent);
}
function roundAway(value) {
  if (!Number.isFinite(value) || value === 0) return value;
  const rounded = value < 0 ? -Math.floor(-value + 0.5) : Math.floor(value + 0.5);
  return rounded === 0 && value < 0 ? -0 : rounded;
}

export function registerMath(reg) {
  const f = (name, args, returns, callback) => reg.fn(`fn ${name}(${args.join(', ')}) -> ${returns}`, callback, { internal: true, dry: callback });
  f('math_abs', ['int'], 'int', (x) => wrapInt64(x < 0n ? -x : x));
  f('math_abs', ['float'], 'float', Math.abs);
  f('math_ceil', ['int'], 'int', (x) => x);
  f('math_ceil', ['float'], 'float', Math.ceil);
  f('math_floor', ['int'], 'int', (x) => x);
  f('math_floor', ['float'], 'float', Math.floor);
  f('math_max', ['int', 'int'], 'int', (a, b) => a > b ? a : b);
  f('math_max', ['float', 'float'], 'float', mathMax);
  f('math_min', ['int', 'int'], 'int', (a, b) => a < b ? a : b);
  f('math_min', ['float', 'float'], 'float', mathMin);
  f('math_pow', ['int', 'int'], 'int', powInt);
  f('math_pow', ['float', 'float'], 'float', powFloat);
  f('math_round', ['int'], 'int', (x) => x);
  f('math_round', ['float'], 'float', roundAway);
  f('math_sqrt', ['int'], 'int', sqrtInt);
  f('math_sqrt', ['float'], 'float', Math.sqrt);
}

export { formatG15 };
