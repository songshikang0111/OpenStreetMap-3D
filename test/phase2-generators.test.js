// WP-C generator tests: AC306 (tile versus phase-one geometry), AC308 (Node versus Worker), AC311 (no DOM).
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MeshWriter, addBox } from '../src/generators/mesh-tools.js';
import { buildTiles } from '../packages/builder/dist/index.js';
import { decodeTile, gridStepMeters } from '../packages/tiles/dist/index.js';
import { generateTile, generateBuildings, BatchSet } from '../packages/generators/dist/index.js';
import { phase1Buildings, tileBuildings, compareBuildings } from './helpers/phase2-compare.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sample = (name) => path.join(root, 'public/data', `${name}.json`);

test('AC306: tile-generated buildings match phase-one direct generation', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'city-gen-'));
  try {
    let total = 0;

    for (const name of ['bibury-village', 'beijing-cbd', 'beijing-lingxiu-d']) {
      const out = path.join(base, name);
      // Include the five landmark-eligible buildings in the same geometry comparison.
      const { report } = await buildTiles({ input: sample(name), output: out, landmarks: false });
      const probe = await phase1Buildings(sample(name));
      const tiles = await tileBuildings(out, report, probe.data.project);
      const { buildings } = await phase1Buildings(sample(name), undefined, tiles.landmarks);
      const rows = compareBuildings(buildings, tiles);
      assert.ok(
        rows.every((r) => !r.missing),
        `${name}: every phase-one building has tile geometry`,
      );
      total += rows.length;
      const a = rows.reduce((s, r) => s + r.triangles[0], 0),
        b = rows.reduce((s, r) => s + r.triangles[1], 0);
      assert.ok(Math.abs(a - b) / a < 0.005, `${name}: total triangles ${a} vs ${b}`);
      for (const row of rows) {
        assert.ok(row.dBounds <= 0.1 && row.dTriangles <= 0.02, name + ' ' + JSON.stringify(row));
      }
    }
    assert.equal(total, 888);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('compact boxes preserve winding, facade attributes and feature IDs across block boundaries', () => {
  const collected = new BatchSet(),
    streamed = new BatchSet();
  const ordinary = new MeshWriter(),
    compact = new MeshWriter();
  const baseline = collected.get('building', 'structure'),
    candidate = streamed.get('building', 'structure');
  const offset = 0.45;
  compact.writeBox = (points, axes, color, id) => candidate.writeBox(points, axes, color, id, offset, compact);
  const dimensions = [
    [3, 4, 2],
    [0, 3, 6],
    [-3, 4, 2],
    [3, -4, -2],
  ];
  for (let i = 0; i < 135; i++) {
    const start = ordinary.positionLength / 3;
    for (const writer of [ordinary, compact]) {
      writer.variant = i / 135;
      writer.surface = [i % 4, 1 + i / 135];
      writer.layout = [2, 0.35, 0.45, 1];
      addBox(writer, [i, 5, -i], dimensions[i % dimensions.length], '#bba099', i + 1, i / 12);
    }
    baseline.addWriterRun(ordinary, start, 36, i + 1, offset);
  }
  assert.deepEqual(streamed.build(), collected.build());
});

function flatten(g) {
  return {
    batches: g.batches.map((b) => ({
      layer: b.layer,
      role: b.role,
      position: Array.from(b.position),
      normal: Array.from(b.normal),
      renderId: Array.from(b.renderId),
      index: b.index ? Array.from(b.index) : null,
      facade: b.facade ? Array.from(b.facade.aLayout) : null,
    })),
    trees: Array.from(g.trees.data),
  };
}

test('AC308/AC311: generation in a DOM-free worker equals generation in the main thread, and repeats exactly', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'city-gen-'));
  try {
    const out = path.join(base, 'tiles');
    const { report } = await buildTiles({ input: sample('beijing-lingxiu-d'), output: out });
    const keys = Object.keys(report.hashes).filter((k) => k.endsWith('.c3t'));
    const worker = new Worker(
      `const { parentPort } = require('node:worker_threads');
       Promise.all([import(${JSON.stringify(pathToFileURL(path.join(root, 'packages/tiles/dist/index.js')).href)}),
                    import(${JSON.stringify(pathToFileURL(path.join(root, 'packages/generators/dist/index.js')).href)})])
         .then(([tiles, gen]) => {
           parentPort.on('message', (buffer) => {
             const dom = ['document', 'window', 'HTMLCanvasElement', 'WebGLRenderingContext'].filter((k) => typeof globalThis[k] !== 'undefined');
             const g = gen.generateTile(tiles.decodeTile(buffer));
             parentPort.postMessage({ dom, g }, gen.batchTransferables(g.batches));
           });
           parentPort.postMessage('ready');
         });`,
      { eval: true },
    );
    const queue = [];
    worker.on('message', (m) => queue.shift()?.(m));
    await new Promise((resolve) => queue.push(resolve));
    let compared = 0;
    for (const key of keys) {
      const bytes = await readFile(path.join(out, key));
      const tile = decodeTile(bytes);
      if (tile.profile === 'full' && tile.layers.building?.type === 'features') {
        const batches = (collect) => {
          const set = new BatchSet();
          const { triangles, nearWalls } = generateBuildings(
            tile.layers.building,
            tile.layers.buildingContext ?? null,
            gridStepMeters(tile.id, tile.extentLog2),
            { inferRoofs: true, collectNearWalls: true },
            set,
            'building',
            collect,
          );
          return { triangles, nearWalls, batches: set.build() };
        };
        assert.deepEqual(batches(false), batches(true), key + ': streamed faces match the scene writer');
      }
      const local = generateTile(tile);
      const again = generateTile(decodeTile(bytes));
      assert.deepEqual(flatten(again), flatten(local), `${key} repeats exactly`);
      const copy = Uint8Array.prototype.slice.call(bytes).buffer;
      const remote = await new Promise((resolve) => {
        queue.push(resolve);
        worker.postMessage(copy, [copy]);
      });
      assert.deepEqual(remote.dom, []);
      assert.deepEqual(flatten(remote.g), flatten(local), `${key}: worker and main thread differ`);
      compared++;
    }
    await worker.terminate();
    assert.ok(compared >= 5);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('AC311: the generator package and the phase-one modules it loads reference no DOM or renderer', async () => {
  const files = [
    'packages/generators/dist/index.js',
    'packages/generators/dist/building.js',
    'packages/generators/dist/surfaces.js',
    'packages/generators/dist/tile.js',
    'packages/generators/dist/batch.js',
    'packages/generators/dist/structures.js',
    'src/road-structures.js',
    'src/road-stairs.js',
    'src/building-mesh.js',
    'src/building-envelope.js',
    'src/roofs.js',
    'src/building-rules.js',
    'src/facade-layout.js',
    'src/generators/mesh-tools.js',
    'src/osm.js',
  ];
  for (const f of files) {
    const text = await readFile(path.join(root, f), 'utf8');
    for (const banned of [
      /\bdocument\./,
      /\bwindow\./,
      /WebGLRenderer/,
      /getContext\(/,
      /three\/addons/,
      /three\/examples/,
    ])
      assert.doesNotMatch(text, banned, `${f} uses ${banned}`);
  }
});
