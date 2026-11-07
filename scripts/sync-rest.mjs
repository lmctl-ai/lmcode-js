// Copies the shared REST conformance suite (the `rest` std module) from the spec repository and pins it.
//   node scripts/sync-rest.mjs            copy ../lmcode/tests/rest-suite (or $LMCODE_SPEC_DIR) and write rest-suite.lock
//   node scripts/sync-rest.mjs --verify   check the copy against the lock
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { root, treeDigest } from './sync-common.mjs';

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
