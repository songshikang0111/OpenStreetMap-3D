// Static performance regression (WP-I task I3, AC903/AC906): per-tile draw calls (generated batches + tree
// instances, near-camera details excluded), tile sizes against 02 section 6, and the @city-ink/map bundle size.
// Usage: node scripts/benchmark-tiles/static-budget.mjs <tilesetDir ...> [--bundle packages/map/bundle/city-map.js]
//        [--max-l1-draws 12] [--max-l0-draws 4] [--max-tile-gzip 1048576] [--max-bundle-gzip 184320] [--json out]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { decodeTile } from '../../packages/tiles/dist/index.js';
import { generateTile } from '../../packages/generators/dist/index.js';
import { DETAIL_GENERATORS } from '../../packages/details/dist/index.js';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const dirs = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const limits = {
  l1Draws: Number(opt('max-l1-draws', 12)),
  l0Draws: Number(opt('max-l0-draws', 4)),
  tileGzip: Number(opt('max-tile-gzip', 1024 * 1024)),
  bundleGzip: Number(opt('max-bundle-gzip', 180 * 1024)),
};
const problems = [];
const summary = { limits, tilesets: [] };
for (const dir of dirs) {
  const ts = JSON.parse(readFileSync(path.join(dir, 'tileset.json'), 'utf8'));
  const report = JSON.parse(readFileSync(path.join(dir, 'report.json'), 'utf8'));
  const finest = ts.levels.at(-1).zoom;
  const options = { inferRoofs: Boolean(ts.build?.options?.inferRoofs), layerGenerators: DETAIL_GENERATORS };
  const row = { name: ts.name, tiles: 0, maxDraws: { L0: 0, L1: 0 }, maxGzip: 0, worst: null };
  for (const key of Object.keys(report.hashes).filter((k) => k.endsWith('.c3t'))) {
    const bytes = readFileSync(path.join(dir, key));
    const tile = decodeTile(new Uint8Array(bytes));
    const g = generateTile(tile, options);
    const level = tile.id.z === finest ? 'L1' : 'L0';
    const draws = g.stats.drawCalls;
    const gz = gzipSync(bytes).length;
    row.tiles++;
    if (draws > row.maxDraws[level]) {
      row.maxDraws[level] = draws;
      if (level === 'L1') row.worst = { tile: key, batches: g.batches.map((b) => `${b.layer}:${b.role}`) };
    }
    row.maxGzip = Math.max(row.maxGzip, gz);
    const limit = level === 'L1' ? limits.l1Draws : limits.l0Draws;
    if (draws > limit) problems.push(`${ts.name} ${key}: ${draws} draw calls > ${limit} (${level})`);
    if (gz > limits.tileGzip) problems.push(`${ts.name} ${key}: ${gz} B gzip > ${limits.tileGzip}`);
  }
  summary.tilesets.push(row);
}
const bundle = opt('bundle', 'packages/map/bundle/city-map.js');
if (existsSync(bundle)) {
  const gz = gzipSync(readFileSync(bundle)).length;
  summary.bundleGzip = gz;
  if (gz > limits.bundleGzip) problems.push(`${bundle}: ${gz} B gzip > ${limits.bundleGzip}`);
} else problems.push(`${bundle} missing: run node scripts/benchmark-tiles/bundle-check.mjs or the map bundle build`);
summary.problems = problems;
summary.status = problems.length ? 'fail' : 'pass';
console.log(JSON.stringify(summary));
const out = opt('json', null);
if (out) writeFileSync(out, JSON.stringify(summary, null, 2));
if (problems.length) process.exitCode = 1;
