// AC602: compare the building identity sets of two tilesets built from different sources over the same area
// (e.g. a PBF extract and an Overpass JSON download). Usage: node compare-sources.mjs <tilesetA> <tilesetB> [--json out]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { decodeTile, readFeatureMetaAt } from '../../packages/tiles/dist/index.js';

function buildings(dir) {
  const ts = JSON.parse(readFileSync(path.join(dir, 'tileset.json'), 'utf8'));
  const z = String(ts.levels.at(-1).zoom);
  const out = new Map();
  for (const x of readdirSync(path.join(dir, z)))
    for (const f of readdirSync(path.join(dir, z, x))) {
      const t = decodeTile(new Uint8Array(readFileSync(path.join(dir, z, x, f))));
      for (const name of ['building', 'landmark']) {
        const layer = t.layers[name];
        if (!layer) continue;
        const table = layer.type === 'features' ? layer : layer.features;
        for (let i = 0; i < table.featureCount; i++) {
          const m = readFeatureMetaAt(table, i);
          out.set(m.id, { tile: `${z}/${x}/${f}`, height: m.properties?.height ?? null });
        }
      }
    }
  return { ts, ids: out };
}
const [a, b] = [buildings(path.resolve(process.argv[2])), buildings(path.resolve(process.argv[3]))];
const onlyA = [...a.ids.keys()].filter((k) => !b.ids.has(k)).sort();
const onlyB = [...b.ids.keys()].filter((k) => !a.ids.has(k)).sort();
const common = [...a.ids.keys()].filter((k) => b.ids.has(k));
const heightDiffs = common.filter((k) => Math.abs((a.ids.get(k).height ?? 0) - (b.ids.get(k).height ?? 0)) > 0.05);
const summary = {
  a: { source: a.ts.source, buildings: a.ids.size },
  b: { source: b.ts.source, buildings: b.ids.size },
  common: common.length,
  onlyA: { count: onlyA.length, sample: onlyA.slice(0, 20) },
  onlyB: { count: onlyB.length, sample: onlyB.slice(0, 20) },
  heightDiffs: { count: heightDiffs.length, sample: heightDiffs.slice(0, 10) },
};
console.log(JSON.stringify(summary));
const i = process.argv.indexOf('--json');
if (i > 0) writeFileSync(process.argv[i + 1], JSON.stringify(summary, null, 2));
