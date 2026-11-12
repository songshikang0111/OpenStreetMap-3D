// Rebuilds the example cities of examples/cities.json and checks their hashes (WP-F task F8, AC609).
// The input PBF is not downloaded automatically (03 section 2): fetch the listed URL yourself, check its SHA-256,
// then run: node scripts/build-example-cities.mjs --pbf-dir <dir with the input files> --out <output dir> [id ...]
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTiles } from '../packages/builder/dist/index.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
const manifest = JSON.parse(readFileSync(path.join(root, 'examples/cities.json'), 'utf8'));
const pbfDir = arg('--pbf-dir');
const outDir = arg('--out');
if (!pbfDir || !outDir) {
  console.error('Usage: node scripts/build-example-cities.mjs --pbf-dir <dir> --out <dir> [id ...]');
  process.exit(2);
}
const wanted = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));
const sha = async (file) => {
  const h = createHash('sha256');
  for await (const c of createReadStream(file)) h.update(c);
  return h.digest('hex');
};
/** Hash of a tileset's content: the sorted per-file hashes of its build report. */
export const tilesetHash = (hashes) =>
  createHash('sha256')
    .update(JSON.stringify(Object.entries(hashes).sort(([a], [b]) => (a < b ? -1 : 1))))
    .digest('hex');

let failed = 0;
for (const city of manifest.cities) {
  if (wanted.length && !wanted.includes(city.id)) continue;
  const input = path.join(pbfDir, city.input.file);
  if (!existsSync(input)) {
    console.log(JSON.stringify({ id: city.id, status: 'missing-input', download: city.input.url }));
    failed++;
    continue;
  }
  const inputHash = await sha(input);
  if (inputHash !== city.input.sha256) {
    console.log(JSON.stringify({ id: city.id, status: 'input-mismatch', expected: city.input.sha256, got: inputHash }));
    failed++;
    continue;
  }
  const t0 = performance.now();
  const { report } = await buildTiles({ input, output: path.join(outDir, city.id), name: city.id, ...city.build });
  const hash = tilesetHash(report.hashes);
  const ok = hash === city.output.tilesetHash;
  if (!ok) failed++;
  console.log(
    JSON.stringify({
      id: city.id,
      status: ok ? 'match' : 'hash-mismatch',
      tilesetHash: hash,
      tiles: Object.keys(report.hashes).length,
      seconds: +((performance.now() - t0) / 1000).toFixed(1),
    }),
  );
}
process.exitCode = failed ? 1 : 0;
