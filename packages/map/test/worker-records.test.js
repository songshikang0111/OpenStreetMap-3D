import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeTile, tileMetersToLngLat } from '@city-ink/tiles';
import { handleRequest } from '../dist/worker-core.js';

test('worker pick bounds follow interleaved mesh owners and retain the shared extent for unassigned meshes', () => {
  const id = { z: 16, x: 53968, y: 24830 };
  const mesh = {
    type: 'mesh',
    positionEncoding: 'float32',
    position: [1, 0, 1, 20, 0, 7, 3, 0, 5, 10, 0, 12],
    index: [],
    submeshes: [],
    features: [
      { id: 'way/1', renderId: 17 },
      { id: 'way/2', renderId: 512 },
      { id: 'way/3', renderId: 4098 },
    ],
  };
  function records(vertexFeature) {
    const buffer = encodeTile({ id, profile: 'full', layers: { landmark: { ...mesh, vertexFeature } } });
    const { response } = handleRequest({ type: 'generate', job: 1, buffer, options: {} });
    assert.equal(response.type, 'result', response.diagnostic?.message);
    return response;
  }
  function bounds(x0, z0, x1, z1) {
    return [...tileMetersToLngLat(id, x0, z1), ...tileMetersToLngLat(id, x1, z0)];
  }
  const assigned = records([0, 1, 0, 1]);
  assert.equal(assigned.maxRenderId, 512);
  assert.deepEqual(
    assigned.features.map((f) => f.bounds),
    [bounds(1, 1, 3, 5), bounds(10, 7, 20, 12)],
  );
  assert.deepEqual(assigned.features[0].lngLat, tileMetersToLngLat(id, 2, 3));
  const shared = records(null);
  assert.equal(shared.maxRenderId, 4098);
  assert.deepEqual(
    shared.features.map((f) => f.bounds),
    Array(3).fill(bounds(1, 1, 20, 12)),
  );
});

test('an empty feature cannot borrow the next feature’s vertices or enlarge the state texture', () => {
  const buffer = encodeTile({
    id: { z: 16, x: 1020, y: 2100 },
    profile: 'full',
    layers: {
      point: {
        type: 'features',
        geometry: 'point',
        features: [
          { id: 'node/1', renderId: 900, geometry: [] },
          { id: 'node/2', renderId: 11, geometry: [[[0, 2]]] },
        ],
      },
    },
  });
  const { response } = handleRequest({ type: 'generate', job: 1, buffer, options: {} });
  assert.equal(response.type, 'result', response.diagnostic?.message);
  assert.deepEqual(
    response.features.map((feature) => feature.id),
    ['node/2'],
  );
  assert.equal(response.maxRenderId, 11);
});
