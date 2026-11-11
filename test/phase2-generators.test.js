// WP-C generator tests: AC306 (tile versus phase-one geometry), AC308 (Node versus Worker), AC311 (no DOM).
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildTiles } from '../packages/builder/dist/index.js';
import { decodeTile } from '../packages/tiles/dist/index.js';
import { generateTile } from '../packages/generators/dist/index.js';
import { phase1Buildings, tileBuildings, compareBuildings } from './helpers/phase2-compare.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sample = (name) => path.join(root, 'public/data', `${name}.json`);

test('AC306: tile-generated buildings match phase-one direct generation', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'city-gen-'));
  try {
    let total = 0;
    const exceptions = [];
    for (const name of ['bibury-village', 'beijing-cbd', 'beijing-lingxiu-d']) {
      const out = path.join(base, name);
      const { report } = await buildTiles({ input: sample(name), output: out });
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
      for (const r of rows) if (r.dBounds > 0.1 || r.dTriangles > 0.02) exceptions.push({ name, ...r });
    }
    // Documented classes (docs/phase2/evidence/C/report.md): entrance canopies on two walls whose lengths sit
    // inside the quantisation band around the 10 cm tie threshold, and facade bay counts at a length threshold.
    assert.ok(
      exceptions.length <= Math.ceil(total * 0.01),
      `${exceptions.length} of ${total}: ${JSON.stringify(exceptions)}`,
    );
    for (const e of exceptions) assert.ok(e.dBounds < 0.5 && e.dTriangles < 0.1, JSON.stringify(e));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
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
      const local = generateTile(decodeTile(bytes));
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
