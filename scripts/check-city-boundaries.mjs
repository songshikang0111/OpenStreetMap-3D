// Compare the exact grid edge and all stacked surface heights across 200 reproducibly sampled neighbours (AC605).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { decodeTile, parseTileKey } from '@city-ink/tiles';
import { boundaryCoverage, sampleAt } from '../test/helpers/tile-boundary.js';

const dir = process.argv[2];
if (!dir) throw new Error('Usage: node scripts/check-city-boundaries.mjs <built tileset>');
const tileset = JSON.parse(await readFile(path.join(dir, 'tileset.json')));
const report = JSON.parse(await readFile(path.join(dir, 'report.json')));
const zoom = tileset.coverage.zoom;
const keys = new Set(
  Object.keys(report.hashes)
    .filter((k) => k.startsWith(zoom + '/'))
    .map((k) => k.replace(/\.c3t$/, '')),
);
const pairs = [];
for (const key of [...keys].sort()) {
  const { x, y } = parseTileKey(key);
  for (const [other, axis] of [
    [`${zoom}/${x + 1}/${y}`, 'x'],
    [`${zoom}/${x}/${y + 1}`, 'y'],
  ])
    if (keys.has(other)) pairs.push({ key, other, axis });
}
if (pairs.length < 200) throw new Error(`Only ${pairs.length} neighbouring L1 tile pairs.`);
let rng = 605;
const random = () => (rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0) / 2 ** 32;
const result = { neighbours: pairs.length, checked: 200, samples: 0, occupied: 0, mismatches: 0, first: [] };
async function tile(key) {
  return decodeTile(await readFile(path.join(dir, key + '.c3t')));
}
for (let i = 0; i < 200; ++i) {
  const j = i + Math.floor(random() * (pairs.length - i));
  [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
  const { key, other, axis } = pairs[i];
  const [a, b] = await Promise.all([tile(key), tile(other)]);
  const e = 2 ** a.extentLog2;
  const edge = (a.id[axis] + 1) * e;
  const start = (axis === 'x' ? a.id.y : a.id.x) * e;
  for (const layer of ['water', 'green', 'ground']) {
    const sa = boundaryCoverage(a, layer, axis, edge);
    const sb = boundaryCoverage(b, layer, axis, edge);
    for (let n = 0; n < 20; ++n) {
      const t = start + Math.floor(random() * e) + 0.5;
      const ha = sampleAt(sa, t, axis),
        hb = sampleAt(sb, t, axis);
      result.samples++;
      if (ha.length || hb.length) result.occupied++;
      if (ha.length !== hb.length || ha.some((h, i) => Math.abs(h - hb[i]) > 0.01)) {
        result.mismatches++;
        if (result.first.length < 8) result.first.push({ key, other, axis, t, layer, ha, hb });
      }
    }
  }
}
console.log(JSON.stringify(result, null, 2));
if (result.mismatches) process.exitCode = 1;
