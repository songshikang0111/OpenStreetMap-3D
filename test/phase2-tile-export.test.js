import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildTiles, runTilesCLI } from '@city-ink/builder';
import { decodeTile, tileKey, tileToWorldMatrix } from '@city-ink/tiles';
import { generateTile } from '@city-ink/generators';
import { DETAIL_GENERATORS } from '@city-ink/details';

test('full GLB matches the finest tile cover, positioning and tree geometry; a failed export preserves the file', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'city-export-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { tileset, report } = await buildTiles({ input: 'public/data/bibury-village.json', output: dir });
  const out = path.join(dir, 'city.glb');
  const run = () => runTilesCLI(['export', dir, '--output', out]);
  assert.equal((await run()).status, 'succeeded');
  const bytes = await readFile(out);
  const { parser, scene } = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  assert.equal(parser.json.extras.scope, 'complete');
  assert.deepEqual(parser.json.extras.attribution, tileset.attribution);
  assert.deepEqual(parser.json.extras.source, tileset.source);
  const keys = Object.keys(report.hashes).filter((k) => k.startsWith(tileset.levels.at(-1).zoom + '/'));
  const roots = parser.json.scenes[0].nodes.map((i) => parser.json.nodes[i]);
  assert.deepEqual(roots.map((n) => n.name).sort(), keys.map((k) => k.slice(0, -4)).sort());
  let expected = 0,
    actual = 0;
  for (const key of keys) {
    const tile = decodeTile(await readFile(path.join(dir, key)));
    const g = generateTile(tile, {
      seed: tileset.build.seed,
      inferRoofs: Boolean(tileset.build.options.inferRoofs),
      layerGenerators: DETAIL_GENERATORS,
    });
    expected += g.batches.reduce((n, b) => n + b.index.length / 3, 0) + 104 * g.trees.count;
    assert.deepEqual(
      roots.find((n) => n.name === tileKey(tile.id)).matrix,
      tileToWorldMatrix(tile.id, tileset.center.slice(0, 2)),
    );
  }
  scene.traverse((o) => {
    if (o.isMesh) actual += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
  });
  assert.ok(expected > 0);
  assert.equal(actual, expected);
  await writeFile(path.join(dir, keys.at(-1)), new Uint8Array(32));
  assert.equal((await run()).status, 'failed');
  assert.deepEqual(await readFile(out), bytes);
});

test('loaded GLB omits hidden vertices from its bounds and flattens filtered buildings', async () => {
  const { BufferGeometry, BufferAttribute, Mesh, MeshBasicMaterial, Group } = await import('three');
  const { loadedTileGLB } = await import('../packages/map/dist/exports.js');
  const { FLAG_HIDDEN, FLAG_FLATTEN } = await import('../packages/map/dist/picking/feature-state.js');
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([0, 10, 0, 3, 10, 0, 3, 10, 1, 99, 80, 99, 98, 80, 99, 98, 80, 98]), 3),
  );
  geometry.setAttribute('renderId', new BufferAttribute(new Uint32Array([1, 1, 1, 2, 2, 2]), 1));
  geometry.setIndex([0, 1, 2, 3, 4, 5]);
  const group = new Group();
  group.add(new Mesh(geometry, new MeshBasicMaterial()));
  const data = new Uint8Array(12);
  data[7] = FLAG_FLATTEN;
  data[11] = FLAG_HIDDEN;
  const attribution = {
    text: '© OpenStreetMap contributors',
    license: 'ODbL',
    url: 'https://www.openstreetmap.org/copyright',
  };
  const glb = loadedTileGLB({ name: 'test', attribution }, [0, 0], [['16/1/1', { group, state: { data } }]], 65536);
  const { scene } = await new GLTFLoader().parseAsync(await glb.arrayBuffer(), '');
  const result = scene.children[0].children[0].geometry;
  assert.equal(result.getAttribute('position').count, 3);
  assert.deepEqual(result.boundingBox.max.toArray(), [3, Math.fround(0.3), 1]);
  assert.equal(geometry.getAttribute('position').getY(0), 10);
});
