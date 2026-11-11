import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { encodeTile, decodeTile, readFeatures, dequantizeToLngLat } from '../dist/index.js';
import { readBuildings } from '../examples/reference-decode.mjs';
import { rng, randomFeatureLayer } from './helpers.js';

test('B6: the standalone reference decoder reads the same outlines and heights as the package', () => {
  const source = readFileSync(new URL('../examples/reference-decode.mjs', import.meta.url), 'utf8');
  for (const m of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) assert.match(m[1], /^node:/, 'standard library only');
  const id = { z: 16, x: 53958, y: 24829 };
  const layer = randomFeatureLayer(rng(208), 'polygon', 40);
  const bytes = encodeTile({
    id,
    profile: 'full',
    layers: { building: layer, tree: randomFeatureLayer(rng(1), 'point', 3) },
  });
  const tile = decodeTile(bytes);
  const expected = readFeatures(tile.layers.building).map((f) => ({
    id: f.id,
    height: f.properties.height,
    outline: Array.from({ length: f.geometry[0][0].length / 2 }, (_, v) =>
      dequantizeToLngLat(id, tile.extentLog2, f.geometry[0][0][v * 2], f.geometry[0][0][v * 2 + 1]),
    ),
  }));
  const got = readBuildings(bytes).map(({ id, height, outline }) => ({ id, height, outline }));
  assert.equal(got.length, expected.length);
  got.forEach((g, i) => {
    const e = expected[i];
    assert.equal(g.id, e.id);
    assert.equal(g.height, e.height);
    assert.equal(g.outline.length, e.outline.length);
    g.outline.forEach((p, v) =>
      assert.ok(Math.abs(p[0] - e.outline[v][0]) < 1e-9 && Math.abs(p[1] - e.outline[v][1]) < 1e-9),
    );
  });
});
