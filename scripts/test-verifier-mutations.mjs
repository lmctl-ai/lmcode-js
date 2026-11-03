import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cases = [
  {
    file: 'src/core/verifier.mjs',
    test: 'unequal branch stack depths',
    original: 'else if (depths[index] !== depth) bad(',
    mutant: 'else if (false) bad(',
  },
  {
    file: 'src/core/verifier.mjs',
    test: 'hidden compiler-owned locals',
    original: 'if (region.locals[ins.a].hidden) bad(`STORE_LOCAL at offset ${ins.pc} writes compiler-owned loop local ${ins.a}`);',
    mutant: 'if (false) bad(`STORE_LOCAL at offset ${ins.pc} writes compiler-owned loop local ${ins.a}`);',
  },
  {
    file: 'src/core/program.mjs',
    test: 'duplicate rule-entry names',
    original: "if (entries.some((entry) => entry.name === name)) throw loadError(`duplicate entry name '${name}'`);",
    mutant: "if (false) throw loadError(`duplicate entry name '${name}'`);",
  },
  {
    file: 'src/core/verifier.mjs',
    test: 'unpaired backward jumps',
    original: 'if (ins.rel < 0) bad(`jump at offset ${pc} goes backwards (only paired LOOP_BACK may jump backward)`);',
    mutant: 'if (false) bad(`jump at offset ${pc} goes backwards (only paired LOOP_BACK may jump backward)`);',
  },
  {
    file: 'src/core/verifier.mjs',
    test: 'operand stack underflow',
    original: 'if (depth < pop) bad(`operand stack underflow at offset ${ins.pc}`);',
    mutant: 'if (false) bad(`operand stack underflow at offset ${ins.pc}`);',
  },
];

for (const mutation of cases) {
  const file = path.join(root, mutation.file);
  const source = await readFile(file, 'utf8');
  const occurrences = source.split(mutation.original).length - 1;
  if (occurrences !== 1) throw new Error(`${mutation.file}: expected one mutation target for ${mutation.test}, found ${occurrences}`);
  try {
    await writeFile(file, source.replace(mutation.original, mutation.mutant), 'utf8');
    const result = spawnSync(process.execPath, ['--test', '--test-name-pattern', mutation.test, 'test/verifier-controls.test.mjs'], {
      cwd: root, encoding: 'utf8',
    });
    if (result.error) throw result.error;
    if (result.status === 0) throw new Error(`verifier mutation survived: ${mutation.test}`);
    console.log(`PASS verifier mutation caught: ${mutation.test}`);
  } finally {
    await writeFile(file, source, 'utf8');
  }
}
