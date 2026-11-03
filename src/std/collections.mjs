import { LmcodeError } from '../core/errors.mjs';
const host = (message) => { throw new LmcodeError('RUN_HOST', message); };
const types = {
  StrList: { kind: 'list', value: 'string', create: () => ({ values: [] }) },
  IntList: { kind: 'list', value: 'int', create: () => ({ values: [] }) },
  FloatList: { kind: 'list', value: 'float', create: () => ({ values: [] }) },
  StrMap: { kind: 'map', value: 'string', create: () => ({ entries: [], index: new Map() }) },
  IntMap: { kind: 'map', value: 'int', create: () => ({ entries: [], index: new Map() }) },
  FloatMap: { kind: 'map', value: 'float', create: () => ({ entries: [], index: new Map() }) },
  StrStack: { kind: 'stack', value: 'string', create: () => ({ values: [] }) },
  IntStack: { kind: 'stack', value: 'int', create: () => ({ values: [] }) },
  FloatStack: { kind: 'stack', value: 'float', create: () => ({ values: [] }) },
  StrQueue: { kind: 'queue', value: 'string', create: () => ({ values: [], head: 0 }) },
  IntQueue: { kind: 'queue', value: 'int', create: () => ({ values: [], head: 0 }) },
  FloatQueue: { kind: 'queue', value: 'float', create: () => ({ values: [], head: 0 }) },
  StrPQ: { kind: 'pq', value: 'string', create: () => ({ items: [], next: 0n }) },
  IntPQ: { kind: 'pq', value: 'int', create: () => ({ items: [], next: 0n }) },
  FloatPQ: { kind: 'pq', value: 'float', create: () => ({ items: [], next: 0n }) },
};

