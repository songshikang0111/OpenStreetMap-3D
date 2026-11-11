import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeTile, encodeTile, readFeatures } from '../dist/index.js';

const TILE = { z: 16, x: 53958, y: 24829 };

test('decodeTile accepts Node Buffers that are views into a shared pool', () => {
  const layer = {
    type: 'features',
    geometry: 'point',
    features: [{ id: 'node/1', renderId: 0, geometry: [[[1, 2]]] }],
  };
  const bytes = encodeTile({ id: TILE, profile: 'full', layers: { tree: layer } });
  const pooled = Buffer.concat([Buffer.alloc(3), Buffer.from(bytes)]).subarray(3);
  assert.notEqual(pooled.byteOffset % 4, 0);
  assert.equal(readFeatures(decodeTile(pooled).layers.tree)[0].id, 'node/1');
  const small = Buffer.from(bytes); // small Buffers live in Node's shared allocation pool
  assert.equal(decodeTile(small).id.x, TILE.x);
});
