// Compare the complete production generator output from two built checkouts, using the same encoded tiles.
// Usage: node scripts/benchmark-tiles/compare-generation.mjs <reference-checkout> <tileset-dir> [...]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function load(checkout) {
  const pkg = (name) => import(pathToFileURL(path.join(checkout, 'packages', name, 'dist/index.js')).href);
  const [{ decodeTile }, { generateTile }, { DETAIL_GENERATORS }] = await Promise.all([
    pkg('tiles'),
    pkg('generators'),
    pkg('details'),
  ]);
  return (bytes, options) => {
    const g = generateTile(decodeTile(bytes), {
      ...options,
      collectNearWalls: true,
      layerGenerators: DETAIL_GENERATORS,
    });
    const { msByLayer, ...stats } = g.stats;
    // Compare typed arrays as exact bytes (including signed zero). Compare the remaining geometry metadata structurally.
    const digest = (array) => ({
      type: array.constructor.name,
      length: array.length,
      sha256: createHash('sha256')
        .update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength))
        .digest('hex'),
    });
    return JSON.parse(JSON.stringify({ ...g, stats }, (_, v) => (ArrayBuffer.isView(v) ? digest(v) : v)));
  };
}

const [reference, ...dirs] = process.argv.slice(2);
assert.ok(reference && dirs.length, 'Supply a built reference checkout and at least one tileset directory');
const before = await load(path.resolve(reference));
const after = await load(fileURLToPath(new URL('../../', import.meta.url)));
let tiles = 0,
  vertices = 0,
  triangles = 0;
for (const dir of dirs) {
  const report = JSON.parse(await readFile(path.join(dir, 'report.json'), 'utf8'));
  const tileset = JSON.parse(await readFile(path.join(dir, 'tileset.json'), 'utf8'));
  const options = { seed: tileset.build?.seed ?? 1, inferRoofs: Boolean(tileset.build?.options?.inferRoofs) };
  for (const key of Object.keys(report.hashes).filter((k) => k.endsWith('.c3t'))) {
    const bytes = await readFile(path.join(dir, key));
    const expected = before(bytes, options);
    const observed = after(bytes, options);
    assert.deepEqual(observed, expected, path.join(dir, key));
    tiles++;
    vertices += observed.stats.vertices;
    triangles += observed.stats.triangles;
  }
}
console.log(
  JSON.stringify({
    tilesets: dirs.map((d) => path.basename(d)),
    tiles,
    vertices,
    triangles,
    allAttributeBytesIdentical: true,
    treeAndNearWallRecordsIdentical: true,
  }),
);
