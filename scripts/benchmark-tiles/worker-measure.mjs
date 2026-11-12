// Per-tile decode + generation in Node with the map worker's options (roof inference from the tileset, details
// layers, near walls). Node timings guide optimisation only; they are not browser evidence (06 section 5).
// Usage: node scripts/benchmark-tiles/worker-measure.mjs <tilesetDir> [--runs 3] [--json out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { decodeTile } from '../../packages/tiles/dist/index.js';
import { generateTile } from '../../packages/generators/dist/index.js';
import { DETAIL_GENERATORS } from '../../packages/details/dist/index.js';

const dir = path.resolve(process.argv[2]);
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const runs = Number(arg('--runs', 3));
const tileset = JSON.parse(readFileSync(path.join(dir, 'tileset.json'), 'utf8'));
const report = JSON.parse(readFileSync(path.join(dir, 'report.json'), 'utf8'));
const options = {
  seed: tileset.build?.seed ?? 1,
  inferRoofs: Boolean(tileset.build?.options?.inferRoofs),
  layerGenerators: DETAIL_GENERATORS,
  collectNearWalls: true,
};
const keys = Object.keys(report.hashes).filter((k) => k.startsWith(`${tileset.levels.at(-1).zoom}/`));
const buffers = keys.map((k) => readFileSync(path.join(dir, k)));
for (const b of buffers) generateTile(decodeTile(b), options);
const rows = [];
const layers = {};
for (const [i, b] of buffers.entries()) {
  const t = [];
  let stats;
  for (let r = 0; r < runs; r++) {
    const t0 = performance.now();
    stats = generateTile(decodeTile(b), options).stats;
    t.push(performance.now() - t0);
  }
  t.sort((a, b) => a - b);
  rows.push({ tile: keys[i], ms: t[Math.floor(t.length / 2)], buildings: stats.buildings, triangles: stats.triangles });
  for (const [k, v] of Object.entries(stats.msByLayer)) layers[k] = (layers[k] ?? 0) + v;
}
const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
const q = (p) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))];
const summary = {
  tileset: tileset.name,
  tiles: rows.length,
  p50: +q(0.5).toFixed(1),
  p95: +q(0.95).toFixed(1),
  max: +ms.at(-1).toFixed(1),
  msByLayerTotal: Object.fromEntries(Object.entries(layers).map(([k, v]) => [k, +v.toFixed(0)])),
  slowest: rows.sort((a, b) => b.ms - a.ms).slice(0, 3),
  node: process.version,
};
console.log(JSON.stringify(summary));
const out = arg('--json', null);
if (out) writeFileSync(out, JSON.stringify(summary, null, 2));
