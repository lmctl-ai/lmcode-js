import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeDigest } from './sync-common.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(process.env.LMCODE_CPP_DIR ?? path.join(root, '..', 'lmcode-cpp'));
const destination = path.join(root, 'sample-suite', 'corpus');
const lock = path.join(root, 'sample-suite.lock');
if (process.argv[2] === '--verify') {
  const text = await readFile(lock, 'utf8');
  const want = text.match(/^sha256=(.+)$/m)?.[1];
  const commit = text.match(/^commit=(.+)$/m)?.[1];
  const have = await treeDigest(destination);
  if (!want || !commit || have !== want) throw new Error(`sample-suite/corpus digest ${have} differs from ${want}`);
  console.log(`sample-suite/corpus matches ${commit}`);
} else {
  const commit = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await rm(destination, { recursive: true, force: true });
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(path.join(source, 'sample-suite'), destination, { recursive: true });
  const sha256 = await treeDigest(destination);
  await writeFile(lock, `repo=https://github.com/lmctl-ai/lmcode-cpp\ncommit=${commit}\nsha256=${sha256}\n`, 'utf8');
  console.log(`synced sample suite from lmcode-cpp ${commit}`);
}
