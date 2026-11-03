import { LmcodeError } from '../core/errors.mjs';
import { jsonString, parseJsonBytes } from './json.mjs';

const host = (message) => { throw new LmcodeError('RUN_HOST', message); };
const pathPart = '[A-Za-z_][A-Za-z0-9_]*(?:[.][A-Za-z_][A-Za-z0-9_]*|\\[[0-9]+\\])*';
const closeLoop = /^};[ ]*separator[ ]*=("(?:[^"\\]|\\.)*")>/;
const pathTokens = /[A-Za-z_][A-Za-z0-9_]*|\[[0-9]+\]/g;

function parse(source, state, mode = '', depth = 0) {
  if (depth > 256) host('template_render: maximum nesting exceeded');
  const nodes = []; let literal = '';
  const flush = () => { if (literal) nodes.push({ text: literal }), literal = ''; };
  while (state.pos < source.length) {
    const rest = source.slice(state.pos);
    if (mode === 'loop' && rest.startsWith('}>')) { flush(); state.pos += 2; return { nodes, separator: '' }; }
    if (mode === 'loop' && rest.startsWith('};')) {
      const match = closeLoop.exec(rest);
      if (!match) host('template_render: invalid loop separator');
      const sep = parseJsonBytes(match[1]);
      if (sep.kind !== 'string') host('template_render: invalid loop separator');
      flush(); state.pos += match[0].length; return { nodes, separator: sep.value };
    }
    if (rest.startsWith('<<')) { literal += '<'; state.pos += 2; continue; }
    if (rest.startsWith('<else>') || rest.startsWith('<endif>')) {
      const tag = rest.startsWith('<else>') ? 'else' : 'endif';
      if ((mode !== 'if' && mode !== 'else') || (mode === 'else' && tag === 'else')) host('template_render: unexpected conditional delimiter');
      flush(); state.pos += tag === 'else' ? 6 : 7; return { nodes, end: tag };
    }
    const conditional = new RegExp(`^<if\\((${pathPart})\\)>`).exec(rest);
    if (conditional) {
      flush(); state.pos += conditional[0].length;
      const body = parse(source, state, 'if', depth + 1);
      let otherwise = [];
      if (body.end === 'else') otherwise = parse(source, state, 'else', depth + 1).nodes;
      nodes.push({ path: conditional[1], conditional: true, body: body.nodes, otherwise }); continue;
    }
    const head = new RegExp(`^<(${pathPart})(?::\\{([A-Za-z_][A-Za-z0-9_]*)\\||>)`).exec(rest);
    if (!head) { literal += source[state.pos++]; continue; }
    flush(); state.pos += head[0].length;
    const node = { path: head[1], item: head[2] ?? '' };
    if (node.item) {
      if (node.item === 'index') host('template_render: index is reserved');
      const body = parse(source, state, 'loop', depth + 1); node.body = body.nodes; node.separator = body.separator;
    }
    nodes.push(node);
  }
  if (mode) host('template_render: unterminated block');
  flush(); return { nodes, end: '' };
}

function lookup(context, locals, variable) {
  const parts = variable.match(pathTokens) ?? [];
  let value = locals.get(parts[0]); let start = value === undefined ? 0 : 1;
  if (value === undefined) value = context;
  for (const key of parts.slice(start)) {
    if (key.startsWith('[')) {
      const digits = key.slice(1, -1); const index = Number(digits);
      value = value?.kind === 'array' && Number.isSafeInteger(index) && String(index) === digits && index < value.items.length ? value.items[index] : undefined;
    } else value = value?.kind === 'object' ? value.members.find((m) => m.key === key)?.value : undefined;
    if (value === undefined) host(`template_render: missing variable ${variable}`);
  }
  return value;
}

function emit(nodes, context, locals, output) {
  for (const node of nodes) {
    if (node.text !== undefined) { output.push(node.text); continue; }
    const value = lookup(context, locals, node.path);
    if (node.conditional) {
      if (value.kind !== 'bool') host(`template_render: condition requires a bool: ${node.path}`);
      emit(value.value ? node.body : node.otherwise, context, locals, output); continue;
    }
    if (!node.item) {
      if (value.kind === 'string') output.push(Buffer.from(value.value, 'utf8').toString('latin1'));
      else output.push(jsonString(value));
      continue;
    }
    if (value.kind !== 'array') host(`template_render: loop requires a list: ${node.path}`);
    const scope = new Map(locals);
    for (let i = 0; i < value.items.length; i++) {
      if (i) output.push(Buffer.from(node.separator, 'utf8').toString('latin1'));
      scope.set(node.item, value.items[i]);
      scope.set('index', { kind: 'int', value: BigInt(i), raw: String(i) });
      emit(node.body, context, scope, output);
    }
  }
}

export function renderTemplate(source, jsonHandle) {
  if (!jsonHandle?.__lmcodeJson || jsonHandle.data.kind !== 'object') host('template_render: context must be an object');
  const parsed = parse(source, { pos: 0 });
  const output = [];
  emit(parsed.nodes, jsonHandle.data, new Map(), output);
  return output.join('');
}