export function makeHandle(reg, type) { return { __lmcodeCollection: true, type, generation: reg.runGeneration, data: types[type].create() }; }
function check(reg, self, type, method) {
  if (!self?.__lmcodeCollection || self.type !== type || self.generation !== reg.runGeneration || !reg.runActive) {
    host(`${type}.${method}: collection handle is not active in this run`);
  }
  return self.data;
}
function index(type, method, value, length) {
  if (value < 0n || value >= BigInt(length)) host(`${type}.${method}: index out of range: ${value}`);
  return Number(value);
}
function equal(a, b) { return a === b; }
export function registerCollections(reg, schema) {
  const fn = (name, params, returns, callback) => reg.fn(`fn ${name}(${params.join(', ')}) -> ${returns}`, callback, { internal: true, dry: callback });
  const constructors = new Map();
  for (const [name, overloads] of Object.entries(schema.functions)) for (const sig of overloads) {
    if (!sig.params.length && types[sig.returns]) constructors.set(sig.returns, name);
  }
  for (const [type, info] of Object.entries(types)) {
    const constructor = constructors.get(type);
    if (constructor) fn(constructor, [], type, () => makeHandle(reg, type));
  }
  fn('str_split', ['string', 'string'], 'StrList', (source, separator) => {
    if (!separator) host('str_split: separator must not be empty');
    const list = makeHandle(reg, 'StrList'); list.data.values = source.split(separator); return list;
  });

  for (const type of Object.keys(types)) {
    const valueType = types[type].value;
    const m = (name, params, returns, callback) => reg.method(`method ${type}.${name}(${params.join(', ')}) -> ${returns}`, callback, { internal: true, dry: callback });
    if (types[type].kind === 'list') {
      m('len', [], 'int', (self) => BigInt(check(reg, self, type, 'len').values.length));
      m('at', ['int'], valueType, (self, i) => check(reg, self, type, 'at').values[index(type, 'at', i, self.data.values.length)]);
      m('add', [valueType], type, (self, value) => { check(reg, self, type, 'add').values.push(value); return self; });
      m('set', ['int', valueType], type, (self, i, value) => { const data = check(reg, self, type, 'set'); data.values[index(type, 'set', i, data.values.length)] = value; return self; });
      m('contains', [valueType], 'bool', (self, value) => check(reg, self, type, 'contains').values.some((v) => equal(v, value)));
      m('index_of', [valueType], 'int', (self, value) => BigInt(check(reg, self, type, 'index_of').values.findIndex((v) => equal(v, value))));
      m('clear', [], type, (self) => { check(reg, self, type, 'clear').values.length = 0; return self; });
      if (type === 'StrList') m('join', ['string'], 'string', (self, sep) => check(reg, self, type, 'join').values.join(sep));
    } else if (types[type].kind === 'map') {
      m('len', [], 'int', (self) => BigInt(check(reg, self, type, 'len').entries.length));
      m('has', ['string'], 'bool', (self, key) => check(reg, self, type, 'has').index.has(key));
      m('get', ['string'], valueType, (self, key) => {
        const data = check(reg, self, type, 'get');
        if (!data.index.has(key)) host(`${type}.get: missing key`);
        return data.entries[data.index.get(key)].value;
      });
      m('get_or', ['string', valueType], valueType, (self, key, fallback) => {
        const data = check(reg, self, type, 'get_or'); return data.index.has(key) ? data.entries[data.index.get(key)].value : fallback;
      });
      m('set', ['string', valueType], type, (self, key, value) => {
        const data = check(reg, self, type, 'set');
        if (data.index.has(key)) data.entries[data.index.get(key)].value = value;
        else { data.index.set(key, data.entries.length); data.entries.push({ key, value }); }
        return self;
      });
      m('key_at', ['int'], 'string', (self, i) => {
        const data = check(reg, self, type, 'key_at'); return data.entries[index(type, 'key_at', i, data.entries.length)].key;
      });
      m('remove', ['string'], 'bool', (self, key) => {
        const data = check(reg, self, type, 'remove'); if (!data.index.has(key)) return false;
        data.entries.splice(data.index.get(key), 1); data.index.clear(); data.entries.forEach((entry, i) => data.index.set(entry.key, i)); return true;
      });
      m('clear', [], type, (self) => { const data = check(reg, self, type, 'clear'); data.entries.length = 0; data.index.clear(); return self; });
      m('keys', [], 'StrList', (self) => { const data = check(reg, self, type, 'keys'); const result = makeHandle(reg, 'StrList'); result.data.values = data.entries.map((e) => e.key); return result; });
      const listType = type === 'IntMap' ? 'IntList' : type === 'FloatMap' ? 'FloatList' : 'StrList';
      m('values', [], listType, (self) => {
        const data = check(reg, self, type, 'values'); const list = makeHandle(reg, listType);
        list.data.values = data.entries.map((e) => e.value); return list;
      });
    } else if (types[type].kind === 'stack' || types[type].kind === 'queue') {
      const queue = types[type].kind === 'queue';
      const size = (self, name) => { const data = check(reg, self, type, name); return queue ? data.values.length - data.head : data.values.length; };
      m('len', [], 'int', (self) => BigInt(size(self, 'len')));
      m('empty', [], 'bool', (self) => size(self, 'empty') === 0);
      m('push', [valueType], type, (self, value) => { const data = check(reg, self, type, 'push'); data.values.push(value); return self; });
      m('pop', [], valueType, (self) => {
        const data = check(reg, self, type, 'pop'); if (size(self, 'pop') === 0) host(`${type}.pop: empty`);
        return queue ? data.values[data.head++] : data.values.pop();
      });
      m('peek', [], valueType, (self) => {
        const data = check(reg, self, type, 'peek'); if (size(self, 'peek') === 0) host(`${type}.peek: empty`);
        return queue ? data.values[data.head] : data.values.at(-1);
      });
      m('clear', [], type, (self) => { const data = check(reg, self, type, 'clear'); data.values.length = 0; data.head = 0; return self; });
      m('at', ['int'], valueType, (self, i) => {
        const data = check(reg, self, type, 'at');
        const offset = index(type, 'at', i, size(self, 'at'));
        return queue ? data.values[data.head + offset] : data.values[data.values.length - 1 - offset];
      });
    } else if (types[type].kind === 'pq') {
      m('len', [], 'int', (self) => BigInt(check(reg, self, type, 'len').items.length));
      m('empty', [], 'bool', (self) => check(reg, self, type, 'empty').items.length === 0);
      m('push', [valueType, 'float'], type, (self, value, priority) => {
        const data = check(reg, self, type, 'push');
        if (!Number.isFinite(priority)) host(`${type}.push: priority must be finite`);
        if (data.next >= (1n << 63n) - 1n) host(`${type}.push: insertion sequence exhausted`);
        data.items.push({ value, priority, seq: data.next++ }); return self;
      });
      m('pop', [], valueType, (self) => {
        const data = check(reg, self, type, 'pop'); if (!data.items.length) host(`${type}.pop: empty`);
        data.items.sort((a, b) => a.priority - b.priority || (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0)); return data.items.shift().value;
      });
      m('peek', [], valueType, (self) => {
        const data = check(reg, self, type, 'peek'); if (!data.items.length) host(`${type}.peek: empty`);
        data.items.sort((a, b) => a.priority - b.priority || (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0)); return data.items[0].value;
      });
      m('clear', [], type, (self) => { const data = check(reg, self, type, 'clear'); data.items.length = 0; data.next = 0n; return self; });
    }
  }
}
