import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { encodeTile, decodeTile, readFeatures } from '../dist/index.js';
import { rng, randomFeatureLayer } from './helpers.js';

test('AC206: decodeTile runs in a worker without DOM and the package has no runtime dependencies', async () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.peerDependencies, undefined);
  const bytes = encodeTile({
    id: { z: 16, x: 1, y: 2 },
    profile: 'full',
    layers: { building: randomFeatureLayer(rng(6), 'polygon', 50) },
  });
  const local = readFeatures(decodeTile(bytes).layers.building);
  const worker = new Worker(
    `const { parentPort } = require('node:worker_threads');
     import(${JSON.stringify(new URL('../dist/index.js', import.meta.url).href)}).then(({ decodeTile, readFeatures }) => {
       parentPort.on('message', (buffer) => {
         const hasDom = typeof document !== 'undefined' || typeof window !== 'undefined';
         const tile = decodeTile(buffer);
         parentPort.postMessage({ hasDom, features: readFeatures(tile.layers.building) });
       });
       parentPort.postMessage('ready');
     });`,
    { eval: true },
  );
  const messages = [];
  const result = await new Promise((resolve, reject) => {
    worker.on('error', reject);
    worker.on('message', (m) => {
      messages.push(m);
      if (m === 'ready') {
        const copy = bytes.slice().buffer;
        worker.postMessage(copy, [copy]);
      } else resolve(m);
    });
  });
  await worker.terminate();
  assert.equal(result.hasDom, false);
  assert.deepEqual(result.features, local);
});

test('dist sources import nothing outside the package', () => {
  for (const file of [
    'index.js',
    'codec.js',
    'mercator.js',
    'coverage.js',
    'tileset.js',
    'layers.js',
    'naming.js',
    'diagnostics.js',
  ]) {
    const source = readFileSync(new URL(`../dist/${file}`, import.meta.url), 'utf8');
    for (const m of source.matchAll(/from\s+['"]([^'"]+)['"]/g))
      assert.ok(m[1].startsWith('./'), `${file} imports ${m[1]}`);
  }
});
