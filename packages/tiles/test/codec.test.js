import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeTile,
  encodeTile,
  readFeatures,
  readFeatureMeta,
  tryDecodeTile,
  gridStepMeters,
  quantizeLngLat,
  dequantizeToMercator,
  tileToLngLatBounds,
  tileSizeMeters,
  lngLatToMercator,
  TileError,
  FORMAT_MAJOR,
  HEIGHT_STEPS_PER_METER,
} from '../dist/index.js';
import { rng, randomFeatureLayer, randomMeshLayer } from './helpers.js';

const TILE = { z: 16, x: 53958, y: 24829 };

function normalizeFeature(f, attributes, elevation) {
  const properties = {};
  for (const a of attributes) {
    const v = f.properties?.[a.name];
    properties[a.name] = v === undefined || v === null ? null : a.type === 'f32' ? Math.fround(v) : v;
  }
  const out = {
    id: f.id,
    renderId: f.renderId,
    geometry: f.geometry,
    properties,
    provenance: f.provenance ?? {},
    tags: f.tags ?? {},
  };
  if (elevation)
    out.elevation = f.elevation.map((p) => p.map((r) => r.map((h) => Math.round(h * HEIGHT_STEPS_PER_METER) + 0)));
  return out;
}

test('AC201: 1,000 random feature and mesh layers round-trip on the quantisation grid', () => {
  const r = rng(201);
  let cases = 0;
  for (let c = 0; c < 1000; c++) {
    const geometry = ['polygon', 'line', 'point'][c % 3];
    const elevation = geometry === 'line' || c % 7 === 0;
    const layer = randomFeatureLayer(r, geometry, 1 + Math.floor(r() * 12), { elevation });
    const mesh = randomMeshLayer(r, 6 + Math.floor(r() * 40), 1 + Math.floor(r() * 4), c % 10 === 0 ? 5000 : 400);
    const tile = { id: TILE, profile: c % 2 ? 'full' : 'massing', layers: { a: layer, m: mesh } };
    const decoded = decodeTile(encodeTile(tile));
    assert.deepEqual(decoded.id, TILE);
    assert.equal(decoded.profile, tile.profile);
    const got = readFeatures(decoded.layers.a).map((f) => normalizeFeature(f, layer.attributes, elevation));
    const want = layer.features.map((f) => normalizeFeature(f, layer.attributes, elevation));
    assert.deepEqual(got, want, `feature layer case ${c}`);
    const m = decoded.layers.m;
    assert.equal(m.positionEncoding, c % 10 === 0 ? 'float32' : 'quantized');
    assert.deepEqual(Array.from(m.index), mesh.index);
    assert.deepEqual(Array.from(m.vertexFeature), mesh.vertexFeature);
    assert.deepEqual(m.submeshes, mesh.submeshes);
    assert.deepEqual(Array.from(m.vertexAttributes.facadeShade.array), mesh.vertexAttributes.facadeShade.array);
    assert.deepEqual(
      readFeatureMeta(m.features).map((f) => f.id),
      mesh.features.map((f) => f.id),
    );
    const step = gridStepMeters(TILE, decoded.extentLog2);
    for (let i = 0; i < mesh.position.length; i++) {
      const tol =
        m.positionEncoding === 'float32' ? 1e-3 : i % 3 === 1 ? 0.5 / HEIGHT_STEPS_PER_METER + 1e-4 : step / 2 + 1e-4;
      assert.ok(Math.abs(m.position[i] - mesh.position[i]) <= tol, `mesh position ${i} case ${c}`);
    }
    // re-encoding a decoded tile is byte-identical
    assert.deepEqual(encodeTile(decoded), encodeTile(tile));
    cases++;
  }
  assert.equal(cases, 1000);
});

test('encoding is deterministic regardless of layer insertion order', () => {
  const r = rng(7);
  const a = randomFeatureLayer(r, 'polygon', 5);
  const b = randomFeatureLayer(r, 'point', 5);
  assert.deepEqual(
    encodeTile({ id: TILE, profile: 'full', layers: { a, b } }),
    encodeTile({ id: TILE, profile: 'full', layers: { b, a } }),
  );
});

test('AC202: quantisation error is at most 5 cm horizontally and vertically, ranges match 02 section 5.2', () => {
  for (const [z, lat] of [
    [16, 0],
    [16, 40],
    [16, 79.9],
    [14, 0],
    [14, 40],
    [18, 0],
  ]) {
    const id = { z, x: 2 ** (z - 1), y: Math.floor(lngLatToMercator([0, lat])[1] * 2 ** z) };
    const extent = z >= 16 ? 14 : 15;
    const step = gridStepMeters(id, extent);
    const maxError = Math.SQRT1_2 * step; // worst case on the diagonal of a grid cell
    assert.ok(maxError / Math.SQRT2 <= 0.05, `z${z} lat ${lat}: per-axis error ${step / 2}`);
    assert.ok(step / 2 <= 0.05);
    // The grid is Mercator-aligned (needed for AC203), so the int16 range is fixed in tile widths: ±2 tiles at
    // z >= 16 (about ±937 m at 40°N) and ±1 tile at z14 (about ±1,874 m at 40°N). Decision E2.
    const tileWidths = (32767 * step) / tileSizeMeters(id);
    assert.ok(tileWidths >= (z >= 16 ? 1.99 : 0.99), `range ${tileWidths} tile widths at z${z}`);
    if (z === 16 && lat === 40) assert.ok(32767 * step > 900);
  }
  // vertical: 1/16 m steps -> error 3.125 cm, 0..4095.9 m above the layer base
  assert.ok(0.5 / HEIGHT_STEPS_PER_METER <= 0.05);
  const deep = {
    type: 'features',
    geometry: 'line',
    elevation: true,
    features: [{ id: 'way/1', renderId: 0, geometry: [[[0, 0, 10, 10]]], elevation: [[[-30.03, 4000.04]]] }],
  };
  const back = readFeatures(
    decodeTile(encodeTile({ id: TILE, profile: 'full', layers: { road: deep } })).layers.road,
  )[0];
  assert.ok(Math.abs(back.elevation[0][0][0] + 30.03) <= 1 / 32);
  assert.ok(Math.abs(back.elevation[0][0][1] - 4000.04) <= 1 / 32);
  assert.throws(
    () =>
      encodeTile({
        id: TILE,
        profile: 'full',
        layers: { road: { ...deep, features: [{ ...deep.features[0], elevation: [[[0, 5000]]] }] } },
      }),
    (e) => e instanceof TileError && e.code === 'ELEVATION_RANGE',
  );
});

