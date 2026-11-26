// Static performance regression (WP-I task I3, AC903/AC906): per-tile draw calls (generated batches + tree
// instances, near-camera details excluded), tile sizes against 02 section 6, and the @city-ink/map bundle size.
// Usage: node scripts/benchmark-tiles/static-budget.mjs <tilesetDir ...> [--bundle packages/map/bundle/city-map.js]
//        [--max-l1-draws 12] [--max-l0-draws 4] [--max-tile-gzip 1048576] [--max-bundle-gzip 184320] [--json out]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import os from 'node:os';
import { decodeTile } from '../../packages/tiles/dist/index.js';
import { generateTile } from '../../packages/generators/dist/index.js';
import { DETAIL_GENERATORS } from '../../packages/details/dist/index.js';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const dirs = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const limits = {
  l1Draws: Number(opt('max-l1-draws', 12)),
  l0Draws: Number(opt('max-l0-draws', 4)),
  tileTriangles: Number(opt('max-tile-triangles', 600000)),
  decodeP95Ms: Number(opt('max-decode-ms', 5)),
  // A machine-specific gate is optional. The independent 167-tile AC312 gate uses the 60 ms target.
  generateP95Ms: opt('max-generate-ms', null) === null ? null : Number(opt('max-generate-ms')),
  tileGzip: Number(opt('max-tile-gzip', 1024 * 1024)),
  bundleGzip: Number(opt('max-bundle-gzip', 180 * 1024)),
};
const problems = dirs.length ? [] : ['Provide at least one tileset directory.'];
const summary = { limits, node: process.version, cpu: os.cpus()[0]?.model, tilesets: [] };
const p95 = (values) => (values.length ? values.toSorted((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] : null);
for (const dir of dirs) {
  const ts = JSON.parse(readFileSync(path.join(dir, 'tileset.json'), 'utf8'));
  const report = JSON.parse(readFileSync(path.join(dir, 'report.json'), 'utf8'));
  const options = { inferRoofs: Boolean(ts.build?.options?.inferRoofs), layerGenerators: DETAIL_GENERATORS };
  const decodeTimes = [],
    generateTimes = [];
  const row = {
    name: ts.name,
    tiles: 0,
    maxTriangles: 0,
    decodeP95Ms: null,
    generateP95Ms: null,
    maxDraws: { L0: 0, L1: 0 },
    maxGzip: 0,
    worst: null,
  };
  for (const key of Object.keys(report.hashes).filter((k) => k.endsWith('.c3t'))) {
    const bytes = readFileSync(path.join(dir, key));
    generateTile(decodeTile(bytes), options); // warm up the codec and generators before recording
    const decode = [],
      generate = [];
    let tile, g;
    for (let run = 0; run < 3; run++) {
      const start = performance.now();
      tile = decodeTile(bytes);
      const decoded = performance.now();
      g = generateTile(tile, options);
      decode.push(decoded - start);
      generate.push(performance.now() - start);
    }
    decodeTimes.push(decode.toSorted((a, b) => a - b)[1]);
    const level = tile.profile === 'full' ? 'L1' : 'L0';
    if (level === 'L1') generateTimes.push(generate.toSorted((a, b) => a - b)[1]);
    // Instanced crown (80) and trunk (24) triangles per tree in the standard single colour pass.
    const triangles = g.batches.reduce((n, b) => n + b.index.length / 3, 0) + 104 * g.trees.count;
    row.maxTriangles = Math.max(row.maxTriangles, triangles);
    if (triangles > limits.tileTriangles)
      problems.push(`${ts.name} ${key}: ${triangles} triangles > ${limits.tileTriangles}`);
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
  row.decodeP95Ms = p95(decodeTimes);
  row.generateP95Ms = p95(generateTimes);
  if (row.decodeP95Ms > limits.decodeP95Ms)
    problems.push(`${ts.name} decode p95 ${row.decodeP95Ms} ms > ${limits.decodeP95Ms}`);
  if (limits.generateP95Ms !== null && row.generateP95Ms > limits.generateP95Ms)
    problems.push(`${ts.name} L1 decode + generation p95 ${row.generateP95Ms} ms > ${limits.generateP95Ms}`);
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
