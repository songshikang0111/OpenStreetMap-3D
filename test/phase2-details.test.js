// Optional decorations (decision E10): street details and inferred landscape are planned at build time into the
// `detail` and `landscape` layers, are partition independent, and are drawn only with @city-ink/details registered.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTiles } from '../packages/builder/dist/index.js';
import { decodeTile, readFeatureMetaAt } from '../packages/tiles/dist/index.js';
import { generateTile } from '../packages/generators/dist/index.js';
import { DETAIL_GENERATORS } from '../packages/details/dist/index.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const sample = (name) => path.join(root, 'public/data', `${name}.json`);

test('E10: details and landscape are off by default, planned when enabled and partition independent', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'city-details-'));
  try {
    const plain = await buildTiles({ input: sample('beijing-lingxiu-d'), output: path.join(base, 'plain') });
    assert.equal(plain.report.counts.detail ?? 0, 0);
    assert.equal(plain.report.counts.landscape ?? 0, 0);
    const opts = { input: sample('beijing-lingxiu-d'), details: true, landscape: true };
    const a = await buildTiles({ ...opts, output: path.join(base, 'a') });
    const b = await buildTiles({ ...opts, output: path.join(base, 'b'), cellZoom: -1 });
    assert.deepEqual(a.report.hashes, b.report.hashes);
    assert.ok(a.report.counts.detail > 50, JSON.stringify(a.report.counts));
    const kinds = {};
    let detailTriangles = 0,
      withoutGenerators = 0;
    for (const x of await readdir(path.join(base, 'a', '16')))
      for (const f of await readdir(path.join(base, 'a', '16', x))) {
        const tile = decodeTile(new Uint8Array(await readFile(path.join(base, 'a', '16', x, f))));
        const layer = tile.layers.detail;
        if (layer)
          for (let i = 0; i < layer.featureCount; i++) {
            const m = readFeatureMetaAt(layer, i);
            kinds[m.properties.kind] = (kinds[m.properties.kind] ?? 0) + 1;
            assert.ok(['observed', 'inferred'].includes(m.provenance.position));
          }
        const tri = (g) => g.batches.reduce((n, b) => n + b.index.length / 3, 0);
        const withDetails = tri(generateTile(tile, { layerGenerators: DETAIL_GENERATORS }));
        const without = tri(generateTile(tile));
        detailTriangles += withDetails - without;
        if (!tile.layers.detail && !tile.layers.landscape && withDetails !== without) withoutGenerators++;
      }
    for (const k of ['lamp', 'curb', 'car', 'person']) assert.ok(kinds[k] > 0, `${k}: ${JSON.stringify(kinds)}`);
    assert.ok(detailTriangles > 1000);
    assert.equal(withoutGenerators, 0);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
