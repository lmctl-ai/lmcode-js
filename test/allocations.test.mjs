import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('sample replace allocation pressure preserves real and dry terminal frames', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lmcode-allocation-'));
  const file = path.join(root, 'test/fixtures/replace-pressure.dslb');
  try {
    for (const dry of [false, true]) {
      const manifest = path.join(dir, 'manifest.json');
      writeFileSync(manifest, JSON.stringify({ version: 1, mode: 'single', dry, parts: [{ index: 0, file }] }));
      const child = spawnSync(process.execPath, ['--max-old-space-size=64', path.join(root, 'sample/main.mjs'), '--lmcode', file], {
        cwd: dir, env: { ...process.env, LMCODE_INVOCATION_FILE: manifest }, maxBuffer: Infinity,
      });
      assert.ifError(child.error);
      assert.equal(child.signal, null, `dry=${dry}: ${child.stderr}`);
      assert.equal(child.status, 0, `dry=${dry}: ${child.stderr}`);
      assert.equal(child.stderr.length, 0);
      const payload = child.stdout.toString().split('LMCODE_RETURN_BEGIN\n')[1];
      assert.ok(payload?.endsWith('\nLMCODE_RETURN_END\n'));
      assert.deepEqual(JSON.parse(payload.split('\n')[0]), dry ? { ok: true, result: null, dry: true } : { ok: true, result: null });
      if (!dry) assert.ok(child.stdout.toString().startsWith('12000000\n'));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('catchable allocation failures become RUN_HOST through the sample VM', async () => {
  const { readFileSync } = await import('node:fs');
  const { Program, Context, LmcodeError } = await import('../src/index.mjs');
  const { Host } = await import('../sample/host.mjs');
  const host = new Host();
  const schema = readFileSync(path.join(root, 'sample-suite/corpus/sample.dsl.json'));
  const program = Program.load(readFileSync(path.join(root, 'test/fixtures/replace-pressure.dslb')), schema, host.registry);
  const original = Buffer.allocUnsafe;
  for (const dry of [false, true]) {
    const context = new Context({ shop: host.shop, ledger: host.ledger }); context.setDry(dry);
    try {
      Buffer.allocUnsafe = () => { throw new RangeError('synthetic allocation failure'); };
      assert.throws(() => program.run(context), (e) => e instanceof LmcodeError && e.code === 'RUN_HOST' && /str_replace: allocation failed/.test(e.message));
    } finally { Buffer.allocUnsafe = original; }
  }
});
