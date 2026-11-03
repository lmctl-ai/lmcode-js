export const VOID = Symbol('lmcode void');
export const INT_MIN = -(1n << 63n);
export const INT_MAX = (1n << 63n) - 1n;
export const wrapInt64 = (value) => BigInt.asIntN(64, BigInt(value));

export class VmObject {
  constructor(type, value) { this.type = type; this.value = value; }
}

export class DryNull {
  constructor(type) { this.type = type; }
}

export function kindName(value) {
  if (value === VOID) return 'void';
  if (typeof value === 'bigint') return 'int';
  if (typeof value === 'number') return 'float';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'boolean') return 'bool';
  if (value instanceof DryNull) return 'dry null';
  if (value instanceof VmObject) return 'object';
  return 'unknown';
}

function decimalParts(text) {
  let source = text.toLowerCase();
  let exponent = 0;
  const e = source.indexOf('e');
  if (e >= 0) { exponent = Number(source.slice(e + 1)); source = source.slice(0, e); }
  const point = source.indexOf('.') < 0 ? source.length : source.indexOf('.');
  let digits = source.replace('.', '');
  let decimal = point + exponent;
  const leading = digits.match(/^0*/)[0].length;
  digits = digits.slice(leading);
  decimal -= leading;
  digits = digits.replace(/0+$/, '') || '0';
  return { digits, decimal, exponent: decimal - 1 };
}

function formatDecimal(sign, digits, decimal, scientificThreshold, minimumExponentDigits = 2) {
  while (digits.length > 1 && digits.endsWith('0')) digits = digits.slice(0, -1);
  const exponent = decimal - 1;
  if (exponent >= -4 && exponent < scientificThreshold) {
    if (decimal <= 0) return `${sign}0.${'0'.repeat(-decimal)}${digits}`;
    if (decimal >= digits.length) return `${sign}${digits}${'0'.repeat(decimal - digits.length)}`;
    return `${sign}${digits.slice(0, decimal)}.${digits.slice(decimal)}`;
  }
  const mantissa = digits.length === 1 ? digits : `${digits[0]}.${digits.slice(1)}`;
  const magnitude = String(Math.abs(exponent)).padStart(minimumExponentDigits, '0');
  return `${sign}${mantissa}e${exponent < 0 ? '-' : '+'}${magnitude}`;
}

export function formatFloat(value) {
  if (Number.isNaN(value)) return 'nan';
  if (value === Infinity) return 'inf';
  if (value === -Infinity) return '-inf';
  if (Object.is(value, -0)) return '0';
  if (value === 0) return '0';
  const sign = value < 0 ? '-' : '';
  const parts = decimalParts(Math.abs(value).toString());
  return formatDecimal(sign, parts.digits, parts.decimal, 6, 2);
}

export function formatG15(value) {
  if (Number.isNaN(value)) return 'nan';
  if (value === Infinity) return 'inf';
  if (value === -Infinity) return '-inf';
  if (Object.is(value, -0)) return '-0';
  if (value === 0) return '0';
  const sign = value < 0 ? '-' : '';
  const parts = decimalParts(Math.abs(value).toPrecision(15));
  return formatDecimal(sign, parts.digits, parts.decimal, 15, 2);
}
