import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const source = path.resolve(process.env.LMCODE_CPP_DIR ?? path.join(root, '..', 'lmcode-cpp'));
export function sourceHead() {
  return execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function treeDigest(directory) {
  const files = [];
  async function walk(dir, prefix = '') {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(absolute, relative);
      else if (entry.isFile()) files.push([relative, await readFile(absolute)]);
    }
  }
  await walk(directory);
  files.sort(([a], [b]) => a.localeCompare(b, 'en'));
  const rows = files.map(([name, bytes]) => `${sha256(bytes)}  ${name}\n`).join('');
  return sha256(Buffer.from(rows, 'utf8'));
}

export async function copyTree(relative) {
  const from = path.join(source, relative);
  const to = path.join(root, relative);
  await rm(to, { recursive: true, force: true });
  await mkdir(path.dirname(to), { recursive: true });
  await cp(from, to, { recursive: true, force: true });
}

export async function writePin(file, contents) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents, 'utf8');
}
