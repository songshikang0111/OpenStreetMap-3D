// WP-C AC312: per-tile decode + generation time in Node for built sample tilesets (single thread, after a warm-up
// pass; each tile's time is the median of 3 runs). Node timings are not browser or GPU evidence.
// Usage: node scripts/benchmark-tiles/generate-measure.mjs <samplesDir> [--json out.json]
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decodeTile } from '../../packages/tiles/dist/index.js';
import { generateTile } from '../../packages/generators/dist/index.js';

const dir = path.resolve(process.argv[2]);
const names = readdirSync(dir).filter((n) => existsSync(path.join(dir, n, 'tileset.json')));
const pct = (v, p) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0;
};
const rows = [];
const all = [];
const layerTotals = {};
for (const name of names) {
  const report = JSON.parse(readFileSync(path.join(dir, name, 'report.json'), 'utf8'));
  const keys = Object.keys(report.hashes).filter((k) => k.startsWith('16/'));
  const buffers = keys.map((k) => readFileSync(path.join(dir, name, k)));
  for (const b of buffers) generateTile(decodeTile(b)); // warm-up
  const times = [];
  let slowest = null;
  for (const [i, b] of buffers.entries()) {
    const runs = [];
    let stats;
    for (let r = 0; r < 3; r++) {
      const t0 = performance.now();
      const g = generateTile(decodeTile(b));
      runs.push(performance.now() - t0);
      stats = g.stats;
    }
    const ms = pct(runs, 50);
    times.push(ms);
    all.push(ms);
    for (const [layer, v] of Object.entries(stats.msByLayer)) layerTotals[layer] = (layerTotals[layer] ?? 0) + v;
    if (!slowest || ms > slowest.ms)
      slowest = {
        tile: keys[i],
        ms: +ms.toFixed(1),
        triangles: stats.triangles,
        buildings: stats.buildings,
        msByLayer: Object.fromEntries(Object.entries(stats.msByLayer).map(([k, v]) => [k, +v.toFixed(1)])),
      };
  }
  rows.push({
    name,
    tiles: keys.length,
    p50: +pct(times, 50).toFixed(1),
    p95: +pct(times, 95).toFixed(1),
    max: +Math.max(0, ...times).toFixed(1),
    slowest,
  });
  console.log(
    `${name.padEnd(24)} ${String(keys.length).padStart(4)} L1 tiles  p50 ${pct(times, 50).toFixed(1).padStart(6)} ms  p95 ${pct(times, 95).toFixed(1).padStart(6)} ms  max ${Math.max(
      0,
      ...times,
    )
      .toFixed(1)
      .padStart(6)} ms  slowest ${slowest?.tile ?? '-'} ${JSON.stringify(slowest?.msByLayer ?? {})}`,
  );
}
const summary = {
  date: new Date().toISOString(),
  machine: {
    cpu: os.cpus()[0]?.model,
    cores: os.cpus().length,
    node: process.version,
    platform: `${os.platform()} ${os.release()}`,
  },
  method: 'decodeTile + generateTile per L1 tile, Node single thread, warm-up pass then median of 3 runs per tile',
  overall: {
    tiles: all.length,
    p50: +pct(all, 50).toFixed(1),
    p95: +pct(all, 95).toFixed(1),
    max: +Math.max(...all).toFixed(1),
  },
  layerShareMs: Object.fromEntries(Object.entries(layerTotals).map(([k, v]) => [k, Math.round(v)])),
  rows,
};
console.log('overall', JSON.stringify(summary.overall), 'layer ms totals', JSON.stringify(summary.layerShareMs));
const at = process.argv.indexOf('--json');
if (at > 0) writeFileSync(process.argv[at + 1], JSON.stringify(summary, null, 2) + '\n');
