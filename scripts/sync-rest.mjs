// Copies the shared REST conformance suite (the `rest` std module) from the spec repository and pins it.
//   node scripts/sync-rest.mjs            copy ../lmcode/tests/rest-suite (or $LMCODE_SPEC_DIR) and write rest-suite.lock
//   node scripts/sync-rest.mjs --verify   check the copy against the lock
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { root } from './sync-common.mjs';

// Portable tree digest: sha256 over rows "<sha256(file)>  <relative path>\n", paths sorted bytewise (C locale).
// Reproducible in shell: (cd DIR && find . -type f -printf '%P\n' | LC_ALL=C sort | xargs sha256sum) | sha256sum
async function treeDigest(dir) {
  const rows = [];
  const walk = async (d, prefix) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(d, e.name), rel);
      else if (e.isFile()) rows.push([rel, createHash('sha256').update(await readFile(path.join(d, e.name))).digest('hex')]);
    }
  };
  await walk(dir, '');
  rows.sort(([a], [b]) => (Buffer.compare(Buffer.from(a), Buffer.from(b))));
  return createHash('sha256').update(rows.map(([n, h]) => `${h}  ${n}\n`).join('')).digest('hex');
}

const spec = path.resolve(process.env.LMCODE_SPEC_DIR ?? path.join(root, '..', 'lmcode'));
const destination = path.join(root, 'conformance', 'rest-suite');
const lock = path.join(root, 'rest-suite.lock');
if (process.argv[2] === '--verify') {
  const text = await readFile(lock, 'utf8');
  const want = text.match(/^sha256=(.+)$/m)?.[1];
  const have = await treeDigest(destination);
  if (!want || have !== want) throw new Error(`conformance/rest-suite digest ${have} differs from ${want}`);
  console.log(`conformance/rest-suite matches ${text.match(/^commit=(.+)$/m)?.[1]}`);
} else {
  const commit = execFileSync('git', ['-C', spec, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await rm(destination, { recursive: true, force: true });
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(path.join(spec, 'tests', 'rest-suite'), destination, { recursive: true });
  await writeFile(lock, `repo=https://github.com/lmctl-ai/lmcode\ncommit=${commit}\nsha256=${await treeDigest(destination)}\n`, 'utf8');
  console.log(`synced REST suite from lmcode ${commit}`);
}
