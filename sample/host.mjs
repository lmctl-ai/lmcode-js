import { LmcodeError } from '../src/core/errors.mjs';
import { VmObject, formatG15, wrapInt64 } from '../src/core/values.mjs';
import { createRegistry, registerTesting } from '../src/std/index.mjs';
import { makeHandle } from '../src/std/collections.mjs';

const hostError = (message) => { throw new LmcodeError('RUN_HOST', message); };
const wrapMul = (a, b) => wrapInt64(a * b);
const wrapAdd = (a, b) => wrapInt64(a + b);
const wrapSub = (a, b) => wrapInt64(a - b);

export class Host {
  constructor({ dry = false, print = (line) => process.stdout.write(line) } = {}) {
    this.registry = createRegistry();
    this.registry.enum('Currency');
    this.shop = { items: { values: [] } };
    this.ledger = { balance: 0n, entries: 0n, note: '' };
    this.money = [];
    this.dry = dry;
    this.registry.context('shop', 'Shop').context('ledger', 'Ledger');
    registerTesting(this.registry, print);
    this.#registerConversions();
    this.#registerShop();
    if (!dry) for (const cents of [125n, 250n, 375n]) this.shop.items.values.push(this.#money(cents).value);
  }
  #money(cents) { const item = { cents: wrapInt64(cents) }; this.money.push(item); return new VmObject('Money', item); }
  totalMoney() { return this.#money(this.shop.items.values.reduce((sum, item) => wrapAdd(sum, item.cents), 0n)); }
  #moneyValue(value) {
    if (!(value && typeof value === 'object' && 'cents' in value)) hostError('money: null handle');
    return value;
  }
  #units(amount) {
    const scaled = amount * 100;
    const cents = scaled < 0 ? Math.ceil(scaled - 0.5) : Math.floor(scaled + 0.5);
    const limit = 2 ** 63;
    if (!Number.isFinite(cents) || cents < -limit || cents >= limit) hostError('money: amount out of range');
    return this.#money(BigInt(cents));
  }
  #total(shop) { return this.#money(shop.items.values.reduce((sum, item) => wrapAdd(sum, item.cents), 0n)); }
  #registerConversions() {
    const r = this.registry;
    r.fn('fn host_int(int) -> int', (x) => x);
    r.fn('fn host_float(float) -> float', (x) => x);
    r.fn('fn host_bool(bool) -> bool', (x) => x);
    r.fn('fn host_bytes(string) -> string', (bytes) => bytes, { rawStrings: true });
    r.fn('fn host_hex(string) -> string', (bytes) => Buffer.from(bytes).toString('hex'), { rawStrings: true });
    r.fn('fn host_float_case(string) -> float', (name) => {
      if (name === '-0') return -0;
      if (name === 'nan') return Number.NaN;
      if (name === 'inf') return Infinity;
      if (name === '-inf') return -Infinity;
      if (name === 'large') return 1e21;
      if (name === 'subnormal') return Number.MIN_VALUE;
      hostError('host_float_case: unknown case');
    });
    r.fn('fn host_echo_money(Money) -> Money', (value) => value);
    r.fn('fn host_same(Money, Money) -> bool', (a, b) => a === b);
    r.fn('fn host_null() -> Money', () => new VmObject('Money', null));
    r.fn('fn host_is_null(Money) -> bool', (money) => money === null);
    r.fn('fn host_wrong() -> Money', () => new VmObject('Items', null), { unsafeReturn: true });
    r.fn('fn host_void() -> void', () => undefined);
    r.fn('fn host_str_list(StrList) -> StrList', (list) => {
      const copy = makeHandle(r, 'StrList'); copy.data.values = [...list.data.values, 'host']; return copy;
    });
    r.fn('fn host_int_list(IntList) -> IntList', (list) => {
      const copy = makeHandle(r, 'IntList'); copy.data.values = [...list.data.values, 9n]; return copy;
    });
    r.fn('fn host_float_list(FloatList) -> FloatList', (list) => {
      const copy = makeHandle(r, 'FloatList'); copy.data.values = [...list.data.values, 0.5]; return copy;
    });
    r.fn('fn host_str_map(StrMap) -> StrMap', (map) => {
      const copy = makeHandle(r, 'StrMap'); copy.data.entries = map.data.entries.map((e) => ({ ...e }));
      copy.data.index = new Map(copy.data.entries.map((entry, index) => [entry.key, index]));
      if (copy.data.index.has('host')) copy.data.entries[copy.data.index.get('host')].value = 'yes';
      else { copy.data.index.set('host', copy.data.entries.length); copy.data.entries.push({ key: 'host', value: 'yes' }); }
      return copy;
    });
    const params = Array(255).fill('int');
    r.fn(`fn host_sum(${params.join(', ')}) -> int`, (...values) => values.reduce((sum, value) => wrapAdd(sum, value), 0n));
    const longName = `host_long_${'x'.repeat(128)}`;
    r.fn(`fn ${longName}(int) -> int`, (value) => value);
  }
  #registerShop() {
    const r = this.registry;
    r.fn('fn money(int) -> Money', (cents) => this.#money(cents));
    r.fn('fn money(float) -> Money', (units) => this.#units(units));
    r.fn('fn fee(int) -> int', (value) => wrapAdd(value, 5n));
    const temp = () => {
      const value = process.env.SAMPLE_TMP;
      if (!value) hostError('SAMPLE_TMP is required');
      return value;
    };
    r.fn('fn sample_tmp() -> string', temp, { dry: temp });
    r.method('method Money.amount() -> int', (money) => this.#moneyValue(money).cents);
    r.method('method Money.currency() -> Currency', (money) => { this.#moneyValue(money); return 'USD'; });
    r.method('method Money.plus(Money) -> Money', (money, right) => this.#money(wrapAdd(this.#moneyValue(money).cents, this.#moneyValue(right).cents)));
    r.method('method Money.minus(Money) -> Money', (money, right) => this.#money(wrapSub(this.#moneyValue(money).cents, this.#moneyValue(right).cents)));
    r.method('method Money.times(int) -> Money', (money, factor) => this.#money(wrapMul(this.#moneyValue(money).cents, factor)));
    r.method('method Money.neg() -> Money', (money) => this.#money(wrapSub(0n, this.#moneyValue(money).cents)));
    r.method('method Money.set(int) -> self', (money, cents) => { const item = this.#moneyValue(money); item.cents = cents; return item; });
    r.method('method Items.len() -> int', (items) => BigInt(items.values.length));
    r.method('method Items.at(int) -> Money', (items, index) => {
      if (index < 0n || index >= BigInt(items.values.length)) hostError('items: index out of range');
      return items.values[Number(index)];
    });
    r.method('method Shop.items() -> Items', (shop) => shop.items);
    r.method('method Shop.total() -> Money', (shop) => this.#total(shop));
    r.method('method Shop.price(int) -> Money', (_shop, cents) => this.#money(cents));
    r.method('method Shop.price(float) -> Money', (_shop, units) => this.#units(units));
    r.method('method Shop.currency() -> Currency', () => 'USD');
    r.method('method Shop.label() -> string', () => 'sample shop');
    r.method('method Ledger.record(Money) -> self', (ledger, money) => {
      ledger.balance = wrapAdd(ledger.balance, this.#moneyValue(money).cents);
      ledger.entries = wrapAdd(ledger.entries, 1n); return ledger;
    });
    r.method('method Ledger.balance() -> Money', (ledger) => this.#money(ledger.balance));
    r.method('method Ledger.count() -> int', (ledger) => ledger.entries);
    r.method('method Ledger.note(string) -> void', (ledger, note) => { ledger.note = note; });
    r.method('method Ledger.note() -> string', (ledger) => ledger.note);
    r.method('method Ledger.reject(string) -> void', (_ledger, message) => hostError(message));
  }
}

export function summary(host, entriesCalled) {
  const note = JSON.stringify(host.ledger.note);
  return `{"host_summary":{"balance": ${host.ledger.balance}, "entries": ${host.ledger.entries}, "note": ${note}, "entries_called": ${entriesCalled}}}\n`;
}

export function entryText(value) {
  if (value === undefined || value === null) return String(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return formatG15(value);
  return String(value);
}
