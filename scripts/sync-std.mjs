import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { root, sha256, source, writePin } from './sync-common.mjs';

const schemaRel = 'std/lmcode-std.schema.json';
const docsRel = 'std/lmcode-std.docs.json';
const schemaCommit = execFileSync('git', ['-C', source, 'log', '-1', '--format=%H', '--', schemaRel], { encoding: 'utf8' }).trim();
const docsCommit = execFileSync('git', ['-C', source, 'log', '-1', '--format=%H', '--', docsRel], { encoding: 'utf8' }).trim();
if (process.argv[2] === '--verify') {
  for (const [rel, lockName] of [[schemaRel, 'std.lock'], [docsRel, 'std-docs.lock']]) {
    const bytes = await readFile(path.join(root, rel));
    const lockText = await readFile(path.join(root, lockName), 'utf8');
    const want = lockText.match(/^sha256=(.+)$/m)?.[1];
    if (!want || sha256(bytes) !== want) throw new Error(`${rel} differs from ${lockName}`);
    console.log(`${rel} matches ${lockText.match(/^commit=(.+)$/m)?.[1] ?? 'its lock'}`);
  }
} else {
  await mkdir(path.join(root, 'std'), { recursive: true });
  for (const [commit, rel] of [[schemaCommit, schemaRel], [docsCommit, docsRel]]) {
    if (!commit) throw new Error(`canonical source has no commit for ${rel}`);
    const bytes = execFileSync('git', ['-C', source, 'show', `${commit}:${rel}`]);
    await writeFile(path.join(root, rel), bytes);
    const lockName = rel === schemaRel ? 'std.lock' : 'std-docs.lock';
    await writePin(path.join(root, lockName), `repo=https://github.com/lmctl-ai/lmcode-cpp\ncommit=${commit}\nsha256=${sha256(bytes)}\n`);
  }
  for (const rel of ['stdlib/result.schema-fragment.json', 'std/template-cases.json', 'std/template.md', 'docs/std.md']) {
    try {
      const bytes = execFileSync('git', ['-C', source, 'show', `HEAD:${rel}`]);
      const target = path.join(root, rel);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
    } catch {
      // Older corpus revisions may not carry optional generated documentation.
    }
  }
  console.log(`synced canonical standard schema/docs from lmcode-cpp ${schemaCommit}/${docsCommit}`);
}
