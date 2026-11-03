import path from 'node:path';
import { copyTree, root, sha256, sourceHead, treeDigest, writePin } from './sync-common.mjs';

const suites = ['vectors', 'stdlib-vectors', 'return-vectors', 'invocation-vectors'];
if (process.argv[2] === '--verify') {
  for (const suite of suites) {
    const lockPath = path.join(root, `${suite}.lock`);
    const lock = (await import('node:fs/promises')).readFile;
    const text = await lock(lockPath, 'utf8');
    const want = text.match(/^sha256=(.+)$/m)?.[1];
    if (!want) throw new Error(`${suite}.lock has no sha256`);
    const have = await treeDigest(path.join(root, 'conformance', suite));
    if (have !== want) throw new Error(`conformance/${suite} digest ${have} differs from ${want}`);
    console.log(`conformance/${suite} matches ${text.match(/^commit=(.+)$/m)?.[1] ?? 'unknown commit'}`);
  }
} else {
  const sourceCommit = sourceHead();
  for (const suite of suites) {
    await copyTree(path.join('conformance', suite));
    const digest = await treeDigest(path.join(root, 'conformance', suite));
    await writePin(path.join(root, `${suite}.lock`), `repo=https://github.com/lmctl-ai/lmcode-cpp\ncommit=${sourceCommit}\nsha256=${digest}\n`);
    console.log(`synced ${suite} from lmcode-cpp ${sourceCommit}`);
  }
}
