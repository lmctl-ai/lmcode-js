import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cases = JSON.parse(readFileSync(path.join(root, 'conformance/invocation-vectors/metadata-errors.json'), 'utf8'));
const dir = mkdtempSync(path.join(tmpdir(), 'lmcode-metadata-'));
let failed = 0;
try {
  for (const row of cases) {
    const manifest = path.join(dir, 'invocation.json');
    writeFileSync(manifest, Buffer.from(row.raw_hex, 'hex'));
    const result = spawnSync(process.execPath, [path.join(root, 'sample/main.mjs'), '--lmcode', '/unused'], {
      env: { ...process.env, LMCODE_INVOCATION_FILE: manifest }, maxBuffer: Infinity,
    });
    try {
      assert.ifError(result.error);
      assert.equal(result.signal, null);
      assert.equal(result.status, 2);
      assert.deepEqual(result.stdout, Buffer.from(row.frame));
      assert.equal(result.stderr.length, 0);
      console.log(`PASS metadata ${row.name}`);
    } catch (error) { failed++; console.error(`FAIL metadata ${row.name}: ${error.message}`); }
  }
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log(`${failed ? 'FAIL' : 'PASS'} ${cases.length - failed}/${cases.length} metadata goldens`);
if (failed) process.exitCode = 1;
