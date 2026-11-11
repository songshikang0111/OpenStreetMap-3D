// Repository slimming inventory (WP-A, A9/AC110). Read-only: lists candidate directories, their size, the size of
// files over 200 KB inside them, and every tracked text file outside the candidate that references it.
// Usage: node scripts/phase2-slim-inventory.mjs [--json]
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 })
  .split('\0')
  .filter(Boolean);
const candidates = [
  ...new Set(
    tracked
      .filter((file) => /^docs\/(evidence[^/]*|phase1-evidence\/[^/]+)\//.test(file))
      .map((file) =>
        file
          .split('/')
          .slice(0, file.startsWith('docs/phase1-evidence/') ? 3 : 2)
          .join('/'),
      ),
  ),
  'public/data',
].sort();
const textFiles = tracked.filter(
  (file) => /\.(md|js|mjs|json|html|ts|yml|css)$/.test(file) && statSync(file).size < 2e6,
);
const texts = new Map(textFiles.map((file) => [file, readFileSync(file, 'utf8')]));
const rows = candidates.map((dir) => {
  const inside = tracked.filter((file) => file.startsWith(dir + '/'));
  const sizes = inside.map((file) => statSync(file).size);
  const large = inside.filter((_, i) => sizes[i] > 200 * 1024);
  const referencedBy = [...texts]
    .filter(([file, text]) => !file.startsWith(dir + '/') && text.includes(dir))
    .map(([file]) => file);
  return {
    directory: dir,
    files: inside.length,
    bytes: sizes.reduce((a, b) => a + b, 0),
    filesOver200KB: large.length,
    bytesOver200KB: large.reduce((sum, file) => sum + statSync(file).size, 0),
    referencedBy,
  };
});
if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
else {
  const mb = (n) => (n / 1048576).toFixed(1);
  console.log('| Directory | Files | MB | Files >200 KB | MB >200 KB | Referenced by |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  for (const r of rows)
    console.log(
      `| \`${r.directory}\` | ${r.files} | ${mb(r.bytes)} | ${r.filesOver200KB} | ${mb(r.bytesOver200KB)} | ${r.referencedBy.map((f) => `\`${f}\``).join(', ') || '—'} |`,
    );
  const total = rows.reduce((s, r) => s + r.bytes, 0);
  const large = rows.reduce((s, r) => s + r.bytesOver200KB, 0);
  console.log(`\nTotal: ${mb(total)} MB, of which ${mb(large)} MB in files over 200 KB.`);
}
