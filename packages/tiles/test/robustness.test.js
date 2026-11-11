import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeTile,
  encodeTile,
  readFeatures,
  TileError,
  decodeCoverage,
  encodeCoverage,
  Coverage,
} from '../dist/index.js';
import { rng, randomFeatureLayer, randomMeshLayer } from './helpers.js';

const TILE = { z: 16, x: 53958, y: 24829 };

function attempt(bytes) {
  const started = performance.now();
  try {
    const t = decodeTile(bytes);
    // materialising every feature must also be safe for anything decodeTile accepted
    for (const layer of Object.values(t.layers)) if (layer.type === 'features') readFeatures(layer);
  } catch (error) {
    assert.ok(error instanceof TileError, `unstructured error: ${error?.stack ?? error}`);
    assert.equal(typeof error.code, 'string');
    assert.equal(error.stage, 'decode');
    assert.ok(error.message.length > 0);
  }
  const ms = performance.now() - started;
  assert.ok(ms < 1000, `decode took ${ms} ms`);
  return ms;
}

test('AC204: truncations, random byte flips and oversized length fields yield structured errors quickly', () => {
  const r = rng(204);
  const samples = [];
  for (let i = 0; i < 12; i++)
    samples.push(
      encodeTile({
        id: TILE,
        profile: 'full',
        layers: {
          building: randomFeatureLayer(r, 'polygon', 20),
          road: randomFeatureLayer(r, 'line', 10, { elevation: true }),
          landmark: randomMeshLayer(r, 60, 2),
        },
      }),
    );
  let runs = 0;
  let worst = 0;
  for (const bytes of samples) {
    // every truncation length on a stride, plus the last 64 bytes exhaustively
    for (let len = 0; len < bytes.length; len += len > bytes.length - 64 ? 1 : 7) {
      worst = Math.max(worst, attempt(bytes.slice(0, len)));
      runs++;
    }
    // random flips
    for (let k = 0; k < 200; k++) {
      const copy = bytes.slice();
      const flips = 1 + Math.floor(r() * 8);
      for (let f = 0; f < flips; f++) copy[Math.floor(r() * copy.length)] ^= 1 << Math.floor(r() * 8);
      worst = Math.max(worst, attempt(copy));
      runs++;
    }
    // oversized u32 fields at every 4-byte-aligned offset
    for (let at = 0; at + 4 <= bytes.length; at += 4) {
      for (const value of [0xffffffff, 0x7fffffff, bytes.length + 1]) {
        const copy = bytes.slice();
        new DataView(copy.buffer).setUint32(at, value, true);
        worst = Math.max(worst, attempt(copy));
        runs++;
      }
    }
  }
  // garbage inputs
  for (let k = 0; k < 500; k++) {
    const len = Math.floor(r() * 400);
    const junk = new Uint8Array(len).map(() => Math.floor(r() * 256));
    if (len >= 6) junk.set([0x43, 0x33, 0x54, 0x01, 1, 0], 0);
    worst = Math.max(worst, attempt(junk));
    runs++;
  }
  assert.ok(runs > 20000, `${runs} runs`);
  assert.ok(worst < 1000);
});

test('decodeTile rejects non-buffer input with a structured error', () => {
  assert.throws(
    () => decodeTile('nope'),
    (e) => e instanceof TileError && e.code === 'TILE_INPUT_INVALID',
  );
  assert.throws(
    () => decodeTile(null),
    (e) => e instanceof TileError,
  );
});

test('encodeTile rejects invalid input with paths', () => {
  const bad = (layers, code) =>
    assert.throws(
      () => encodeTile({ id: TILE, profile: 'full', layers }),
      (e) => e instanceof TileError && e.code === code && !!e.path,
    );
  bad(
    {
      b: {
        type: 'features',
        geometry: 'polygon',
        features: [{ id: 'way/1', renderId: 0, geometry: [[[0, 0, 40000, 0, 0, 1]]] }],
      },
    },
    'TILE_COORD_RANGE',
  );
  bad(
    { b: { type: 'features', geometry: 'polygon', features: [{ id: 'way/x', renderId: 0, geometry: [] }] } },
    'FEATURE_ID_INVALID',
  );
  bad(
    { b: { type: 'features', geometry: 'polygon', features: [{ id: 'way/1', renderId: -1, geometry: [] }] } },
    'RENDER_ID_INVALID',
  );
  bad(
    {
      b: {
        type: 'features',
        geometry: 'point',
        attributes: [{ name: 'n', type: 'u32' }],
        features: [{ id: 'node/1', renderId: 0, geometry: [[[0, 0]]], properties: { n: 1.5 } }],
      },
    },
    'ATTRIBUTE_RANGE',
  );
  bad(
    {
      m: {
        type: 'mesh',
        positionEncoding: 'quantized',
        position: [0, 0, 1e6],
        index: [0, 0, 0],
        submeshes: [],
        features: [],
      },
    },
    'TILE_COORD_RANGE',
  );
  bad({ m: { type: 'mesh', position: [0, 0, 0], index: [0, 0, 3], submeshes: [], features: [] } }, 'MESH_INVALID');
});

test('coverage round-trips and rejects corruption', () => {
  const r = rng(9);
  const tiles = [];
  for (let i = 0; i < 300; i++) tiles.push({ z: 16, x: 53950 + Math.floor(r() * 30), y: 24820 + Math.floor(r() * 20) });
  const c = Coverage.fromTiles(16, tiles);
  const back = decodeCoverage(encodeCoverage(c));
  for (const t of tiles) assert.ok(back.has(t));
  assert.equal(back.count, new Set(tiles.map((t) => `${t.x}/${t.y}`)).size);
  assert.ok(!back.has({ z: 16, x: 1, y: 1 }));
  assert.ok(back.has({ z: 14, x: Math.floor(tiles[0].x / 4), y: Math.floor(tiles[0].y / 4) }), 'ancestor exists');
  assert.ok(back.has({ z: 17, x: tiles[0].x * 2 + 1, y: tiles[0].y * 2 }), 'descendant inherits');
  assert.ok(!back.has({ z: 14, x: 1, y: 1 }));
  const bytes = encodeCoverage(c);
  for (let len = 0; len < bytes.length; len++)
    assert.throws(
      () => decodeCoverage(bytes.slice(0, len)),
      (e) => e instanceof TileError,
    );
});
