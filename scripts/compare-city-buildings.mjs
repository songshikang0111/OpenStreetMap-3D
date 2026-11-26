// AC602. Compare full-detail identities including buildings claimed by baked landmark recipes.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { decodeTile, readFeatureMeta } from '@city-ink/tiles';
async function buildings(dir) {
  const report = JSON.parse(await readFile(path.join(dir, 'report.json')));
  const level = report.tiles.at(-1).zoom;
  const ids = new Set();
  for (const file of Object.keys(report.hashes).filter((f) => f.startsWith(level + '/'))) {
    const tile = decodeTile(await readFile(path.join(dir, file)));
    for (const layer of [tile.layers.building, tile.layers.landmark?.features]) {
      if (layer) for (const f of readFeatureMeta(layer)) ids.add(f.id);
    }
  }
  return ids;
}
const [a, b] = await Promise.all(process.argv.slice(2, 4).map(buildings));
if (!a || !b) throw new Error('Usage: node scripts/compare-city-buildings.mjs <PBF tiles> <JSON tiles>');
const difference = (s, t) => [...s].filter((x) => !t.has(x)).sort();
const onlyPbf = difference(a, b),
  onlyJson = difference(b, a);
console.log(JSON.stringify({ pbf: a.size, json: b.size, onlyPbf, onlyJson }, null, 2));
if (onlyPbf.length || onlyJson.length) process.exitCode = 1;