test('AC203: a vertex on a shared edge maps to the identical Mercator position from both tiles', () => {
  const r = rng(203);
  for (let i = 0; i < 2000; i++) {
    const z = r() < 0.5 ? 16 : 14;
    const extent = z >= 16 ? 14 : 15;
    const x = (40000 + Math.floor(r() * 10000)) >> (16 - z);
    const y = (20000 + Math.floor(r() * 10000)) >> (16 - z);
    const a = { z, x, y };
    const vertical = r() < 0.5;
    const b = vertical ? { z, x: x + 1, y } : { z, x, y: y + 1 };
    const [w, s, e, n] = tileToLngLatBounds(a);
    const point = vertical ? [e, s + r() * (n - s)] : [w + r() * (e - w), s];
    const qa = quantizeLngLat(a, extent, point);
    const qb = quantizeLngLat(b, extent, point);
    assert.deepEqual(dequantizeToMercator(a, extent, ...qa), dequantizeToMercator(b, extent, ...qb));
    // the edge itself sits exactly on grid line ±2^(extent-1) in both tiles
    if (vertical) assert.equal(qa[0] - qb[0], 2 ** extent);
  }
});

test('AC205: unknown layers and minor fields are skipped; an unknown major version is rejected', () => {
  const r = rng(205);
  const bytes = encodeTile({
    id: TILE,
    profile: 'full',
    layers: { building: randomFeatureLayer(r, 'polygon', 3), future: randomFeatureLayer(r, 'point', 2) },
  });
  // mark the "future" layer's encoding as unknown (3) in the directory
  const view = new DataView(bytes.buffer);
  const dir = view.getUint32(24, true);
  const count = view.getUint16(14, true);
  const copy = bytes.slice();
  const cv = new DataView(copy.buffer);
  for (let i = 0; i < count; i++) {
    const at = dir + i * 20;
    const decoded = decodeTile(bytes);
    const names = Object.keys(decoded.layers).sort();
    if (names[i] === 'future') cv.setUint8(at + 4, 3);
  }
  const t = decodeTile(copy);
  assert.deepEqual(Object.keys(t.layers), ['building']);
  assert.deepEqual(t.skippedLayers, ['future']);
  // newer minor version decodes
  const minor = bytes.slice();
  new DataView(minor.buffer).setUint16(6, 9, true);
  assert.equal(decodeTile(minor).version.minor, 9);
  // unknown section codes inside a layer are skipped: append nothing, just verify filter-only decode
  assert.deepEqual(Object.keys(decodeTile(bytes, { layers: ['building'] }).layers), ['building']);
  // newer major version is rejected with a clear diagnostic
  const major = bytes.slice();
  new DataView(major.buffer).setUint16(4, FORMAT_MAJOR + 1, true);
  assert.throws(
    () => decodeTile(major),
    (e) => e instanceof TileError && e.code === 'TILE_VERSION_UNSUPPORTED' && /Upgrade/.test(e.hint),
  );
});

test('AC205: an unknown section code inside a layer is skipped', () => {
  const layer = {
    type: 'features',
    geometry: 'point',
    features: [{ id: 'node/1', renderId: 0, geometry: [[[1, 2]]], properties: { kind: 'x' } }],
  };
  const bytes = encodeTile({ id: TILE, profile: 'full', layers: { tree: layer } });
  // rewrite the first section code (ID_TYPE = 1) by inserting a fake section is complex; instead relabel the
  // attribute section as unknown code 999 and check the layer still decodes without that attribute
  const v = new DataView(bytes.buffer);
  const layerAt = v.getUint32(v.getUint32(24, true) + 8, true);
  let at = layerAt + 16;
  const sections = v.getUint32(layerAt + 12, true);
  for (let i = 0; i < sections; i++) {
    const code = v.getUint16(at, true);
    const len = v.getUint32(at + 4, true);
    if (code === 12) v.setUint16(at, 999, true);
    at += 8 + len + ((4 - (len % 4)) % 4);
  }
  const t = decodeTile(bytes);
  assert.equal(t.layers.tree.featureCount, 1);
  assert.equal(t.layers.tree.attributes.length, 0);
});

test('tryDecodeTile returns a structured diagnostic', () => {
  const result = tryDecodeTile(new Uint8Array([1, 2, 3]));
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.stage, 'decode');
  assert.equal(result.diagnostic.code, 'TILE_TRUNCATED');
});

test('feature ids above 2^53 survive the round trip', () => {
  const layer = {
    type: 'features',
    geometry: 'point',
    features: [{ id: 'way/18446744073709551615', renderId: 0, geometry: [[[0, 0]]] }],
  };
  const t = decodeTile(encodeTile({ id: TILE, profile: 'full', layers: { tree: layer } }));
  assert.equal(readFeatures(t.layers.tree)[0].id, 'way/18446744073709551615');
});
