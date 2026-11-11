// Formatting-equivalence check for a pure formatting change (WP-A, AC103).
// Usage: node scripts/phase2-format-equivalence.mjs <report.json> [base-ref] [head-ref]
// For each changed JS/TS file, compares esbuild-minified output at base-ref and at head-ref (or the working tree
// when head-ref is omitted). Identical minified output means the change cannot alter behaviour. Declaration files are
// compared as token streams that ignore whitespace, separators and quote style.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const [out, base = 'HEAD', head] = process.argv.slice(2);
if (!out) throw new Error('Expected an output path.');
const range = head ? [base, head] : [base];
const files = execFileSync('git', ['diff', '--name-only', ...range], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean);
const show = (ref, file) => execFileSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8', maxBuffer: 1 << 28 });
const result = {
  method: 'esbuild minify comparison for code; whitespace-insensitive token comparison for .d.ts',
  base,
  head: head || 'working tree',
  files: 0,
  identical: 0,
  skipped: [],
  different: [],
};
const normalizeDeclarations = (s) =>
  s
    .replace(/"/g, "'")
    .replace(/[\s;,]/g, '')
    .replace(/([=:(<])\|/g, '$1');

for (const file of files) {
  if (!/\.(m?js|ts)$/.test(file)) {
    result.skipped.push(file);
    continue;
  }
  const before = show(base, file);
  const after = head ? show(head, file) : readFileSync(file, 'utf8');
  result.files++;
  if (file.endsWith('.d.ts')) {
    if (normalizeDeclarations(before) === normalizeDeclarations(after)) result.identical++;
    else result.different.push(`${file} (declaration tokens differ)`);
    continue;
  }
  const options = { loader: file.endsWith('.ts') ? 'ts' : 'js', minify: true, format: 'esm', legalComments: 'none' };
  try {
    if (transformSync(before, options).code === transformSync(after, options).code) result.identical++;
    else result.different.push(file);
  } catch (error) {
    result.different.push(`${file} (${String(error.message).split('\n')[0]})`);
  }
}
writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
console.log(
  JSON.stringify({
    files: result.files,
    identical: result.identical,
    different: result.different,
    skipped: result.skipped,
  }),
);
if (result.different.length) process.exitCode = 1;
